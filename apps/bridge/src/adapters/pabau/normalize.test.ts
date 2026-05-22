import { describe, it, expect } from "vitest";
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizeInvoice,
  normalizeRecall,
} from "./normalize.js";
import type {
  PabauPatient,
  PabauAppointment,
  PabauEncounter,
  PabauInvoice,
  PabauRecall,
} from "./client.js";

/**
 * Pabau normalizer coverage. Anchors on the portal-side contract from
 * Section 7 of UNIVERSAL_ADAPTER_BUILD.md and the live shape of
 * pvs-status-derive.ts. Every test verifies a non-optional field is
 * populated, because the worker silently drops events that omit them.
 */

const CLINIC = "00000000-0000-0000-0000-000000000001";

describe("pabau normalizePatient", () => {
  it("maps the documented Pabau client fields to PatientUpserted", () => {
    const input: PabauPatient = {
      id: 4711,
      email: "anna@example.com",
      mobile: "+49 1511 234567",
      first_name: "Anna",
      last_name: "Schmidt",
      dob: "1990-04-12",
      gender: "Female",
      notes: "VIP, EINS-Lead-1a2b3c4d",
      modified_at: "2026-05-21T09:00:00.000Z",
    };
    const out = normalizePatient(CLINIC, input);
    expect(out).toEqual({
      kind: "PatientUpserted",
      clinicId: CLINIC,
      bridgeSource: "pabau",
      pvsExternalEventId: "pabau:patient:4711:2026-05-21T09:00:00.000Z",
      occurredAt: "2026-05-21T09:00:00.000Z",
      pvsPatientId: "4711",
      email: "anna@example.com",
      phone: "+49 1511 234567",
      fullName: "Anna Schmidt",
      dob: "1990-04-12",
      gender: "f",
      bemerkung: "VIP, EINS-Lead-1a2b3c4d",
    });
  });

  it("falls back to `phone` when `mobile` is absent", () => {
    const input: PabauPatient = {
      id: "x9",
      phone: "01234",
      first_name: "B",
      last_name: "S",
      modified_at: "2026-05-21T09:00:00.000Z",
    };
    const out = normalizePatient(CLINIC, input);
    expect(out.phone).toBe("01234");
  });

  it("emits `gender: undefined` for unrecognised values", () => {
    const input: PabauPatient = {
      id: "1",
      gender: "rather_not_say",
      modified_at: "2026-05-21T09:00:00.000Z",
    };
    const out = normalizePatient(CLINIC, input);
    expect(out.gender).toBeUndefined();
  });
});

describe("pabau normalizeAppointment", () => {
  const base: PabauAppointment = {
    id: 51,
    client_id: 4711,
    start_time: "2026-06-01T10:00:00.000Z",
    status: "booked",
    service_id: 9,
    service_name: "Botox Stirn",
    location_id: 2,
    location_name: "Düsseldorf Mitte",
    notes: "Erstberatung",
    modified_at: "2026-05-21T09:00:00.000Z",
  };

  it("emits AppointmentCreated with all required linkage fields", () => {
    const events = normalizeAppointment(CLINIC, base);
    expect(events).toHaveLength(1);
    const created = events[0]!;
    expect(created.kind).toBe("AppointmentCreated");
    expect(created.bridgeSource).toBe("pabau");
    if (created.kind === "AppointmentCreated") {
      expect(created.pvsAppointmentId).toBe("51");
      expect(created.pvsPatientId).toBe("4711");
      expect(created.scheduledAt).toBe(base.start_time);
      expect(created.treatmentCode).toBe("9");
      expect(created.treatmentLabel).toBe("Botox Stirn");
      expect(created.locationCode).toBe("2");
      expect(created.locationLabel).toBe("Düsseldorf Mitte");
    }
  });

  it("emits StatusChanged in addition to Created when status is non-scheduled", () => {
    const events = normalizeAppointment(CLINIC, { ...base, status: "no_show" });
    expect(events).toHaveLength(2);
    const status = events[1]!;
    expect(status.kind).toBe("AppointmentStatusChanged");
    if (status.kind === "AppointmentStatusChanged") {
      expect(status.newStatus).toBe("no_show");
      expect(status.pvsAppointmentId).toBe("51");
      expect(status.changedAt).toBe(base.modified_at);
      // Multi-status dedup: id is unique per (booking, status, modifiedAt).
      expect(status.pvsExternalEventId).toContain(":status:no_show:");
    }
  });

  it("does NOT emit StatusChanged when status maps to 'scheduled'", () => {
    const events = normalizeAppointment(CLINIC, { ...base, status: "confirmed" });
    expect(events).toHaveLength(1);
  });

  it("returns [] when patient or start_time linkage is missing", () => {
    expect(
      normalizeAppointment(CLINIC, { ...base, client_id: "" as unknown as string })
    ).toEqual([]);
    expect(
      normalizeAppointment(CLINIC, { ...base, start_time: "" as unknown as string })
    ).toEqual([]);
  });

  it.each([
    ["arrived", "checked_in"],
    ["checked_in", "checked_in"],
    ["completed", "completed"],
    ["fulfilled", "completed"],
    ["cancelled", "cancelled"],
    ["canceled", "cancelled"],
    ["noshow", "no_show"],
  ] as const)(
    "maps Pabau status '%s' to canonical '%s'",
    (pabauStatus, expected) => {
      const events = normalizeAppointment(CLINIC, { ...base, status: pabauStatus });
      const status = events.find((e) => e.kind === "AppointmentStatusChanged");
      expect(status).toBeDefined();
      if (status?.kind === "AppointmentStatusChanged") {
        expect(status.newStatus).toBe(expected);
      }
    }
  );
});

