import "server-only";
import { notifyOps } from "@/server/ops-alerts";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";
import { enqueuePvsStatusDerive, enqueuePvsLinkBackfill } from "@/server/jobs";
import {
  moveRequestsOfUnmappedPatient,
  resolvePatientLink,
  recordLinkingFailure,
  upsertPatientFromPvs,
} from "@/server/pvs-linking";
import {
  computePvsEventIntegrityTag,
  verifyPvsEventIntegrityTag,
} from "@/server/pvs-event-integrity";
import { QUEUES } from "@/lib/queues";
import { ensurePartitionForMonth } from "@/worker/processors/pvs-partition-rotate";

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
/** Pass 2: YYYY-MM-DD that is also a real calendar day. The bare regex let
 *  "1980-02-30" through, which then failed the Postgres date cast on the
 *  patient merge and answered internal_error for that event forever. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
/** Pass 2: free-text labels are clipped to the cap instead of rejecting the
 *  whole event. A 201-char Leistungstext from a PVS used to cost the entire
 *  AppointmentCreated / EncounterCompleted (non-retryable invalid_envelope).
 *  Storage stays bounded either way. Never cuts a surrogate pair in half
 *  (a lone surrogate fails the jsonb insert). */
const clip = (max: number) => (s: string): string => {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
};
/** Pass 2: an over-long Notiz keeps its EINS-Lead token (the only part the
 *  Stage-2 linker reads) instead of rejecting the PatientUpserted. */
const keepLeadToken = (s: string): string =>
  s.length <= 4000 ? s : (/EINS-Lead-[0-9a-f]{8}/i.exec(s)?.[0] ?? clip(4000)(s));

// The portal's canonical bridge-source enum. Conformance-pinned to
// BRIDGE_SOURCES (apps/bridge/src/canonical/schema-source.ts) by
// pvs-events.canonical.test.ts. Exported as the portal-side source of truth;
// other server modules that need the value set keep their own local copy when
// importing this module would pull heavy deps (e.g. the heartbeat route avoids
// the pg-boss job chain). The last 7 are the Phase 7 per-Praxis DB-read
// engines (underscores; CGM-M1 Postgres + Oracle both collapse to cgm_m1pro).
export const BridgeSource = z.enum([
  "tomedo",
  "healthhub",
  "red",
  "pabau",
  "consentz",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
  "medatixx",
  "cgm_albis",
  "cgm_turbomed",
  "cgm_m1pro",
  "indamed",
  "quincy",
  "pixelmedics",
]);
export type BridgeSource = z.infer<typeof BridgeSource>;

/** M-D6: the event kinds that move money. Only these are subject to the
 *  billing-authority gate — everything else may legitimately flow from more
 *  than one path (e.g. GDT covering Termine, a DB adapter covering Stammdaten). */
export const REVENUE_BEARING_KINDS: ReadonlySet<string> = new Set([
  "InvoicePaid",
  "InvoiceRefunded",
]);

/** M-D6: sources that continuously mirror a PVS (agent watcher, vendor DB
 *  engines, cloud adapters), as opposed to the operator-driven universal
 *  paths (csv_upload backfills, bespoke n8n flows). Only continuous sources
 *  can accidentally double-ingest the same billing data. */
export function isContinuousPvsSource(source: string): boolean {
  return source !== "csv_upload" && source !== "n8n_custom";
}

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
  email: z.string().email().max(200).optional().catch(undefined),
  phone: z.string().max(64).optional().catch(undefined),
  fullName: z.string().transform(clip(200)).optional(),
  dob: isoDate.optional().catch(undefined),
  gender: z.enum(["f", "m", "d", "x"]).optional(),
  /** Free-text PVS bemerkung field. Stage-2 linker parses this for
   *  EINS-Lead-{8hex} tokens. */
  bemerkung: z.string().transform(keepLeadToken).optional(),
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
  treatmentCode: z.string().transform(clip(200)).optional(),
  treatmentLabel: z.string().transform(clip(200)).optional(),
  locationCode: z.string().transform(clip(200)).optional(),
  locationLabel: z.string().transform(clip(200)).optional(),
  bemerkung: z.string().transform(keepLeadToken).optional(),
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
  cancellationReason: z.string().transform(clip(200)).optional(),
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
  treatmentCode: z.string().transform(clip(200)).optional(),
  treatmentLabel: z.string().transform(clip(200)).optional(),
  completedAt: isoDatetime,
  practitionerLabel: z.string().transform(clip(200)).optional(),
});
export type EncounterCompletedEvent = z.infer<typeof EncounterCompletedSchema>;

