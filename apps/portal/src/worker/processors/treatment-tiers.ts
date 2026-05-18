/**
 * Single source of truth for treatment-value scoring.
 *
 * Mirrors the `category` enum in apps/clinic-landing/lib/schema.ts. The
 * rule-based scorer reads the tier here when the landing form passes a
 * `treatmentCategory` in the intake payload. The heuristic fallback (for
 * non-formular leads without structured quiz data) maps free-text
 * `treatmentWish` to a category via the keyword table below.
 */

export type TreatmentCategory =
  | "botox"
  | "filler"
  | "lid-op"
  | "liposuktion"
  | "brust"
  | "rhino"
  | "anti-aging"
  | "skin"
  | "other";

/** All valid category strings — used by the Zod schema in the intake route. */
export const TREATMENT_CATEGORIES = [
  "botox",
  "filler",
  "lid-op",
  "liposuktion",
  "brust",
  "rhino",
  "anti-aging",
  "skin",
  "other",
] as const;

/**
 * Base points for the treatment-value bucket. The specificity modifier
 * (kombination / unsicher / specific) is applied on top by the caller; the
 * combined value is then clamped to [5, 25].
 *
 * Tiers:
 *   - Surgical / high-ticket → 20 (rhino, brust, lid-op, liposuktion)
 *   - Mid-ticket             → 14 (filler, anti-aging, other)
 *   - Low-ticket             → 9  (botox, skin)
 *   - Unknown                → 12 (neutral fallback for legacy payloads)
 */
export function tierBasePoints(
  category: TreatmentCategory | string | null | undefined,
): number {
  switch (category) {
    case "rhino":
    case "brust":
    case "lid-op":
    case "liposuktion":
      return 20;
    case "filler":
    case "anti-aging":
    case "other":
      return 14;
    case "botox":
    case "skin":
      return 9;
    default:
      return 12;
  }
}

/**
 * Free-text → category map for the heuristic fallback. Order matters — first
 * substring match wins, lowercase comparison. Used by `scoreWithHeuristic`
 * when no structured quiz data exists (manual / WhatsApp / paid-ad intake).
 */
const KEYWORD_TO_CATEGORY: ReadonlyArray<readonly [string, TreatmentCategory]> = [
  ["rhinoplastik", "rhino"],
  ["nasenkorrektur", "rhino"],
  ["nasen-op", "rhino"],
  ["rhino", "rhino"],
  ["brustvergrößerung", "brust"],
  ["brustvergroesserung", "brust"],
  ["brustverkleinerung", "brust"],
  ["bruststraffung", "brust"],
  ["brust-op", "brust"],
  ["mammaplastik", "brust"],
  ["lidkorrektur", "lid-op"],
  ["oberlid", "lid-op"],
  ["unterlid", "lid-op"],
  ["blepharoplastik", "lid-op"],
  ["fettabsaugung", "liposuktion"],
  ["liposuktion", "liposuktion"],
  ["liposuction", "liposuktion"],
  ["hyaluron", "filler"],
  ["filler", "filler"],
  ["lippenunterspritzung", "filler"],
  ["jawline", "filler"],
  ["botox", "botox"],
  ["botulinum", "botox"],
  ["skinbooster", "skin"],
  ["microneedling", "skin"],
  ["peeling", "skin"],
  ["fadenlifting", "anti-aging"],
  ["mesotherapie", "anti-aging"],
  ["anti-aging", "anti-aging"],
];

export function inferCategoryFromText(
  text: string | null | undefined,
): TreatmentCategory | null {
  if (!text) return null;
  const lc = text.toLowerCase();
  for (const [kw, cat] of KEYWORD_TO_CATEGORY) {
    if (lc.includes(kw)) return cat;
  }
  return null;
}
