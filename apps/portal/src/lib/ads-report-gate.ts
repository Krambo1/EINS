import { classifyAttribution } from "@/lib/sources";

/**
 * Gate for every report EINS sends to Meta or Google about a person
 * (owner decision 2026-10-06, migration 0077).
 *
 * A report goes to a platform ONLY when BOTH hold:
 *   1. the person gave the separate, optional consent in the EINS form and has
 *      not revoked it, and
 *   2. the person came via a paid ad of THAT platform:
 *        Meta:   classifyAttribution({source, utm}).channel === "meta_anzeige"
 *                (fbclid alone does not count, Meta appends it to organic
 *                clicks too)
 *        Google: a gclid / wbraid / gbraid click id on the request
 *
 * Pure (no "server-only", no DB) so the rule is unit-testable. Workers call it
 * at send time, so a revoke before sending stops the report.
 */

/**
 * Meta purchase reporting is OFF (owner decision 2026-10-06): Meta restricts
 * lower-funnel events of health advertisers in the EU and a Purchase risks
 * the ad account; EINS ranks ads by treated patients in the portal instead.
 * While false, no meta outbox row is created and capi-purchase skips any
 * existing one with `meta_purchase_off`. Google is unaffected.
 */
export const META_PURCHASE_REPORTING = false as boolean;

export interface AdsReportGateInput {
  source: string | null;
  utm: unknown;
  adsConsentAt: Date | null;
  adsConsentRevokedAt: Date | null;
  contactEmail: string | null;
  contactPhone: string | null;
  fbc: string | null;
  fbclid: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
}

export type MetaSkipReason = "no_ads_consent" | "not_meta_ad" | "no_meta_identifier";
export type GoogleSkipReason = "no_ads_consent" | "no_google_click_id";

/** True when consent was given and not revoked. */
export function hasActiveAdsConsent(
  req: Pick<AdsReportGateInput, "adsConsentAt" | "adsConsentRevokedAt">
): boolean {
  return req.adsConsentAt != null && req.adsConsentRevokedAt == null;
}

/** `null` = send the Meta report; otherwise the reason to skip it. */
export function metaPurchaseSkipReason(req: AdsReportGateInput): MetaSkipReason | null {
  if (!hasActiveAdsConsent(req)) return "no_ads_consent";
  if (classifyAttribution({ source: req.source, utm: req.utm }).channel !== "meta_anzeige") {
    return "not_meta_ad";
  }
  // Meta needs at least one identifier to match the event to a person.
  const hasMetaClick = Boolean(req.fbc || req.fbclid);
  const hasHashablePii = Boolean(req.contactEmail || req.contactPhone);
  if (!hasMetaClick && !hasHashablePii) return "no_meta_identifier";
  return null;
}

/** `null` = send the Google report; otherwise the reason to skip it. */
export function googlePurchaseSkipReason(req: AdsReportGateInput): GoogleSkipReason | null {
  if (!hasActiveAdsConsent(req)) return "no_ads_consent";
  // OCI requires a click id (gclid > wbraid > gbraid) to attach to.
  if (!req.gclid && !req.wbraid && !req.gbraid) return "no_google_click_id";
  return null;
}
