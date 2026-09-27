/**
 * Gmail Add-on: sidebar card on every open email, backed by
 * GET /gmail-reports/{messageId} (backend/api/routes_gmail_reports.py — a
 * local JSON file mapping message_id -> run_id, resolved against
 * history.db for the actual verdict):
 *
 *   - Already checked: the card shows the verdict right away (safe/
 *     suspicious/dangerous + confidence) and a "View Full Report" button
 *     that's a direct link to the existing dashboard report — no
 *     Apps Script round trip, so it can't re-trigger a scan.
 *   - Not checked yet: the card shows a "Check Report" button. Clicking
 *     it hands the raw email off to /email-drafts and redirects to the
 *     dashboard with that draft id, which auto-starts the real
 *     /check-email scan and shows live progress there.
 *
 * The lookup happens both at card-build time (to decide which card to
 * show) AND again inside checkReport() at click time (as the actual
 * gate on whether a new scan starts) — see checkReport()'s docstring for
 * why that duplication is deliberate, not the two-path bug from an
 * earlier design.
 *
 * Either way, Gmail's own job is just the lookup + handoff — nothing
 * scans or renders results inside the Gmail sidebar itself.
 *
 * BACKEND_URL is already declared as a top-level const in Code.gs — Apps
 * Script shares global scope across every file in the same project, so
 * it's NOT redeclared here (that would throw "already declared"). Only
 * DASHBOARD_URL is new. Both point at public HTTPS tunnels (Gmail
 * Add-ons only allow opening https:// links, and Apps Script itself runs
 * on Google's servers, not your machine, so it can't reach localhost
 * either). Update Code.gs's BACKEND_URL and this file's DASHBOARD_URL if
 * the tunnels restart and get new URLs — run `WITH_TUNNELS=1
 * ./start_all.bash` and it prints both.
 *
 * See gmail-addon/README.md for full setup steps.
 */
const DASHBOARD_URL = 'https://deluxe-apollo-digit-assured.trycloudflare.com';

const SHIELD_ICON_URL = 'https://www.gstatic.com/images/icons/material/system/2x/verified_user_googblue_48dp.png';

/**
 * Contextual trigger — Gmail calls this automatically whenever you open
 * an email, to build the sidebar card. DOES look up whether a report
 * already exists (fetchExistingReport — one lightweight GET), purely to
 * decide which button/label to render: "View Full Report" with the
 * verdict shown right away, vs. "Check Report" to start a new scan.
 *
 * This is safe against the two-path bug an earlier design had (card-build
 * state disagreeing with click-time behavior) because the two branches
 * can no longer disagree about WHAT HAPPENS on click, only about which
 * one is offered:
 *   - Already-checked branch: the button is a direct setOpenLink straight
 *     to the dashboard URL — a static hyperlink, not a script call, so
 *     there's no second lookup that could contradict this one.
 *   - Not-yet-checked branch: the button calls checkReport(), which does
 *     its OWN fresh fetchExistingReport() check before ever starting a
 *     new scan — so even if a report appeared in the few seconds between
 *     opening the email and clicking, it still won't re-scan.
 */