// 6) InvoicePaid — money in. amountCents is integer cents.
//
// Currency accepts EUR and CHF (the DACH set: DE/AT bill in EUR, CH in CHF).
// Review finding 12: a hard z.literal("EUR") rejected a Swiss Praxis's
// invoices with a 400, which the agent then drops permanently (a 400 is
// non-retryable), so every CHF payment vanished silently. Widening the enum
// stops that data loss; the real currency is preserved on the event payload.
//
// NOT YET multi-currency downstream: lifetimeRevenueEur (column name + €
// display) and the ads-conversion upload (capi-purchase.ts hardcodes
// currency:"EUR") still assume EUR. So a CHF Praxis's revenue is captured
// with correct cents but labelled/attributed as EUR. Before onboarding any
// CHF Praxis, thread `currency` through derive -> ads_conversion_outbox ->
// CAPI/OCI and fix the € display. Tracked as a follow-up, not silent.
const InvoicePaidSchema = z.object({
  kind: z.literal("InvoicePaid"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsInvoiceId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  pvsEncounterId: z.string().min(1).max(200).optional(),
  // Plausibility ceiling: €1,000,000.00 per single invoice. No single
  // aesthetic-medicine encounter bills this much, so a value above it is an
  // adapter bug or an injection (Chain B used €10M to triple a clinic's
  // revenue). Rejecting it here keeps a fabricated amount out of
  // lifetimeRevenueEur / kpi_daily / the ads-conversion outbox (pentest H4 /
  // BR-03 / apvs-04). The DB column is numeric(10,2) (~€100M) — this is the
  // tighter business ceiling.
  amountCents: z.number().int().nonnegative().max(100_000_000),
  currency: z.enum(["EUR", "CHF"]).default("EUR"),
  paidAt: isoDatetime,
  /** Pass 2: optional producer revision of this invoice / refund (CSV
   *  invoice-book revision, DB modified_at in epoch ms). When two versions
   *  both carry one, derive takes the higher revision instead of relying on
   *  occurredAt / arrival order: the agent retries a failed row behind newer
   *  rows, and a corrected payment date can be earlier than the original. */
  sourceRevision: z.number().int().nonnegative().optional(),
});
export type InvoicePaidEvent = z.infer<typeof InvoicePaidSchema>;

// 6b) InvoiceRefunded: a refund / storno / credit note against a prior
// InvoicePaid, keyed by pvsInvoiceId. refundedAmountCents is a POSITIVE
// magnitude (the amount given back); the derive worker subtracts it from the
// patient total and the matching appointment bucket. A dedicated kind (rather
// than a negative InvoicePaid) keeps the amount validators nonnegative and lets
// the ads-conversion side later send a proper Meta refund / Google adjustment
// instead of a nonsensical negative Purchase. That ad-platform propagation is a
// follow-up; v1 nets the dashboard revenue and lets the P2-3 downgrade alarm
// catch a gewonnen -> lower flip.
const InvoiceRefundedSchema = z.object({
  kind: z.literal("InvoiceRefunded"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsInvoiceId: z.string().min(1).max(200),
  pvsAppointmentId: z.string().min(1).max(200).optional(),
  /** Pass 2: the refund / credit-note document's own id. Distinct ids against
   *  one pvsInvoiceId are separate refunds and are SUMMED by derive; repeated
   *  events with the same id (or none) are versions of one refund, latest
   *  wins. Optional: legacy producers keep the latest-wins behaviour. */
  pvsRefundId: z.string().min(1).max(200).optional(),
  // Same €1,000,000.00 plausibility ceiling as InvoicePaid.amountCents — a
  // refund cannot exceed an invoice we would have accepted (pentest H4).
  refundedAmountCents: z.number().int().nonnegative().max(100_000_000),
  currency: z.enum(["EUR", "CHF"]).default("EUR"),
  refundedAt: isoDatetime,
  sourceRevision: z.number().int().nonnegative().optional(),
  reason: z.string().transform(clip(200)).optional(),
});
export type InvoiceRefundedEvent = z.infer<typeof InvoiceRefundedSchema>;

// 7) RecallScheduled — follow-up booked in the PVS.
const RecallScheduledSchema = z.object({
  kind: z.literal("RecallScheduled"),
  ...baseFields,
  pvsPatientId: z.string().min(1).max(200),
  pvsRecallId: z.string().min(1).max(200),
  recallAt: isoDatetime,
  treatmentCode: z.string().transform(clip(200)).optional(),
  treatmentLabel: z.string().transform(clip(200)).optional(),
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
  InvoiceRefundedSchema,
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
      /**
       * P1-2: link.status was 'pending' at ingest. The event is persisted in
       * pvs_event_log (applied_at remains NULL) but the linker + derive are
       * NOT run. confirmPvsLinkActive() will replay the event when the
       * operator confirms the link.
       */
      ok: true;
      status: "quarantined";
      eventLogId: string;
    }
  | {
      ok: false;
      reason:
        | "clinic_not_found"
        | "link_not_ready"
        | "vendor_mismatch"
        /**
         * M-D6: a revenue-bearing event arrived from a source that is not the
         * clinic's authoritative billing path (billing_enabled = false, or a
         * gdt_agent event colliding with an active vendor DB/cloud path).
         * Mapped to 422 (non-retryable, non-auth) by the route; a standing
         * dashboard alert is raised so the drop is never silent.
         */
        | "billing_conflict"
        /**
         * occurredAt outside [2000-01-01, now + 2 years]. A year-0001 / 9999
         * date maps to a partition that cannot be created, which would be a
         * permanent 500. Mapped to 400 (non-retryable) by the route.
         */
        | "invalid_envelope"
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
  rawInput: PvsEvent
): Promise<PvsEventResult> {
  // Pass 2: Postgres text/jsonb cannot hold U+0000 or a lone UTF-16
  // surrogate. A UTF-16 export read as UTF-8 (or a torn multi-byte name)
  // carries them, and the insert then threw on every retry: internal_error
  // for that event forever. Scrub before anything touches the DB.
  const input = scrubStringsDeep(rawInput);
  // 0) occurredAt sanity. Anything outside [2000-01-01, now + 2y] is an
  //    adapter bug (epoch-0 / year-0001 / 9999 defaults); inserting it would
  //    need a partition that cannot exist and 500 forever.
  if (!isPlausibleOccurredAt(input.occurredAt)) {
    return { ok: false, reason: "invalid_envelope" };
  }

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
  // Provenance membership check (Phase 7 per-vendor identity).
  //
  // The HMAC signature already authenticated the clinic; bridge_source is a
  // provenance label, not an auth boundary. One GDT agent can read several PVS
  // engines, so a clinic may legitimately emit more than one source. Accept
  // when:
  //   - the source is universal (csv_upload / n8n_custom), OR
  //   - it matches the clinic's configured vendor (back-compat fast path: every
  //     existing single-vendor clinic keeps emitting with zero new rows), OR
  //   - the clinic has enrolled that source in pvs_link_source (seeded by GDT
  //     enrollment, the agent heartbeat, and the 0055 backfill).
  //
  // A miss is NOT a hard misconfiguration: it is the transient window before
  // the agent's next heartbeat reports its vendors. We return vendor_mismatch,
  // which the route maps to 409 (retryable) so the agent retries instead of
  // dropping the event on a 400.
  if (
    input.bridgeSource !== "csv_upload" &&
    input.bridgeSource !== "n8n_custom" &&
    input.bridgeSource !== link.vendor
  ) {
    const [enrolledSource] = await db
      .select({ bridgeSource: schema.pvsLinkSource.bridgeSource })
      .from(schema.pvsLinkSource)
      .where(
        and(
          eq(schema.pvsLinkSource.clinicId, input.clinicId),
          eq(schema.pvsLinkSource.bridgeSource, input.bridgeSource)
        )
      )
      .limit(1);
    if (!enrolledSource) {
      return { ok: false, reason: "vendor_mismatch" };
    }
  }

  // M-D6 billing-authority gate (dual-ingest-path mutual exclusion).
  //
  // A GDT/CSV file watcher and a vendor DB/cloud adapter running for the SAME
  // Praxis stamp different bridge_source values, so the dedup UNIQUE index can
  // never collapse the two copies of one logical payment. Cross-source
  // natural-key dedup is not viable either: the GDT export's Rechnungs-Kennung
  // and the vendor DB's invoice key do not match (H4 scopes invoice dedup per
  // source for exactly that reason). So the portal enforces ONE authoritative
  // ingest path for the billing domain per clinic instead:
  //   - Only revenue-bearing kinds are gated. Mixed setups where the file
  //     watcher covers one data kind and the DB adapter another are legitimate
  //     (see the agent's M-D6 boot warning) and keep flowing.
  //   - csv_upload / n8n_custom stay exempt (operator-driven).
  //   - Vendor DB/cloud sources win by default: their billing tables are the
  //     system of record; the GDT Honorar fields are a lossy export of them.
  //
  // Rejections map to 422 in the route — deliberately NON-retryable and
  // non-auth: a billing conflict is a standing configuration state, not a
  // transient window, so retrying hourly forever (409) would only grow the
  // agent outbox, and 403 would read as an auth rejection that pauses the
  // whole outbox. The agent's dead-letter roll-up keeps the drop visible, and
  // the standing dashboard alert raised here tells the operator what happened.
  //
  // ORDERING IS LOAD-BEARING: this gate must stay BEFORE the event_log insert
  // (and therefore before the P1-2 pending-quarantine branch). The derive
  // worker folds EVERY log row for a patient without filtering on applied_at,
  // so a duplicate that entered the log — even quarantined and later
  // replay-rejected — would still double-count the moment any other event
  // triggers a derive for that patient. Side effect, accepted: a replayed
  // already-ingested revenue event from a blocked source answers 422 instead
  // of 201 deduped.
  if (
    REVENUE_BEARING_KINDS.has(input.kind) &&
    isContinuousPvsSource(input.bridgeSource)
  ) {
    const allowed = await enforceBillingAuthority(
      input.clinicId,
      input.bridgeSource,
      link.vendor
    );
    if (!allowed) {
      return { ok: false, reason: "billing_conflict" };
    }
  }

  // 2) Insert event_log (idempotent). The link.status snapshot is
  //    immutable on the row — captured here at ingest time so the P1-2
  //    replay query can find quarantined rows without depending on any
  //    later mutable state.
  let eventLogId: string;
  try {
    eventLogId = await insertEventLogWithPartitionHeal(input, link.status);
  } catch (err) {
    if (isDedupeSentinel(err)) {
      // The row already exists. "Deduped" is only true when it was fully
      // applied: a first attempt that died after the insert (linking threw,
      // route 500) leaves applied_at NULL, and the agent's retry lands here.
      // Dropping it would mean revenue is never counted, so finish the job.
      return await finishDuplicate(input, link.id);
    }
    console.error("[pvs-events] event_log insert failed:", err);
    return { ok: false, reason: "internal_error" };
  }

  // P1-2 quarantine: a pending link logs events but defers the linker +
  // derive until the operator confirms via confirmPvsLinkActive(). The
  // applied_at column stays NULL so the replay query picks the row up.
  // This prevents events from a misconfigured link (wrong vendor auto-set,
  // wrong fingerprint, etc.) from silently committing revenue and ads-
  // conversion effects against unreviewed configuration.
  if (link.status === "pending") {
    return {
      ok: true,
      status: "quarantined",
      eventLogId,
    };
  }

  const outcome = await runPostInsertSteps(input, eventLogId, link.id);
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    status: "ingested",
    eventLogId,
    linked: outcome.linked,
  };
}

interface PostInsertOutcomeOk {
  ok: true;
  linked: { portalPatientId: string; method: string } | null;
  /** true when applied_at was stamped (every required enqueue confirmed). */
  applied: boolean;
}

/**
 * Steps 3-5 of applyPvsEvent, runnable any number of times for one logged row
 * (first ingest, agent retry of a half-applied row, the apply sweep):
 *   3) link (PatientUpserted / PatientMerged / Stage-1),
 *   4) enqueue derive (+ link backfill on a miss),
 *   5) touch the link + stamp applied_at.
 *
 * applied_at is stamped ONLY when every required enqueue is confirmed: a job
 * id, or a null that is provably a short-policy coalesce with a job that is
 * still queued. A swallowed enqueue failure (jobs.ts returns null for those
 * too) leaves applied_at NULL so the sweep retries instead of the revenue
 * silently never being derived. Any throw maps to internal_error (500): the
 * agent retries, hits the dedupe branch, and re-enters here.
 */
async function runPostInsertSteps(
  input: PvsEvent,
  eventLogId: string,
  linkId: string
): Promise<PostInsertOutcomeOk | { ok: false; reason: "internal_error" }> {
  let linkResult: { portalPatientId: string; method: string } | null = null;
  let backfillPatientId: string | null = null;
  const deriveTargets = new Set<string>();

  try {
    if (input.kind === "PatientUpserted") {
      // Full pipeline: upsert patient + map (Stage 1→2→3) or queue failure.
      const res = await upsertPatientFromPvs(input);
      if (res.portalPatientId) {
        linkResult = {
          portalPatientId: res.portalPatientId,
          method: res.method,
        };
        // P1-1: when the linker created a fresh patient (method === "external_id")
        // but found one or more candidates the operator might want to merge
        // into instead, write a linking_failure. The event still ingests so
        // downstream derive runs against the new patient, but the operator
        // sees a review-queue card with the candidates ranked. This also
        // covers an email-exact candidate the auto-accept gate refused
        // (shared family email, incompatible name/dob): no link is created.
        //
        // Auto-accepted (method === "email_exact") or Stage-1/Stage-2 hits
        // do NOT carry candidates; they skip this branch.
        if (res.method === "external_id" && res.candidates.length > 0) {
          await recordLinkingFailure({
            clinicId: input.clinicId,
            pvsEventLogId: eventLogId,
            pvsEventOccurredAt: new Date(input.occurredAt),
            pvsPatientId: input.pvsPatientId,
            snapshot: snapshotOf(input),
            candidates: res.candidates,
          });
        }
      } else {
        // Defensive: today this branch is unreachable since the linker
        // always creates a patient when no map row exists. Kept so a
        // future contract change (e.g. "return null instead of orphan-
        // create") still routes through the failure queue.
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
      const beforeMerge = await mergeMaps(input);
      // Derive for both ids' portal patient(s) — they may be the same row
      // after the merge; the Set dedupes and enqueuePvsStatusDerive
      // singleton-keys by (clinic, patient) anyway. Pass 2: plus the
      // patients they pointed at before, so the absorbed one is reset.
      for (const portalPatientId of beforeMerge) deriveTargets.add(portalPatientId);
      for (const portalPatientId of await resolveBothSides(input)) {
        deriveTargets.add(portalPatientId);
      }
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
    // The event_log row is already persisted (committed at step 2) so the
    // retry / sweep can finish it. The producer needs a non-2xx signal;
    // silently returning "ingested" would break the "PVS gewinnt immer"
    // guarantee. Surface as internal_error → 500 so it retries with backoff.
    return { ok: false, reason: "internal_error" };
  }

  if (linkResult) deriveTargets.add(linkResult.portalPatientId);

  // 4) Enqueue derive / backfill and note whether each is confirmed.
  let allConfirmed = true;
  for (const portalPatientId of deriveTargets) {
    const jobId = await enqueuePvsStatusDerive(input.clinicId, portalPatientId);
    if (!(await deriveEnqueueConfirmed(jobId, input.clinicId, portalPatientId))) {
      allConfirmed = false;
    }
  }
  if (backfillPatientId) {
    // No singleton key on the backfill queue: null can only be a failure.
    const jobId = await enqueuePvsLinkBackfill(input.clinicId, backfillPatientId);
    if (jobId === null) allConfirmed = false;
  }

  try {
    // 5) Update sync metadata.
    await touchLink(linkId);

    // P1-2: mark this event as fully applied so the pending-replay query and
    // the apply sweep skip it. Done LAST and only when the enqueues are
    // confirmed: anything short of that leaves applied_at NULL and the row
    // stays eligible for re-application (agent retry, sweep, replay).
    if (allConfirmed) await markEventApplied(eventLogId);
  } catch (err) {
    console.error("[pvs-events] post-apply bookkeeping failed:", err);
    return { ok: false, reason: "internal_error" };
  }

  return { ok: true, linked: linkResult, applied: allConfirmed };
}

/**
 * Is an enqueue result acceptable for stamping applied_at? A job id: yes.
 * `null`: jobs.ts safeAdd returns null both for a swallowed failure and for a
 * short-policy singleton coalesce (a derive job for this key is already
 * queued and will fold this event too). Tell them apart by looking for that
 * queued job. A lookup error counts as "not confirmed" (the sweep retries).
 * `undefined` (only test doubles) is treated as success.
 */
async function deriveEnqueueConfirmed(
  jobId: string | null | undefined,
  clinicId: string,
  portalPatientId: string
): Promise<boolean> {
  if (jobId !== null) return true;
  try {
    const rows = await db.execute(sql`
      SELECT 1 AS queued
        FROM pgboss.job
       WHERE name = ${QUEUES.pvsStatusDerive}
         AND singleton_key = ${`${clinicId}__${portalPatientId}`}
         AND state IN ('created', 'retry')
       LIMIT 1
    `);
    return Array.from(rows as unknown as unknown[]).length > 0;
  } catch (err) {
    console.error("[pvs-events] derive coalesce lookup failed:", err);
    return false;
  }
}

/**
 * Agent retry of an event whose row already exists. Fully applied (or
 * quarantined behind a pending link) → "deduped". Otherwise re-run the
 * post-insert steps so a half-applied row is completed instead of dropped.
 */
async function finishDuplicate(
  input: PvsEvent,
  linkId: string
): Promise<PvsEventResult> {
  let existing:
    | { id: string; appliedAt: Date | null; linkStatusAtIngest: string }
    | undefined;
  try {
    [existing] = await db
      .select({
        id: schema.pvsEventLog.id,
        appliedAt: schema.pvsEventLog.appliedAt,
        linkStatusAtIngest: schema.pvsEventLog.linkStatusAtIngest,
      })
      .from(schema.pvsEventLog)
      .where(
        and(
          eq(schema.pvsEventLog.clinicId, input.clinicId),
          eq(schema.pvsEventLog.bridgeSource, input.bridgeSource),
          eq(schema.pvsEventLog.pvsExternalEventId, input.pvsExternalEventId),
          eq(schema.pvsEventLog.occurredAt, new Date(input.occurredAt))
        )
      )
      .limit(1);
  } catch (err) {
    console.error("[pvs-events] dedupe lookup failed:", err);
    return { ok: false, reason: "internal_error" };
  }
  if (!existing || existing.appliedAt !== null) {
    return { ok: true, status: "deduped" };
  }
  // Quarantined behind a pending link: confirmPvsLinkActive owns it.
  if (existing.linkStatusAtIngest === "pending") {
    return { ok: true, status: "deduped" };
  }
  const outcome = await runPostInsertSteps(input, existing.id, linkId);
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    status: "ingested",
    eventLogId: existing.id,
    linked: outcome.linked,
  };
}

export type ReapplyResult =
  | { ok: true; status: "reapplied" | "already_applied" | "quarantined" }
  | {
      ok: true;
      /** Steps ran, but a required enqueue was not confirmed: applied_at stays NULL. */
      status: "unconfirmed";
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "integrity_failed"
        | "payload_invalid"
        | "link_not_ready"
        | "internal_error";
    };

/**
 * Re-run the post-insert pipeline for an already-logged row (apply sweep).
 * Verifies the stored integrity tag and re-validates the payload first, since
 * this feeds a row back into the trusted pipeline.
 */
export async function reapplyLoggedEvent(rowId: string): Promise<ReapplyResult> {
  let row:
    | {
        id: string;
        clinicId: string;
        payload: unknown;
        payloadSig: string | null;
        appliedAt: Date | null;
        linkStatusAtIngest: string;
      }
    | undefined;
  try {
    [row] = await db
      .select({
        id: schema.pvsEventLog.id,
        clinicId: schema.pvsEventLog.clinicId,
        payload: schema.pvsEventLog.payload,
        payloadSig: schema.pvsEventLog.payloadSig,
        appliedAt: schema.pvsEventLog.appliedAt,
        linkStatusAtIngest: schema.pvsEventLog.linkStatusAtIngest,
      })
      .from(schema.pvsEventLog)
      .where(eq(schema.pvsEventLog.id, rowId))
      .limit(1);
  } catch (err) {
    console.error("[pvs-events] reapply lookup failed:", err);
    return { ok: false, reason: "internal_error" };
  }
  if (!row) return { ok: false, reason: "not_found" };
  if (row.appliedAt !== null) return { ok: true, status: "already_applied" };
  if (row.linkStatusAtIngest === "pending") {
    return { ok: true, status: "quarantined" };
  }
  if (
    row.payloadSig !== null &&
    !verifyPvsEventIntegrityTag(row.payload, row.payloadSig)
  ) {
    return { ok: false, reason: "integrity_failed" };
  }
  const parsed = PvsEventSchema.safeParse(row.payload);
  if (!parsed.success || parsed.data.clinicId !== row.clinicId) {
    return { ok: false, reason: "payload_invalid" };
  }

  let link: { id: string; status: string } | undefined;
  try {
    [link] = await db
      .select({ id: schema.pvsLink.id, status: schema.pvsLink.status })
      .from(schema.pvsLink)
      .where(eq(schema.pvsLink.clinicId, row.clinicId))
      .limit(1);
  } catch (err) {
    console.error("[pvs-events] reapply link lookup failed:", err);
    return { ok: false, reason: "internal_error" };
  }
  if (
    !link ||
    (link.status !== "connected" &&
      link.status !== "akkreditierung" &&
      link.status !== "pending")
  ) {
    return { ok: false, reason: "link_not_ready" };
  }

  const outcome = await runPostInsertSteps(parsed.data, row.id, link.id);
  if (!outcome.ok) return outcome;
  return { ok: true, status: outcome.applied ? "reapplied" : "unconfirmed" };
}

/**
 * P1-2: mark a pvs_event_log row as fully processed. Called after the
 * linker + derive enqueue + touchLink all succeeded. Idempotent: re-
 * calling for an already-applied row is a no-op.
 */
async function markEventApplied(eventLogId: string): Promise<void> {
  await db
    .update(schema.pvsEventLog)
    .set({ appliedAt: new Date() })
    .where(eq(schema.pvsEventLog.id, eventLogId));
}

const MIN_OCCURRED_AT_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_MS = 2 * 366 * 24 * 60 * 60 * 1000;

/** Removes U+0000 and replaces lone surrogates with U+FFFD in every string
 *  of a JSON-like value. Returns the same shape. Exported for tests. */
export function scrubStringsDeep<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replace(/\u0000/g, "")
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD") as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrubStringsDeep(v)) as T;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubStringsDeep(v);
    return out as T;
  }
  return value;
}

function isPlausibleOccurredAt(iso: string): boolean {
  const t = new Date(iso).getTime();
  return (
    Number.isFinite(t) &&
    t >= MIN_OCCURRED_AT_MS &&
    t <= Date.now() + MAX_FUTURE_MS
  );
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

const DEDUPE_SENTINEL = Symbol("eins.pvs.dedupe");

function isDedupeSentinel(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { __sentinel?: symbol }).__sentinel === DEDUPE_SENTINEL
  );
}

