# gmail-addon/

Two Google Apps Script pieces, both living in one Apps Script project against your own Gmail account. Not deployable via git — Apps Script has its own editor and deployment flow, so these files are the source of truth to copy/paste in, not something `clasp`-synced automatically (no `clasp` setup in this repo).

- **`Code.gs`** — a background auto-scanner. A time-driven trigger (every 1 minute, the fastest Apps Script allows) checks for genuinely new mail (timestamp-checkpointed, not `is:unread` — see its own docstring for why that's fragile) and calls the backend's `POST /quick-check-email` for each one, applying a colored `Dangerous` / `Suspicious` / `Safe` Gmail label matching the backend's actual verdict (plain top-level names, not nested under a parent — Gmail renders those as a small grey chip instead of a big bold one).
- **`addon.gs`** — a Gmail Add-on: a sidebar card on every open email. It checks the backend for an existing report (`GET /gmail-reports/{messageId}`) when the card is built, so a message you've already checked shows its verdict (safe/suspicious/dangerous + confidence) immediately with a "View Full Report" button straight to that report — no re-scanning, no click needed to find out. A message not yet checked shows a "Check Report" button instead; clicking it hands the raw email off (`POST /email-drafts`, headers + body only, attachments stripped) and opens the dashboard, which auto-starts the real `/check-email-stream` investigation and shows live, step-by-step progress there — nothing scans inside Gmail itself.
- **`appsscript.json`** — the Add-on manifest (contextual trigger registration, OAuth scopes, Gmail API advanced service dependency).

Both need the backend (and, for the Add-on, the dashboard) reachable over the public internet — Apps Script runs on Google's servers, not your machine, and Gmail Add-ons only allow `https://` links. Not needed for the rest of this project; only for this Gmail integration.

## Setup

**1. Start the backend + dashboard with public tunnels:**

```bash
WITH_TUNNELS=1 ./start_all.bash
```

This prints two URLs at the end — a `BACKEND_URL` (ngrok) and a `DASHBOARD_URL` (`cloudflared`). ngrok's free tier gives one reserved static domain per account, so that URL is usually stable across restarts; `cloudflared`'s quick-tunnel URL is randomly generated fresh every time the tunnel process restarts — you'll need to re-paste it after every full restart of `start_all.bash`.

**2. Create the Apps Script project:**
- Go to [script.google.com](https://script.google.com) → **New project**
- Rename `Code.gs`'s default content to this repo's `Code.gs`, add a second file (**+** → Script) named `addon`, paste in `addon.gs`
- Project Settings (gear icon) → check **"Show 'appsscript.json' manifest file in editor"**, then paste this repo's `appsscript.json` over its contents
- In both `Code.gs` and `addon.gs`, replace the placeholder `BACKEND_URL` / `DASHBOARD_URL` with the two URLs from step 1
- Save

**3. Install the auto-scanner:**
- Select `setupTrigger` in the function dropdown, click **Run** — authorize the Gmail scopes when prompted (an "unverified app" warning is expected for your own unpublished script; Advanced → proceed)
- This installs the 1-minute trigger and resets the "only scan mail from now on" checkpoint

**4. Install the Add-on:**
- **Deploy → Test deployments** → select **Google Workspace add-on** → install for yourself
- Enable the Gmail API advanced service too (Services **+** → find "Gmail API" → Add) — without this, labels still work, just uncolored
- Reload Gmail. Open any email — a shield icon appears in the right-hand app rail; click it for the "Check Report" card

## Known limitation

Both tunnel URLs need re-pasting into `Code.gs`/`addon.gs` after a full restart of `start_all.bash` (Ctrl+C, then re-run) — they're read at Apps Script *runtime*, not baked in, so there's no way around this short of a paid ngrok plan (a second stable domain) or a Cloudflare *named* tunnel (free, but needs a domain you own — see `start_all.bash`'s comments for the tradeoff).
