import type {
  CanonicalEvent,
  PatientUpsertedEvent,
  AppointmentCreatedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  RecallScheduledEvent,
} from "../../canonical/types.js";

/**
 * Tomedo → canonical event translators.
 *
 * Each function takes the raw record from the Tomedo API (a JSON object
 * with vendor-specific field names) and emits one canonical event. Field
 * shapes mirror Zollsoft's documented API; verify against sandbox before
 * production-cutover.
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
  return {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: `tomedo:patient:${t.id}:${t.modifiedAt}`,
    occurredAt: t.modifiedAt,
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
  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: `tomedo:appointment:${t.id}`,
    occurredAt: t.scheduledAt,
    pvsPatientId: t.patientId,
    pvsAppointmentId: t.id,
    scheduledAt: t.scheduledAt,
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
  return {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: `tomedo:encounter:${t.id}`,
    occurredAt: t.completedAt,
    pvsPatientId: t.patientId,
    pvsEncounterId: t.id,
    pvsAppointmentId: t.appointmentId,
    treatmentCode: t.treatmentCode,
    treatmentLabel: t.treatmentName,
    completedAt: t.completedAt,
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
  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: `tomedo:invoice:${t.id}`,
    occurredAt: t.paidAt,
    pvsPatientId: t.patientId,
    pvsInvoiceId: t.id,
    pvsAppointmentId: t.appointmentId,
    pvsEncounterId: t.encounterId,
    amountCents: t.amountCents,
    currency: "EUR",
    paidAt: t.paidAt,
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
  return {
    kind: "RecallScheduled",
    clinicId,
    bridgeSource: "tomedo",
    pvsExternalEventId: `tomedo:recall:${t.id}`,
    occurredAt: t.modifiedAt,
    pvsPatientId: t.patientId,
    pvsRecallId: t.id,
    recallAt: t.recallAt,
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
