/**
 * Browser storage for the command palette's "Zuletzt besucht" and
 * "Schnellzugriff" lists (L-1).
 *
 * Entries can carry a patient's name and treatment, so they are kept per
 * clinic and per user (an admin's customer view of practice A never shows
 * up in practice B, a colleague on the same reception PC never sees another
 * login's history) and wiped on logout (account menu, before the logout
 * form is sent) and on start/end of a customer view. There is deliberately
 * no `Clear-Site-Data` header on logout; this client-side wipe is the only
 * cleanup.
 */

const PREFIX = "eins-portal-search-";
/** Pre-L-1 keys: one global list for everyone who used this browser. */
const LEGACY_KEYS = [`${PREFIX}recent`, `${PREFIX}pinned`];

/** Short stable tag so the key does not spell out the e-mail address. */
function scopeTag(clinicId: string, userKey: string): string {
  // FNV-1a 32-bit over "clinic|user"; collisions only merge two lists of
  // the same browser, never leak across a logout (which clears everything).
  let h = 0x811c9dc5;
  const s = `${clinicId}|${userKey.toLowerCase()}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function searchStorageKeys(clinicId: string, userKey: string) {
  const tag = scopeTag(clinicId, userKey);
  return {
    recent: `${PREFIX}recent:${tag}`,
    pinned: `${PREFIX}pinned:${tag}`,
  };
}

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

/** Drops the old unscoped keys once; scoped lists stay. */
export function clearLegacySearchStorage(): void {
  try {
    for (const k of LEGACY_KEYS) window.localStorage.removeItem(k);
  } catch {
    // see above
  }
}
