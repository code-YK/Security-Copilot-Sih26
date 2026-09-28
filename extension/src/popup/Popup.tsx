import {
  AlertTriangle,
  Ban,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Loader2,
  Radar,
  RotateCcw,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { api, ApiError } from "@/lib/api";
import { extractPageContent, MAX_PAGE_TEXT_CHARS } from "@/lib/pageContent";
import { getPendingFullCheck, getStorage, getTabVerdict, type PendingFullCheck, type TabVerdict } from "@/lib/storage";
import { isWebmailHost } from "@/lib/webmail";
import type { QuickCheckEmailResponse, ReportResponse } from "@/types";

type ReportState =
  | { url: string; status: "idle" }
  | { url: string; status: "loading" }
  | { url: string; status: "done"; result: ReportResponse }
  | { url: string; status: "error"; message: string };

interface ActiveTab {
  id: number;
  url: string;
  hostname: string;
}

type View =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "idle"; tab: ActiveTab }
  // `step` is a live label from background.ts's SSE consumption of
  // /check-links-stream or /check-email-stream (e.g. "Checking
  // VirusTotal...", "Exploring another page found on the site..."),
  // absent until the first progress event arrives — both kinds stream
  // now, an email investigation follows every link it found the same
  // way a link case follows a suspicious link on the page.
  | { status: "checking"; tab: ActiveTab; kind: "link" | "email"; step?: string }
  | { status: "result"; tab: ActiveTab; verdict: TabVerdict }
  | { status: "error"; tab: ActiveTab; message: string };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// Verdict → icon + verdict-colour class (see styles/aegis.css's `.v-*`).
// Widened to TabVerdict["label"] | QuickCheckEmailResponse["label"] — the
// same rendering (a generic "info" look via the switch's default case)
// already covers "inconclusive" and "unknown" identically, so this is
// just making the signature honest about the two label sets that
// actually get passed to it, not a behavior change.
function labelMeta(label: TabVerdict["label"] | QuickCheckEmailResponse["label"]) {
  switch (label) {
    case "dangerous":
      return { Icon: ShieldAlert, vclass: "v-critical" };
    case "suspicious":
      return { Icon: AlertTriangle, vclass: "v-medium" };
    case "safe":
      return { Icon: ShieldCheck, vclass: "v-safe" };
    default:
      return { Icon: ShieldQuestion, vclass: "v-info" };
  }
}

// The gauge always reads as *risk* — 0 = safe, 100 = dangerous — coloured
// by the verdict. The trick is that `confidence` means two different things
// depending on how the verdict was produced (see storage.ts's TabVerdict):
//   • quick scans store the local model's *threat probability* (low = safe),
//     so it maps straight to risk — a safe quick scan is a low number, not
//     the misleading 100−conf a naive inversion produced (a 4% threat score
//     used to render as "96", contradicting the green "Safe" label).
//   • the full agent stores its *confidence in the verdict* (high = sure),
//     so a confident "safe" is inverted into low risk and a confident
//     "phishing" maps straight through.
// `sub` is the honest sub-label: literal confidence for a full verdict, a
// plain "Local quick scan" for the model-only one (whose number isn't a
// confidence and shouldn't be shown as one).
function riskInfo(v: Pick<TabVerdict, "kind" | "label" | "confidence">): { risk: number; sub: string } {
  const c = Math.round(v.confidence * 100);
  if (v.kind === "quick") {
    return { risk: v.label === "safe" ? Math.min(c, 12) : c, sub: "Local quick scan" };
  }
  return { risk: v.label === "safe" ? Math.max(2, 100 - c) : c, sub: `${c}% confidence` };
}

// Eases a number from 0 → target once on mount, for the gauge count-up.
// Respects reduced-motion by jumping straight to the target.
function useCountUp(target: number, ms = 750): number {
  const [n, setN] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    setN(0);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return n;
}

