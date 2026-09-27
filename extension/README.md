# security-copilot browser extension

Chrome Manifest V3 extension for the security-copilot agent (`backend/`). It does **not** run any AI models or
sandboxing itself — the backend performs all the investigation (headless browser, WHOIS/VirusTotal, an LLM, web
search). No auth on the backend it talks to — see `backend/README.md`'s POC scope for why (no DB beyond SQLite,
no auth, terminal-first).

## What it does

- **Automatic per-navigation URL scan** (`src/background/index.ts` + `src/content/index.ts`) — every `http(s)://`
  page load gets an instant local check (`POST /quick-check-url`: the ONNX URL model, corroborated with a cached
  VirusTotal lookup): a brief self-dismissing toast if it looks fine, a persistent in-page banner (Shadow DOM, never
  touches the page's own CSS/JS) with a **Full report** button if not. Also escalates on a page-content signal the
  URL alone can't see — a password field whose form posts to a different domain than the page itself.
- **Automatic Gmail message check** (`src/lib/webmail.ts`'s `extractGmailMessageId` + `background.ts`'s
  `maybeAutoCheckEmail`) — opening an actual message in Gmail (a URL like `#inbox/<id>`, not a mailbox list/
  search/settings view) runs the same fast email quick-check (`POST /quick-check-email`: BERT text model + Jev +
  the ML+VirusTotal link check, no LLM) automatically, no click needed, and shows the same in-page banner. Fires
  **at most once per distinct message id, ever** — the result is cached in `chrome.storage.local`
  (`hasCheckedWebmailMessage`/`markWebmailMessageChecked`), so reopening the same email later never re-checks or
  re-alerts. Needs a real `host_permissions` entry for the webmail host (see `manifest.json`) since it runs from a
  background navigation event, not a user gesture — `activeTab` alone isn't enough for that.
- **Popup** (`src/popup/`) — **Check this URL** and **Check page text** buttons for a manual full investigation on
  any page; on a recognized webmail tab, also runs the same quick email-check the instant the popup opens (in
  addition to, and independent of, the fully automatic Gmail-only check above — this one works on Outlook/Yahoo/
  Proton too, just requires opening the popup once per email instead of firing on its own).
- **Options page** (`src/options/`) — backend base URL (defaults to `http://127.0.0.1:8010`) and dashboard base URL.

`src/lib/pageContent.ts`'s `extractPageContent` (visible text + real `<a href>`s) is shared by both the popup's
on-demand extraction and the background's fully automatic one, so they can never drift into two different
extraction behaviors.

## Setup

```bash
cd extension
npm install
npm run build
```

This produces a complete unpacked extension in `extension/dist/`.

## Load into Chrome

1. Make sure the backend is running first (`cd backend && uvicorn api.app:app --port 8010` — see
   `backend/README.md`).
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select `extension/dist/`.
5. Just browse — every page gets the automatic URL scan on its own, and opening an actual email in Gmail gets the
   automatic content scan on its own too (see "What it does" above). Click the toolbar icon for the manual
   **Check this URL** / **Check page text** buttons if you want a full investigation instead of the quick one.
6. If your backend isn't on `http://127.0.0.1:8010`, open the extension's **Settings** (gear icon in the popup,
   or right-click the toolbar icon → Options) and change the URL.

## Development

```bash
npm run dev        # rebuilds on file changes; reload the unpacked extension in chrome://extensions after each change
npm run typecheck  # strict TypeScript check, no build
```

## Build architecture

One Vite build pass (`vite.config.ts`) compiles the popup and options pages (React, multi-page) as ES modules.
`scripts/copy-assets.mjs` flattens Vite's nested HTML output to `popup.html` / `options.html` at the root of
`dist/` (matching `manifest.json`) and copies in `manifest.json` + icons.
