import { z } from "zod";
import { BRIDGE_SOURCES } from "./schema-source.js";

/**
 * Bridge-side mirror of the portal Zod PvsEventSchema
 * (apps/portal/src/server/pvs-events.ts). sanitize.ts coerces vendor values
 * and then runs this as the FINAL gate, so an event the portal would reject
 * never leaves the bridge: it is dropped and counted instead of poisoning a
 * batch (and, before the portal validated per event, a whole practice's sync).
 *
 * Hand-maintained mirror; portal-schema.mirror.test.ts pins the load-bearing
 * constraints against the portal source so drift fails CI. Deliberate
 * difference: clinicId is any non-empty string here (the portal checks the
 * uuid and answers clinic_mismatch; the bridge does not second-guess it).
 */
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
const BridgeSource = z.enum(BRIDGE_SOURCES);

const baseFields = {
  clinicId: z.string().min(1),
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


// 8) PatientMerged — PVS-side merge collapses fromPvsPatientId → toPvsPatientId.
const PatientMergedSchema = z.object({
  kind: z.literal("PatientMerged"),
  ...baseFields,
  fromPvsPatientId: z.string().min(1).max(200),
  toPvsPatientId: z.string().min(1).max(200),
});


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
export const PvsEventMirror = PvsEventSchema;
