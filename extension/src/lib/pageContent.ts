/**
 * Extracts a tab's visible text plus every real anchor href — shared by
 * Popup.tsx's manual/on-open webmail quick-check and background.ts's fully
 * automatic one (maybeAutoCheckEmail), so the two never drift into two
 * slightly different extraction behaviors. innerText alone misses
 * "Click here"-style links entirely (the visible text has no URL in it at
 * all; only the href does), which matters a lot more for an email than for
 * a generic page-text check.
 *
 * Requires either `activeTab` (a user gesture just granted temporary host
 * access — how the popup calls it) or a real host_permissions entry for
 * the target's origin (how background.ts's automatic, gesture-less calls
 * work — see manifest.json's host_permissions list). `func` runs injected
 * into the tab, not this module — it can't close over anything from the
 * outer scope, so the whole extraction has to be self-contained.
 */
export const MAX_PAGE_TEXT_CHARS = 20000;

export async function extractPageContent(tabId: number): Promise<{ text: string; links: string[] }> {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText;
        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((href) => href.startsWith("http"));
        return { text, links: Array.from(new Set(links)).slice(0, 40) };
      },
    });
    return result ?? { text: "", links: [] };
  } catch {
    return { text: "", links: [] };
  }
}
