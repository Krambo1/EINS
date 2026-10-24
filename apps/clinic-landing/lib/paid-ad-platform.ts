/**
 * Which paid ad platform (if any) brought this visit.
 *
 * Mirrors the portal convention, which is the source of truth:
 *   apps/portal/src/lib/sources.ts  (MEDIUM_PAID, platformOf, channelFromUtm,
 *   classifyAttribution: channel "meta_anzeige" / "google_anzeige")
 * Keep both in sync. Used to gate every report to Meta / Google / TikTok
 * (owner decision 2026-10-06): a person is reported to a platform only with
 * the separate form consent AND only when they came via a paid ad of THAT
 * platform.
 *
 * Differences to the portal, both stricter or additive:
 *   - Google needs a click id (gclid / wbraid / gbraid). A paid UTM with
 *     utm_source=google alone is not enough, matching the purchase worker.
 *   - TikTok paid UTMs return "tiktok" (the portal has no paid TikTok
 *     channel and calls them "unbekannt").
 *
 * fbclid alone never counts: Meta appends it to organic link clicks too.
 */

export type PaidAdPlatform = "meta" | "google" | "tiktok";

// Same set as MEDIUM_PAID in apps/portal/src/lib/sources.ts.
const MEDIUM_PAID = new Set([
  "anzeige", "anzeigen", "cpc", "ppc", "paid", "paid_social", "paidsocial", "paid_search", "ads", "ad",
]);
// Same sets as MEDIUM_PROFIL / MEDIUM_DM in the portal: these are EINS links,
// never ads, even when a click id rides along.
const MEDIUM_PROFIL = new Set([
  "profil_link", "profillink", "profil", "profile_link", "profile", "bio", "link_in_bio", "linkinbio",
]);
const MEDIUM_DM = new Set(["dm", "dm_link", "direktnachricht", "direct_message", "nachricht", "message"]);

function platformOf(utmSource: string | null): "instagram" | "facebook" | "tiktok" | "google" | "meta" | null {
  if (!utmSource) return null;
  if (utmSource === "instagram" || utmSource === "ig" || utmSource === "insta") return "instagram";
  if (utmSource === "facebook" || utmSource === "fb") return "facebook";
  if (utmSource === "tiktok" || utmSource === "tt") return "tiktok";
  if (utmSource === "google") return "google";
  if (utmSource === "meta") return "meta";
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * @param utm The visit's UTM bag as captured by the pre-qualifier
 *   (`extractUtm()`): utm_* plus fbclid / gclid / wbraid / gbraid / ttclid.
 */
export function paidAdPlatformOfVisit(
  utm: Record<string, string> | null | undefined,
): PaidAdPlatform | null {
  if (!utm) return null;
  // Same normalization as normalizeMedium in the portal: "paid-social",
  // "Paid Social" and "paid_social" are one medium.
  const medium = str(utm.utm_medium)?.toLowerCase().replace(/[\s-]+/g, "_") ?? null;
  const rawPlatform = platformOf(str(utm.utm_source)?.toLowerCase() ?? null);
  const hasGoogleClick = Boolean(str(utm.gclid) || str(utm.wbraid) || str(utm.gbraid));

  if (medium && (MEDIUM_PROFIL.has(medium) || MEDIUM_DM.has(medium))) return null;

  if ((medium && MEDIUM_PAID.has(medium)) || hasGoogleClick) {
    if (rawPlatform === "google" || (hasGoogleClick && !rawPlatform)) {
      return hasGoogleClick ? "google" : null;
    }
    if (rawPlatform === "instagram" || rawPlatform === "facebook" || rawPlatform === "meta") {
      return "meta";
    }
    if (rawPlatform === "tiktok" && medium && MEDIUM_PAID.has(medium)) return "tiktok";
  }
  return null;
}
