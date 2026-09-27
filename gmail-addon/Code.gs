/**
 * Security-Copilot v2 — Gmail auto-scanner.
 *
 * Sends each new email's text + links to the backend's /quick-check-email
 * (fast, combined ML + Jev + VirusTotal check), and labels the message
 * with one of three colored Gmail labels matching the backend's actual
 * verdict: Dangerous, Suspicious, or Safe. (Earlier version collapsed
 * "suspicious" into "Dangerous" for simplicity — confirmed a real problem:
 * a legitimate-but-unfamiliar-sender email that scored right at the
 * suspicious threshold got the same scary red tag as actual phishing,
 * with no way to tell them apart without opening the full report.)
 *
 * Only ever processes mail newer than the persisted checkpoint
 * (PropertiesService) set by setupTrigger(). Deliberately NOT filtered by
 * is:unread — reading/opening an email marks it read independent of
 * whether the scanner has processed it yet, so relying on unread-status
 * as "is this new" is fragile (confirmed: a self-sent test email got
 * read before the next run and silently vanished from an is:unread
 * search). The timestamp checkpoint is the sole "is this new" check.
 *
 * REQUIRES the Gmail API advanced service enabled for colored labels:
 * in the Apps Script editor, click "Services" (+ icon, left sidebar) ->
 * find "Gmail API" -> Add. If you skip this, labels still work, just
 * without color.
 *
 * See gmail-addon/README.md for full setup steps.
 */

// ---- CONFIG — set to your backend's public tunnel URL. Changes every
// time you restart `WITH_TUNNELS=1 ./start_all.bash` unless your ngrok
// account has a reserved static domain. ----
const BACKEND_URL = 'https://fraternal-heap-dictate.ngrok-free.dev';

/**
 * Every UrlFetchApp call to BACKEND_URL must go through this, not
 * UrlFetchApp.fetch directly — free ngrok tunnels serve an HTML
 * "You are about to visit..." interstitial instead of proxying through,
 * for requests that don't look like a browser that already clicked past
 * it. Confirmed as the real cause of several "already-checked email gets
 * re-scanned" reports: Apps Script's UrlFetchApp got the interstitial's
 * HTML back instead of JSON, JSON.parse threw, and every caller here
 * treats a thrown/failed lookup as "no report exists" — so it silently
 * looked exactly like a cache miss instead of a tunnel-layer problem.
 * The 'ngrok-skip-browser-warning' header (any value) skips it — a
 * documented ngrok feature, not a workaround of anything on our side.
 */
function fetchBackend(path, options) {
  const merged = Object.assign({ muteHttpExceptions: true }, options || {});
  merged.headers = Object.assign({ 'ngrok-skip-browser-warning': 'true' }, merged.headers || {});
  return UrlFetchApp.fetch(BACKEND_URL + path, merged);
}

// Plain top-level names (not nested under a parent label) so Gmail renders
// them as big, bold, standalone chips on each message row/subject line —
// nesting under "SecurityCopilot/" made them show as a small grey parent
// chip instead.
const LABEL_DANGEROUS = 'Dangerous';
const LABEL_SUSPICIOUS = 'Suspicious';
const LABEL_SAFE = 'Safe';

const CHECKPOINT_KEY = 'sc_last_checked_ms';

/**
 * Main entry point — called by the time-driven trigger every minute (the
 * fastest interval Apps Script's time-driven triggers support at all).
 */
function checkNewMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(500)) {
    Logger.log('Previous run still in progress, skipping this trigger.');
    return;
  }

  try {
    const props = PropertiesService.getScriptProperties();
    const lastChecked = Number(props.getProperty(CHECKPOINT_KEY) || Date.now());
    let newestSeen = lastChecked;

    const threads = GmailApp.search('newer_than:1d', 0, 20);

    for (const thread of threads) {
      for (const message of thread.getMessages()) {
        const sentMs = message.getDate().getTime();
        if (sentMs <= lastChecked) continue;
        if (sentMs > newestSeen) newestSeen = sentMs;
        try {
          scanMessage(message);
        } catch (err) {
          Logger.log('Failed to scan message "%s": %s', message.getSubject(), err);
        }
      }
    }

    props.setProperty(CHECKPOINT_KEY, String(newestSeen));
  } finally {
    lock.releaseLock();
  }
}

