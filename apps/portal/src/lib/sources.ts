/**
 * Stable source taxonomy. The raw `requests.source` column is free text
 * (Meta webhook writes "meta", intake API writes "intake", PVS CSV writes
 * "csv", manual entries write "manuell", etc.). Forecast + reporting queries
 * need a constrained set of buckets that survives free-text drift.
 *
 * The legacy `constants.ts` REQUEST_SOURCES list is a subset of what we see
 * in production; this module is the canonical normalizer. attribution.ts and
 * forecast.ts both go through `canonicalSource()` so a future renamed source
 * (or a typo on the intake side) collapses to "unbekannt" instead of
 * fragmenting a per-source rate into a one-row sample.
 */

export const FORECAST_SOURCES = [
  "meta",
  "google",
  "formular",
  "manuell",
  "whatsapp",
  "empfehlung",
  "pvs_import",
  "unbekannt",
] as const;

export type ForecastSource = (typeof FORECAST_SOURCES)[number];

export const FORECAST_SOURCE_LABELS: Record<ForecastSource, string> = {
  meta: "Meta / Instagram",
  google: "Google Ads",
  formular: "Zielseiten-Formular",
  manuell: "Manueller Eintrag",
  whatsapp: "WhatsApp",
  empfehlung: "Empfehlung",
  pvs_import: "PVS-Import",
  unbekannt: "Unbekannt",
};

/**
 * Normalize whatever lives in `requests.source` into a forecast bucket.
 * Returns "unbekannt" rather than throwing on unknown values so a single
 * misnamed source never crashes the forecast page.
 */
export function canonicalSource(raw: string | null | undefined): ForecastSource {
  if (!raw) return "unbekannt";
  const s = raw.toLowerCase().trim();
  if (s === "meta" || s === "meta_lead_form" || s === "facebook" || s === "instagram") {
    return "meta";
  }
  if (s === "google" || s === "google_form" || s === "google_ads") {
    return "google";
  }
  if (s === "formular" || s === "intake" || s === "landing" || s === "website") {
    return "formular";
  }
  if (s === "manuell" || s === "manual") {
    return "manuell";
  }
  if (s === "whatsapp" || s === "wa") {
    return "whatsapp";
  }
  if (s === "empfehlung" || s === "referral" || s === "word_of_mouth") {
    return "empfehlung";
  }
  if (s === "csv" || s === "pvs" || s === "pvs_import" || s === "import") {
    return "pvs_import";
  }
  return "unbekannt";
}
