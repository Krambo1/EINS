import {
  conversionOrderId,
  loadOutboxRow,
  loadRequestForOutbox,
  markFailed,
  markSent,
  markSkipped,
} from "@/server/ads-conversion-outbox";
import { loadClinicAdsConfig } from "@/server/conversion-config";
import {
  clampConversionTime,
  classifyOciFailure,
  refreshGoogleAccessTokenForClinic,
  uploadClickConversion,
} from "@/server/google-ads-oci";
import { ADS_MAX_ATTEMPTS } from "@/lib/queues";
import { hashEmail, hashPhoneForGoogle } from "@/server/meta-capi";
import { googlePurchaseSkipReason } from "@/lib/ads-report-gate";

/**
 * Google Ads Offline Conversion Import worker — uploads a single
 * `Purchase` conversion when a PVS InvoicePaid lands for a request
 * carrying gclid (or its iOS-14-era wbraid/gbraid fallbacks).
 *
 * Triggered by `enqueueInvoiceConversions` (see ads-conversion-outbox.ts).
 * Idempotency at two levels:
 *   • outbox `status=sent` → return early (pg-boss replay protection).
 *   • Google `order_id = outbox dedup key (per invoice)` → Google dedupes within 24h
 *     even on retry-from-scratch, AND if a user revisits the outbox
 *     dashboard and clicks "retry" weeks later, the conversion is still
 *     attached to the same order.
 *
 * Enhanced conversions (hashed email + phone) are added when available —
 * recommended by Google for accuracy, especially for clicks older than 7
 * days where the gclid attribution window has degraded.
 */

export interface OciPurchaseJob {
  outboxId: string;
}

// Pass 2: matches the queue's ADS_RETRY (was 3 against 3 quick retries).
const MAX_ATTEMPTS = ADS_MAX_ATTEMPTS;

export async function processOciPurchase(job: OciPurchaseJob): Promise<void> {
  const row = await loadOutboxRow(job.outboxId);
  if (!row) {
    console.warn(`[oci-purchase] outbox row gone: ${job.outboxId}`);
    return;
  }
  if (row.channel !== "google") {
    throw new Error(`[oci-purchase] wrong channel: ${row.channel}`);
  }
  if (row.status === "sent" || row.status === "skipped") {
    return;
  }

  const config = await loadClinicAdsConfig(row.clinicId);
  if (!config) {
    await markSkipped(row.id, "clinic_not_found");
    return;
  }
  if ("reason" in config.google) {
    await markSkipped(row.id, config.google.reason);
    return;
  }

  const request = await loadRequestForOutbox(row.clinicId, row.requestId);
  if (!request) {
    await markSkipped(row.id, "request_gone");
    return;
  }

  // Report gate (owner decision 2026-10-06): only with the person's active
  // form consent (checked at send time, so a revoke before this point stops
  // the report) AND a Google click id (gclid > wbraid > gbraid). Without a
  // click id OCI has nothing to attach to.
  const skipReason = googlePurchaseSkipReason(request);
  if (skipReason) {
    await markSkipped(row.id, skipReason);
    return;
  }

  let accessToken: string | null;
  try {
    accessToken = await refreshGoogleAccessTokenForClinic(row.clinicId);
  } catch (err) {
    const message = (err as Error).message;
    const nextAttempt = row.attemptCount + 1;
    const finalAttempt = nextAttempt >= MAX_ATTEMPTS;
    await markFailed(
      row.id,
      0,
      { error: `refresh_failed: ${message}` },
      nextAttempt,
      finalAttempt
    );
    if (!finalAttempt) throw err;
    return;
  }
  if (!accessToken) {
    await markSkipped(row.id, "google_not_connected");
    return;
  }

  const hashedEmail = request.contactEmail
    ? hashEmail(request.contactEmail)
    : undefined;
  const hashedPhone = request.contactPhone
    ? hashPhoneForGoogle(request.contactPhone)
    : undefined;

  const result = await uploadClickConversion(
    {
      clinicId: row.clinicId,
      customerId: config.google.customerId,
      loginCustomerId: config.google.loginCustomerId,
      conversionAction: config.google.conversionAction,
      developerToken: config.google.developerToken,
      gclid: request.gclid,
      wbraid: request.wbraid,
      gbraid: request.gbraid,
      // Pass 2: never before the click (the lead's arrival) nor in the
      // future; Google rejects both permanently.
      occurredAt: clampConversionTime(row.occurredAt, request.createdAt, new Date()),
      valueEur: Number(row.valueEur),
      currency: row.currency,
      orderId: conversionOrderId(row),
      hashedEmail,
      hashedPhone,
    },
    accessToken
  );

  const userDataSnapshot = {
    has_gclid: Boolean(request.gclid),
    has_wbraid: Boolean(request.wbraid),
    has_gbraid: Boolean(request.gbraid),
    has_email_hash: Boolean(hashedEmail),
    has_phone_hash: Boolean(hashedPhone),
  };

  if (result.ok) {
    await markSent(row.id, result.status, result.body, userDataSnapshot);
    return;
  }

  // Pass 2: a duplicate means an earlier attempt landed (its response was
  // lost); an error no retry can fix stops now instead of burning retries.
  const kind = classifyOciFailure(result);
  if (kind === "already_sent") {
    await markSent(row.id, result.status, result.body, userDataSnapshot);
    return;
  }
  const nextAttempt = row.attemptCount + 1;
  const finalAttempt = kind === "permanent" || nextAttempt >= MAX_ATTEMPTS;
  await markFailed(row.id, result.status, result.body, nextAttempt, finalAttempt);
  if (!finalAttempt) {
    throw new Error(`oci http ${result.status}`);
  }
}