function buildEmailCheckCard(e) {
  const messageId = e.gmail.messageId;
  const existing = fetchExistingReport(messageId);
  Logger.log('buildEmailCheckCard: messageId=%s existing=%s', messageId, existing ? JSON.stringify(existing) : 'NOT FOUND');
  const done = existing && existing.status === 'done';
  const pending = existing && existing.status === 'pending';

  const header = CardService.newCardHeader()
    .setTitle('Security Copilot')
    .setSubtitle(done ? verdictSubtitle(existing.label) : pending ? 'Check already running' : 'AI email threat analysis')
    .setImageUrl(SHIELD_ICON_URL)
    .setImageStyle(CardService.ImageStyle.CIRCLE);

  const section = CardService.newCardSection();

  if (done) {
    const pct = existing.risk_score != null ? Math.round(existing.risk_score * 100) : existing.confidence != null ? Math.round(existing.confidence * 100) : null;
    section
      .addWidget(
        CardService.newDecoratedText()
          .setTopLabel('VERDICT')
          .setText(verdictEmoji(existing.label) + '  ' + verdictSubtitle(existing.label) + (pct != null ? ' · ' + pct + '% confidence' : ''))
          .setWrapText(true)
      )
      .addWidget(
        CardService.newTextParagraph().setText('This message was already investigated. Reopen the full forensic report — headers, origin trace, and every link — without re-scanning.')
      )
      .addWidget(
        CardService.newTextButton()
          .setText('📄  View Full Report')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor(verdictColor(existing.label))
          .setOpenLink(CardService.newOpenLink().setUrl(DASHBOARD_URL + '/run/' + existing.run_id))
      );
  } else if (pending) {
    section.addWidget(
      CardService.newTextParagraph().setText(
        '⏳ A check for this exact message is already running (started by an earlier click). ' +
        'Reopen this email in a little while for the full verdict — clicking Check Report again ' +
        'right now would only start a duplicate scan.'
      )
    );
    const card = CardService.newCardBuilder().setHeader(header).addSection(section).build();
    return [card];
  } else {
    section
      .addWidget(
        CardService.newDecoratedText()
          .setTopLabel('SPF · DKIM · DMARC')
          .setText('Sender authentication')
          .setIcon(CardService.Icon.CONFIRMATION_NUMBER_ICON)
          .setWrapText(true)
      )
      .addWidget(
        CardService.newDecoratedText()
          .setTopLabel('HOP-0 · IP GEOLOCATION · WHOIS')
          .setText('Origin tracing')
          .setIcon(CardService.Icon.MAP_PIN)
          .setWrapText(true)
      )
      .addWidget(
        CardService.newDecoratedText()
          .setTopLabel('ML + AI · VIRUSTOTAL')
          .setText('Every link, sandboxed')
          .setIcon(CardService.Icon.DESCRIPTION)
          .setWrapText(true)
      );

    const secondSection = CardService.newCardSection()
      .addWidget(
        CardService.newTextParagraph().setText(
          'Not checked yet. Runs the full investigation and opens the live report as it runs.'
        )
      )
      .addWidget(
        CardService.newTextButton()
          .setText('🔍  Check Report')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setBackgroundColor('#cc3a21')
          .setOnClickAction(
            CardService.newAction()
              .setFunctionName('checkReport')
              .setLoadIndicator(CardService.LoadIndicator.SPINNER)
          )
      );

    const card = CardService.newCardBuilder().setHeader(header).addSection(section).addSection(secondSection).build();
    return [card];
  }

  const card = CardService.newCardBuilder().setHeader(header).addSection(section).build();
  return [card];
}

function verdictEmoji(label) {
  if (label === 'safe') return '✅';
  if (label === 'dangerous') return '🚫';
  return '⚠️';
}

function verdictSubtitle(label) {
  if (label === 'safe') return 'Safe';
  if (label === 'dangerous') return 'Dangerous';
  if (label === 'suspicious') return 'Suspicious';
  return 'Unknown';
}

function verdictColor(label) {
  if (label === 'safe') return '#0b804b';
  if (label === 'dangerous') return '#cc3a21';
  return '#c77700';
}

/**
 * "Check Report" button handler — only reachable from the not-yet-checked
 * card, but re-checks /gmail-reports/{messageId} anyway before doing
 * anything else. This is the actual authority on "does a report exist,"
 * catching the rare case where one was created in the seconds between
 * this card being built and the button being clicked (e.g. another
 * device already ran the check). Three outcomes:
 *   - done: jump straight to that report.
 *   - pending: a check for this exact message is already running
 *     (started by an earlier click, still in flight) — show a "wait"
 *     card instead of starting a second investigation. This is the fix
 *     for a confirmed real bug: two rapid clicks (e.g. the user clicking
 *     again because the first scan takes a while) each saw "no report
 *     yet" and independently ran a full investigation, 28 seconds apart.
 *     run_id is only assigned when a scan FINISHES, so "not found yet"
 *     alone can't distinguish "never started" from "still running" —
 *     that's what the pending marker (set right below, before the
 *     redirect) is for.
 *   - not found: hands the raw email off to /email-drafts, claims the
 *     message as pending, and opens the dashboard to auto-run a new scan.
 */
function checkReport(e) {
  GmailApp.setCurrentMessageAccessToken(e.gmail.accessToken);
  const messageId = e.gmail.messageId;

  const existing = fetchExistingReport(messageId);
  Logger.log('checkReport: messageId=%s existing=%s', messageId, existing ? JSON.stringify(existing) : 'NOT FOUND');
  if (existing && existing.status === 'done') {
    return CardService.newActionResponseBuilder()
      .setOpenLink(CardService.newOpenLink().setUrl(DASHBOARD_URL + '/run/' + existing.run_id))
      .build();
  }
  if (existing && existing.status === 'pending') {
    return CardService.newActionResponseBuilder().setNavigation(CardService.newNavigation().updateCard(pendingCard())).build();
  }

  // Headers (incl. the Received chain the backend needs for origin tracing)
  // plus body text only — deliberately NOT message.getRawContent(), which
  // inlines every attachment as base64 and can turn a small email into a
  // multi-MB POST over a free tunnel, slow enough to blow past the
  // button-click execution ceiling on its own. See buildRawEmailNoAttachments.
  const raw = buildRawEmailNoAttachments(messageId);

  const response = fetchBackend('/email-drafts', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: raw, message_id: messageId }),
  });

  if (response.getResponseCode() !== 200) {
    const errorCard = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader().setTitle('Could not start check'))
      .addSection(
        CardService.newCardSection().addWidget(
          CardService.newTextParagraph().setText(
            'Backend returned ' + response.getResponseCode() + ':<br>' + response.getContentText()
          )
        )
      )
      .build();
    return CardService.newActionResponseBuilder()
      .setNavigation(CardService.newNavigation().updateCard(errorCard))
      .build();
  }

  const draftId = JSON.parse(response.getContentText()).id;

  // Claim this message before redirecting, so a second click in the next
  // few minutes (impatience, a second device) sees "pending" instead of
  // also starting a fresh scan. Best-effort — if this call fails, the
  // worst case is the old behavior (a possible duplicate scan), not a
  // broken check, so it's not wrapped in error handling that blocks the redirect.
  fetchBackend('/gmail-reports/pending', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ message_id: messageId, draft_id: draftId }),
  });

  const url = DASHBOARD_URL + '/?draft=' + draftId;

  return CardService.newActionResponseBuilder()
    .setOpenLink(CardService.newOpenLink().setUrl(url))
    .build();
}

