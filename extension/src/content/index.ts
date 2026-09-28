/**
 * security-copilot content script — the in-page banner.
 *
 * Deliberately dependency-free (no imports, no React) so it can be bundled
 * as a small IIFE and injected on every page without pulling in the
 * extension's React bundle. Its only job is to render a floating banner
 * or toast whenever background.ts's automatic quick-check finishes.
 *
 * Renders inside a closed Shadow DOM so the page's own CSS can never break
 * (or be broken by) the banner, and talks back to background.ts by
 * message only — content scripts can't call chrome.tabs.* directly.
 *
 * "safe" gets a distinct, minimal toast that clears itself after ~1.5s —
 * a brief confirmation, not an alert. "dangerous"/"suspicious" get the
 * full banner with actions, and NEVER auto-dismiss — the user asked
 * explicitly that those stay up until they click the close button.
 */
(function securityCopilotContentScript() {
  type Label = "dangerous" | "suspicious" | "safe";

  const HOST_ID = "security-copilot-banner-host";
  const SAFE_TOAST_MS = 1600;

  let shadow: ShadowRoot | null = null;
  let cardEl: HTMLDivElement | null = null;
  let safeDismissTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureHost(): ShadowRoot {
    if (shadow) return shadow;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.all = "initial"; // isolate from page CSS at the host boundary too
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "closed" });

    const style = document.createElement("style");
    // Same "night desk" palette as the dashboard and popup: an ink card,
    // a verdict-coloured rail, bone primary button, and the copilot's UV
    // for the live "investigating" state. The page's own fonts can't be
    // relied on, so this stays on the system stack with Archivo first.
    style.textContent = `
      :host { all: initial; }
      .card {
        --tone: #8E9CB8;
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 330px;
        overflow: hidden;
        font-family: "Archivo", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        color: #F1EFE8;
        background: #101217;
        border: 1px solid #2E333E;
        border-radius: 16px;
        box-shadow: 0 24px 60px -26px var(--tone), 0 18px 40px -18px rgba(0,0,0,0.75);
        padding: 15px 18px 16px 20px;
        animation: sc-slide-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tone); }
      .card.dangerous { --tone: #FF5065; }
      .card.suspicious { --tone: #F6BB45; }
      .card.safe { --tone: #43DC9C; width: auto; max-width: 270px; padding: 11px 16px 11px 18px; animation: sc-slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1), sc-fade-out 0.35s ease-in 1.25s forwards; }
      @keyframes sc-slide-in { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }
      @keyframes sc-fade-out { from { opacity: 1; } to { opacity: 0; } }
      .row { display: flex; align-items: flex-start; gap: 11px; }
      .icon { flex-shrink: 0; color: var(--tone); line-height: 0; margin-top: 1px; }
      .icon svg { width: 20px; height: 20px; }
      .title { font-weight: 760; font-size: 14px; letter-spacing: -0.01em; color: var(--tone); }
      .sub { color: #7C808B; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 3px; }
      .msg { margin-top: 9px; color: #AAADB6; }
      .progress {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 11px;
        padding: 8px 11px;
        border-radius: 10px;
        background: #07080A;
        border: 1px solid rgba(149,133,255,0.38);
        color: #AAADB6;
        font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.4;
      }
      .progress .spinner { margin-right: 0; flex-shrink: 0; }
      .actions { display: flex; gap: 8px; margin-top: 13px; }
      button {
        flex: 1;
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 650;
        padding: 8px 12px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid #2E333E;
        background: transparent;
        color: #F1EFE8;
        transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
      }
      button.primary { background: #F1EFE8; border-color: #F1EFE8; color: #0A0B0E; }
      button:hover:not(:disabled) { border-color: #4A505C; }
      button.primary:hover:not(:disabled) { box-shadow: 0 0 0 4px rgba(241,239,232,0.16); }
      button:disabled { opacity: 0.6; cursor: default; }
      .close {
        position: absolute; top: 10px; right: 12px;
        background: none; border: none; color: #7C808B;
        font-size: 17px; padding: 0; width: auto; flex: none;
        line-height: 1;
      }
      .close:hover { color: #F1EFE8; }
      .spinner {
        display: inline-block;
        width: 11px; height: 11px;
        margin-right: 6px;
        vertical-align: -1px;
        border: 2px solid rgba(149,133,255,0.3);
        border-top-color: #9585FF;
        border-radius: 50%;
        animation: sc-spin 0.7s linear infinite;
      }
      @keyframes sc-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .card, .card.safe { animation: none; }
      }
    `;
    shadow.appendChild(style);
    return shadow;
  }

  // Inline SVG (stroke = currentColor, so the verdict tone colours it) —
  // emoji render differently on every OS and can't take the tone.
  const ICONS = {
    dangerous:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="m15 9-6 6M9 9l6 6"/></svg>',
    suspicious:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    safe:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>',
  } as const;

  function labelIcon(label: Label): string {
    return ICONS[label];
  }

  function labelTitle(label: Label): string {
    if (label === "dangerous") return "Dangerous site";
    if (label === "suspicious") return "Suspicious site";
    return "Looks safe";
  }

  function messageFor(label: "dangerous" | "suspicious", source: string): string {
    if (source === "blocklist") return "This URL matches a known-bad domain. Avoid entering any credentials.";
    if (source === "virustotal") {
      return label === "dangerous"
        ? "VirusTotal already has multiple security vendors flagging this domain as phishing/malicious."
        : "VirusTotal has at least one security vendor flagging this domain. Worth a closer look.";
    }
    if (source === "page_signal") {
      return "This page has a login form that submits your password to a different, unrelated domain — a strong sign of credential phishing. Do not enter your password.";
    }
    return label === "dangerous"
      ? "This page's URL matches known phishing patterns. Avoid entering any credentials."
      : "This page's URL looks unusual. Worth a closer look before you trust it.";
  }

  function showBanner(url: string, label: Label, confidence: number, source: string): void {
    const root = ensureHost();
    hideBanner();

    const card = document.createElement("div");
    card.className = `card ${label}`;

    if (label === "safe") {
      // Deliberately no close button, no actions — this is a brief
      // confirmation that clears itself, not something to interact with.
      card.innerHTML = `
        <div class="row">
          <span class="icon">${labelIcon(label)}</span>
          <div>
            <div class="title ${label}">${labelTitle(label)}</div>
            <div class="sub">security-copilot &middot; quick scan</div>
          </div>
        </div>
      `;
      root.appendChild(card);
      cardEl = card;
      safeDismissTimer = setTimeout(hideBanner, SAFE_TOAST_MS);
      return;
    }

    card.innerHTML = `
      <button class="close" aria-label="Dismiss">&times;</button>
      <div class="row">
        <span class="icon">${labelIcon(label)}</span>
        <div>
          <div class="title ${label}">${labelTitle(label)}</div>
          <div class="sub">security-copilot &middot; ${Math.round(confidence * 100)}% confidence &middot; quick scan</div>
        </div>
      </div>
      <div class="msg">${messageFor(label, source)}</div>
      <div class="progress" style="display:none;"></div>
      <div class="actions">
        <button class="full-report primary">Full report</button>
        <button class="dismiss">Dismiss</button>
      </div>
    `;

    card.querySelector(".close")?.addEventListener("click", hideBanner);
    card.querySelector(".dismiss")?.addEventListener("click", hideBanner);
    card.querySelector(".full-report")?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Investigating...";
      try {
        chrome.runtime.sendMessage({ type: "RUN_FULL_CHECK", url });
      } catch {
        // Extension context invalidated (e.g. mid-update) — nothing to recover.
      }
    });

    // No auto-dismiss timer here, intentionally: dangerous/suspicious
    // banners stay until the user clicks the close button.
    root.appendChild(card);
    cardEl = card;
  }

  function emailLabelTitle(label: Label | "unknown"): string {
    if (label === "dangerous") return "Dangerous email";
    if (label === "suspicious") return "Suspicious email";
    if (label === "safe") return "Looks safe";
    return "Could not classify";
  }

  function emailMessageFor(label: Label | "unknown"): string {
    if (label === "dangerous") return "This message's content and links read as a phishing attempt. Do not click any links or enter credentials.";
    if (label === "suspicious") return "Something about this message's wording or links looks off. Worth a closer look before you trust it.";
    if (label === "safe") return "security-copilot's automatic scan found nothing suspicious about this message.";
    return "The automatic scan couldn't produce a confident verdict.";
  }

  // Shows once per distinct Gmail message (background.ts only ever sends
  // this for a message id it hasn't checked before — see
  // lib/storage.ts's hasCheckedWebmailMessage), so unlike showBanner's
  // per-navigation URL scan there's no repeat-suppression logic needed
  // here at all: if this fires, it's genuinely the first and only time.
  function showEmailBanner(pageUrl: string, label: Label | "unknown", confidence: number, text: string, links: string[]): void {
    const root = ensureHost();
    hideBanner();

    const card = document.createElement("div");
    card.className = `card ${label === "unknown" ? "suspicious" : label}`;

    if (label === "safe") {
      card.innerHTML = `
        <div class="row">
          <span class="icon">${labelIcon("safe")}</span>
          <div>
            <div class="title safe">${emailLabelTitle(label)}</div>
            <div class="sub">security-copilot &middot; email scan</div>
          </div>
        </div>
      `;
      root.appendChild(card);
      cardEl = card;
      safeDismissTimer = setTimeout(hideBanner, SAFE_TOAST_MS);
      return;
    }

    const titleClass = label === "dangerous" ? "dangerous" : "suspicious";
    card.innerHTML = `
      <button class="close" aria-label="Dismiss">&times;</button>
      <div class="row">
        <span class="icon">${labelIcon(label === "dangerous" ? "dangerous" : "suspicious")}</span>
        <div>
          <div class="title ${titleClass}">${emailLabelTitle(label)}</div>
          <div class="sub">security-copilot &middot; ${Math.round(confidence * 100)}% confidence &middot; email scan</div>
        </div>
      </div>
      <div class="msg">${emailMessageFor(label)}</div>
      <div class="progress" style="display:none;"></div>
      <div class="actions">
        <button class="full-report primary">Full report</button>
        <button class="dismiss">Dismiss</button>
      </div>
    `;

    card.querySelector(".close")?.addEventListener("click", hideBanner);
    card.querySelector(".dismiss")?.addEventListener("click", hideBanner);
    card.querySelector(".full-report")?.addEventListener("click", (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Investigating...";
      try {
        chrome.runtime.sendMessage({ type: "RUN_FULL_EMAIL_CHECK", text, links, pageUrl });
      } catch {
        // Extension context invalidated (e.g. mid-update) — nothing to recover.
      }
    });

    root.appendChild(card);
    cardEl = card;
  }

  function hideBanner(): void {
    if (safeDismissTimer !== null) {
      clearTimeout(safeDismissTimer);
      safeDismissTimer = null;
    }
    if (cardEl) {
      cardEl.remove();
      cardEl = null;
    }
  }

  function updateFullReportButton(text: string, disabled: boolean, spinner = false): void {
    const btn = cardEl?.querySelector<HTMLButtonElement>(".full-report");
    if (!btn) return;
    btn.innerHTML = spinner ? `<span class="spinner"></span>${text}` : text;
    btn.disabled = disabled;
  }

  // The live step narration (e.g. "Checking VirusTotal & domain
  // registration history...") gets its own row instead of living inside
  // the button — those labels are full sentences, and the button is a
  // small pill with no room to wrap them.
  function updateProgress(label: string | null): void {
    const el = cardEl?.querySelector<HTMLDivElement>(".progress");
    if (!el) return;
    if (label === null) {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "flex";
    el.innerHTML = `<span class="spinner"></span><span>${label}</span>`;
  }

  chrome.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "SHOW_BANNER":
        showBanner(message.url, message.label, message.confidence, message.source);
        break;
      case "SHOW_EMAIL_BANNER":
        showEmailBanner(message.pageUrl, message.label, message.confidence, message.text, message.links);
        break;
      case "HIDE_BANNER":
        hideBanner();
        break;
      case "FULL_CHECK_STARTED":
        updateFullReportButton("Investigating...", true, true);
        updateProgress("Starting investigation...");
        break;
      case "FULL_CHECK_PROGRESS":
        updateProgress(message.label);
        break;
      case "FULL_CHECK_DONE":
        updateFullReportButton("✓ Opened in new tab", true);
        updateProgress(null);
        break;
      case "FULL_CHECK_FAILED":
        updateFullReportButton("Failed — retry", false);
        updateProgress(null);
        break;
      default:
        break;
    }
    return false;
  });

  // The one page-content signal this extension looks at: a password field
  // inside a form that posts somewhere other than this page's own site —
  // the classic shape of a credential-harvesting fake login page, and
  // something background.ts's /quick-check-url can't see from the URL
  // string alone. A password field by itself means nothing (nearly every
  // real login page has one) — only reported when paired with a foreign
  // submit target, and only that one fact is sent, never page content
  // itself.
  //
  // Static-DOM only: a form whose submission is fully handled by JS
  // (fetch()/XHR in a submit handler, no real `action` attribute) won't be
  // caught here. That's a missed detection, not a false positive, which is
  // the direction that matters — see routes_quick_check.py's docstring for
  // why false positives are treated as the costlier mistake throughout
  // this pipeline.
  function computePageSignals(): void {
    const passwordInputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]');
    for (const input of passwordInputs) {
      const form = input.closest("form");
      if (!form) continue;

      const actionAttr = form.getAttribute("action");
      let resolved: URL;
      try {
        resolved = new URL(actionAttr || "", location.href);
      } catch {
        continue;
      }
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      if (resolved.hostname === location.hostname) continue;

      try {
        chrome.runtime.sendMessage({
          type: "PAGE_SIGNALS",
          url: location.href,
          actionDomain: resolved.hostname,
        } satisfies { type: "PAGE_SIGNALS"; url: string; actionDomain: string });
      } catch {
        // Extension context invalidated (e.g. mid-update) — nothing to recover.
      }
      return; // one report is enough — background re-derives everything else itself
    }
  }

  computePageSignals();
})();
