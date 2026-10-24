import type {
  CanonicalEvent,
  PatientUpsertedEvent,
  AppointmentCreatedEvent,
  AppointmentStatusChangedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  InvoiceRefundedEvent,
  RecallScheduledEvent,
} from "../../canonical/types.js";
import { isoUtc, tomedoEventId } from "./event-identity.js";
import { DEFAULT_TIMEZONE, type NormalizeOptions } from "../_shared/iso.js";

/**
 * Tomedo → canonical event translators.
 *
 * Each function takes the raw record from the Tomedo API (a JSON object
 * with vendor-specific field names) and emits one canonical event. Field
 * shapes mirror Zollsoft's documented API; verify against sandbox before
 * production-cutover.
 *
 * Cross-path dedup (Phase 11): every id and timestamp routes through
 * event-identity.ts so this REST path and the DB-read YAML path produce
 * byte-identical (pvsExternalEventId, occurredAt) for the same Tomedo row, and
 * the portal's unique index collapses them. Do not inline an id template or a
 * raw timestamp here; that would silently re-open the cross-path gap.
 */

interface TomedoBase {
  modifiedAt: string;
}

interface TomedoPatient extends TomedoBase {
  id: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  gender?: string;
  comment?: string; // PVS bemerkung field
}

export function normalizePatient(
  clinicId: string,
  p: unknown,
  opts: NormalizeOptions = {}
): PatientUpsertedEvent {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = p as TomedoPatient;
  const fullName = [t.firstName, t.lastName].filter(Boolean).join(" ") || undefined;
  const modifiedAt = isoUtc(t.modifiedAt, tz);
  return {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.patient(t.id, modifiedAt),
    occurredAt: modifiedAt,
    pvsPatientId: t.id,
    email: t.email,
    phone: t.phone,
    fullName,
    dob: t.dob,
    gender: mapGender(t.gender),
    bemerkung: t.comment,
  };
}

interface TomedoAppointment extends TomedoBase {
  id: string;
  patientId: string;
  scheduledAt: string;
  treatmentCode?: string;
  treatmentName?: string;
  locationId?: string;
  locationName?: string;
  comment?: string;
  status?: string;
}

export function normalizeAppointment(
  clinicId: string,
  a: unknown,
  opts: NormalizeOptions = {}
): CanonicalEvent {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = a as TomedoAppointment;
  // Emit AppointmentCreated for every poll-seen appointment; the portal-side
  // event_log dedupes by (clinicId, bridge_source, pvsExternalEventId,
  // occurredAt) and the status-derive worker fold groups by appointmentId,
  // so repeated re-emission is safe. If the row's status changed since last
  // sync, also emit a StatusChanged — but tomedo doesn't expose a separate
  // "status changed at" timestamp, so we cheat by setting the event's
  // occurredAt to modifiedAt.
  //
  // H4 note: AppointmentCreated.occurredAt stays scheduledAt. Tomedo exposes no
  // appointment CREATION timestamp (only the mutable scheduledAt and
  // modifiedAt), so there is no stable creation instant to key on; a reschedule
  // that moves scheduledAt re-emits one AppointmentCreated row. That count
  // impact is accepted (the derive worker folds by pvsAppointmentId and dedups
  // revenue by pvsInvoiceId). scheduledAt must ALSO stay the occurredAt for the
  // cross-path dedup contract in event-identity.ts (the DB-read YAML path maps
  // occurred_at from the same scheduledAt).
  const scheduledAt = isoUtc(t.scheduledAt, tz);
  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.appointment(t.id),
    occurredAt: scheduledAt,
    pvsPatientId: t.patientId,
    pvsAppointmentId: t.id,
    scheduledAt,
    treatmentCode: t.treatmentCode,
    treatmentLabel: t.treatmentName,
    locationCode: t.locationId,
    locationLabel: t.locationName,
    bemerkung: t.comment,
  };
  return created;
}

/**
 * The AppointmentStatusChanged event for a status that is not the default
 * "scheduled", or null. Same contract as pabau/consentz: tomedo has no separate
 * "status changed at", so occurredAt/changedAt are the row's modifiedAt, and the
 * id embeds status + modifiedAt so each distinct transition dedups on its own.
 * Id + occurredAt come from event-identity.ts (tomedoEventId.appointmentStatus),
 * the same template the DB-read YAML path uses.
 */
export function normalizeAppointmentStatus(
  clinicId: string,
  a: unknown,
  opts: NormalizeOptions = {}
): AppointmentStatusChangedEvent | null {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = a as TomedoAppointment;
  const newStatus = mapApptStatus(t.status);
  if (!newStatus || newStatus === "scheduled") return null;
  const changedAt = isoUtc(t.modifiedAt, tz);
  if (changedAt === "" || Number.isNaN(Date.parse(changedAt))) return null;
  return {
    kind: "AppointmentStatusChanged",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.appointmentStatus(t.id, newStatus, changedAt),
    occurredAt: changedAt,
    pvsPatientId: t.patientId,
    pvsAppointmentId: t.id,
    newStatus,
    changedAt,
  };
}

/** AppointmentCreated plus, when the status moved on, AppointmentStatusChanged. */
export function normalizeAppointmentEvents(
  clinicId: string,
  a: unknown,
  opts: NormalizeOptions = {}
): CanonicalEvent[] {
  const events: CanonicalEvent[] = [normalizeAppointment(clinicId, a, opts)];
  const status = normalizeAppointmentStatus(clinicId, a, opts);
  if (status) events.push(status);
  return events;
}