/**
 * Insert the event_log row. On the "no partition of relation X found for row"
 * error (PG SQLSTATE 23514, fired when occurredAt falls outside any existing
 * partition window) we self-heal: create the missing month partition via
 * `ensurePartitionForMonth` and retry once. Retrying further would mask a
 * deeper bug, so we re-raise after one attempt.
 *
 * Throws an internal sentinel for the dedupe case so the outer try/catch can
 * route to `{status: 'deduped'}` instead of `{reason: 'internal_error'}`.
 */
async function insertEventLogWithPartitionHeal(
  input: PvsEvent,
  linkStatusAtIngest: string
): Promise<string> {
  const doInsert = async () => {
    const [row] = await db
      .insert(schema.pvsEventLog)
      .values({
        clinicId: input.clinicId,
        bridgeSource: input.bridgeSource,
        pvsExternalEventId: input.pvsExternalEventId,
        kind: input.kind,
        occurredAt: new Date(input.occurredAt),
        payload: input as unknown as Record<string, unknown>,
        // H3: server-side integrity tag over the canonical payload, computed
        // before the JSONB round-trip. Re-checked at admin replay so a row
        // edited at rest can't be re-ingested as trusted.
        payloadSig: computePvsEventIntegrityTag(input),
        // P1-2: persisted snapshot. Replay uses link_status_at_ingest
        // = 'pending' AND applied_at IS NULL.
        linkStatusAtIngest,
      })
      .onConflictDoNothing()
      .returning({ id: schema.pvsEventLog.id });
    if (!row) {
      // Signal dedupe to outer handler. Throwing is the cleanest way to
      // bail out of the try-block without polluting the return type.
      throw { __sentinel: DEDUPE_SENTINEL };
    }
    return row.id;
  };

  try {
    return await doInsert();
  } catch (err) {
    if (isDedupeSentinel(err)) throw err;
    if (isMissingPartitionError(err)) {
      console.warn(
        `[pvs-events] missing partition for occurredAt=${input.occurredAt}; self-healing`
      );
      try {
        await ensurePartitionForMonth(new Date(input.occurredAt));
      } catch (healErr) {
        // 42P07 duplicate_table: a concurrent request healed the same month
        // first. The partition exists, which is all we wanted.
        const he = healErr as { code?: string; cause?: { code?: string } } | null;
        if (he?.code !== "42P07" && he?.cause?.code !== "42P07") {
          throw healErr;
        }
      }
      // Retry exactly once. If this still fails, propagate — something
      // weirder is going on.
      return await doInsert();
    }
    throw err;
  }
}

