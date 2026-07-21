import type {
  CanonicalEvent,
  AppointmentCreatedEvent,
  AppointmentStatusChangedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  InvoiceRefundedEvent,
  PatientUpsertedEvent,
  RecallScheduledEvent,
} from "../../canonical/types.js";
import {
  parseSignedAmountToCents,
  guardAmountCents,
} from "../amount.js";
import { isoUtc } from "../_shared/iso.js";
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
  // isoUtc so the id + occurredAt are byte-stable regardless of the offset /
  // precision Consentz returns; the portal dedups on (id, occurred_at).
  const updatedAt = isoUtc(p.updated_at);
  const fullName =
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || undefined;
  const phone = p.mobile ?? p.phone ?? undefined;
  return {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:patient:${id}:${updatedAt}`,
    occurredAt: updatedAt,
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
  const scheduledAt = isoUtc(a.scheduled_at);

  // H4 note: AppointmentCreated.occurredAt stays scheduled_at. The Consentz
  // appointment payload carries no creation timestamp (only scheduled_at and
  // the mutable updated_at), so there is no stable creation instant to key on;
  // a reschedule that moves scheduled_at re-emits one AppointmentCreated row.
  // We accept that count impact rather than invent identity (the derive worker
  // folds by pvsAppointmentId and dedups revenue by pvsInvoiceId).
  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:appointment:${id}`,
    occurredAt: scheduledAt,
    pvsPatientId: clientId,
    pvsAppointmentId: id,
    scheduledAt,
    treatmentCode: a.treatment_id != null ? String(a.treatment_id) : undefined,
    treatmentLabel: a.treatment_name ?? undefined,
    locationCode: a.location_id != null ? String(a.location_id) : undefined,
    locationLabel: a.location_name ?? undefined,
    bemerkung: a.notes ?? undefined,
  };
  const events: CanonicalEvent[] = [created];

  const newStatus = mapApptStatus(a.status);
  if (newStatus && newStatus !== "scheduled") {
    const changedAt = isoUtc(a.updated_at);
    const status: AppointmentStatusChangedEvent = {
      kind: "AppointmentStatusChanged",
      clinicId,
      bridgeSource: "consentz",
      pvsExternalEventId: `consentz:appointment:${id}:status:${newStatus}:${changedAt}`,
      occurredAt: changedAt,
      pvsPatientId: clientId,
      pvsAppointmentId: id,
      newStatus,
      changedAt,
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
  const completedAt = isoUtc(e.completed_at);
  return {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: "consentz",
    pvsExternalEventId: `consentz:encounter:${id}`,
    occurredAt: completedAt,
    pvsPatientId: clientId,
    pvsEncounterId: id,
    pvsAppointmentId:
      e.appointment_id != null ? String(e.appointment_id) : undefined,
    treatmentCode:
      e.treatment_id != null ? String(e.treatment_id) : undefined,
    treatmentLabel: e.treatment_name ?? undefined,
    completedAt,
    practitionerLabel: e.practitioner_name ?? undefined,
  };
}

export function normalizePayment(
  clinicId: string,
  p: ConsentzPayment
): InvoicePaidEvent | InvoiceRefundedEvent | null {
  const id = String(p.id);
  const clientId = String(p.client_id);
  if (!id || !clientId) return null;

  const amountCents = coerceSignedCents(p);
  if (amountCents == null) return null;

  // H1: a negative amount is a refund / Gutschrift. Emit InvoiceRefunded with
  // the positive magnitude and a dedicated id namespace (consentz:payment-
  // refund:) so it can never collide with the paid event of the same payment.
  // Evaluated BEFORE the paid gate: a refund is revenue-relevant regardless of
  // status.
  if (amountCents < 0) {
    const refundedAt = isoUtc(p.paid_at ?? p.updated_at);
    return {
      kind: "InvoiceRefunded",
      clinicId,
      bridgeSource: "consentz",
      pvsExternalEventId: `consentz:payment-refund:${id}`,
      occurredAt: refundedAt,
      pvsPatientId: clientId,
      pvsInvoiceId: id,
      pvsAppointmentId:
        p.appointment_id != null ? String(p.appointment_id) : undefined,
      refundedAmountCents: Math.abs(amountCents),
      currency: "EUR",
      refundedAt,
    };
  }

  const status = (p.status ?? "").toLowerCase();
  const isPaid =
    status === "paid" || status === "succeeded" || status === "settled" || !!p.paid_at;
  if (!isPaid) return null;

  const paidAt = isoUtc(p.paid_at ?? p.updated_at);

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
    occurredAt: isoUtc(r.updated_at ?? r.recall_at),
    pvsPatientId: clientId,
    pvsRecallId: id,
    recallAt: isoUtc(r.recall_at),
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

/** SIGNED integer cents from a Consentz payment (negatives preserved so a
 *  refund routes to InvoiceRefunded). */
function coerceSignedCents(p: ConsentzPayment): number | null {
  if (typeof p.amount_cents === "number" && Number.isFinite(p.amount_cents)) {
    return guardAmountCents(Math.round(p.amount_cents), p.amount_cents);
  }
  const raw = p.amount;
  if (raw == null) return null;
  return parseSignedAmountToCents(raw);
}