describe("pabau normalizeEncounter", () => {
  it("emits EncounterCompleted with pvsAppointmentId linkage (worker requires it)", () => {
    const input: PabauEncounter = {
      id: "tn-3",
      client_id: 4711,
      booking_id: 51,
      service_id: 9,
      service_name: "Botox",
      practitioner_name: "Dr. K. Issa",
      completed_at: "2026-06-01T10:45:00.000Z",
      modified_at: "2026-06-01T10:50:00.000Z",
    };
    const out = normalizeEncounter(CLINIC, input);
    expect(out).not.toBeNull();
    expect(out!.pvsAppointmentId).toBe("51");
    expect(out!.pvsEncounterId).toBe("tn-3");
    expect(out!.completedAt).toBe(input.completed_at);
    expect(out!.practitionerLabel).toBe("Dr. K. Issa");
  });

  it("returns null when client_id missing", () => {
    const input = {
      id: "x",
      client_id: "",
      completed_at: "2026-06-01T10:45:00.000Z",
      modified_at: "2026-06-01T10:50:00.000Z",
    } as unknown as PabauEncounter;
    expect(normalizeEncounter(CLINIC, input)).toBeNull();
  });
});

describe("pabau normalizeInvoice", () => {
  const base: PabauInvoice = {
    id: 901,
    client_id: 4711,
    booking_id: 51,
    treatment_note_id: 3,
    total: 199.5,
    currency: "EUR",
    paid_at: "2026-06-01T11:00:00.000Z",
    status: "paid",
    modified_at: "2026-06-01T11:00:00.000Z",
  };

  it("converts major-unit total to integer cents", () => {
    const out = normalizeInvoice(CLINIC, base);
    expect(out).not.toBeNull();
    expect(out!.amountCents).toBe(19950);
    expect(out!.pvsAppointmentId).toBe("51");
    expect(out!.paidAt).toBe(base.paid_at);
  });

  it("accepts DACH comma decimal in string form", () => {
    const out = normalizeInvoice(CLINIC, { ...base, total: "199,50" as unknown as string });
    expect(out!.amountCents).toBe(19950);
  });

  it("prefers amount_cents when provided", () => {
    const out = normalizeInvoice(CLINIC, { ...base, total: 9999, amount_cents: 12345 });
    expect(out!.amountCents).toBe(12345);
  });

  it("emits even when only paid_at is set (status absent)", () => {
    const out = normalizeInvoice(CLINIC, { ...base, status: null });
    expect(out).not.toBeNull();
  });

  it("returns null for unpaid invoices", () => {
    const out = normalizeInvoice(CLINIC, { ...base, status: "draft", paid_at: null });
    expect(out).toBeNull();
  });

  it("returns null when amount cannot be coerced", () => {
    const out = normalizeInvoice(CLINIC, {
      ...base,
      total: null,
      total_amount: null,
      amount_cents: null,
    });
    expect(out).toBeNull();
  });
});

describe("pabau normalizeRecall", () => {
  it("emits RecallScheduled with all required fields", () => {
    const input: PabauRecall = {
      id: 7,
      client_id: 4711,
      recall_at: "2026-12-01T09:00:00.000Z",
      service_id: 9,
      service_name: "Botox Refresh",
      modified_at: "2026-06-01T11:00:00.000Z",
    };
    const out = normalizeRecall(CLINIC, input);
    expect(out).not.toBeNull();
    expect(out!.kind).toBe("RecallScheduled");
    expect(out!.pvsRecallId).toBe("7");
    expect(out!.pvsPatientId).toBe("4711");
    expect(out!.recallAt).toBe(input.recall_at);
    expect(out!.treatmentLabel).toBe("Botox Refresh");
  });

  it("returns null when recall_at missing", () => {
    const input = {
      id: 7,
      client_id: 4711,
      recall_at: "",
      modified_at: "2026-06-01T11:00:00.000Z",
    } as unknown as PabauRecall;
    expect(normalizeRecall(CLINIC, input)).toBeNull();
  });
});
