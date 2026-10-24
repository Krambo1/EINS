import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueueCapiPurchase, enqueueOciPurchase } from "@/server/jobs";
import { META_PURCHASE_REPORTING } from "@/lib/ads-report-gate";

/**
 * Outbox helpers for closed-loop revenue attribution.
 *
 * Producers (pvs-status-derive) call `enqueueInvoiceConversions` for each
 * NEW InvoicePaid event tied to a request. It inserts one outbox row per
 * channel (meta, google) with ON CONFLICT DO NOTHING, and enqueues a
 * channel-specific worker ONLY for rows that were actually inserted —
 * which makes the whole pipeline safe under pvs-status-derive replays.
 *
 * Workers (capi-purchase, oci-purchase) call `loadOutboxRow` /
 * `markSent` / `markFailed` / `markSkipped`.
 */

export type AdsChannel = "meta" | "google";

export interface EnqueueInvoiceConversionArgs {
  clinicId: string;
  requestId: string;
  pvsEventLogId: string;
  /** Invoice identity. Optional: looked up from the pvs_event_log row when omitted. */
  bridgeSource?: string;
  pvsInvoiceId?: string;
  /** Value (decimal) in `currency`. Stored verbatim on the outbox row. */
  valueEur: number;
  /** Currency of valueEur (EUR/CHF). Defaults EUR. Sent to CAPI/OCI. Phase 11. */
  currency?: "EUR" | "CHF";
  occurredAt: Date;
}

/**
 * Wire-level dedup id (Meta event_id / Google order_id) for one invoice. Derived
 * from (clinic, bridgeSource, pvsInvoiceId) so every re-emission of the same
 * invoice maps to the same id; hashed so arbitrary invoice ids stay within the
 * platforms' length/charset limits.
 */
export function invoiceDedupKey(
  clinicId: string,
  bridgeSource: string,
  pvsInvoiceId: string
): string {
  const h = createHash("sha256")
    .update(`${clinicId}|${bridgeSource}|${pvsInvoiceId}`)
    .digest("hex")
    .slice(0, 32);
  return `purchase-inv-${h}`;
}

/**
 * order_id sent to Meta/Google. Invoice-keyed rows use their dedup key; legacy
 * rows (written before 0080) keep the pvs_event_log id they were first sent with.
 */
export function conversionOrderId(row: {
  dedupKey: string;
  pvsEventLogId: string;
}): string {
  return row.dedupKey.startsWith("purchase-inv-")
    ? row.dedupKey
    : row.pvsEventLogId;
}

export interface EnqueueResult {
  /** Channels we just inserted (and enqueued). Empty on a full replay. */
  inserted: AdsChannel[];
  /** Channels skipped because a row already exists for this event. */
  alreadyExists: AdsChannel[];
}

/**
 * Insert outbox rows for each reported channel and enqueue workers for the
 * rows that didn't already exist. Meta only while META_PURCHASE_REPORTING is
 * on (currently off: Google only). The (clinic_id, channel, pvs_event_log_id)
 * UNIQUE index is what makes this idempotent under replays, and the
 * (clinic_id, channel, bridge_source, pvs_invoice_id) partial UNIQUE index
 * (migration 0080) makes it idempotent across re-emitted invoices and admin
 * replays, which arrive as NEW pvs_event_log rows. Only InvoicePaid rows are
 * accepted: an InvoiceRefunded never creates a Purchase conversion.
 *
 * We create a row per reported channel, even if the request lacks a click id
 * for that channel — the worker is the right place to decide "skipped",
 * because it can tell admins the precise reason in response_body. Creating
 * the row also gives /admin a per-channel record of every invoice for
 * forensic purposes.
 */
