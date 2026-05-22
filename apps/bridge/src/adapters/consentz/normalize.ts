import type {
  CanonicalEvent,
  AppointmentCreatedEvent,
  AppointmentStatusChangedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  PatientUpsertedEvent,
  RecallScheduledEvent,
} from "../../canonical/types.js";
import type {
  ConsentzClient_Patient,
  ConsentzAppointment,
  ConsentzTreatmentNote,
  ConsentzPayment,
  ConsentzRecall,
} from "./client.js";

/**
 * Consentz → canonical event translators. Same contract obligations as
 * the Pabau translators (see apps/bridge/src/adapters/pabau/normalize.ts
 * header). Calibrate field paths against Consentz's actual response shape
 * at first-Praxis onboarding; the dedup index protects us from emitting
 * duplicates during that calibration period.
 */

export function normalizePatient(
  clinicId: string,
  p: ConsentzClient_Patient
): PatientUpsertedEvent {
  const id = String(p.id);
  const fullName =
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || undefined;
  const phone = p.mobile ?? p.phone ?? undefined;
  return {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:patient:${id}:${p.updated_at}`,
    occurredAt: p.updated_at,
    pvsPatientId: id,
    email: p.email ?? undefined,
    phone: phone ?? undefined,
    fullName,
    dob: p.date_of_birth ?? undefined,
    gender: mapGender(p.gender),
    bemerkung: p.notes ?? undefined,
  };
}

export function normalizeAppointment(
  clinicId: string,
  a: ConsentzAppointment
): CanonicalEvent[] {
  const id = String(a.id);
  const clientId = String(a.client_id);
  if (!id || !clientId || !a.scheduled_at) return [];

  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:appointment:${id}`,
    occurredAt: a.scheduled_at,
    pvsPatientId: clientId,
    pvsAppointmentId: id,
    scheduledAt: a.scheduled_at,
    treatmentCode: a.treatment_id != null ? String(a.treatment_id) : undefined,
    treatmentLabel: a.treatment_name ?? undefined,
    locationCode: a.location_id != null ? String(a.location_id) : undefined,
    locationLabel: a.location_name ?? undefined,
    bemerkung: a.notes ?? undefined,
  };
  const events: CanonicalEvent[] = [created];

  const newStatus = mapApptStatus(a.status);
  if (newStatus && newStatus !== "scheduled") {
    const status: AppointmentStatusChangedEvent = {
      kind: "AppointmentStatusChanged",
      clinicId,
      bridgeSource: "consentz",
      pvsExternalEventId: `consentz:appointment:${id}:status:${newStatus}:${a.updated_at}`,
      occurredAt: a.updated_at,
      pvsPatientId: clientId,
      pvsAppointmentId: id,
      newStatus,
      changedAt: a.updated_at,
    };
    events.push(status);
  }
  return events;
}

export function normalizeEncounter(
  clinicId: string,
  e: ConsentzTreatmentNote
): EncounterCompletedEvent | null {
  const id = String(e.id);
  const clientId = String(e.client_id);
  if (!id || !clientId || !e.completed_at) return null;
  return {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:encounter:${id}`,
    occurredAt: e.completed_at,
    pvsPatientId: clientId,
    pvsEncounterId: id,
    pvsAppointmentId:
      e.appointment_id != null ? String(e.appointment_id) : undefined,
    treatmentCode:
      e.treatment_id != null ? String(e.treatment_id) : undefined,
    treatmentLabel: e.treatment_name ?? undefined,
    completedAt: e.completed_at,
    practitionerLabel: e.practitioner_name ?? undefined,
  };
}

export function normalizePayment(
  clinicId: string,
  p: ConsentzPayment
): InvoicePaidEvent | null {
  const id = String(p.id);
  const clientId = String(p.client_id);
  if (!id || !clientId) return null;

  const status = (p.status ?? "").toLowerCase();
  const isPaid =
    status === "paid" || status === "succeeded" || status === "settled" || !!p.paid_at;
  if (!isPaid) return null;

  const amountCents = coerceAmountCents(p);
  if (amountCents == null) return null;

  const paidAt = p.paid_at ?? p.updated_at;

  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:payment:${id}`,
    occurredAt: paidAt,
    pvsPatientId: clientId,
    pvsInvoiceId: id,
    pvsAppointmentId:
      p.appointment_id != null ? String(p.appointment_id) : undefined,
    pvsEncounterId:
      p.treatment_note_id != null ? String(p.treatment_note_id) : undefined,
    amountCents,
    currency: "EUR",
    paidAt,
  };
}

export function normalizeRecall(
  clinicId: string,
  r: ConsentzRecall
): RecallScheduledEvent | null {
  const id = String(r.id);
  const clientId = String(r.client_id);
  if (!id || !clientId || !r.recall_at) return null;
  return {
    kind: "RecallScheduled",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:recall:${id}`,
    occurredAt: r.updated_at ?? r.recall_at,
    pvsPatientId: clientId,
    pvsRecallId: id,
    recallAt: r.recall_at,
    treatmentCode: r.treatment_id != null ? String(r.treatment_id) : undefined,
    treatmentLabel: r.treatment_name ?? undefined,
  };
}

// ---- helpers ----

function mapApptStatus(
  s?: string | null
):
  | "scheduled"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled"
  | null {
  if (!s) return null;
  const v = s.trim().toLowerCase();
  switch (v) {
    case "scheduled":
    case "booked":
    case "confirmed":
    case "pending":
      return "scheduled";
    case "checked_in":
    case "checked-in":
    case "arrived":
      return "checked_in";
    case "completed":
    case "complete":
    case "finished":
    case "fulfilled":
      return "completed";
    case "no_show":
    case "no-show":
    case "noshow":
    case "missed":
      return "no_show";
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return null;
  }
}

function mapGender(input?: string | null): "f" | "m" | "d" | "x" | undefined {
  if (!input) return undefined;
  const v = input.trim().toLowerCase();
  if (v === "f" || v === "female" || v === "w") return "f";
  if (v === "m" || v === "male") return "m";
  if (v === "d" || v === "diverse" || v === "divers" || v === "other") return "d";
  if (v === "x" || v === "unknown" || v === "unbekannt") return "x";
  return undefined;
}

function coerceAmountCents(p: ConsentzPayment): number | null {
  if (typeof p.amount_cents === "number" && Number.isFinite(p.amount_cents)) {
    return Math.round(p.amount_cents);
  }
  const raw = p.amount;
  if (raw == null) return null;
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else {
    const cleaned = raw.replace(/[^0-9,.-]/g, "").replace(",", ".");
    n = Number.parseFloat(cleaned);
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