/**
 * PG raises SQLSTATE 23514 (check_violation) with message
 * "no partition of relation \"pvs_event_log\" found for row" when inserting
 * a row whose occurred_at doesn't fall into any existing partition.
 */
function isMissingPartitionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  const msg = String(e.message ?? "");
  return (
    e.code === "23514" &&
    msg.includes("no partition of relation") &&
    msg.includes("pvs_event_log")
  );
}

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

/**
 * M-D6: decide whether `bridgeSource` may emit a revenue-bearing event for
 * this clinic. Reads all pvs_link_source rows once and applies:
 *
 *   - Vendor DB/cloud source: allowed unless an operator explicitly disabled
 *     it (billing_enabled = false, the "GDT soll führen" override). No
 *     auto-resolution on this side: every agent-enrolled clinic has a
 *     gdt_agent row (the watcher is always on), and pre-emptively disabling
 *     it for clinics whose GDT stream never carries Honorar data would be
 *     pure alert noise.
 *   - gdt_agent: allowed only while its flag is true AND no billing-enabled
 *     vendor path exists. On the first real collision the vendor wins: we
 *     persist billing_enabled = false on the gdt_agent row (upsert, so even
 *     a missing row cannot leave the gate open) and raise a standing
 *     dashboard alert. The clinic's pvs_link.pvs_vendor counts as an
 *     implicit vendor path when it has no explicit row — cloud adapters
 *     pass the vendor fast path and may never be seeded into
 *     pvs_link_source.
 *
 * The alert is re-raised (upserted on its dedupe key) on every rejection so
 * the standing condition stays visible; a dismissed alert stays dismissed.
 */
