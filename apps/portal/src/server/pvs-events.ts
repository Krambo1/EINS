import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive, enqueuePvsLinkBackfill } from "@/server/jobs";
import {
  resolvePatientLink,
  recordLinkingFailure,
  upsertPatientFromPvs,
} from "@/server/pvs-linking";

/**
 * PVS Bridge — inbound canonical event handler.
 *
 * Adapters (apps/bridge/* for native PVSs, the CSV worker for uploads, the
 * GDT-Agent for on-prem, and n8n workflows for long-tail) emit canonical
 * envelopes and POST them to /api/pvs/events (or for the in-process CSV
 * path, call applyPvsEvent directly). This module is the business-logic
 * side — kept out of the route so tests can drive it without faking HTTP.
 *
 * Idempotency: the `(clinicId, bridgeSource, pvsExternalEventId, occurredAt)`
 * UNIQUE index on pvs_event_log dedupes replays at the database. The
 * insert uses ON CONFLICT DO NOTHING so a replayed event returns
 * `{status: 'deduped'}` instead of erroring.
 *
 * "PVS gewinnt immer": the derived status updates (in pvs-status-derive
 * worker) unconditionally overwrite manual edits on rows that have a
 * pvs_appointment_id. The UI shows a `Quelle: PVS` readonly badge.
 */

// ---------------------------------------------------------------
// Canonical event schemas (Zod discriminated union)
// ---------------------------------------------------------------

/** Tightened ISO-8601 datetime — z.string().datetime() accepts both
 *  `Z` and `±HH:mm` offsets, which is what we want from adapters. */
const isoDatetime = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const BridgeSource = z.enum([
  "tomedo",
  "healthhub",
  "red",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
]);
export type BridgeSource = z.infer<typeof BridgeSource>;

const baseFields = {
  clinicId: z.string().uuid(),
  bridgeSource: BridgeSource,
  /** Stable, adapter-supplied id for dedup. For HealthHub/RED this is the
   *  FHIR Bundle entry id; for Tomedo a derived `{resource}:{modified_at}`;
   *  for the GDT-Agent the SHA-256 of the file content; for CSV
   *  `{uploadId}:{rowNumber}`. */
  pvsExternalEventId: z.string().min(1).max(200),
  /** When the event happened *in the PVS*. NOT receivedAt — that's set by
   *  the portal at insert time. occurredAt drives time-ordered replay. */
  occurredAt: isoDatetime,
} as const;

