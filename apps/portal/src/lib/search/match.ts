/**
 * Umlaut-folding and a simple ranking score for the global search.
 *
 * We don't want users to have to type "ä" / "ö" / "ü" / "ß" to find German
 * results, so all comparisons happen on a folded lower-case string. cmdk
 * exposes its own `filter` prop that returns a number 0..1 — anything > 0
 * makes the row visible; higher scores sort earlier.
 */

export function fold(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Score `haystack` against `needle` after folding both. Returns 0 for no match,
 * higher for better matches. Heuristics:
 *   - exact whole-string match: 1.0
 *   - prefix match on a token: 0.9
 *   - whole haystack starts with needle: 0.85
 *   - substring match anywhere: 0.6
 *
 * No fuzzy "chars-in-order" fallback — it was matching unrelated entries
 * (e.g. searching "Mitarbeiter" surfaced the Patientenfeedback KPI because
 * m,i,t,a,r,b,e,i,t,e,r happened to appear in order across the haystack).
 * Users prefer no result over a misleading one.
 */
export function scoreMatch(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = fold(haystack);
  const n = fold(needle);
  if (h === n) return 1;
  // Token-prefix: any whitespace-separated word starts with the needle.
  for (const token of h.split(/\s+/)) {
    if (token.startsWith(n)) return 0.9;
  }
  if (h.startsWith(n)) return 0.85;
  if (h.includes(n)) return 0.6;
  return 0;
}
