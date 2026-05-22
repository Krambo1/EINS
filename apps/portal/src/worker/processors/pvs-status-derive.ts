import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueueInvoiceConversions } from "@/server/ads-conversion-outbox";
import { enqueueKpiRebuild } from "@/server/jobs";
import type { PvsEvent } from "@/server/pvs-events";

/**
 * PVS Bridge — request.status + revenue derivation worker.
 *
 * Triggered by every successful applyPvsEvent for a (clinicId, portalPatientId)
 * tuple. Replays the entire event-log history for that patient, groups by
 * `pvsAppointmentId`, and computes the canonical request status + revenue
 * from the events seen.
 *
 * BullMQ jobId is `${clinicId}__${portalPatientId}` so concurrent enqueues
 * coalesce. Worst case the worker runs once per patient per ~second of
 * event burst — acceptable for a Praxis with thousands of patients.
 *
 * Algorithm per appointment cluster:
 *   has(InvoicePaid) OR has(EncounterCompleted) → 'gewonnen'
 *     (gewonnen only when invoice ≥ 1ct; encounters without invoice → 'behandelt')
 *   has(no_show)                                → 'no_show'
 *   has(checked_in)                             → 'beratung_erschienen'
 *   has(AppointmentCreated)                     → 'termin_vereinbart'
 *   else                                        → unchanged
 *
 * Patient-aggregate:
 *   patients.lifetime_revenue_eur = SUM(InvoicePaid.amountCents / 100)
 *   patients.last_seen_at         = MAX(occurredAt)
 *
 * Cascades:
 *   On status flip, enqueue kpi-rebuild for the affected day(s).
 */

export interface PvsStatusDeriveJob {
  clinicId: string;
  portalPatientId: string;
}

interface AppointmentBuckets {
  /** Keyed by pvsAppointmentId. */
  byAppt: Map<string, AppointmentBucket>;
  invoiceTotalsCents: number;
  minOccurredAt: Date | null;
  maxOccurredAt: Date | null;
  /** True if at least one PatientMerged event was seen. */
  hadMerge: boolean;
}

interface InvoiceEvent {
  /** pvs_event_log row id of the InvoicePaid event — outbox dedup key. */
  eventLogId: string;
  amountCents: number;
  paidAt: Date;
}

interface AppointmentBucket {
  pvsAppointmentId: string;
  scheduledAt: Date | null;
  treatmentCode: string | null;
  treatmentLabel: string | null;
  locationCode: string | null;
  locationLabel: string | null;
  bemerkung: string | null;
  pvsEncounterId: string | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  appointmentStatus:
    | "scheduled"
    | "checked_in"
    | "completed"
    | "no_show"
    | "cancelled";
  invoiceCents: number;
  earliestInvoiceAt: Date | null;
  /**
   * One entry per InvoicePaid event tied to this appointment. Carried
   * separately from `invoiceCents` so the ads-conversion outbox can emit
   * one Meta CAPI Purchase + one Google OCI upload per payment (a deal
   * with installments produces multiple invoices).
   */
  invoiceEvents: InvoiceEvent[];
}