interface TomedoEncounter extends TomedoBase {
  id: string;
  patientId: string;
  appointmentId?: string;
  completedAt: string;
  treatmentCode?: string;
  treatmentName?: string;
  practitionerName?: string;
}

export function normalizeEncounter(
  clinicId: string,
  e: unknown,
  opts: NormalizeOptions = {}
): EncounterCompletedEvent {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = e as TomedoEncounter;
  const completedAt = isoUtc(t.completedAt, tz);
  return {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.encounter(t.id),
    occurredAt: completedAt,
    pvsPatientId: t.patientId,
    pvsEncounterId: t.id,
    pvsAppointmentId: t.appointmentId,
    treatmentCode: t.treatmentCode,
    treatmentLabel: t.treatmentName,
    completedAt,
    practitionerLabel: t.practitionerName,
  };
}

interface TomedoInvoice extends TomedoBase {
  id: string;
  patientId: string;
  appointmentId?: string;
  encounterId?: string;
  amountCents: number;
  paidAt: string;
}

export function normalizeInvoice(
  clinicId: string,
  i: unknown,
  opts: NormalizeOptions = {}
): InvoicePaidEvent | InvoiceRefundedEvent | null {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = i as TomedoInvoice;
  const paidAt = isoUtc(t.paidAt, tz);
  // An invoice without a (valid) paidAt is NOT an InvoicePaid: Tomedo lists
  // open invoices too, and emitting those with an empty paidAt made the portal
  // reject the event (and, before per-event validation, the whole batch). Skip
  // it; it is emitted once it is paid and its row changes.
  if (paidAt === "" || Number.isNaN(Date.parse(paidAt))) return null;
  // A negative amount is a Storno / Gutschrift. As an InvoicePaid it would be
  // dropped by the sanitiser (amounts are non-negative) and the refund would
  // silently never reach the revenue numbers, so it goes out as InvoiceRefunded
  // with the positive magnitude. The id carries the row's timestamp, matching
  // the shared refund id builder.
  if (t.amountCents < 0) {
    return {
      kind: "InvoiceRefunded",
      clinicId,
      bridgeSource: "tomedo",
      pvsExternalEventId: tomedoEventId.refund(t.id, paidAt),
      occurredAt: paidAt,
      pvsPatientId: t.patientId,
      pvsInvoiceId: t.id,
      pvsAppointmentId: t.appointmentId,
      refundedAmountCents: Math.abs(t.amountCents),
      currency: "EUR",
      refundedAt: paidAt,
    };
  }
  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.invoice(t.id),
    occurredAt: paidAt,
    pvsPatientId: t.patientId,
    pvsInvoiceId: t.id,
    pvsAppointmentId: t.appointmentId,
    pvsEncounterId: t.encounterId,
    amountCents: t.amountCents,
    currency: "EUR",
    paidAt,
  };
}

interface TomedoRecall extends TomedoBase {
  id: string;
  patientId: string;
  recallAt: string;
  treatmentCode?: string;
  treatmentName?: string;
}

export function normalizeRecall(
  clinicId: string,
  r: unknown,
  opts: NormalizeOptions = {}
): RecallScheduledEvent {
  const tz = opts.timezone ?? DEFAULT_TIMEZONE;
  const t = r as TomedoRecall;
  // occurredAt is the scheduling moment (modifiedAt), NOT the future recall
  // target (recallAt). The DB-read YAML maps occurredAt from modified_at too
  // (Phase 11), so the two paths dedup; recallAt stays the target time.
  return {
    kind: "RecallScheduled",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.recall(t.id),
    occurredAt: isoUtc(t.modifiedAt, tz),
    pvsPatientId: t.patientId,
    pvsRecallId: t.id,
    recallAt: isoUtc(t.recallAt, tz),
    treatmentCode: t.treatmentCode,
    treatmentLabel: t.treatmentName,
  };
}

/** Tomedo appointment status (German or English wording) -> canonical set. */
function mapApptStatus(
  s?: string | null
): AppointmentStatusChangedEvent["newStatus"] | null {
  if (!s) return null;
  const v = s.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (v) {
    case "scheduled":
    case "booked":
    case "confirmed":
    case "geplant":
    case "terminiert":
    case "bestaetigt":
    case "bestätigt":
      return "scheduled";
    case "checked_in":
    case "arrived":
    case "eingecheckt":
    case "anwesend":
      return "checked_in";
    case "completed":
    case "complete":
    case "finished":
    case "abgeschlossen":
    case "erledigt":
    case "stattgefunden":
      return "completed";
    case "no_show":
    case "noshow":
    case "nicht_erschienen":
      return "no_show";
    case "cancelled":
    case "canceled":
    case "storniert":
    case "abgesagt":
      return "cancelled";
    default:
      return null;
  }
}

function mapGender(input?: string): "f" | "m" | "d" | "x" | undefined {
  if (!input) return undefined;
  const v = input.trim().toLowerCase();
  if (v === "w" || v === "f" || v === "weiblich") return "f";
  if (v === "m" || v === "männlich" || v === "maennlich") return "m";
  if (v === "d" || v === "divers") return "d";
  if (v === "x" || v === "unbekannt") return "x";
  return undefined;
}
