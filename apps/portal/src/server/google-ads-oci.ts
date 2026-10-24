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

/**
 * Google Ads REST API version, shared with worker/processors/sync-google.ts
 * (E-17). Google sunsets each version roughly a year after release; v18 was
 * already gone. Override with GOOGLE_ADS_API_VERSION (e.g. "v24") without a
 * code change when Google announces the next sunset. A 404 from the API is
 * reported as "version sunset?" by both callers.
 */
export const GOOGLE_ADS_API_VERSION =
  process.env.GOOGLE_ADS_API_VERSION?.trim() || "v23";

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
  /** Value (decimal) in `currency`. Google wants this as a float. */
  valueEur: number;
  /** Currency of valueEur (EUR/CHF). Defaults EUR when omitted. Phase 11. */
  currency?: "EUR" | "CHF";
  /**
   * Order id used by Google for dedup within 24h. We pass the outbox row's
   * pvs_event_log_id so a worker retry produces an identical key.
   */
  orderId: string;
  /** Optional SHA-256 of lowercased email for enhanced conversions. */
  hashedEmail?: string;
  /** Optional SHA-256 of the E.164 phone ("+49...") for enhanced conversions. */
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

/**
 * Pass 2: the conversion time Google accepts. A PVS payment date often has no
 * time (midnight) or predates the click by hours (invoice dated the day of
 * the Beratung, lead created that afternoon); Google rejects that row with
 * CONVERSION_PRECEDES_CLICK, permanently. A future-dated payment is rejected
 * as well. Clamp into [click + 1 min, now].
 */
export function clampConversionTime(
  occurredAt: Date,
  clickAt: Date | null,
  now: Date
): Date {
  let t = occurredAt.getTime();
  if (clickAt) t = Math.max(t, clickAt.getTime() + 60_000);
  t = Math.min(t, now.getTime());
  return new Date(t);
}

/** Upload errors a later retry can fix (Google docs: retry after hours). */
const OCI_RETRYABLE_CODES = [
  "TOO_RECENT_CONVERSION_ACTION",
  "CLICK_NOT_FOUND",
  "TOO_RECENT_EVENT",
  "INTERNAL_ERROR",
  "TRANSIENT_ERROR",
  "RESOURCE_EXHAUSTED",
  "RESOURCE_TEMPORARILY_EXHAUSTED",
  "CONCURRENT_MODIFICATION",
];
/** The conversion is already in Google: the retry of a lost response. */
const OCI_ALREADY_SENT_CODES = [
  "CLICK_CONVERSION_ALREADY_EXISTS",
  "ORDER_ID_ALREADY_IN_USE",
  "DUPLICATE_ORDER_ID",
];

/**
 * Pass 2: what a failed upload means. Every failure used to be retried 3
 * times within ~35 s and then marked failed for good, so a minute of Google
 * trouble or a 429 lost the Purchase, while a duplicate (the conversion is
 * already there) was reported as a failure.
 */
export function classifyOciFailure(
  result: UploadClickConversionResult
): "already_sent" | "retry" | "permanent" {
  const text = JSON.stringify(result.body ?? {});
  if (OCI_ALREADY_SENT_CODES.some((c) => text.includes(c))) return "already_sent";
  if (result.status === 0) {
    // No HTTP response: network, timeout. A missing click id is ours.
    return text.includes("no_click_id") ? "permanent" : "retry";
  }
  if (result.status === 429 || result.status >= 500) return "retry";
  if (OCI_RETRYABLE_CODES.some((c) => text.includes(c))) return "retry";
  // 401: the access token was refreshed right before the call, so a retry
  // with a fresh token is worth it.
  if (result.status === 401) return "retry";
  return "permanent";
}

interface ClickConversionPayload {
  conversionAction: string;
  conversionDateTime: string;
  conversionValue: number;
  currencyCode: "EUR" | "CHF";
  orderId: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  consent: { adUserData: "GRANTED" };
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
    currencyCode: args.currency ?? "EUR",
    orderId: args.orderId,
    // Pass 2 (EU user consent policy / DMA): Google needs the consent signal
    // for EEA users, or the uploaded conversion and its hashed user data may
    // not be used. The worker only gets here with the person's active ads
    // consent (googlePurchaseSkipReason), whose text covers passing this to
    // Google so the Praxis can show its ads more precisely. adPersonalization
    // is left unset: nothing in the consent text asks for more.
    consent: { adUserData: "GRANTED" },
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
    if (res.status === 404) {
      console.error(
        `[google-ads-oci] 404 from Google Ads API ${GOOGLE_ADS_API_VERSION}: version sunset? Set GOOGLE_ADS_API_VERSION.`
      );
    }
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, body: { error: (err as Error).message } };
  }
}
