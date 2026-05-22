import { describe, it, expect } from "vitest";
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizePayment,
  normalizeRecall,
} from "./normalize.js";
import type {
  ConsentzClient_Patient,
  ConsentzAppointment,
  ConsentzTreatmentNote,
  ConsentzPayment,
  ConsentzRecall,
} from "./client.js";

const CLINIC = "00000000-0000-0000-0000-000000000002";

describe("consentz normalizePatient", () => {
  it("maps the Consentz client envelope into PatientUpserted", () => {
    const input: ConsentzClient_Patient = {
      id: "c-12",
      email: "lena@example.com",
      mobile: "+44 7700 900000",
      first_name: "Lena",
      last_name: "Hoffmann",
      date_of_birth: "1985-09-04",
      gender: "Female",
      notes: "Followup needed",
      updated_at: "2026-05-21T10:00:00.000Z",
    };
    const out = normalizePatient(CLINIC, input);
    expect(out.kind).toBe("PatientUpserted");
    expect(out.bridgeSource).toBe("consentz");
    expect(out.pvsPatientId).toBe("c-12");
    expect(out.email).toBe("lena@example.com");
    expect(out.phone).toBe("+44 7700 900000");
    expect(out.fullName).toBe("Lena Hoffmann");
    expect(out.dob).toBe("1985-09-04");
    expect(out.gender).toBe("f");
    expect(out.bemerkung).toBe("Followup needed");
  });
});

describe("consentz normalizeAppointment", () => {
  const base: ConsentzAppointment = {
    id: "appt-1",
    client_id: "c-12",
    scheduled_at: "2026-06-15T13:30:00.000Z",
    status: "scheduled",
    treatment_id: "tx-42",
    treatment_name: "Hyaluron Lippe",
    location_id: "loc-1",
    location_name: "Berlin",
    practitioner_name: "Dr. M.",
    notes: "Erstbehandlung",
    updated_at: "2026-05-21T10:00:00.000Z",
  };

  it("emits AppointmentCreated with required linkage", () => {
    const events = normalizeAppointment(CLINIC, base);
    expect(events).toHaveLength(1);
    const created = events[0]!;
    expect(created.kind).toBe("AppointmentCreated");
    if (created.kind === "AppointmentCreated") {
      expect(created.pvsAppointmentId).toBe("appt-1");
      expect(created.pvsPatientId).toBe("c-12");
      expect(created.scheduledAt).toBe(base.scheduled_at);
      expect(created.treatmentCode).toBe("tx-42");
    }
  });

  it("emits StatusChanged when Consentz reports a terminal state", () => {
    const events = normalizeAppointment(CLINIC, { ...base, status: "cancelled" });
    expect(events).toHaveLength(2);
    const status = events[1]!;
    if (status.kind === "AppointmentStatusChanged") {
      expect(status.newStatus).toBe("cancelled");
      expect(status.pvsAppointmentId).toBe("appt-1");
    }
  });

  it("recognises 'missed' as no_show", () => {
    const events = normalizeAppointment(CLINIC, { ...base, status: "missed" });
    const status = events.find((e) => e.kind === "AppointmentStatusChanged");
    if (status?.kind === "AppointmentStatusChanged") {
      expect(status.newStatus).toBe("no_show");
    }
  });
});

describe("consentz normalizeEncounter", () => {
  it("emits EncounterCompleted with the all-important pvsAppointmentId", () => {
    const input: ConsentzTreatmentNote = {
      id: "tn-9",
      client_id: "c-12",
      appointment_id: "appt-1",
      treatment_id: "tx-42",
      treatment_name: "Hyaluron Lippe",
      practitioner_name: "Dr. M.",
      completed_at: "2026-06-15T14:00:00.000Z",
      updated_at: "2026-06-15T14:05:00.000Z",
    };
    const out = normalizeEncounter(CLINIC, input);
    expect(out).not.toBeNull();
    expect(out!.pvsAppointmentId).toBe("appt-1");
    expect(out!.pvsEncounterId).toBe("tn-9");
  });

  it("returns null when completed_at missing", () => {
    const input = {
      id: "tn-9",
      client_id: "c-12",
      appointment_id: "appt-1",
      completed_at: "",
      updated_at: "2026-06-15T14:05:00.000Z",
    } as unknown as ConsentzTreatmentNote;
    expect(normalizeEncounter(CLINIC, input)).toBeNull();
  });
});

describe("consentz normalizePayment", () => {
  const base: ConsentzPayment = {
    id: "pay-1",
    client_id: "c-12",
    appointment_id: "appt-1",
    treatment_note_id: "tn-9",
    amount: 350,
    currency: "EUR",
    paid_at: "2026-06-15T14:30:00.000Z",
    status: "paid",
    updated_at: "2026-06-15T14:30:00.000Z",
  };

  it("converts amount to integer cents", () => {
    const out = normalizePayment(CLINIC, base);
    expect(out).not.toBeNull();
    expect(out!.amountCents).toBe(35000);
    expect(out!.pvsAppointmentId).toBe("appt-1");
  });

  it("accepts 'succeeded' and 'settled' status values", () => {
    expect(normalizePayment(CLINIC, { ...base, status: "succeeded" })).not.toBeNull();
    expect(normalizePayment(CLINIC, { ...base, status: "settled" })).not.toBeNull();
  });

  it("returns null on unpaid status with no paid_at", () => {
    const out = normalizePayment(CLINIC, {
      ...base,
      status: "pending",
      paid_at: null,
    });
    expect(out).toBeNull();
  });

  it("prefers amount_cents when both fields present", () => {
    const out = normalizePayment(CLINIC, { ...base, amount: 999, amount_cents: 12345 });
    expect(out!.amountCents).toBe(12345);
  });
});

describe("consentz normalizeRecall", () => {
  it("emits RecallScheduled with all required fields", () => {
    const input: ConsentzRecall = {
      id: "r-1",
      client_id: "c-12",
      recall_at: "2027-01-15T09:00:00.000Z",
      treatment_id: "tx-42",
      treatment_name: "Refresh",
      updated_at: "2026-06-15T14:30:00.000Z",
    };
    const out = normalizeRecall(CLINIC, input);
    expect(out).not.toBeNull();
    expect(out!.pvsRecallId).toBe("r-1");
    expect(out!.recallAt).toBe(input.recall_at);
  });
});