export function Popup() {
  const [view, setView] = useState<View>({ status: "loading" });
  const [reportState, setReportState] = useState<ReportState>({ url: "", status: "idle" });
  // The automatic "you're looking at an email" quick check (see the
  // useEffect below) — separate from `view` on purpose: it's an
  // auxiliary, always-fast BERT-only read of the page's text, shown
  // alongside the normal idle state rather than replacing it, and never
  // itself gets stored as a TabVerdict the way a real check does.
  const [quickEmailCheck, setQuickEmailCheck] = useState<
    null | { status: "checking" } | { status: "done"; result: QuickCheckEmailResponse; text: string; links: string[] }
  >(null);
  const tab = "tab" in view ? view.tab : null;

  useEffect(() => {
    void bootstrap();
  }, []);

  // A "Full report" run started from the banner (or from this popup on a
  // previous open) lives in the background service worker, not in this
  // popup — popups close the instant they lose focus, so this component
  // can't just await a fetch itself and expect to still be around when it
  // resolves. Instead it watches chrome.storage.session for the same
  // writes background.ts's runFullCheck already makes, and reflects
  // whatever it finds — whether or not this popup instance is the one
  // that started the check.
  useEffect(() => {
    if (!tab) return;
    const tabId = tab.id;
    const currentUrl = tab.url;

    function onChanged(changes: Record<string, chrome.storage.StorageChange>, areaName: string) {
      if (areaName !== "session") return;
      const verdictChange = changes[`tab_verdict_${tabId}`];
      if (verdictChange) {
        const newVerdict = verdictChange.newValue as TabVerdict | undefined;
        if (newVerdict && newVerdict.checkedUrl === currentUrl) {
          setView({ status: "result", tab: { id: tabId, url: currentUrl, hostname: hostnameOf(currentUrl) }, verdict: newVerdict });
        }
        return;
      }
      const pendingChange = changes[`pending_full_check_${tabId}`];
      if (!pendingChange) return;
      if (pendingChange.newValue === undefined) {
        // Pending check cleared with no verdict update alongside it (that
        // case is handled above) means the check failed — but only worth
        // reporting if this popup was actually shown as waiting on it.
        setView((prev) =>
          prev.status === "checking"
            ? {
                status: "error",
                tab: prev.tab,
                message:
                  "The full investigation couldn't complete. Make sure the backend is running and its agent is configured (an LLM API key is required for full scans — the quick scan works without one).",
              }
            : prev,
        );
        return;
      }
      // A live step label landed (background.ts's runFullCheck /
      // runFullEmailCheck updates this on every SSE progress event) —
      // reflect it if this popup is currently showing the "checking"
      // state for the same check.
      const newPending = pendingChange.newValue as PendingFullCheck;
      if (newPending.url === currentUrl && newPending.step) {
        setView((prev) => (prev.status === "checking" ? { ...prev, step: newPending.step } : prev));
      }
    }

    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [tab?.id, tab?.url]);

  // The email quick-check is offered whenever nothing more specific than
  // the passive per-navigation URL scan (kind "quick") has happened for
  // this tab yet. That automatic URL scan fires — and, on any reasonable
  // connection, finishes — on every navigation, including the webmail
  // site's own domain, well before a user could realistically open the
  // popup. Gating purely on view.status === "idle" would mean this
  // almost never triggers in practice: bootstrap() finds that cached URL
  // verdict first and jumps straight to "result", and the email-content
  // check (a completely different signal — about the open email, not
  // about mail.google.com's own domain) never gets a chance to run.
  const emailQuickCheckEligible =
    !!tab && isWebmailHost(tab.hostname) && (view.status === "idle" || (view.status === "result" && view.verdict.kind === "quick"));

  // The automatic webmail scan: the instant the popup opens on a
  // recognized webmail tab with nothing more specific already shown,
  // extract the page's text + real link hrefs and run them through the
  // fast BERT-only quick check — no click needed, the same way the
  // extension already shows an automatic quick verdict for the current
  // tab's URL on every navigation. Deliberately NOT fully passive/
  // background like that URL autoscan, though: this only runs when the
  // user actually opens the popup, since it means sending this page's
  // visible text to the backend, which shouldn't happen on every email a
  // user merely has open in a tab.
  useEffect(() => {
    if (!emailQuickCheckEligible || !tab) return;
    let cancelled = false;
    setQuickEmailCheck({ status: "checking" });
    void (async () => {
      const extracted = await extractPageContent(tab.id);
      if (cancelled) return;
      const text = extracted.text.slice(0, MAX_PAGE_TEXT_CHARS);
      if (!text.trim()) {
        setQuickEmailCheck(null);
        return;
      }
      try {
        const result = await api.post<QuickCheckEmailResponse>("/quick-check-email", {
          text,
          links: extracted.links,
        });
        if (!cancelled) setQuickEmailCheck({ status: "done", result, text, links: extracted.links });
      } catch {
        // A quick-check failure should never block using the popup —
        // same principle as background.ts's scanNavigation.
        if (!cancelled) setQuickEmailCheck(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailQuickCheckEligible, tab?.id]);

  async function bootstrap() {
    const [chromeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!chromeTab?.id || !chromeTab.url || !chromeTab.url.startsWith("http")) {
      setView({ status: "unsupported" });
      return;
    }
    const tab: ActiveTab = { id: chromeTab.id, url: chromeTab.url, hostname: hostnameOf(chromeTab.url) };

    // Checked before the cached verdict below, deliberately: the automatic
    // quick-scan sets a (kind: "quick") verdict on essentially every
    // navigation, almost always well before the user could open this
    // popup — so if that check ran first, a full check already running in
    // the background (started from the banner, or from a previous popup
    // open that got closed before it finished) would never be reflected,
    // and the user would see a stale quick-scan result with no indication
    // anything is in progress.
    const pending = await getPendingFullCheck(tab.id);
    if (pending && pending.url === tab.url) {
      setView({ status: "checking", tab, kind: pending.kind, step: pending.step });
      return;
    }

    const cached = await getTabVerdict(tab.id);
    if (cached && cached.checkedUrl === tab.url) {
      setView({ status: "result", tab, verdict: cached });
      return;
    }

    setView({ status: "idle", tab });
  }

  async function handleCheckUrl(tab: ActiveTab) {
    setView({ status: "checking", tab, kind: "link" });
    // The actual /check-links call now runs in the background service
    // worker (background.ts's runFullCheck), not here — a full
    // investigation can take 10-40s, and this popup closes the instant it
    // loses focus, which would silently abandon a check run locally the
    // same way the banner's "Full report" button used to get stuck. The
    // result comes back through the storage.onChanged listener above,
    // whether or not this exact popup instance is still open when it
    // lands. This also means a check already running (started from the
    // banner) is naturally deduped — see runFullCheck's pending-check
    // guard — instead of firing a second, redundant one.
    try {
      await chrome.runtime.sendMessage({ type: "RUN_FULL_CHECK", url: tab.url, tabId: tab.id });
    } catch {
      setView({ status: "error", tab, message: "Could not start the check. Try again." });
    }
  }

  // Shared by the manual "Check page text" button (any page other than a
  // recognized webmail tab) and the automatic webmail quick-check's
  // "Check this email" button — both end up wanting the same thing: hand
  // text + links to background.ts's
  // runFullEmailCheck, which streams the real investigation (every
  // extracted link gets its own inspect_website + domain_reputation look,
  // not just the email's wording) the same reliable, survives-a-closed-
  // popup way handleCheckUrl already does for a link case.
  async function runFullEmailScan(tab: ActiveTab, text: string, links: string[]) {
    setView({ status: "checking", tab, kind: "email" });
    try {
      await chrome.runtime.sendMessage({ type: "RUN_FULL_EMAIL_CHECK", text, links, pageUrl: tab.url, tabId: tab.id });
    } catch {
      setView({ status: "error", tab, message: "Could not start the check. Try again." });
    }
  }

  async function handleCheckText(tab: ActiveTab) {
    setView({ status: "checking", tab, kind: "email" });
    const extracted = await extractPageContent(tab.id);
    const text = extracted.text.slice(0, MAX_PAGE_TEXT_CHARS);
    if (!text.trim()) {
      setView({ status: "error", tab, message: "This page has no readable text to check." });
      return;
    }
    await runFullEmailScan(tab, text, extracted.links);
  }

  async function handleViewReport(runId: string) {
    const { dashboardBaseUrl } = await getStorage();
    chrome.tabs.create({ url: `${dashboardBaseUrl}/run/${runId}` });
  }

  // Reports the URL to VirusTotal and adds its domain to this tool's own
  // blocklist (backend/reporting.py's module docstring has the full
  // reasoning: this is the legal, effective alternative to attacking the
  // site back). REFRESH_BLOCKLIST tells background.ts to re-sync its
  // local copy immediately, so onBeforeNavigate enforces this domain on
  // the very next navigation rather than waiting for the periodic alarm.
  async function handleReportBlock(url: string) {
    setReportState({ url, status: "loading" });
    try {
      const result = await api.post<ReportResponse>("/report", { url });
      setReportState({ url, status: "done", result });
      void chrome.runtime.sendMessage({ type: "REFRESH_BLOCKLIST" });
    } catch (error) {
      setReportState({ url, status: "error", message: error instanceof ApiError ? error.message : "Report failed." });
    }
  }

  const isWebmail = emailQuickCheckEligible;

  return (
    <div className="popup">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="hdr">
        <BrandMark active={view.status === "checking" || quickEmailCheck?.status === "checking"} />
        <div className="wordmark">
          <b>Security Copilot</b>
          <span className="sub">Email forensic intelligence</span>
        </div>
        <div className="hdr-actions">
          <ThemeToggle />
          <button className="ico-btn" title="Settings" aria-label="Settings" onClick={() => chrome.runtime.openOptionsPage()}>
            <Settings />
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <div className="body">
        {view.status === "loading" && <p className="centered">Loading…</p>}

        {view.status === "unsupported" && <p className="centered">Open a regular http(s) page to run a check.</p>}

        {tab && (
          <>
            {/* Current page */}
            <div className="host" title={tab.url}>
              <Globe className="globe" />
              <span className="name">{tab.hostname}</span>
              {isWebmail && <span className="tag">Webmail</span>}
            </div>

            {/* Primary actions */}
            <div className={isWebmail ? "actions" : "actions two"}>
              <button className="btn" disabled={view.status === "checking"} onClick={() => handleCheckUrl(tab)}>
                {view.status === "checking" && view.kind === "link" ? (
                  <Loader2 className="ae-spin" />
                ) : (
                  <span className="lead">
                    <Link2 />
                  </span>
                )}
                Check this URL
              </button>
              {/* Hidden on a webmail tab once the quick-check panel below is */}
              {/* showing — its "Check this email" button does the exact same */}
              {/* thing (extract text + links, run the full investigation). */}
              {!isWebmail && (
                <button className="btn" disabled={view.status === "checking"} onClick={() => handleCheckText(tab)}>
                  {view.status === "checking" && view.kind === "email" ? (
                    <Loader2 className="ae-spin" />
                  ) : (
                    <span className="lead">
                      <FileText />
                    </span>
                  )}
                  Check page text
                </button>
              )}
            </div>

            {/* Scanning */}
            {view.status === "checking" && (
              <div className="scan">
                <div className="radar">
                  <div className="scope">
                    <div className="sweep" />
                    <span className="blip b1" />
                    <span className="blip b2" />
                    <span className="core" />
                  </div>
                </div>
                <div className="scanbar">
                  <span />
                </div>
                <div className="step">
                  <span className="dot" />
                  {/* keyed so each new step label re-triggers its entrance animation */}
                  <span className="label" key={view.step ?? "start"}>
                    {view.step ?? "Starting investigation…"}
                  </span>
                </div>
              </div>
            )}

            {/* Automatic webmail quick-check */}
            {isWebmail && (
              <>
                {quickEmailCheck?.status === "checking" && (
                  <div className="qmail">
                    <div className="row" style={{ color: "var(--text)" }}>
                      <Loader2 className="ae-spin" />
                      <b>Scanning this email…</b>
                    </div>
                  </div>
                )}
                {quickEmailCheck?.status === "done" &&
                  (() => {
                    const { Icon, vclass } = labelMeta(quickEmailCheck.result.label);
                    const { result, text, links } = quickEmailCheck;
                    const isUnknown = result.label === "unknown";
                    // How many independent signals actually weighed in —
                    // Jev/WHOIS may have timed out and dropped silently,
                    // so this reflects what really ran, not what was asked for.
                    const signalCount = result.source.split("+").length;
                    const linksChecked = result.breakdown?.links.length ?? 0;
                    const dangerousLinks =
                      result.breakdown?.links.filter((l) => l.label === "dangerous" || l.label === "suspicious") ?? [];
                    return (
                      <div className={`qmail ${vclass}`}>
                        <div className="row" style={{ color: isUnknown ? "var(--text)" : "var(--v)" }}>
                          <Icon style={{ color: isUnknown ? "var(--text-lo)" : "var(--v)" }} />
                          <b>{isUnknown ? "Quick scan unavailable" : `Quick scan: ${result.label}`}</b>
                        </div>
                        <p className="muted">
                          {isUnknown
                            ? "Run a full scan to investigate this email and every link inside it."
                            : `Cross-checked with ${signalCount} signal${signalCount === 1 ? "" : "s"}${
                                result.source.includes("jev") ? " (text model + Jev)" : " (text model only)"
                              }${linksChecked > 0 ? ` · ${linksChecked} link${linksChecked === 1 ? "" : "s"} checked` : ""}.`}
                        </p>
                        {dangerousLinks.length > 0 && (
                          <ul className="qlinks">
                            {dangerousLinks.map((l, i) => (
                              <li key={`${l.domain}-${i}`} className={l.label === "dangerous" ? "v-critical" : "v-medium"} title={l.domain}>
                                {l.label === "dangerous" ? "⚠" : "?"} {l.domain ?? "unknown link"}
                                {l.source === "virustotal" ? " — flagged by VirusTotal" : ""}
                              </li>
                            ))}
                          </ul>
                        )}
                        <button className="btn primary" style={{ width: "100%", marginTop: 11 }} onClick={() => runFullEmailScan(tab, text, links)}>
                          <span className="lead">
                            <FileText />
                          </span>
                          Check this email
                        </button>
                      </div>
                    );
                  })()}
              </>
            )}

            {/* Error */}
            {view.status === "error" && (
              <div className="err">
                <ShieldAlert />
                <p>{view.message}</p>
              </div>
            )}

            {/* Verdict */}
            {view.status === "result" && (
              <VerdictCard
                verdict={view.verdict}
                reportState={reportState}
                onFullReport={() => handleViewReport(view.verdict.runId!)}
                onRunFullScan={() => handleCheckUrl(tab)}
                onDismiss={() => setView({ status: "idle", tab })}
                onReportBlock={handleReportBlock}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// The verdict hero, split out so it can own the gauge's count-up + ring
// sweep on mount. For a model-only "quick" verdict there's no saved report
// to open, so the primary action escalates to a real investigation ("Run
// full scan") instead of a dead, disabled "Full report" button.
function VerdictCard({
  verdict,
  reportState,
  onFullReport,
  onRunFullScan,
  onDismiss,
  onReportBlock,
}: {
  verdict: TabVerdict;
  reportState: ReportState;
  onFullReport: () => void;
  onRunFullScan: () => void;
  onDismiss: () => void;
  onReportBlock: (url: string) => void;
}) {
  const { Icon, vclass } = labelMeta(verdict.label);
  const { risk, sub } = riskInfo(verdict);
  const shownRisk = useCountUp(risk);
  const [fill, setFill] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFill(risk));
    return () => cancelAnimationFrame(id);
  }, [risk]);

  const isQuick = verdict.kind === "quick";
  const kindLabel = verdict.kind === "link" ? "URL check" : verdict.kind === "email" ? "Page text check" : "Quick scan";
  const isBad = verdict.label === "dangerous" || verdict.label === "suspicious";

  return (
    <div className={`verdict ${vclass}`}>
      <div className="vcard">
        <div className="vcard-top">
          <div className="gauge" style={{ ["--p" as string]: fill }}>
            <b>{shownRisk}</b>
            <s>/100</s>
          </div>
          <div className="vhead">
            <div className="vlabel">
              <Icon />
              <b>{verdict.category ?? verdict.label}</b>
            </div>
            <div className="vmeta">
              <span className="pill">{kindLabel}</span>
              <span>{sub}</span>
            </div>
          </div>
        </div>

        {/* Reason */}
        <p className="vreason">{verdict.reason}</p>

        {/* Mitigation */}
        {verdict.mitigation && (
          <div className="vsub">
            <span className="k">What to do: </span>
            {verdict.mitigation}
          </div>
        )}

        {/* Legitimate alternatives */}
        {verdict.legitimateAlternatives.length > 0 && (
          <div className="alts">
            <div className="h">Likely impersonating</div>
            {verdict.legitimateAlternatives.map((alt) => (
              <a key={alt.url} className="alt" href={alt.url} target="_blank" rel="noopener noreferrer">
                <Globe />
                <span>{alt.title}</span>
                <ExternalLink className="ext" width={14} height={14} />
              </a>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="vactions">
          {isQuick ? (
            <button className="btn primary" onClick={onRunFullScan}>
              <span className="lead">
                <Radar />
              </span>
              Run full scan
            </button>
          ) : (
            <button className="btn" onClick={onFullReport} disabled={!verdict.runId}>
              <span className="lead">
                <ExternalLink />
              </span>
              Full report
            </button>
          )}
          <button className="btn ghost" onClick={onDismiss}>
            <RotateCcw />
            Dismiss
          </button>
        </div>

        {/* Report & block — only for a real, confirmed-bad verdict */}
        {isBad &&
          (() => {
            const url = verdict.checkedUrl;
            const rs = reportState.url === url ? reportState : { url, status: "idle" as const };
            if (rs.status === "done") {
              return (
                <div className="report-note">
                  <Ban />
                  {rs.result.added_to_blocklist ? "Blocked" : "Already blocked"} on this device
                  {rs.result.virustotal.reported ? " and reported to VirusTotal." : "."}
                </div>
              );
            }
            return (
              <>
                <button
                  className="btn danger"
                  style={{ width: "100%", marginTop: 10 }}
                  disabled={rs.status === "loading"}
                  onClick={() => onReportBlock(url)}
                >
                  {rs.status === "loading" ? <Loader2 className="ae-spin" /> : <Ban />}
                  Report &amp; block this site
                </button>
                {rs.status === "error" && (
                  <p className="report-note" style={{ color: "var(--critical)" }}>
                    {rs.message}
                  </p>
                )}
              </>
            );
          })()}
      </div>
    </div>
  );
}
