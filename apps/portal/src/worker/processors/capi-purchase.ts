import {
  loadOutboxRow,
  loadRequestForOutbox,
  markFailed,
  markSent,
  markSkipped,
} from "@/server/ads-conversion-outbox";
import { loadClinicAdsConfig } from "@/server/conversion-config";
import {
  hashEmail,
  hashName,
  hashPhone,
  rebuildFbcFromFbclid,
  sendCapi,
  type CapiUserData,
} from "@/server/meta-capi";

/**
 * Meta CAPI Purchase worker — fires a server-side Purchase event when a
 * PVS InvoicePaid lands for a request whose original click is on file.
 *
 * Triggered by `enqueueInvoiceConversions` (see ads-conversion-outbox.ts)
 * which inserts one outbox row per (request, InvoicePaid, channel) and
 * enqueues this worker by row id. The worker is idempotent at two levels:
 *   • outbox `status=sent` → return early (BullMQ replay protection).
 *   • Meta `event_id = purchase-<requestId>-<pvsEventLogId>` → Meta dedupes
 *     within 7 days even if the outbox row gets reset to pending and we
 *     retry from scratch.
 *
 * Best Practices Meta itself documents for the CAPI Purchase event:
 *   • Send fbc + fbp wherever you have them — the match-quality score
 *     plummets without them.
 *   • Hash email + phone with SHA-256 of the lowercased trimmed value.
 *   • action_source = "physical_store" is more accurate here than
 *     "website" because the transaction itself happened in the praxis
 *     (Meta's bidding model uses this to weight LTV).
 */

export interface CapiPurchaseJob {
  outboxId: string;
}

/** Max attempts before we hard-fail the outbox row. Aligns with the BullMQ default. */
const MAX_ATTEMPTS = 3;

export async function processCapiPurchase(job: CapiPurchaseJob): Promise<void> {
  const row = await loadOutboxRow(job.outboxId);
  if (!row) {
    console.warn(`[capi-purchase] outbox row gone: ${job.outboxId}`);
    return;
  }
  if (row.channel !== "meta") {
    // Shouldn't happen — but a misrouted job would silently send the wrong
    // event to the wrong platform, so fail loudly.
    throw new Error(`[capi-purchase] wrong channel: ${row.channel}`);
  }
  if (row.status === "sent" || row.status === "skipped") {
    return;
  }

  const config = await loadClinicAdsConfig(row.clinicId);
  if (!config) {
    await markSkipped(row.id, "clinic_not_found");
    return;
  }
  if ("reason" in config.meta) {
    await markSkipped(row.id, config.meta.reason);
    return;
  }

  const request = await loadRequestForOutbox(row.clinicId, row.requestId);
  if (!request) {
    await markSkipped(row.id, "request_gone");
    return;
  }

  // We need at least one Meta-side identifier on the user_data envelope
  // (fbc/fbclid) OR a hashed PII identifier (email/phone) for Meta to
  // attribute. With neither, the event has zero match potential — skip
  // and tell admins why.
  const hasMetaClick = Boolean(request.fbc || request.fbclid);
  const hasHashablePii = Boolean(request.contactEmail || request.contactPhone);
  if (!hasMetaClick && !hasHashablePii) {
    await markSkipped(row.id, "no_meta_identifier");
    return;
  }

  const eventTimeSeconds = Math.floor(row.occurredAt.getTime() / 1000);

  const userData: CapiUserData = {};
  if (request.contactEmail)
    userData.em = [hashEmail(request.contactEmail)];
  if (request.contactPhone)
    userData.ph = [hashPhone(request.contactPhone)];
  if (request.contactName)
    userData.fn = [hashName(request.contactName)];

  // Meta accepts the raw `_fbc` cookie value; if we only have the bare
  // `fbclid` from the URL, rebuild the canonical form Meta expects.
  if (request.fbc) {
    userData.fbc = request.fbc;
  } else if (request.fbclid) {
    userData.fbc = rebuildFbcFromFbclid(request.fbclid, eventTimeSeconds);
  }
  if (request.fbp) userData.fbp = request.fbp;
  if (request.clickUserAgent) userData.client_user_agent = request.clickUserAgent;
  if (request.clickIpAnon) userData.client_ip_address = request.clickIpAnon;

  const result = await sendCapi({
    pixelId: config.meta.pixelId,
    accessToken: config.meta.accessToken,
    apiVersion: config.meta.apiVersion,
    events: [
      {
        event_name: "Purchase",
        event_id: row.dedupKey,
        event_time: eventTimeSeconds,
        // Transaction itself happens in the praxis, not on the website.
        // Drives Meta's value-based bidding model more correctly than
        // "website" would.
        action_source: "physical_store",
        user_data: userData,
        custom_data: {
          value: Number(row.valueEur),
          currency: row.currency,
          order_id: row.pvsEventLogId,
        },
      },
    ],
  });

  // Stash a no-PII snapshot of what we actually sent. The hashes are
  // already opaque, but we also avoid storing them: a /admin viewer doesn't
  // need to know which patient — just that the call carried n identifiers.
  const userDataSnapshot = {
    has_email_hash: Boolean(userData.em?.length),
    has_phone_hash: Boolean(userData.ph?.length),
    has_name_hash: Boolean(userData.fn?.length),
    has_fbc: Boolean(userData.fbc),
    has_fbp: Boolean(userData.fbp),
    has_user_agent: Boolean(userData.client_user_agent),
    has_ip: Boolean(userData.client_ip_address),
  };

  if (result.ok) {
    await markSent(row.id, result.status, result.body, userDataSnapshot);
    return;
  }

  const nextAttempt = row.attemptCount + 1;
  const finalAttempt = nextAttempt >= MAX_ATTEMPTS;
  await markFailed(row.id, result.status, result.body, nextAttempt, finalAttempt);
  if (!finalAttempt) {
    // Throw so BullMQ retries with the standard exponential backoff
    // defined in jobs.ts. Final attempt: don't throw — the outbox row is
    // already `failed`, no point in BullMQ marking the job failed too.
    throw new Error(`capi http ${result.status}`);
  }
}