function pendingCard() {
  return CardService.newCardBuilder()
    .setHeader(
      CardService.newCardHeader()
        .setTitle('Security Copilot')
        .setSubtitle('Check already running')
        .setImageUrl(SHIELD_ICON_URL)
        .setImageStyle(CardService.ImageStyle.CIRCLE)
    )
    .addSection(
      CardService.newCardSection().addWidget(
        CardService.newTextParagraph().setText(
          '⏳ A check for this exact message was already started and is still running. ' +
          'Reopen this email in a little while — once it finishes, this card will show the ' +
          'full verdict directly.'
        )
      )
    )
    .build();
}

/**
 * Reconstructs a lightweight RFC822 message: real headers (via the Gmail
 * API advanced service's format=full — includes the full Received chain,
 * same as message.getRawContent() would) plus just the text/html or
 * text/plain body, walked out of the MIME tree by hand so attachment
 * parts (which only carry an attachmentId in format=full, never inline
 * data) are never touched at all. The backend only ever needed headers +
 * body + links, never attachment bytes, for this quick-check path.
 */
function buildRawEmailNoAttachments(messageId) {
  const msg = Gmail.Users.Messages.get('me', messageId, { format: 'full' });
  const skip = { 'content-type': 1, 'content-transfer-encoding': 1, 'mime-version': 1 };
  const headerLines = msg.payload.headers
    .filter((h) => !skip[h.name.toLowerCase()])
    .map((h) => h.name + ': ' + h.value)
    .join('\r\n');

  const bodyPart = pickBodyPart(msg.payload);
  return headerLines + '\r\nContent-Type: ' + bodyPart.contentType + '\r\n\r\n' + bodyPart.text;
}

/**
 * Gmail's format=full body.data is base64url, sometimes without the '='
 * padding Apps Script's decoder wants — pad it out, and never let one
 * malformed/unexpected part crash the whole lookup (falls back to the
 * next candidate part instead).
 */
function decodeGmailBody(data) {
  const padded = data + '='.repeat((4 - (data.length % 4)) % 4);
  try {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString();
  } catch (err) {
    Logger.log('Could not decode a body part, skipping it: %s', err);
    return null;
  }
}

function pickBodyPart(payload) {
  let html = null;
  let plain = null;
  (function walk(part) {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/html' && part.body && part.body.data && !html) {
      html = decodeGmailBody(part.body.data);
    } else if (mime === 'text/plain' && part.body && part.body.data && !plain) {
      plain = decodeGmailBody(part.body.data);
    } else if (part.parts) {
      part.parts.forEach(walk);
    }
  })(payload);

  if (html) return { contentType: 'text/html; charset="UTF-8"', text: html };
  if (plain) return { contentType: 'text/plain; charset="UTF-8"', text: plain };
  return { contentType: 'text/plain; charset="UTF-8"', text: '' };
}

/**
 * GET /gmail-reports/{messageId} — a local JSON-file-backed lookup on
 * the backend (backend/api/routes_gmail_reports.py), resolved against
 * history.db for the actual verdict. Returns null on any failure (not
 * found, backend down, network hiccup) so the button always falls back
 * to starting a fresh check rather than breaking.
 */
function fetchExistingReport(messageId) {
  try {
    const response = fetchBackend('/gmail-reports/' + encodeURIComponent(messageId), {});
    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log('fetchExistingReport(%s): backend returned %s: %s', messageId, code, response.getContentText());
      return null;
    }
    return JSON.parse(response.getContentText());
  } catch (err) {
    Logger.log('fetchExistingReport(%s) threw: %s', messageId, err);
    return null;
  }
}
