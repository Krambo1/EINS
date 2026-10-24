/**
 * Treatment slug + keyword helpers for "Behandlung anlegen" (F-20). Pure, so
 * they are unit-testable.
 *
 * The Praxis only types a name. The slug (internal id, unique per Praxis) is
 * derived from it, and the name itself counts as a keyword, so a new
 * treatment matches Anfragen even when no Stichwörter were entered.
 */

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export function slugifyTreatmentName(name: string): string {
  const lowered = name
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
  const slug = lowered
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return slug || "behandlung";
}

/** First free slug: `base`, then `base-2`, `base-3`, … */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Keywords as stored (lowercase, comma-separated, deduplicated) with the
 * treatment name added. Names shorter than 4 characters are not added on
 * their own: the classifier matches substrings, so "OP" would hit "Kopf".
 */
export function keywordsWithName(name: string, keywords?: string | null): string | null {
  const parts = (keywords ?? "")
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  const nameKw = name.trim().toLowerCase();
  if (nameKw.length >= 4) parts.unshift(nameKw);
  const unique = Array.from(new Set(parts));
  return unique.length > 0 ? unique.join(", ") : null;
}