export async function enqueueInvoiceConversions(
  args: EnqueueInvoiceConversionArgs
): Promise<EnqueueResult> {
  const inserted: AdsChannel[] = [];
  const alreadyExists: AdsChannel[] = [];
  // Pass 2: a zero (or refunded-to-zero) invoice is not a purchase. Before,
  // a 0 € Kassenleistung or a storniert-then-reissued invoice reported a
  // Purchase worth 0, which counts as a conversion in Meta / Google and skews
  // bidding. Guarded here as well as in derive, so no caller can send one.
  if (!(args.valueEur > 0)) return { inserted, alreadyExists };
  const channels: AdsChannel[] = META_PURCHASE_REPORTING ? ["meta", "google"] : ["google"];

  // Resolve the invoice identity (and refuse non-InvoicePaid rows).
  let bridgeSource = args.bridgeSource ?? null;
  let pvsInvoiceId = args.pvsInvoiceId ?? null;
  if (!bridgeSource || !pvsInvoiceId) {
    const [ev] = await db
      .select({
        kind: schema.pvsEventLog.kind,
        bridgeSource: schema.pvsEventLog.bridgeSource,
        payload: schema.pvsEventLog.payload,
      })
      .from(schema.pvsEventLog)
      .where(
        and(
          eq(schema.pvsEventLog.id, args.pvsEventLogId),
          eq(schema.pvsEventLog.clinicId, args.clinicId)
        )
      )
      .limit(1);
    if (ev) {
      if (ev.kind !== "InvoicePaid") return { inserted, alreadyExists };
      bridgeSource = ev.bridgeSource;
      const pid = (ev.payload as { pvsInvoiceId?: unknown } | null)?.pvsInvoiceId;
      pvsInvoiceId = typeof pid === "string" && pid ? pid : null;
    }
  }
  const dedupKey =
    bridgeSource && pvsInvoiceId
      ? invoiceDedupKey(args.clinicId, bridgeSource, pvsInvoiceId)
      : `purchase-${args.requestId}-${args.pvsEventLogId}`;

  for (const channel of channels) {
    const [row] = await db
      .insert(schema.adsConversionOutbox)
      .values({
        clinicId: args.clinicId,
        requestId: args.requestId,
        pvsEventLogId: args.pvsEventLogId,
        channel,
        eventName: "Purchase",
        valueEur: args.valueEur.toFixed(2),
        currency: args.currency ?? "EUR",
        occurredAt: args.occurredAt,
        dedupKey,
        bridgeSource: pvsInvoiceId ? bridgeSource : null,
        pvsInvoiceId,
      })
      // No target: either UNIQUE (per event, or per invoice) may fire.
      .onConflictDoNothing()
      .returning({ id: schema.adsConversionOutbox.id });

    if (row) {
      inserted.push(channel);
      // Enqueue is best-effort; jobs.ts swallows enqueue errors so a
      // broken queue can't roll back the outbox insert. A lost enqueue is
      // picked up by reenqueueStuckOutbox() (pvs-apply-sweep worker).
      if (channel === "meta") await enqueueCapiPurchase(row.id);
      else await enqueueOciPurchase(row.id);
    } else {
      alreadyExists.push(channel);
    }
  }

  return { inserted, alreadyExists };
}

export interface OutboxRowForWorker {
  id: string;
  clinicId: string;
  requestId: string;
  pvsEventLogId: string;
  channel: AdsChannel;
  eventName: string;
  valueEur: string;
  currency: "EUR" | "CHF";
  occurredAt: Date;
  status: string;
  attemptCount: number;
  dedupKey: string;
}

export async function loadOutboxRow(
  outboxId: string
): Promise<OutboxRowForWorker | null> {
  const [row] = await db
    .select({
      id: schema.adsConversionOutbox.id,
      clinicId: schema.adsConversionOutbox.clinicId,
      requestId: schema.adsConversionOutbox.requestId,
      pvsEventLogId: schema.adsConversionOutbox.pvsEventLogId,
      channel: schema.adsConversionOutbox.channel,
      eventName: schema.adsConversionOutbox.eventName,
      valueEur: schema.adsConversionOutbox.valueEur,
      currency: schema.adsConversionOutbox.currency,
      occurredAt: schema.adsConversionOutbox.occurredAt,
      status: schema.adsConversionOutbox.status,
      attemptCount: schema.adsConversionOutbox.attemptCount,
      dedupKey: schema.adsConversionOutbox.dedupKey,
    })
    .from(schema.adsConversionOutbox)
    .where(eq(schema.adsConversionOutbox.id, outboxId))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    channel: row.channel as AdsChannel,
    currency: row.currency as "EUR" | "CHF",
  };
}

export async function markSent(
  outboxId: string,
  responseCode: number,
  responseBody: unknown,
  userDataSnapshot: unknown
): Promise<void> {
  await db
    .update(schema.adsConversionOutbox)
    .set({
      status: "sent",
      sentAt: new Date(),
      lastAttemptAt: new Date(),
      responseCode,
      responseBody: responseBody as never,
      userDataSnapshot: userDataSnapshot as never,
      updatedAt: new Date(),
    })
    .where(eq(schema.adsConversionOutbox.id, outboxId));
}

