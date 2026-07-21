import type {
  CanonicalEvent,
  PatientUpsertedEvent,
  AppointmentCreatedEvent,
  AppointmentStatusChangedEvent,
  EncounterCompletedEvent,
  InvoicePaidEvent,
  BridgeSource,
} from "../../canonical/types.js";

/**
 * FHIR Bundle → canonical-event translators shared between HealthHub
 * and RED. Both vendors deliver FHIR R4 Subscription notifications as
 * `application/fhir+json` Bundles containing one or more Patient /
 * Appointment / Encounter / Invoice resources.
 *
 * Both medatixx-HealthHub and RED are FHIR R4-compliant for the
 * resources we consume, so the same translator covers ~80% of code.
 * Vendor-specific deltas (e.g. medatixx's PaymentNotice vs. RED's
 * Invoice; gender code system differences) are isolated into the per-
 * vendor `index.ts`.
 */

export interface FhirBundle {
  resourceType: "Bundle";
  type: string;
  entry?: Array<{ resource?: FhirResource; fullUrl?: string }>;
}

export type FhirResource =
  | FhirPatient
  | FhirAppointment
  | FhirEncounter
  | FhirInvoice
  | { resourceType: string; [k: string]: unknown };

interface FhirPatient {
  resourceType: "Patient";
  id: string;
  name?: Array<{ family?: string; given?: string[] }>;
  telecom?: Array<{ system?: string; value?: string; use?: string }>;
  birthDate?: string;
  gender?: "male" | "female" | "other" | "unknown";
  note?: Array<{ text?: string }>;
  meta?: { lastUpdated?: string };
}

interface FhirAppointment {
  resourceType: "Appointment";
  id: string;
  status:
    | "proposed"
    | "pending"
    | "booked"
    | "arrived"
    | "fulfilled"
    | "cancelled"
    | "noshow"
    | "entered-in-error"
    | "checked-in"
    | "waitlist";
  start: string;
  participant?: Array<{
    actor?: { reference?: string; display?: string };
    type?: Array<{ coding?: Array<{ code?: string }> }>;
  }>;
  serviceType?: Array<{
    coding?: Array<{ code?: string; display?: string }>;
  }>;
  comment?: string;
  meta?: { lastUpdated?: string };
}

interface FhirEncounter {
  resourceType: "Encounter";
  id: string;
  status: string;
  subject?: { reference?: string };
  appointment?: Array<{ reference?: string }>;
  period?: { end?: string };
  type?: Array<{
    coding?: Array<{ code?: string; display?: string }>;
  }>;
  meta?: { lastUpdated?: string };
}

interface FhirInvoice {
  resourceType: "Invoice";
  id: string;
  status: "draft" | "issued" | "balanced" | "cancelled" | "entered-in-error";
  subject?: { reference?: string };
  totalNet?: { value?: number; currency?: string };
  totalGross?: { value?: number; currency?: string };
  date?: string;
  meta?: { lastUpdated?: string };
}

export function decodeFhirBundle(
  clinicId: string,
  source: BridgeSource,
  bundle: FhirBundle
): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  for (const entry of bundle.entry ?? []) {
    const r = entry.resource;
    if (!r) continue;
    switch (r.resourceType) {
      case "Patient":
        events.push(...patientToEvents(clinicId, source, r as FhirPatient));
        break;
      case "Appointment":
        events.push(...appointmentToEvents(clinicId, source, r as FhirAppointment));
        break;
      case "Encounter":
        events.push(...encounterToEvents(clinicId, source, r as FhirEncounter));
        break;
      case "Invoice":
        events.push(...invoiceToEvents(clinicId, source, r as FhirInvoice));
        break;
      // PaymentNotice, ServiceRequest etc. handled in vendor-specific
      // extension points (see HealthHub recall handler).
    }
  }
  return events;
}

function patientToEvents(
  clinicId: string,
  source: BridgeSource,
  p: FhirPatient
): CanonicalEvent[] {
  const email = p.telecom?.find((t) => t.system === "email")?.value;
  const phone = p.telecom?.find((t) => t.system === "phone")?.value;
  const name = p.name?.[0];
  const fullName = name
    ? [name.given?.join(" "), name.family].filter(Boolean).join(" ").trim() ||
      undefined
    : undefined;
  const bemerkung = p.note?.map((n) => n.text ?? "").join(" ").trim() || undefined;
  // occurredAt must be deterministic across webhook redeliveries (H4). A Patient
  // resource carries no clinical date, so meta.lastUpdated is the only stable
  // key: it is identical across redeliveries of the same resource version and
  // changes only on a real update (which SHOULD produce a distinguishable
  // event). The wall-clock fallback is gone: it duplicated on every redelivery.
  // When a resource lacks lastUpdated (pathological for FHIR R4, where the
  // server populates it) we reject rather than fabricate identity, matching the
  // return-[] convention used elsewhere in this file.
  const occurredAt = p.meta?.lastUpdated;
  if (!occurredAt) return [];
  const event: PatientUpsertedEvent = {
    kind: "PatientUpserted",
    clinicId,
    bridgeSource: source,
    pvsExternalEventId: `${source}:patient:${p.id}:${occurredAt}`,
    occurredAt,
    pvsPatientId: p.id,
    email,
    phone,
    fullName,
    dob: p.birthDate,
    gender: mapGenderFhir(p.gender),
    bemerkung,
  };
  return [event];
}

