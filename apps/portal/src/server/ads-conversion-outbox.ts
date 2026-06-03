import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueueCapiPurchase, enqueueOciPurchase } from "@/server/jobs";

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
  /** Value (decimal) in `currency`. Stored verbatim on the outbox row. */
  valueEur: number;
  /** Currency of valueEur (EUR/CHF). Defaults EUR. Sent to CAPI/OCI. Phase 11. */
  currency?: "EUR" | "CHF";
  occurredAt: Date;
}

export interface EnqueueResult {
  /** Channels we just inserted (and enqueued). Empty on a full replay. */
  inserted: AdsChannel[];
  /** Channels skipped because a row already exists for this event. */
  alreadyExists: AdsChannel[];
}

/**
 * Insert outbox rows for both channels and enqueue workers for the rows
 * that didn't already exist. The (clinic_id, channel, pvs_event_log_id)
 * UNIQUE index is what makes this idempotent under replays.
 *
 * We always create BOTH channel rows, even if the request lacks a click id
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
  const channels: AdsChannel[] = ["meta", "google"];

  for (const channel of channels) {
    const dedupKey = `purchase-${args.requestId}-${args.pvsEventLogId}`;
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
      })
      .onConflictDoNothing({
        target: [
          schema.adsConversionOutbox.clinicId,
          schema.adsConversionOutbox.channel,
          schema.adsConversionOutbox.pvsEventLogId,
        ],
      })
      .returning({ id: schema.adsConversionOutbox.id });

    if (row) {
      inserted.push(channel);
      // Enqueue is best-effort; jobs.ts swallows enqueue errors so a
      // broken queue can't roll back the outbox insert. The
      // pvs-reconcile worker re-enqueues stuck pending rows nightly.
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
