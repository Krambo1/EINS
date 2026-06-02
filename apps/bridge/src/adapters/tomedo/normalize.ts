import type {
  CanonicalEvent,
  PatientUpsertedEvent,
  AppointmentCreatedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  RecallScheduledEvent,
} from "../../canonical/types.js";
import { isoUtc, tomedoEventId } from "./event-identity.js";

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
  p: unknown
): PatientUpsertedEvent {
  const t = p as TomedoPatient;
  const fullName = [t.firstName, t.lastName].filter(Boolean).join(" ") || undefined;
  const modifiedAt = isoUtc(t.modifiedAt);
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
  a: unknown
): CanonicalEvent {
  const t = a as TomedoAppointment;
  // Emit AppointmentCreated for every poll-seen appointment; the portal-side
  // event_log dedupes by (clinicId, bridge_source, pvsExternalEventId,
  // occurredAt) and the status-derive worker fold groups by appointmentId,
  // so repeated re-emission is safe. If the row's status changed since last
  // sync, also emit a StatusChanged — but tomedo doesn't expose a separate
  // "status changed at" timestamp, so we cheat by setting the event's
  // occurredAt to modifiedAt.
  const scheduledAt = isoUtc(t.scheduledAt);
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
  e: unknown
): EncounterCompletedEvent {
  const t = e as TomedoEncounter;
  const completedAt = isoUtc(t.completedAt);
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
  i: unknown
): InvoicePaidEvent {
  const t = i as TomedoInvoice;
  const paidAt = isoUtc(t.paidAt);
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
  r: unknown
): RecallScheduledEvent {
  const t = r as TomedoRecall;
  // occurredAt is the scheduling moment (modifiedAt), NOT the future recall
  // target (recallAt). The DB-read YAML maps occurredAt from modified_at too
  // (Phase 11), so the two paths dedup; recallAt stays the target time.
  return {
    kind: "RecallScheduled",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: tomedoEventId.recall(t.id),
    occurredAt: isoUtc(t.modifiedAt),
    pvsPatientId: t.patientId,
    pvsRecallId: t.id,
    recallAt: isoUtc(t.recallAt),
    treatmentCode: t.treatmentCode,
    treatmentLabel: t.treatmentName,
  };
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
