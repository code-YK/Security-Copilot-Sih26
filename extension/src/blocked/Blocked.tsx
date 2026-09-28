/**
 * The interstitial shown in place of a page whose domain is on the
 * blocklist (backend/data/blocklist.txt, added via the "Report & block"
 * action). background.ts's onBeforeNavigate redirects here *before* the
 * real navigation ever commits — see that file's comment on why this is
 * a best-effort, not a hard security boundary (no declarativeNetRequest
 * here, just a same-process check that wins the race in practice).
 *
 * "Proceed anyway" exists on purpose: a personal blocklist can have false
 * positives, and a tool with no escape hatch just gets uninstalled the
 * first time it's wrong. It sends ALLOW_ONCE first so the next attempt at
 * this exact URL isn't blocked again, then navigates there itself.
 */
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

function useQueryParam(name: string): string {
  const [value] = useState(() => new URLSearchParams(window.location.search).get(name) ?? "");
  return value;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function Blocked() {
  const url = useQueryParam("url");
  const [proceeding, setProceeding] = useState(false);

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else window.location.href = "about:blank";
  }

  async function proceedAnyway() {
    if (!url) return;
    setProceeding(true);
    try {
      const tab = await chrome.tabs.getCurrent();
      if (!tab?.id) return;
      await chrome.runtime.sendMessage({ type: "ALLOW_ONCE", url });
      await chrome.tabs.update(tab.id, { url });
    } catch {
      setProceeding(false);
    }
  }

  return (
    <div className="blocked-stage">
      <div style={{ position: "fixed", top: 20, right: 20, zIndex: 2 }}>
        <ThemeToggle />
      </div>
      <div className="blocked">
        <div className="icon">
          <ShieldAlert />
        </div>
        <div className="ey">Blocked · personal blocklist</div>
        <h1>This site was stopped before it loaded</h1>
        <p>
          <span className="dom">{hostnameOf(url) || url}</span> was previously reported and added to your blocklist, so
          Security Copilot prevented this page from opening.
        </p>
        <div className="row">
          <button className="btn primary" onClick={goBack}>
            <span className="lead">
              <ArrowLeft />
            </span>
            Go back to safety
          </button>
          <button className="btn ghost" onClick={proceedAnyway} disabled={proceeding || !url}>
            {proceeding ? "Loading…" : "Proceed anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