// 1) PatientUpserted — patient created or demographic fields changed.
const PatientUpsertedSchema = z.object({
  kind: z.literal("PatientUpserted"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  email: z.string().email().max(200).optional(),
  phone: z.string().max(64).optional(),
  fullName: z.string().max(200).optional(),
  dob: isoDate.optional(),
  gender: z.enum(["f", "m", "d", "x"]).optional(),
  /** Free-text PVS bemerkung field. Stage-2 linker parses this for
   *  EINS-Lead-{8hex} tokens. */
  bemerkung: z.string().max(4000).optional(),
  /** Legacy patient external_id — only used by /api/patients/events
   *  back-compatible bridges (CSV mostly). */
  externalId: z.string().max(200).optional(),
});
export type PatientUpsertedEvent = z.infer<typeof PatientUpsertedSchema>;

// 2) AppointmentCreated
const AppointmentCreatedSchema = z.object({
  kind: z.literal("AppointmentCreated"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  scheduledAt: isoDatetime,
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
  locationCode: z.string().max(200).optional(),
  locationLabel: z.string().max(200).optional(),
  bemerkung: z.string().max(4000).optional(),
});
export type AppointmentCreatedEvent = z.infer<typeof AppointmentCreatedSchema>;

// 3) AppointmentStatusChanged
const AppointmentStatusChangedSchema = z.object({
  kind: z.literal("AppointmentStatusChanged"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  newStatus: z.enum([
    "scheduled",
    "checked_in",
    "completed",
    "no_show",
    "cancelled",
  ]),
  changedAt: isoDatetime.optional(),
});
export type AppointmentStatusChangedEvent = z.infer<
  typeof AppointmentStatusChangedSchema
>;

// 4) AppointmentCancelled — adapters that distinguish "cancel by Praxis"
//    vs "cancel by patient" emit this; otherwise emit StatusChanged(cancelled).
const AppointmentCancelledSchema = z.object({
  kind: z.literal("AppointmentCancelled"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200),
  cancellationReason: z.string().max(200).optional(),
  cancelledBy: z.enum(["patient", "clinic"]).optional(),
});
export type AppointmentCancelledEvent = z.infer<
  typeof AppointmentCancelledSchema
>;

// 5) EncounterCompleted — treatment was actually performed.
const EncounterCompletedSchema = z.object({
  kind: z.literal("EncounterCompleted"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsEncounterId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
  completedAt: isoDatetime,
  practitionerLabel: z.string().max(200).optional(),
});
export type EncounterCompletedEvent = z.infer<typeof EncounterCompletedSchema>;

// 6) InvoicePaid — money in. amountCents is integer cents (EUR-only in v1).
const InvoicePaidSchema = z.object({
  kind: z.literal("InvoicePaid"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsInvoiceId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  pvsEncounterId: z.string().min(1).max(200).optional(),
  amountCents: z.number().int().nonnegative(),
  currency: z.literal("EUR").default("EUR"),
  paidAt: isoDatetime,
});
export type InvoicePaidEvent = z.infer<typeof InvoicePaidSchema>;

// 7) RecallScheduled — follow-up booked in the PVS.
const RecallScheduledSchema = z.object({
  kind: z.literal("RecallScheduled"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsRecallId: z.string().min(1).max(200),
  recallAt: isoDatetime,
  treatmentCode: z.string().max(200).optional(),
  treatmentLabel: z.string().max(200).optional(),
});
export type RecallScheduledEvent = z.infer<typeof RecallScheduledSchema>;

// 8) PatientMerged — PVS-side merge collapses fromPvsPatientId → toPvsPatientId.
const PatientMergedSchema = z.object({
  kind: z.literal("PatientMerged"),
  ...baseFields,
  fromPvsPatientId: z.string().min(1).max(200),
  toPvsPatientId: z.string().min(1).max(200),
});
export type PatientMergedEvent = z.infer<typeof PatientMergedSchema>;

export const PvsEventSchema = z.discriminatedUnion("kind", [
  PatientUpsertedSchema,
  AppointmentCreatedSchema,
  AppointmentStatusChangedSchema,
  AppointmentCancelledSchema,
  EncounterCompletedSchema,
  InvoicePaidSchema,
  RecallScheduledSchema,
  PatientMergedSchema,
]);
export type PvsEvent = z.infer<typeof PvsEventSchema>;

// ---------------------------------------------------------------
// Apply result
// ---------------------------------------------------------------

export type PvsEventResult =
  | {
      ok: true;
      status: "ingested";
      eventLogId: string;
      linked: { portalPatientId: string; method: string } | null;
    }
  | { ok: true; status: "deduped" }
  | {
      ok: false;
      reason:
        | "clinic_not_found"
        | "link_not_ready"
        | "vendor_mismatch"
        | "internal_error";
    };

// ---------------------------------------------------------------
// applyPvsEvent
// ---------------------------------------------------------------

/**
 * Apply a single canonical event. Steps:
 *   1. Resolve pvs_link; ensure status accepts events.
 *   2. Insert event_log row (idempotent via UNIQUE index + ON CONFLICT).
 *   3. Branch by kind:
 *      - PatientUpserted: run full 3-stage linker + upsert patient + map row.
 *      - PatientMerged: collapse pvs_patient_map (from → to) + dual-enqueue.
 *      - Other: Stage-1 lookup only; on miss enqueue backfill + linking_failure.
 *   4. Enqueue pvsStatusDerive(clinicId, portalPatientId) for the resolved
 *      patient so request status + revenue are recomputed.
 *   5. Update pvs_link.last_event_at + pvs_sync_status counters.
 */
export async function applyPvsEvent(
  input: PvsEvent
): Promise<PvsEventResult> {
  // 1) Resolve link.
  const [link] = await db
    .select({
      id: schema.pvsLink.id,
      clinicId: schema.pvsLink.clinicId,
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, input.clinicId))
    .limit(1);
  if (!link) return { ok: false, reason: "link_not_ready" };
  if (
    link.status !== "connected" &&
    link.status !== "akkreditierung" &&
    link.status !== "pending"
  ) {
    return { ok: false, reason: "link_not_ready" };
  }
  // Reject events whose bridge_source contradicts the configured vendor —
  // an obvious misconfiguration that we'd rather fail closed on than ingest
  // and confuse the resolver. CSV / n8n are universal so we accept those
  // for any vendor.
  if (
    input.bridgeSource !== "csv_upload" &&
    input.bridgeSource !== "n8n_custom" &&
    input.bridgeSource !== link.vendor
  ) {
    return { ok: false, reason: "vendor_mismatch" };
  }

  // 2) Insert event_log (idempotent).
  let eventLogId: string;
  try {
    const [row] = await db
      .insert(schema.pvsEventLog)
      .values({
        clinicId: input.clinicId,
        bridgeSource: input.bridgeSource,
        pvsExternalEventId: input.pvsExternalEventId,
        kind: input.kind,
        occurredAt: new Date(input.occurredAt),
        payload: input as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({
        // The unique index is (clinic_id, bridge_source, pvs_external_event_id,
        // occurred_at). Drizzle's onConflictDoNothing without target falls
        // back to ON CONFLICT DO NOTHING (no target) which matches any
        // conflict, including this one.
      })
      .returning({ id: schema.pvsEventLog.id });
    if (!row) {
      return { ok: true, status: "deduped" };
    }
    eventLogId = row.id;
  } catch (err) {
    console.error("[pvs-events] event_log insert failed:", err);
    return { ok: false, reason: "internal_error" };
  }

  // 3) Branch by kind for linking.
  let linkResult:
    | { portalPatientId: string; method: string }
    | null = null;
  let backfillPatientId: string | null = null;

  try {
    if (input.kind === "PatientUpserted") {
      // Full pipeline: upsert patient + map (Stage 1→2→3) or queue failure.
      const res = await upsertPatientFromPvs(input);
      if (res.portalPatientId) {
        linkResult = {
          portalPatientId: res.portalPatientId,
          method: res.method,
        };
      } else {
        await recordLinkingFailure({
          clinicId: input.clinicId,
          pvsEventLogId: eventLogId,
          pvsEventOccurredAt: new Date(input.occurredAt),
          pvsPatientId: input.pvsPatientId,
          snapshot: snapshotOf(input),
          candidates: res.candidates,
        });
        backfillPatientId = input.pvsPatientId;
      }
    } else if (input.kind === "PatientMerged") {
      // Collapse the from-id into the to-id. After merge, the resolver will
      // route subsequent events for either id to the to-id's portal patient.
      await mergeMaps(input);
      // Enqueue derive for both ids' portal patient(s) — they may be the
      // same row after the merge, but enqueuePvsStatusDerive jobId-dedupes
      // by (clinic, patient) so it's safe to call twice.
      const both = await resolveBothSides(input);
      for (const portalPatientId of both) {
        await enqueuePvsStatusDerive(input.clinicId, portalPatientId);
      }
      // Return early — no single linkResult.
      await touchLink(link.id);
      return {
        ok: true,
        status: "ingested",
        eventLogId,
        linked: null,
      };
    } else {
      // For all other event kinds: Stage-1 only.
      const pvsPatientId = (input as { pvsPatientId: string }).pvsPatientId;
      const res = await resolvePatientLink(input.clinicId, pvsPatientId);
      if (res) {
        linkResult = res;
      } else {
        await recordLinkingFailure({
          clinicId: input.clinicId,
          pvsEventLogId: eventLogId,
          pvsEventOccurredAt: new Date(input.occurredAt),
          pvsPatientId,
          snapshot: snapshotOf(input),
          candidates: [],
        });
        backfillPatientId = pvsPatientId;
      }
    }
  } catch (err) {
    console.error("[pvs-events] linking failed:", err);
    // We've still inserted the event log; the nightly reconciliation job
    // will retry. Don't roll back.
  }

  // 4) Enqueue derive for the resolved patient.
  if (linkResult) {
    await enqueuePvsStatusDerive(input.clinicId, linkResult.portalPatientId);
  }
  if (backfillPatientId) {
    await enqueuePvsLinkBackfill(input.clinicId, backfillPatientId);
  }

  // 5) Update sync metadata.
  await touchLink(link.id);

  return {
    ok: true,
    status: "ingested",
    eventLogId,
    linked: linkResult,
  };
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

function snapshotOf(input: PvsEvent): Record<string, unknown> {
  // Only carry fields that would help an MFA visually recognise the patient
  // in the linking-failures inbox. Everything else is fluff.
  const candidate = input as unknown as {
    pvsPatientId?: string;
    email?: string;
    phone?: string;
    fullName?: string;
    dob?: string;
    gender?: string;
    bemerkung?: string;
  };
  return {
    pvsPatientId: candidate.pvsPatientId,
    email: candidate.email,
    phone: candidate.phone,
    fullName: candidate.fullName,
    dob: candidate.dob,
    gender: candidate.gender,
    bemerkung: candidate.bemerkung,
    kind: input.kind,
  };
}

async function touchLink(linkId: string): Promise<void> {
  // pvs_link.last_event_at is read by the health dashboard and the
  // "is the bridge alive?" indicator on the integrations page.
  await db
    .update(schema.pvsLink)
    .set({ lastEventAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.pvsLink.id, linkId));

  // Bump the sync-status counters. Insert a row if one doesn't yet exist
  // (initial sync hasn't started for this link).
  await db
    .insert(schema.pvsSyncStatus)
    .values({
      pvsLinkId: linkId,
      lastIncrementalAt: new Date(),
      totalEventsIngested: 1,
      totalEventsLast24h: 1,
    })
    .onConflictDoUpdate({
      target: schema.pvsSyncStatus.pvsLinkId,
      set: {
        lastIncrementalAt: new Date(),
        totalEventsIngested: sql`${schema.pvsSyncStatus.totalEventsIngested} + 1`,
        totalEventsLast24h: sql`${schema.pvsSyncStatus.totalEventsLast24h} + 1`,
      },
    });
}

async function mergeMaps(input: PatientMergedEvent): Promise<void> {
  // If both pvs ids map to different portal patients, prefer the *toPvsPatientId*'s
  // portal patient as the survivor — the PVS authoritative side decided
  // they're the same person. Re-point the from-id map to the survivor.
  const [fromRow] = await db
    .select({
      portalPatientId: schema.pvsPatientMap.portalPatientId,
    })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, input.clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, input.fromPvsPatientId)
      )
    )
    .limit(1);
  const [toRow] = await db
    .select({
      portalPatientId: schema.pvsPatientMap.portalPatientId,
    })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, input.clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, input.toPvsPatientId)
      )
    )
    .limit(1);
  if (!fromRow && !toRow) return; // neither side known yet — nothing to do

  // Take the survivor.
  const survivorPatientId =
    toRow?.portalPatientId ?? fromRow?.portalPatientId ?? null;
  if (!survivorPatientId) return;

  // Ensure both ids point at the survivor.
  await db
    .insert(schema.pvsPatientMap)
    .values({
      clinicId: input.clinicId,
      pvsPatientId: input.toPvsPatientId,
      portalPatientId: survivorPatientId,
      linkMethod: "external_id",
      confidenceScore: "1.0",
    })
    .onConflictDoUpdate({
      target: [
        schema.pvsPatientMap.clinicId,
        schema.pvsPatientMap.pvsPatientId,
      ],
      set: { portalPatientId: survivorPatientId },
    });
  await db
    .update(schema.pvsPatientMap)
    .set({ portalPatientId: survivorPatientId })
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, input.clinicId),
        eq(schema.pvsPatientMap.pvsPatientId, input.fromPvsPatientId)
      )
    );
}

async function resolveBothSides(
  input: PatientMergedEvent
): Promise<string[]> {
  const rows = await db
    .select({ portalPatientId: schema.pvsPatientMap.portalPatientId })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, input.clinicId),
        sql`${schema.pvsPatientMap.pvsPatientId} IN (${input.fromPvsPatientId}, ${input.toPvsPatientId})`
      )
    );
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.portalPatientId);
  return Array.from(ids);
}