async function enforceBillingAuthority(
  clinicId: string,
  bridgeSource: string,
  linkVendor: string
): Promise<boolean> {
  const rows = await db
    .select({
      bridgeSource: schema.pvsLinkSource.bridgeSource,
      billingEnabled: schema.pvsLinkSource.billingEnabled,
    })
    .from(schema.pvsLinkSource)
    .where(eq(schema.pvsLinkSource.clinicId, clinicId));

  const own = rows.find((r) => r.bridgeSource === bridgeSource);
  const ownEnabled = own?.billingEnabled ?? true;

  if (bridgeSource !== "gdt_agent") {
    if (!ownEnabled) {
      await raiseBillingConflictAlert(clinicId, bridgeSource, ["gdt_agent"]);
      return false;
    }
    return true;
  }

  // gdt_agent: collect the billing-enabled vendor paths competing for the
  // billing domain.
  const competing = rows
    .filter(
      (r) =>
        r.bridgeSource !== "gdt_agent" &&
        isContinuousPvsSource(r.bridgeSource) &&
        r.billingEnabled
    )
    .map((r) => r.bridgeSource);
  if (
    linkVendor !== "gdt_agent" &&
    linkVendor !== "none" &&
    isContinuousPvsSource(linkVendor) &&
    !rows.some((r) => r.bridgeSource === linkVendor)
  ) {
    // Implicit vendor path with no explicit row (cloud-adapter fast path).
    competing.push(linkVendor);
  }

  if (ownEnabled && competing.length === 0) return true;

  if (ownEnabled) {
    // First collision: the vendor path wins. Persist the decision so
    // subsequent gdt_agent revenue events fail fast on the flag alone.
    await db
      .insert(schema.pvsLinkSource)
      .values({
        clinicId,
        bridgeSource: "gdt_agent",
        pvsVendor: "gdt_agent",
        enrolledVia: "conflict",
        billingEnabled: false,
      })
      .onConflictDoUpdate({
        target: [
          schema.pvsLinkSource.clinicId,
          schema.pvsLinkSource.bridgeSource,
        ],
        set: { billingEnabled: false },
      });
  }
  await raiseBillingConflictAlert(clinicId, "gdt_agent", competing);
  return false;
}

