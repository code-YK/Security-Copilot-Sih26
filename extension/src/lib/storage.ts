/**
 * Typed wrapper around `chrome.storage.local`, used instead of
 * `localStorage` because service workers and popup/options pages do not
 * share a single `window`. The backend has no auth (see
 * backend/README.md — POC scope), so the durable settings are just where
 * the backend lives and whether automatic scanning is on.
 */
export interface CopilotStorage {
  apiBaseUrl: string;
  // Separate from apiBaseUrl on purpose: the Next.js dashboard (dashboard/)
  // is its own dev server on its own port (:3000 by default), not something
  // the FastAPI backend (:8010) serves — see start_all.bash's
  // WITH_DASHBOARD/DASHBOARD_PORT. This is where "Full report" and automatic
  // report tabs open a run, instead of the backend's own built-in viewer.
  dashboardBaseUrl: string;
  autoScanEnabled: boolean;
}

const DEFAULTS: CopilotStorage = {
  apiBaseUrl: "http://127.0.0.1:8010",
  dashboardBaseUrl: "http://localhost:3000",
  autoScanEnabled: true,
};

export async function getStorage(): Promise<CopilotStorage> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored } as CopilotStorage;
}

export async function setStorage(partial: Partial<CopilotStorage>): Promise<void> {
  await chrome.storage.local.set(partial);
}

/** Per-tab last verdict, kept in session storage (cleared on browser restart)
 * so re-opening the popup on the same tab doesn't re-run a check. `kind`
 * "quick" is the automatic background.ts scan (ML model only, no runId);
 * "link"/"email" are real on-demand checks through the full agent. */
export interface TabVerdict {
  checkedUrl: string;
  kind: "link" | "email" | "quick";
  label: "dangerous" | "suspicious" | "safe" | "inconclusive";
  /** The agent's own verdict class (legitimate/impersonated/phishing/...); absent for quick checks. */
  category?: string;
  confidence: number;
  reason: string;
  mitigation: string | null;
  legitimateAlternatives: { title: string; url: string }[];
  runId: string | null;
  checkedAt: number;
}

export async function setTabVerdict(tabId: number, verdict: TabVerdict): Promise<void> {
  await chrome.storage.session.set({ [`tab_verdict_${tabId}`]: verdict });
}

export async function getTabVerdict(tabId: number): Promise<TabVerdict | null> {
  const result = await chrome.storage.session.get(`tab_verdict_${tabId}`);
  return (result[`tab_verdict_${tabId}`] as TabVerdict | undefined) ?? null;
}

export async function clearTabVerdict(tabId: number): Promise<void> {
  await chrome.storage.session.remove(`tab_verdict_${tabId}`);
}

/** Tracks a full investigation (background.ts's runFullCheck /
 * runFullEmailCheck) that's currently in flight for a tab, so the popup
 * can tell "already checking" apart from "idle" and avoid firing a
 * second, redundant call for the same URL the banner's "Full report"
 * button (or the popup's own webmail auto-scan) already started.
 * `step` is the live progress label from the most recent
 * FULL_CHECK_PROGRESS event (see types/index.ts's CheckLinksStreamEvent)
 * — the popup reads it on mount and watches it update via
 * chrome.storage.onChanged, so it shows the same live progress the
 * banner does even though a popup can't receive runtime messages sent
 * while it was closed. `kind` lets a freshly-opened popup restore an
 * in-progress check with the right label instead of assuming "link". */
export interface PendingFullCheck {
  url: string;
  startedAt: number;
  kind: "link" | "email";
  step?: string;
}

export async function setPendingFullCheck(tabId: number, pending: PendingFullCheck): Promise<void> {
  await chrome.storage.session.set({ [`pending_full_check_${tabId}`]: pending });
}

export async function updatePendingFullCheckStep(tabId: number, step: string): Promise<void> {
  const key = `pending_full_check_${tabId}`;
  const existing = (await chrome.storage.session.get(key))[key] as PendingFullCheck | undefined;
  if (!existing) return; // nothing pending (e.g. already cleared) — nothing to update
  await chrome.storage.session.set({ [key]: { ...existing, step } });
}

export async function getPendingFullCheck(tabId: number): Promise<PendingFullCheck | null> {
  const result = await chrome.storage.session.get(`pending_full_check_${tabId}`);
  return (result[`pending_full_check_${tabId}`] as PendingFullCheck | undefined) ?? null;
}

export async function clearPendingFullCheck(tabId: number): Promise<void> {
  await chrome.storage.session.remove(`pending_full_check_${tabId}`);
}

/** Which Gmail messages the automatic content check (background.ts's
 * maybeAutoCheckEmail) has already run for — chrome.storage.LOCAL, not
 * session, deliberately: the user asked explicitly that a message only
 * ever gets checked/alerted on once, including across browser restarts,
 * not just "once per tab session" the way TabVerdict above is. A plain
 * array capped at MAX_CHECKED_MESSAGES with FIFO eviction — this is a
 * "have I seen this" set, not data anything needs to read back, so no
 * need for the verdict itself to live here (that's on the backend, via
 * the same history.db every other check already records to). */
const CHECKED_MESSAGES_KEY = "checkedWebmailMessageIds";
const MAX_CHECKED_MESSAGES = 1000;

export async function hasCheckedWebmailMessage(messageId: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(CHECKED_MESSAGES_KEY);
  const ids = (stored[CHECKED_MESSAGES_KEY] as string[] | undefined) ?? [];
  return ids.includes(messageId);
}

/** Claims a message id BEFORE the check actually runs (not after) — two
 * near-simultaneous events for the same message (onCommitted firing right
 * alongside onReferenceFragmentUpdated for the same navigation, which
 * happens) must not both pass the "not yet checked" gate and each start
 * their own check/banner. Idempotent: calling it twice for the same id is
 * harmless. */
export async function markWebmailMessageChecked(messageId: string): Promise<void> {
  const stored = await chrome.storage.local.get(CHECKED_MESSAGES_KEY);
  const ids = (stored[CHECKED_MESSAGES_KEY] as string[] | undefined) ?? [];
  if (ids.includes(messageId)) return;
  ids.push(messageId);
  while (ids.length > MAX_CHECKED_MESSAGES) ids.shift();
  await chrome.storage.local.set({ [CHECKED_MESSAGES_KEY]: ids });
}
