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
  PabauPatient,
  PabauAppointment,
  PabauEncounter,
  PabauInvoice,
  PabauRecall,
} from "./client.js";

/**
 * Pabau → canonical event translators.
 *
 * Section 7 contract reminders (verified against
 * apps/portal/src/worker/processors/pvs-status-derive.ts):
 *
 *   AppointmentCreated     must carry pvsAppointmentId + scheduledAt + pvsPatientId
 *   AppointmentStatusChanged must carry pvsAppointmentId + newStatus in the canonical set
 *   EncounterCompleted     must carry pvsAppointmentId (otherwise the worker drops it)
 *   InvoicePaid            must carry pvsAppointmentId + amountCents + paidAt
 *   RecallScheduled        must carry pvsRecallId + recallAt + pvsPatientId
 *
 * If a Pabau record arrives without the linkage field, we still emit the
 * canonical event but it will be silently dropped downstream — which is
 * the correct behavior; the alternative is fabricating linkage data.
 * Linkage missing is a Pabau-side data issue, not a bridge bug.
 */

export function normalizePatient(
  clinicId: string,
  p: PabauPatient
): PatientUpsertedEvent {
  const id = String(p.id);
  const fullName =
    [p.first_name, p.last_name].filter(Boolean).join(" ").trim() || undefined;
  const phone = p.mobile ?? p.phone ?? undefined;
  return {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: "pabau",
    pvsExternalEventId: `pabau:patient:${id}:${p.modified_at}`,
    occurredAt: p.modified_at,
    pvsPatientId: id,
    email: p.email ?? undefined,
    phone: phone ?? undefined,
    fullName,
    dob: p.dob ?? undefined,
    gender: mapGender(p.gender),
    bemerkung: p.notes ?? undefined,
  };
}

export function normalizeAppointment(
  clinicId: string,
  a: PabauAppointment
): CanonicalEvent[] {
  const id = String(a.id);
  const clientId = String(a.client_id);
  if (!id || !clientId || !a.start_time) return [];

  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: "pabau",
    pvsExternalEventId: `pabau:appointment:${id}`,
    occurredAt: a.start_time,
    pvsPatientId: clientId,
    pvsAppointmentId: id,
    scheduledAt: a.start_time,
    treatmentCode: a.service_id != null ? String(a.service_id) : undefined,
    treatmentLabel: a.service_name ?? undefined,
    locationCode: a.location_id != null ? String(a.location_id) : undefined,
    locationLabel: a.location_name ?? undefined,
    bemerkung: a.notes ?? undefined,
  };

  const events: CanonicalEvent[] = [created];

  const newStatus = mapApptStatus(a.status);
  if (newStatus && newStatus !== "scheduled") {
    // Status-change occurrence: we don't get a separate "status changed at"
    // timestamp from Pabau, so we use modified_at (which is bumped by Pabau
    // whenever a booking row is touched, including status edits). The
    // pvsExternalEventId includes the status + modified_at so multiple
    // status transitions on the same booking dedupe correctly.
    const status: AppointmentStatusChangedEvent = {
      kind: "AppointmentStatusChanged",
      clinicId,
      bridgeSource: "pabau",
      pvsExternalEventId: `pabau:appointment:${id}:status:${newStatus}:${a.modified_at}`,
      occurredAt: a.modified_at,
      pvsPatientId: clientId,
      pvsAppointmentId: id,
      newStatus,
      changedAt: a.modified_at,
    };
    events.push(status);
  }
  return events;
}

export function normalizeEncounter(
  clinicId: string,
  e: PabauEncounter
): EncounterCompletedEvent | null {
  const id = String(e.id);
  const clientId = String(e.client_id);
  if (!id || !clientId || !e.completed_at) return null;
  return {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: "pabau",
    pvsExternalEventId: `pabau:encounter:${id}`,
    occurredAt: e.completed_at,
    pvsPatientId: clientId,
    pvsEncounterId: id,
    pvsAppointmentId: e.booking_id != null ? String(e.booking_id) : undefined,
    treatmentCode: e.service_id != null ? String(e.service_id) : undefined,
    treatmentLabel: e.service_name ?? undefined,
    completedAt: e.completed_at,
    practitionerLabel: e.practitioner_name ?? undefined,
  };
}

