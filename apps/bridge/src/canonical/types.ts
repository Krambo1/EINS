/**
 * TypeScript mirror of the portal's PvsEventSchema (apps/portal/src/server/pvs-events.ts).
 *
 * Adapters return values of these types; portal-client.ts serializes them
 * into the wire format the portal endpoint validates.
 *
 * Keep this file in lock-step with the portal's Zod schema — when a new
 * event kind is added, mirror it here AND in apps/bridge/agent/src.
 */

export type BridgeSource =
  | "tomedo"
  | "healthhub"
  | "red"
  | "pabau"
  | "consentz"
  | "gdt_agent"
  | "csv_upload"
  | "n8n_custom"
  // Phase 7 per-vendor identity: the on-prem DB-read engines (underscores;
  // CGM-M1 Postgres + Oracle both collapse to cgm_m1pro). Mirror of the
  // canonical BRIDGE_SOURCES; conformance-pinned by types.conformance.test.ts.
  | "medatixx"
  | "cgm_albis"
  | "cgm_turbomed"
  | "cgm_m1pro"
  | "indamed"
  | "quincy"
  | "pixelmedics";

export interface BaseEvent {
  clinicId: string;
  bridgeSource: BridgeSource;
  pvsExternalEventId: string;
  occurredAt: string; // ISO 8601
}

export interface PatientUpsertedEvent extends BaseEvent {
  kind: "PatientUpserted";
  pvsPatientId: string;
  email?: string;
  phone?: string;
  fullName?: string;
  dob?: string;
  gender?: "f" | "m" | "d" | "x";
  bemerkung?: string;
  externalId?: string;
}

export interface AppointmentCreatedEvent extends BaseEvent {
  kind: "AppointmentCreated";
  pvsPatientId: string;
  pvsAppointmentId: string;
  scheduledAt: string;
  treatmentCode?: string;
  treatmentLabel?: string;
  locationCode?: string;
  locationLabel?: string;
  bemerkung?: string;
}

export interface AppointmentStatusChangedEvent extends BaseEvent {
  kind: "AppointmentStatusChanged";
  pvsPatientId: string;
  pvsAppointmentId: string;
  newStatus:
    | "scheduled"
    | "checked_in"
    | "completed"
    | "no_show"
    | "cancelled";
  changedAt?: string;
}

export interface AppointmentCancelledEvent extends BaseEvent {
  kind: "AppointmentCancelled";
  pvsPatientId: string;
  pvsAppointmentId: string;
  cancellationReason?: string;
  cancelledBy?: "patient" | "clinic";
}

export interface EncounterCompletedEvent extends BaseEvent {
  kind: "EncounterCompleted";
  pvsPatientId: string;
  pvsEncounterId: string;
  pvsAppointmentId?: string;
  treatmentCode?: string;
  treatmentLabel?: string;
  completedAt: string;
  practitionerLabel?: string;
}

export interface InvoicePaidEvent extends BaseEvent {
  kind: "InvoicePaid";
  pvsPatientId: string;
  pvsInvoiceId: string;
  pvsAppointmentId?: string;
  pvsEncounterId?: string;
  amountCents: number;
  currency?: "EUR" | "CHF";
  paidAt: string;
}

export interface InvoiceRefundedEvent extends BaseEvent {
  kind: "InvoiceRefunded";
  pvsPatientId: string;
  pvsInvoiceId: string;
  pvsAppointmentId?: string;
  /** POSITIVE magnitude of the amount given back (integer cents). The derive
   *  worker subtracts it from the patient total and the matching appointment
   *  bucket. A dedicated kind (not a negative InvoicePaid) keeps amounts
   *  nonnegative. Mirrors the portal Zod InvoiceRefundedSchema. */
  refundedAmountCents: number;
  currency?: "EUR" | "CHF";
  refundedAt: string;
  reason?: string;
}

export interface RecallScheduledEvent extends BaseEvent {
  kind: "RecallScheduled";
  pvsPatientId: string;
  pvsRecallId: string;
  recallAt: string;
  treatmentCode?: string;
  treatmentLabel?: string;
}

export interface PatientMergedEvent extends BaseEvent {
  kind: "PatientMerged";
  fromPvsPatientId: string;
  toPvsPatientId: string;
}

export type CanonicalEvent =
  | PatientUpsertedEvent
  | AppointmentCreatedEvent
  | AppointmentStatusChangedEvent
  | AppointmentCancelledEvent
  | EncounterCompletedEvent
  | InvoicePaidEvent
  | InvoiceRefundedEvent
  | RecallScheduledEvent
  | PatientMergedEvent;
