/**
 * Browser storage of the former command palette's "Zuletzt besucht" and
 * "Schnellzugriff" lists (L-1).
 *
 * Entries can carry a patient's name and treatment, so they are wiped on
 * logout (account menu, before the logout form is sent) and on start/end of
 * a customer view. There is deliberately no `Clear-Site-Data` header on
 * logout; this client-side wipe is the only cleanup.
 */

const PREFIX = "eins-portal-search-";
/** Removes every palette list in this browser (all scopes plus legacy keys). */
export function clearSearchStorage(): void {
  try {
    const ls = window.localStorage;
    const doomed: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) ls.removeItem(k);
  } catch {
    // localStorage unavailable (private mode): nothing stored, nothing to clear.
  }
}