export async function markFailed(
  outboxId: string,
  responseCode: number,
  responseBody: unknown,
  attempt: number,
  finalAttempt: boolean
): Promise<void> {
  await db
    .update(schema.adsConversionOutbox)
    .set({
      status: finalAttempt ? "failed" : "pending",
      lastAttemptAt: new Date(),
      attemptCount: attempt,
      responseCode,
      responseBody: responseBody as never,
      updatedAt: new Date(),
    })
    .where(eq(schema.adsConversionOutbox.id, outboxId));
}

export async function markSkipped(
  outboxId: string,
  reason: string,
  detail?: Record<string, unknown>
): Promise<void> {
  await db
    .update(schema.adsConversionOutbox)
    .set({
      status: "skipped",
      lastAttemptAt: new Date(),
      attemptCount: 1,
      responseCode: 0,
      responseBody: { reason, ...(detail ?? {}) } as never,
      updatedAt: new Date(),
    })
    .where(eq(schema.adsConversionOutbox.id, outboxId));
}

/**
 * Lookup helper used by both workers: the row's request and the
 * InvoicePaid event payload from pvs_event_log. Returns null when either
 * is missing (the request was deleted between insert and worker run; the
 * pvs_event_log row was archived; etc.). The worker should mark the
 * outbox row `skipped` with reason='request_gone' in that case.
 */
export async function loadRequestForOutbox(
  clinicId: string,
  requestId: string
): Promise<{
  id: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contactName: string | null;
  fbclid: string | null;
  gclid: string | null;
  wbraid: string | null;
  gbraid: string | null;
  fbc: string | null;
  fbp: string | null;
  clickUserAgent: string | null;
  clickIpAnon: string | null;
  source: string | null;
  utm: unknown;
  adsConsentAt: Date | null;
  adsConsentVersion: string | null;
  adsConsentRevokedAt: Date | null;
  /** Click time proxy: OCI clamps the conversion time after it (pass 2). */
  createdAt: Date;
} | null> {
  const [row] = await db
    .select({
      id: schema.requests.id,
      contactEmail: schema.requests.contactEmail,
      contactPhone: schema.requests.contactPhone,
      contactName: schema.requests.contactName,
      fbclid: schema.requests.fbclid,
      gclid: schema.requests.gclid,
      wbraid: schema.requests.wbraid,
      gbraid: schema.requests.gbraid,
      fbc: schema.requests.fbc,
      fbp: schema.requests.fbp,
      clickUserAgent: schema.requests.clickUserAgent,
      clickIpAnon: schema.requests.clickIpAnon,
      // Report gate (src/lib/ads-report-gate.ts): channel + consent, read at
      // send time so a revoke before sending stops the report.
      source: schema.requests.source,
      utm: schema.requests.utm,
      adsConsentAt: schema.requests.adsConsentAt,
      adsConsentVersion: schema.requests.adsConsentVersion,
      adsConsentRevokedAt: schema.requests.adsConsentRevokedAt,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.id, requestId),
        eq(schema.requests.clinicId, clinicId)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Re-enqueue outbox rows that have sat in `pending` for longer than
 * `olderThanMinutes` (lost enqueue, worker down). The channel workers are
 * idempotent (status check + platform-side order_id dedup) and the enqueue
 * helpers coalesce on a singletonKey, so this is safe to run repeatedly.
 */
export async function reenqueueStuckOutbox(
  olderThanMinutes = 30,
  limit = 200
): Promise<{ found: number; enqueued: number; failed: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const rows = await db
    .select({
      id: schema.adsConversionOutbox.id,
      channel: schema.adsConversionOutbox.channel,
    })
    .from(schema.adsConversionOutbox)
    .where(
      and(
        eq(schema.adsConversionOutbox.status, "pending"),
        lt(
          sql`COALESCE(${schema.adsConversionOutbox.lastAttemptAt}, ${schema.adsConversionOutbox.createdAt})`,
          cutoff
        )
      )
    )
    .orderBy(schema.adsConversionOutbox.createdAt)
    .limit(limit);
  let enqueued = 0;
  let failed = 0;
  for (const r of rows) {
    const jobId =
      r.channel === "meta"
        ? await enqueueCapiPurchase(r.id)
        : await enqueueOciPurchase(r.id);
    // null = coalesced with an already-queued job, or a failed enqueue; both
    // are re-tried on the next sweep, so only count the sure successes.
    if (jobId) enqueued++;
    else failed++;
  }
  return { found: rows.length, enqueued, failed };
}
