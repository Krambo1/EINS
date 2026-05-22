import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import { decryptString, encryptString } from "@/lib/crypto";

/**
 * Google Ads Offline Conversion Import — `customers/{cid}:uploadClickConversions`.
 *
 * Closed-loop revenue attribution: when a PVS InvoicePaid arrives, the
 * oci-purchase worker calls `uploadClickConversion` here with the gclid
 * (or wbraid / gbraid for iOS-14-era clicks) and the real EUR value.
 * Google then teaches Smart Bidding to optimise for real-paying patients
 * instead of vanity Lead conversions.
 *
 * Refresh-token storage mirrors what sync-google.ts already does so the
 * worker reuses the existing OAuth connection: no separate consent flow.
 */

const GOOGLE_ADS_API_VERSION = "v18";

export interface UploadClickConversionArgs {
  clinicId: string;
  customerId: string;
  loginCustomerId: string;
  conversionAction: string;
  developerToken: string;
  /**
   * Exactly one of these three must be present; gclid takes priority.
   * iOS-14-era clicks lack gclid; web fallbacks land in wbraid, app
   * fallbacks in gbraid.
   */
  gclid?: string | null;
  wbraid?: string | null;
  gbraid?: string | null;
  /** Conversion timestamp in ISO 8601; we format to Google's `YYYY-MM-DD HH:MM:SS+ZZ:ZZ`. */
  occurredAt: Date;
  /** EUR value (decimal). Google wants this as a float. */
  valueEur: number;
  /**
   * Order id used by Google for dedup within 24h. We pass the outbox row's
   * pvs_event_log_id so a worker retry produces an identical key.
   */
  orderId: string;
  /** Optional SHA-256 of lowercased email for enhanced conversions. */
  hashedEmail?: string;
  /** Optional SHA-256 of digits-only phone for enhanced conversions. */
  hashedPhone?: string;
}

export interface UploadClickConversionResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/**
 * Refresh the Google OAuth access token for one clinic, persist the new
 * token + expiry. Returns the access token or null when no refresh token
 * is on file (i.e. the praxis hasn't connected Google yet).
 */
export async function refreshGoogleAccessTokenForClinic(
  clinicId: string
): Promise<string | null> {
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) {
    return null;
  }
  const [cred] = await db
    .select()
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, "google")
      )
    )
    .limit(1);
  if (!cred?.refreshTokenEnc) return null;

  const refreshToken = decryptString(cred.refreshTokenEnc);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`google refresh http ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };

  // Persist the new access token so concurrent workers in the same window
  // don't all refresh again. Mirrors sync-google.ts.
  await db
    .update(schema.platformCredentials)
    .set({
      accessTokenEnc: encryptString(data.access_token),
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    })
    .where(eq(schema.platformCredentials.id, cred.id));

  return data.access_token;
}

/**
 * Format a Date to the format Google Ads OCI expects:
 *   `YYYY-MM-DD HH:MM:SS+ZZ:ZZ`  (NOT ISO 8601 with `T`).
 *
 * We always emit UTC (`+00:00`) so DST never produces a bad signature.
 */
export function formatGoogleConversionDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
  );
}

interface ClickConversionPayload {
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: "EUR";
  orderId: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  userIdentifiers?: Array<{
    hashedEmail?: string;
    hashedPhoneNumber?: string;
  }>;
}

export function buildClickConversionPayload(
  args: UploadClickConversionArgs
): ClickConversionPayload | { reason: "no_click_id" } {
  const click = args.gclid ?? args.wbraid ?? args.gbraid ?? null;
  if (!click) return { reason: "no_click_id" };

  const payload: ClickConversionPayload = {
    conversionAction: args.conversionAction,
    conversionDateTime: formatGoogleConversionDateTime(args.occurredAt),
    conversionValue: Number(args.valueEur.toFixed(2)),
    currencyCode: "EUR",
    orderId: args.orderId,
  };
  if (args.gclid) payload.gclid = args.gclid;
  else if (args.wbraid) payload.wbraid = args.wbraid;
  else if (args.gbraid) payload.gbraid = args.gbraid;

  const userIdentifiers: Array<{
    hashedEmail?: string;
    hashedPhoneNumber?: string;
  }> = [];
  if (args.hashedEmail) userIdentifiers.push({ hashedEmail: args.hashedEmail });
  if (args.hashedPhone)
    userIdentifiers.push({ hashedPhoneNumber: args.hashedPhone });
  if (userIdentifiers.length > 0) payload.userIdentifiers = userIdentifiers;

  return payload;
}

export async function uploadClickConversion(
  args: UploadClickConversionArgs,
  accessToken: string
): Promise<UploadClickConversionResult> {
  const built = buildClickConversionPayload(args);
  if ("reason" in built) {
    return { ok: false, status: 0, body: { error: built.reason } };
  }

  const url =
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/` +
    `${args.customerId}:uploadClickConversions`;
  const body = {
    conversions: [built],
    // `partial_failure` returns 200 with per-row errors instead of failing
    // the whole upload. Safer at the row-at-a-time call site we use here:
    // even a single-row "this gclid is too old" comes back as a structured
    // error we can store in the outbox.
    partialFailure: true,
    validateOnly: false,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": args.developerToken,
        "login-customer-id": args.loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => ({}));
    // partialFailure=true means a 200 can still carry a per-row error.
    // Surface that as ok=false so the worker treats it as a failure.
    const partial = (json as { partialFailureError?: { message?: string } })
      .partialFailureError;
    if (res.ok && partial && partial.message) {
      return { ok: false, status: res.status, body: json };
    }
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: { error: (err as Error).message } };
  }
}