export async function processPvsStatusDerive(
  job: PvsStatusDeriveJob
): Promise<void> {
  const { clinicId, portalPatientId } = job;

  // 1) Find the set of PVS patient ids that map to this portal patient.
  //    (Patient merges can result in multiple pvs ids → one portal patient.)
  const mapRows = await db
    .select({ pvsPatientId: schema.pvsPatientMap.pvsPatientId })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, clinicId),
        eq(schema.pvsPatientMap.portalPatientId, portalPatientId)
      )
    );
  if (mapRows.length === 0) {
    // Nothing to derive — patient has no PVS events linked.
    return;
  }
  const pvsPatientIds = mapRows.map((r) => r.pvsPatientId);

  // 2) Pull the full event-log history for these PVS ids, ordered by
  //    occurredAt ASC so the fold below sees events in temporal order.
  //
  //    The payload->>'pvsPatientId' index (created in 0022) makes this
  //    fast even for big partitions.
  //
  //    The `::text[]` cast on the param is non-negotiable: postgres.js binds
  //    JS arrays as `unknown`, and `ANY($1)` without a typed RHS raises
  //    42P18 ("could not determine data type of parameter"). The catch path
  //    in applyPvsEvent surfaces that as a 500 so the producer retries —
  //    but the retry loops forever until the cast is in place.
  const events = await db
    .select({
      id: schema.pvsEventLog.id,
      kind: schema.pvsEventLog.kind,
      occurredAt: schema.pvsEventLog.occurredAt,
      payload: schema.pvsEventLog.payload,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, clinicId),
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ANY(${pvsPatientIds}::text[])`
      )
    )
    .orderBy(asc(schema.pvsEventLog.occurredAt));

  if (events.length === 0) return;

  // 3) Fold events into per-appointment buckets + patient-level aggregates.
  const buckets = foldEvents(events);

  // 4) Apply changes per appointment.
  await applyAppointmentBuckets(clinicId, portalPatientId, buckets);

  // 5) Update patient aggregate.
  await db
    .update(schema.patients)
    .set({
      lifetimeRevenueEur: (buckets.invoiceTotalsCents / 100).toFixed(2),
      lastSeenAt: buckets.maxOccurredAt ?? new Date(),
    })
    .where(eq(schema.patients.id, portalPatientId));

  // 6) Cascade KPI rebuild for the date range covered by these events.
  if (buckets.minOccurredAt && buckets.maxOccurredAt) {
    const from = buckets.minOccurredAt.toISOString().slice(0, 10);
    const to = buckets.maxOccurredAt.toISOString().slice(0, 10);
    await enqueueKpiRebuild(clinicId, from, to);
  }
}

// ---------------------------------------------------------------
// Fold events → buckets
// ---------------------------------------------------------------

function foldEvents(
  events: Array<{
    id: string;
    kind: string;
    occurredAt: Date;
    payload: unknown;
  }>
): AppointmentBuckets {
  const byAppt = new Map<string, AppointmentBucket>();
  let invoiceTotalsCents = 0;
  let minAt: Date | null = null;
  let maxAt: Date | null = null;
  let hadMerge = false;

  const ensure = (id: string): AppointmentBucket => {
    let b = byAppt.get(id);
    if (!b) {
      b = {
        pvsAppointmentId: id,
        scheduledAt: null,
        treatmentCode: null,
        treatmentLabel: null,
        locationCode: null,
        locationLabel: null,
        bemerkung: null,
        pvsEncounterId: null,
        completedAt: null,
        noShowAt: null,
        appointmentStatus: "scheduled",
        invoiceCents: 0,
        earliestInvoiceAt: null,
        invoiceEvents: [],
      };
      byAppt.set(id, b);
    }
    return b;
  };

  for (const e of events) {
    if (!minAt || e.occurredAt < minAt) minAt = e.occurredAt;
    if (!maxAt || e.occurredAt > maxAt) maxAt = e.occurredAt;

    const payload = e.payload as PvsEvent;
    switch (payload.kind) {
      case "AppointmentCreated": {
        const b = ensure(payload.pvsAppointmentId);
        b.scheduledAt = new Date(payload.scheduledAt);
        b.treatmentCode = payload.treatmentCode ?? b.treatmentCode;
        b.treatmentLabel = payload.treatmentLabel ?? b.treatmentLabel;
        b.locationCode = payload.locationCode ?? b.locationCode;
        b.locationLabel = payload.locationLabel ?? b.locationLabel;
        b.bemerkung = payload.bemerkung ?? b.bemerkung;
        break;
      }
      case "AppointmentStatusChanged": {
        const b = ensure(payload.pvsAppointmentId);
        // Status changes are time-ordered (we iterate ASC), so the latest
        // wins implicitly.
        b.appointmentStatus = payload.newStatus;
        if (payload.newStatus === "no_show" && !b.noShowAt) {
          b.noShowAt = e.occurredAt;
        }
        break;
      }
      case "AppointmentCancelled": {
        const b = ensure(payload.pvsAppointmentId);
        b.appointmentStatus = "cancelled";
        break;
      }
      case "EncounterCompleted": {
        if (payload.pvsAppointmentId) {
          const b = ensure(payload.pvsAppointmentId);
          b.pvsEncounterId = payload.pvsEncounterId;
          b.completedAt = new Date(payload.completedAt);
          b.appointmentStatus = "completed";
          b.treatmentCode = payload.treatmentCode ?? b.treatmentCode;
          b.treatmentLabel = payload.treatmentLabel ?? b.treatmentLabel;
        }
        break;
      }
      case "InvoicePaid": {
        invoiceTotalsCents += payload.amountCents;
        if (payload.pvsAppointmentId) {
          const b = ensure(payload.pvsAppointmentId);
          b.invoiceCents += payload.amountCents;
          const paid = new Date(payload.paidAt);
          if (!b.earliestInvoiceAt || paid < b.earliestInvoiceAt) {
            b.earliestInvoiceAt = paid;
          }
          b.invoiceEvents.push({
            eventLogId: e.id,
            amountCents: payload.amountCents,
            paidAt: paid,
          });
        }
        break;
      }
      case "PatientMerged": {
        hadMerge = true;
        break;
      }
      // PatientUpserted + RecallScheduled don't drive appointment buckets.
      default:
        break;
    }
  }

  return { byAppt, invoiceTotalsCents, minOccurredAt: minAt, maxOccurredAt: maxAt, hadMerge };
}

// ---------------------------------------------------------------
// Bucket → requests row update
// ---------------------------------------------------------------

async function applyAppointmentBuckets(
  clinicId: string,
  portalPatientId: string,
  buckets: AppointmentBuckets
): Promise<void> {
  // For each appointment bucket, find the existing request row (if any) and
  // update it. If no existing request links to this appointment, we look
  // for the most-recent unlinked request for this patient and attach.
  for (const bucket of buckets.byAppt.values()) {
    const derivedStatus = deriveStatusForBucket(bucket);
    if (!derivedStatus) continue;

    // Find existing request linked to this appointment.
    const [linked] = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          eq(schema.requests.pvsAppointmentId, bucket.pvsAppointmentId)
        )
      )
      .limit(1);

    if (linked) {
      await applyToRequest(linked.id, bucket, derivedStatus);
      await fanoutInvoiceConversions(clinicId, linked.id, bucket);
      continue;
    }

    // Attempt attach: latest open request for this patient that doesn't
    // yet have a pvs_appointment_id.
    const [attachable] = await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          eq(schema.requests.patientId, portalPatientId),
          sql`${schema.requests.pvsAppointmentId} IS NULL`
        )
      )
      .orderBy(desc(schema.requests.createdAt))
      .limit(1);
    if (attachable) {
      await applyToRequest(attachable.id, bucket, derivedStatus);
      await fanoutInvoiceConversions(clinicId, attachable.id, bucket);
      continue;
    }
    // No existing request → don't synthesize one. The patient row holds the
    // PVS data; if this person never came through the lead funnel, they
    // simply aren't an attributable lead. KPIs reflect that correctly.
  }
}

function deriveStatusForBucket(
  b: AppointmentBucket
):
  | "gewonnen"
  | "behandelt"
  | "no_show"
  | "beratung_erschienen"
  | "termin_vereinbart"
  | null {
  if (b.invoiceCents > 0) return "gewonnen";
  if (b.completedAt) return "behandelt";
  if (b.appointmentStatus === "no_show" || b.noShowAt) return "no_show";
  if (b.appointmentStatus === "checked_in") return "beratung_erschienen";
  if (b.appointmentStatus === "cancelled") {
    // Cancelled appointments don't drive a request status change beyond
    // termin_vereinbart (which still happened); some clinics want a
    // 'verloren' marker but that's a manual decision.
    return "termin_vereinbart";
  }
  return "termin_vereinbart";
}

async function applyToRequest(
  requestId: string,
  bucket: AppointmentBucket,
  derivedStatus: NonNullable<ReturnType<typeof deriveStatusForBucket>>
): Promise<void> {
  await db
    .update(schema.requests)
    .set({
      status: derivedStatus,
      statusSource: "pvs",
      pvsAppointmentId: bucket.pvsAppointmentId,
      pvsEncounterId: bucket.pvsEncounterId ?? undefined,
      appointmentAt: bucket.scheduledAt ?? undefined,
      noShowAt: bucket.noShowAt ?? undefined,
      completedAt: bucket.completedAt ?? undefined,
      convertedRevenueEur:
        bucket.invoiceCents > 0
          ? (bucket.invoiceCents / 100).toFixed(2)
          : undefined,
      wonAt:
        bucket.invoiceCents > 0 && bucket.earliestInvoiceAt
          ? bucket.earliestInvoiceAt
          : undefined,
    })
    .where(eq(schema.requests.id, requestId));

  // Log the auto-update as a request_activity so the timeline shows it.
  await db.insert(schema.requestActivities).values({
    requestId,
    actorId: null,
    kind: "status_change",
    body: `PVS: ${derivedStatus}`,
    meta: {
      source: "pvs",
      pvsAppointmentId: bucket.pvsAppointmentId,
      invoiceCents: bucket.invoiceCents,
      derivedStatus,
    },
  });
}

/**
 * For each InvoicePaid event tied to this appointment, insert an outbox
 * row per channel and enqueue the corresponding worker.
 *
 * Idempotency: the outbox UNIQUE(clinic_id, channel, pvs_event_log_id)
 * makes this safe under derive-replay — rows already inserted on a prior
 * run are no-ops on the insert side and don't re-enqueue.
 *
 * Best-effort: failure to insert/enqueue MUST NOT roll back the request
 * update above. Practical reason: pvs-status-derive is the source of truth
 * for "gewonnen" status in the UI; if Redis is down, we still want the
 * praxis to see the correct status. The nightly pvs-reconcile job will
 * re-emit any missing outbox rows.
 */
async function fanoutInvoiceConversions(
  clinicId: string,
  requestId: string,
  bucket: AppointmentBucket
): Promise<void> {
  for (const invoice of bucket.invoiceEvents) {
    try {
      await enqueueInvoiceConversions({
        clinicId,
        requestId,
        pvsEventLogId: invoice.eventLogId,
        valueEur: invoice.amountCents / 100,
        occurredAt: invoice.paidAt,
      });
    } catch (err) {
      console.error(
        `[pvs-status-derive] ads-outbox fanout failed (request=${requestId}, event_log=${invoice.eventLogId}):`,
        err
      );
      // Swallow — request update already committed; reconcile job will retry.
    }
  }
}
