import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Per-praxis ads-conversion configuration loader.
 *
 * The capi-purchase and oci-purchase workers each call this once at the
 * start of a job. Anything that returns `null` for a channel means "skip
 * that channel" — the outbox row lands as `status='skipped'` with a
 * `missing_*` reason captured in the response_body.
 *
 * Token convention:
 *   • Meta: `META_CAPI_TOKEN_<UPPERCASE_SLUG>` env var (matches the
 *     clinic-landing /api/lead path so a praxis with working Lead events
 *     also gets working Purchase events automatically). Dashes in the
 *     slug become underscores.
 *   • Google: OAuth refresh token from platform_credentials (platform='google'),
 *     refreshed on demand via the existing oauth helpers in this app. The
 *     access_token row carries the customer-id confirmation in account_id;
 *     the customer id we send on the wire comes from clinics.google_ads_customer_id
 *     because that's what the praxis sees in the settings form.
 */

export interface MetaConfig {
  /** Meta Pixel id (numeric, ~15 digits). */
  pixelId: string;
  /** Long-lived System User token from `META_CAPI_TOKEN_<SLUG>` env. */
  accessToken: string;
  /** API version we send on the wire. Bumped together with the helper. */
  apiVersion: string;
}

export interface GoogleConfig {
  /** Customer id, digits only (dashes stripped). */
  customerId: string;
  /** Full conversion-action resource name from the praxis's Google Ads account. */
  conversionAction: string;
  /** Manager (MCC) customer id used for `login-customer-id` header, digits only. */
  loginCustomerId: string;
  /** Anthropic-grade obvious: developer token from env, gates ALL Google Ads calls. */
  developerToken: string;
}

export interface ClinicAdsConfig {
  clinicId: string;
  slug: string;
  meta: MetaConfig | { reason: MetaSkipReason };
  google: GoogleConfig | { reason: GoogleSkipReason };
}

export type MetaSkipReason =
  | "missing_pixel_id"
  | "missing_capi_token";

export type GoogleSkipReason =
  | "missing_customer_id"
  | "missing_conversion_action"
  | "missing_login_customer_id"
  | "missing_developer_token";

const META_API_VERSION = "v21.0";

/** Build the env-var name a praxis's CAPI token lives under. */
export function metaCapiTokenEnvName(slug: string): string {
  return `META_CAPI_TOKEN_${slug.toUpperCase().replace(/-/g, "_")}`;
}

/** Normalize a Google Ads customer id to digits-only. */
export function normalizeGoogleCustomerId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits : null;
}

export async function loadClinicAdsConfig(
  clinicId: string
): Promise<ClinicAdsConfig | null> {
  const [clinic] = await db
    .select({
      id: schema.clinics.id,
      slug: schema.clinics.slug,
      metaPixelId: schema.clinics.metaPixelId,
      googleAdsCustomerId: schema.clinics.googleAdsCustomerId,
      googleAdsConversionAction: schema.clinics.googleAdsConversionAction,
      googleAdsLoginCustomerId: schema.clinics.googleAdsLoginCustomerId,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) return null;

  const meta = resolveMeta(clinic.slug, clinic.metaPixelId);
  const google = resolveGoogle(
    clinic.googleAdsCustomerId,
    clinic.googleAdsConversionAction,
    clinic.googleAdsLoginCustomerId
  );

  return {
    clinicId: clinic.id,
    slug: clinic.slug,
    meta,
    google,
  };
}

function resolveMeta(
  slug: string,
  pixelId: string | null
): MetaConfig | { reason: MetaSkipReason } {
  if (!pixelId) return { reason: "missing_pixel_id" };
  const token = process.env[metaCapiTokenEnvName(slug)];
  if (!token) return { reason: "missing_capi_token" };
  return { pixelId, accessToken: token, apiVersion: META_API_VERSION };
}

function resolveGoogle(
  customerIdRaw: string | null,
  conversionAction: string | null,
  loginOverrideRaw: string | null
): GoogleConfig | { reason: GoogleSkipReason } {
  const customerId = normalizeGoogleCustomerId(customerIdRaw);
  if (!customerId) return { reason: "missing_customer_id" };
  if (!conversionAction) return { reason: "missing_conversion_action" };
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return { reason: "missing_developer_token" };
  const loginId =
    normalizeGoogleCustomerId(loginOverrideRaw) ??
    normalizeGoogleCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null);
  if (!loginId) return { reason: "missing_login_customer_id" };
  return {
    customerId,
    conversionAction,
    loginCustomerId: loginId,
    developerToken,
  };
}