function scanMessage(message) {
  const subject = message.getSubject() || '';
  const body = message.getPlainBody() || '';
  const text = (subject + '\n\n' + body).slice(0, 8000);
  const links = extractLinks(message.getBody());

  const response = fetchBackend('/quick-check-email', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text, links: links }),
  });

  if (response.getResponseCode() !== 200) {
    Logger.log('Backend returned %s for "%s": %s', response.getResponseCode(), subject, response.getContentText());
    return;
  }

  const result = JSON.parse(response.getContentText());
  applyLabel(message, result);
  Logger.log('"%s" -> %s (confidence %s)', subject, result.label.toUpperCase(), result.confidence);
}

/**
 * Pulls real <a href="..."> targets out of the HTML body — catches
 * "click here"-style links where the visible text has no URL in it.
 */
function extractLinks(html) {
  const links = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  let match;
  while ((match = re.exec(html)) !== null && links.length < 10) {
    const url = match[1];
    if (url.startsWith('http://') || url.startsWith('https://')) {
      links.push(url);
    }
  }
  return links;
}

/**
 * Three-way: mirrors the backend's actual label exactly (dangerous /
 * suspicious / safe), not a flattened binary — see file header docstring
 * for why collapsing "suspicious" into "Dangerous" was a real problem.
 */
function applyLabel(message, result) {
  // Gmail's boldest palette entries — deeper/more saturated than the
  // default red/green/yellow, closer to what Gmail itself uses for "important."
  let labelName, color;
  if (result.label === 'dangerous') {
    labelName = LABEL_DANGEROUS;
    color = { backgroundColor: '#cc3a21', textColor: '#ffffff' }; // deep red
  } else if (result.label === 'suspicious') {
    labelName = LABEL_SUSPICIOUS;
    color = { backgroundColor: '#c77700', textColor: '#ffffff' }; // amber
  } else {
    labelName = LABEL_SAFE;
    color = { backgroundColor: '#0b804b', textColor: '#ffffff' }; // deep green
  }

  const label = getOrCreateLabel(labelName, color);
  message.getThread().addLabel(label);
}

/**
 * Creates (or fetches) a label, trying to color it via the Gmail API
 * advanced service. Falls back to a plain uncolored label if that
 * service isn't enabled or the color call fails — color is cosmetic,
 * it must never be able to break labeling itself.
 */
function getOrCreateLabel(name, color) {
  const existing = GmailApp.getUserLabelByName(name);
  if (existing) return existing;

  const label = GmailApp.createLabel(name);

  try {
    const gmailLabel = Gmail.Users.Labels.list('me').labels.find((l) => l.name === name);
    if (gmailLabel) {
      Gmail.Users.Labels.patch({ color: color }, 'me', gmailLabel.id);
    }
  } catch (err) {
    Logger.log('Could not color label "%s" (Gmail API service may not be enabled) — using plain label. %s', name, err);
  }

  return label;
}

/**
 * Run this ONCE manually (select it in the Apps Script editor toolbar and
 * click Run) to (re)install the trigger and reset the checkpoint to
 * "now" — nothing already in your inbox is ever scanned, only mail that
 * arrives after this point.
 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'checkNewMail') ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('checkNewMail')
    .timeBased()
    .everyMinutes(1)
    .create();

  PropertiesService.getScriptProperties().setProperty(CHECKPOINT_KEY, String(Date.now()));

  Logger.log('Trigger installed — checkNewMail() will now run every minute, only on mail received from now on. Labels: Dangerous / Suspicious / Safe.');
}
