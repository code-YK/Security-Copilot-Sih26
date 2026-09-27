/**
 * Recognized webmail hosts — used by the popup to decide whether to
 * automatically run a quick phishing check on the page's visible text
 * the moment it opens (see Popup.tsx), the same way it already shows an
 * automatic quick verdict for the current tab's URL. Deliberately a short,
 * explicit hostname list rather than a heuristic ("contains 'mail'") —
 * false positives here mean silently sending page text from an unrelated
 * site to the backend, which is worse than just missing a webmail
 * provider we haven't added yet.
 */
const WEBMAIL_HOSTS = [
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "mail.yahoo.com",
  "mail.proton.me",
];

export function isWebmailHost(hostname: string): boolean {
  return WEBMAIL_HOSTS.includes(hostname.toLowerCase());
}

// Gmail's own permalink ids (e.g. "FMfcgzQfCMnKvNWTVZRqTvGfTMgbQMQV" in the
// current UI, or a 16-hex-char thread id in classic view) — long, opaque,
// alphanumeric tokens. A bare list view's hash ("#inbox", "#starred",
// "#snoozed", ...) is always exactly one segment; opening an actual message
// adds a final segment that's this kind of token, regardless of which
// label/search/folder segment(s) come before it (e.g.
// "#label/My+Label/FMfcgz..." or "#search/some+query/FMfcgz..."). 16 is a
// deliberately generous floor — real ids are comfortably longer — chosen so
// a short navigational segment (e.g. "#settings/general") can never match.
const GMAIL_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Extracts the opened message's id from a Gmail tab URL, or null if this
 * URL is a list/folder/settings view with no single message open. Used to
 * gate the automatic email-content check (background.ts) so it runs
 * exactly once per real message, never on a mailbox listing.
 *
 * Gmail-only for now — the other WEBMAIL_HOSTS above use different routing
 * schemes (Outlook's is a numeric ItemID query param, Yahoo/Proton have
 * their own), each would need its own parser to extend this to them.
 */
export function extractGmailMessageId(url: string): string | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex === -1) return null;
  const hash = url.slice(hashIndex + 1).split(/[?&]/)[0];
  const segments = hash.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const last = decodeURIComponent(segments[segments.length - 1]);
  return GMAIL_MESSAGE_ID_RE.test(last) ? last : null;
}
