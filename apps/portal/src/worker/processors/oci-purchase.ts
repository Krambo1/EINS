import {
  loadOutboxRow,
  loadRequestForOutbox,
  markFailed,
  markSent,
  markSkipped,
} from "@/server/ads-conversion-outbox";
import { loadClinicAdsConfig } from "@/server/conversion-config";
import {
  refreshGoogleAccessTokenForClinic,
  uploadClickConversion,
} from "@/server/google-ads-oci";
import { hashEmail, hashPhone } from "@/server/meta-capi";

/**
 * Google Ads Offline Conversion Import worker — uploads a single
 * `Purchase` conversion when a PVS InvoicePaid lands for a request
 * carrying gclid (or its iOS-14-era wbraid/gbraid fallbacks).
 *
 * Triggered by `enqueueInvoiceConversions` (see ads-conversion-outbox.ts).
 * Idempotency at two levels:
 *   • outbox `status=sent` → return early (pg-boss replay protection).
 *   • Google `order_id = pvs_event_log_id` → Google dedupes within 24h
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

const MAX_ATTEMPTS = 3;

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

  // OCI requires at least one click id (gclid > wbraid > gbraid). Without
  // any of them we have nothing to attach to and the upload will fail with
  // an InvalidArgument; skip cleanly instead.
  if (!request.gclid && !request.wbraid && !request.gbraid) {
    await markSkipped(row.id, "no_google_click_id");
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
    ? hashPhone(request.contactPhone)
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
      occurredAt: row.occurredAt,
      valueEur: Number(row.valueEur),
      currency: row.currency,
      orderId: row.pvsEventLogId,
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

  const nextAttempt = row.attemptCount + 1;
  const finalAttempt = nextAttempt >= MAX_ATTEMPTS;
  await markFailed(row.id, result.status, result.body, nextAttempt, finalAttempt);
  if (!finalAttempt) {
    throw new Error(`oci http ${result.status}`);
  }
}