function appointmentToEvents(
  clinicId: string,
  source: BridgeSource,
  a: FhirAppointment
): CanonicalEvent[] {
  const patientRef = a.participant?.find(
    (p) => p.actor?.reference?.startsWith("Patient/")
  )?.actor?.reference;
  const pvsPatientId = patientRef?.replace(/^Patient\//, "") ?? "";
  if (!pvsPatientId) return [];

  const treatment = a.serviceType?.[0]?.coding?.[0];
  const occurredAt = a.meta?.lastUpdated ?? a.start;
  // H4 note: AppointmentCreated.occurredAt stays a.start (scheduledAt). The FHIR
  // R4 Appointment resource carries no creation timestamp (only the mutable
  // start and meta.lastUpdated), so there is no stable creation instant to key
  // on; a reschedule that moves start therefore re-emits one AppointmentCreated
  // row. We accept that count impact rather than invent identity: the portal
  // derive worker folds appointments by pvsAppointmentId and dedups revenue by
  // pvsInvoiceId, so the duplicate does not corrupt money. Using meta.lastUpdated
  // here would be strictly worse (it changes on ANY edit, not only reschedules).
  const created: AppointmentCreatedEvent = {
    kind: "AppointmentCreated",
    clinicId,
    bridgeSource: source,
    pvsExternalEventId: `${source}:appointment:${a.id}`,
    occurredAt: a.start,
    pvsPatientId,
    pvsAppointmentId: a.id,
    scheduledAt: a.start,
    treatmentCode: treatment?.code,
    treatmentLabel: treatment?.display,
    bemerkung: a.comment,
  };
  const events: CanonicalEvent[] = [created];

  // Emit a StatusChanged event when the appointment isn't in the default
  // 'booked' state — the portal's fold then derives the right status.
  const newStatus = mapApptStatus(a.status);
  if (newStatus && newStatus !== "scheduled") {
    const status: AppointmentStatusChangedEvent = {
      kind: "AppointmentStatusChanged",
      clinicId,
      bridgeSource: source,
      pvsExternalEventId: `${source}:appointment:${a.id}:status:${a.status}:${occurredAt}`,
      occurredAt,
      pvsPatientId,
      pvsAppointmentId: a.id,
      newStatus,
    };
    events.push(status);
  }
  return events;
}

function encounterToEvents(
  clinicId: string,
  source: BridgeSource,
  e: FhirEncounter
): CanonicalEvent[] {
  if (e.status !== "finished") return [];
  const patientRef = e.subject?.reference;
  const pvsPatientId = patientRef?.replace(/^Patient\//, "") ?? "";
  if (!pvsPatientId) return [];
  const apptRef = e.appointment?.[0]?.reference;
  const pvsAppointmentId = apptRef?.replace(/^Appointment\//, "");
  const treatment = e.type?.[0]?.coding?.[0];
  // Deterministic occurredAt (H4): the clinical end date wins; else the stable
  // meta.lastUpdated; never the wall clock, which duplicated on every webhook
  // redelivery. Reject when the resource carries neither.
  const completedAt = e.period?.end ?? e.meta?.lastUpdated;
  if (!completedAt) return [];
  const event: EncounterCompletedEvent = {
    kind: "EncounterCompleted",
    clinicId,
    bridgeSource: source,
    pvsExternalEventId: `${source}:encounter:${e.id}`,
    occurredAt: completedAt,
    pvsPatientId,
    pvsEncounterId: e.id,
    pvsAppointmentId,
    completedAt,
    treatmentCode: treatment?.code,
    treatmentLabel: treatment?.display,
  };
  return [event];
}

function invoiceToEvents(
  clinicId: string,
  source: BridgeSource,
  inv: FhirInvoice
): CanonicalEvent[] {
  if (inv.status !== "balanced") return []; // 'balanced' = paid in FHIR R4
  const patientRef = inv.subject?.reference;
  const pvsPatientId = patientRef?.replace(/^Patient\//, "") ?? "";
  if (!pvsPatientId) return [];
  const grossValue = inv.totalGross?.value ?? inv.totalNet?.value;
  if (typeof grossValue !== "number") return [];
  const amountCents = Math.round(grossValue * 100);
  // Deterministic occurredAt (H4): the invoice date wins; else the stable
  // meta.lastUpdated; never the wall clock, which duplicated on every webhook
  // redelivery. Reject when the resource carries neither.
  const paidAt = inv.date ?? inv.meta?.lastUpdated;
  if (!paidAt) return [];
  const event: InvoicePaidEvent = {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: source,
    pvsExternalEventId: `${source}:invoice:${inv.id}`,
    occurredAt: paidAt,
    pvsPatientId,
    pvsInvoiceId: inv.id,
    amountCents,
    currency: "EUR",
    paidAt,
  };
  return [event];
}

function mapGenderFhir(
  g: FhirPatient["gender"]
): "f" | "m" | "d" | "x" | undefined {
  if (!g) return undefined;
  if (g === "female") return "f";
  if (g === "male") return "m";
  if (g === "other") return "d";
  if (g === "unknown") return "x";
  return undefined;
}

function mapApptStatus(
  s: FhirAppointment["status"]
):
  | "scheduled"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled"
  | null {
  switch (s) {
    case "proposed":
    case "pending":
    case "booked":
    case "waitlist":
      return "scheduled";
    case "arrived":
    case "checked-in":
      return "checked_in";
    case "fulfilled":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "noshow":
      return "no_show";
    case "entered-in-error":
      return null;
    default:
      return null;
  }
}
