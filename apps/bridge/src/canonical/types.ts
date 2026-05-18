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
  | "gdt_agent"
  | "csv_upload"
  | "n8n_custom";

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
  currency?: "EUR";
  paidAt: string;
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
  | RecallScheduledEvent
  | PatientMergedEvent;