export function normalizeInvoice(
  clinicId: string,
  i: PabauInvoice
): InvoicePaidEvent | null {
  // Only "paid" invoices advance Werbebudget ROI. Pabau marks paid invoices
  // either via status='paid' or via a non-null paid_at timestamp. We accept
  // either signal; if neither is set, skip.
  const status = (i.status ?? "").toLowerCase();
  const isPaid = status === "paid" || !!i.paid_at;
  if (!isPaid) return null;

  const id = String(i.id);
  const clientId = String(i.client_id);
  if (!id || !clientId) return null;

  const amountCents = coerceAmountCents(i);
  if (amountCents == null) return null;

  const paidAt = i.paid_at ?? i.modified_at;

  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "pabau",
    pvsExternalEventId: `pabau:invoice:${id}`,
    occurredAt: paidAt,
    pvsPatientId: clientId,
    pvsInvoiceId: id,
    pvsAppointmentId: i.booking_id != null ? String(i.booking_id) : undefined,
    pvsEncounterId:
      i.treatment_note_id != null ? String(i.treatment_note_id) : undefined,
    amountCents,
    currency: (i.currency ?? "EUR").toUpperCase() === "EUR" ? "EUR" : "EUR",
    paidAt,
  };
}

export function normalizeRecall(
  clinicId: string,
  r: PabauRecall
): RecallScheduledEvent | null {
  const id = String(r.id);
  const clientId = String(r.client_id);
  if (!id || !clientId || !r.recall_at) return null;
  return {
    kind: "RecallScheduled",
    clinicId,
    bridgeSource: "pabau",
    pvsExternalEventId: `pabau:recall:${id}`,
    occurredAt: r.modified_at ?? r.recall_at,
    pvsPatientId: clientId,
    pvsRecallId: id,
    recallAt: r.recall_at,
    treatmentCode: r.service_id != null ? String(r.service_id) : undefined,
    treatmentLabel: r.service_name ?? undefined,
  };
}

// ---------- helpers ----------

/**
 * Pabau's booking.status values per their docs surface:
 *   "booked", "confirmed", "checked_in" / "arrived", "completed",
 *   "cancelled", "no_show", "waiting", "rescheduled".
 * We map them to the canonical set the portal worker expects.
 */
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
    case "booked":
    case "confirmed":
    case "scheduled":
    case "waiting":
    case "rescheduled":
    case "pending":
      return "scheduled";
    case "arrived":
    case "checked_in":
    case "checked-in":
    case "checkedin":
      return "checked_in";
    case "completed":
    case "complete":
    case "fulfilled":
    case "finished":
      return "completed";
    case "no_show":
    case "no-show":
    case "noshow":
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
  if (v === "f" || v === "female" || v === "w" || v === "weiblich") return "f";
  if (v === "m" || v === "male" || v === "männlich" || v === "maennlich") return "m";
  if (v === "d" || v === "diverse" || v === "divers" || v === "other") return "d";
  if (v === "x" || v === "unknown" || v === "unbekannt") return "x";
  return undefined;
}

/**
 * Pabau invoice totals come back in three flavors depending on account
 * config:
 *   1) `amount_cents` (already integer cents)
 *   2) `total` or `total_amount` as a number (major units, e.g. 199.50)
 *   3) the same string-encoded (e.g. "199.50" or "199,50")
 * We accept all three and normalize to integer cents.
 */
function coerceAmountCents(i: PabauInvoice): number | null {
  if (typeof i.amount_cents === "number" && Number.isFinite(i.amount_cents)) {
    return Math.round(i.amount_cents);
  }
  const raw =
    typeof i.total === "number" || typeof i.total === "string"
      ? i.total
      : i.total_amount;
  if (raw == null) return null;
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else {
    // Accept both `.` and `,` decimal separators (DACH locale exports).
    const cleaned = raw.replace(/[^0-9,.-]/g, "").replace(",", ".");
    n = Number.parseFloat(cleaned);
  }
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