/**
 * M-D6: standing "zwei Datenpfade für Rechnungsdaten" alert. Dedupe key is
 * per blocked source WITHOUT a day suffix — this is a configuration state,
 * not an incident stream, so one row per source is enough; re-detections
 * refresh updated_at. Best-effort like the derive-worker alarms: a failed
 * alert write must never turn into a 500 for the producer.
 */
async function raiseBillingConflictAlert(
  clinicId: string,
  blockedSource: string,
  competingSources: string[]
): Promise<void> {
  const winners =
    competingSources.length > 0
      ? competingSources.join(", ")
      : "der führenden Quelle";
  try {
    await db
      .insert(schema.dashboardAlerts)
      .values({
        clinicId,
        kind: "pvs_billing_conflict",
        severity: "high",
        title: `PVS: zweiter Datenpfad für Rechnungsdaten blockiert (${blockedSource})`,
        body: `Für diese Praxis liefern zwei Anbindungen gleichzeitig Rechnungsdaten (${blockedSource} und ${winners}). Damit Umsätze nicht doppelt gezählt werden, nimmt das Portal Rechnungs-Ereignisse nur aus einer führenden Quelle an; ${blockedSource} ist dafür blockiert. Termine, Patientendaten und Behandlungen sind nicht betroffen und fließen weiter aus beiden Quellen.`,
        actionSteps: [
          "Prüfen, welche Anbindung die Rechnungsdaten liefern soll. Standard: der PVS-Datenbank-Adapter, weil er direkt aus der Abrechnung liest.",
          "Soll stattdessen der GDT-Pfad führen: billing_enabled in pvs_link_source für beide Quellen umstellen (nie beide gleichzeitig aktiv).",
          "Nach einer Umstellung ggf. pnpm pvs:reconcile replay-events für das betroffene Zeitfenster ausführen.",
        ],
        metric: "pvs_billing_conflict_source",
        // dashboard_alerts.observed_value is numeric(14,4): a source-name
        // string raised 22P02 and the alert was never written. The source
        // names are in the title and body instead.
        observedValue: null,
        dedupeKey: `pvs_billing_conflict:${blockedSource}`,
      })
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error(
      `[pvs-events] billing-conflict alert write failed (clinic=${clinicId}, source=${blockedSource}):`,
      err
    );
  }
  // Revenue from this source is being rejected: EINS must know, not only the
  // Praxis dashboard. notifyOps never throws and is rate-limited per clinic.
  await notifyOps({
    clinicId,
    kind: `pvs_billing_conflict:${blockedSource}`,
    severity: "high",
    title: `PVS: Rechnungsdaten aus ${blockedSource} werden blockiert (zweiter Datenpfad)`,
    body: `Führende Quelle: ${winners}.`,
  });
}

/**
 * Returns the portal patients the two PVS ids pointed at BEFORE the merge.
 * Pass 2: the caller derives all of them. It used to derive only the post-
 * merge side, so the absorbed patient kept its lifetime revenue and its
 * Anfragen kept the PVS revenue: the same money counted on two patients.
 */
async function mergeMaps(input: PatientMergedEvent): Promise<string[]> {
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
  if (!fromRow && !toRow) return []; // neither side known yet — nothing to do

  // Take the survivor.
  const survivorPatientId =
    toRow?.portalPatientId ?? fromRow?.portalPatientId ?? null;
  if (!survivorPatientId) return [];
  const before = [fromRow?.portalPatientId, toRow?.portalPatientId].filter(
    (id): id is string => !!id
  );

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
  for (const old of before) {
    if (old !== survivorPatientId) {
      await moveRequestsOfUnmappedPatient(input.clinicId, old, survivorPatientId);
    }
  }
  return before;
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
