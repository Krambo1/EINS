import { describe, it, expect } from "vitest";
import {
  normalizePatient,
  normalizeAppointment,
  normalizeEncounter,
  normalizeInvoice,
  normalizeRecall,
} from "./normalize.js";
import { isoUtc, tomedoEventId } from "./event-identity.js";

describe("tomedo normalize", () => {
  it("maps a patient row to PatientUpserted", () => {
    const ev = normalizePatient("clinic-1", {
      id: "P1",
      modifiedAt: "2026-01-02T03:04:05.000Z",
      email: "A@B.de",
      firstName: "Anna",
      lastName: "Beispiel",
    });
    expect(ev.kind).toBe("PatientUpserted");
    expect(ev.pvsExternalEventId).toBe("tomedo:patient:P1:2026-01-02T03:04:05.000Z");
    expect(ev.occurredAt).toBe("2026-01-02T03:04:05.000Z");
    expect(ev.pvsPatientId).toBe("P1");
    expect(ev.email).toBe("A@B.de");
    expect(ev.fullName).toBe("Anna Beispiel");
  });

  it("maps an invoice row to InvoicePaid", () => {
    const ev = normalizeInvoice("clinic-1", {
      id: "R1",
      patientId: "P1",
      appointmentId: "A1",
      amountCents: 12500,
      paidAt: "2026-01-02T03:04:05.000Z",
    });
    expect(ev.kind).toBe("InvoicePaid");
    expect(ev.pvsExternalEventId).toBe("tomedo:invoice:R1");
    expect(ev.occurredAt).toBe("2026-01-02T03:04:05.000Z");
    expect(ev.amountCents).toBe(12500);
    expect(ev.currency).toBe("EUR");
  });
});

/**
 * Cross-path dedup contract (Phase 11).
 *
 * Proves the REST adapter produces the canonical (pvsExternalEventId,
 * occurredAt) tuple defined in event-identity.ts. The DB-read side is proven by
 * apps/bridge/agent/src/db-adapters/cross-path-dedup.test.ts against the SAME
 * fixed fixture and the SAME literal expectations, so both paths emit identical
 * tuples for the same Tomedo row and the portal's unique index collapses them.
 *
 * If you change an id template or an occurred_at source on one side, update
 * event-identity.ts and BOTH tests together, or the paths silently stop
 * deduping.
 */
const FIXTURE = {
  // The single Tomedo row, expressed once. The agent test feeds the same
  // logical values (as DB columns) and must derive the same canonical tuple.
  modifiedAt: "2026-01-02T03:04:05.000Z",
  scheduledAt: "2026-03-04T09:00:00.000Z",
  completedAt: "2026-03-04T09:30:00.000Z",
  paidAt: "2026-03-05T11:22:33.000Z",
  recallAt: "2026-09-01T08:00:00.000Z",
};

describe("tomedo cross-path dedup contract (REST side)", () => {
  it("PatientUpserted matches the canonical tuple", () => {
    const ev = normalizePatient("c", { id: "P1", modifiedAt: FIXTURE.modifiedAt });
    expect(ev.bridgeSource).toBe("tomedo");
    expect(ev.pvsExternalEventId).toBe(
      tomedoEventId.patient("P1", FIXTURE.modifiedAt)
    );
    expect(ev.pvsExternalEventId).toBe(`tomedo:patient:P1:${FIXTURE.modifiedAt}`);
    expect(ev.occurredAt).toBe(FIXTURE.modifiedAt);
  });

  it("AppointmentCreated matches the canonical tuple", () => {
    const ev = normalizeAppointment("c", {
      id: "A1",
      patientId: "P1",
      scheduledAt: FIXTURE.scheduledAt,
    });
    expect(ev.pvsExternalEventId).toBe(tomedoEventId.appointment("A1"));
    expect(ev.pvsExternalEventId).toBe("tomedo:appointment:A1");
    expect(ev.occurredAt).toBe(FIXTURE.scheduledAt);
  });

  it("EncounterCompleted matches the canonical tuple", () => {
    const ev = normalizeEncounter("c", {
      id: "E1",
      patientId: "P1",
      appointmentId: "A1",
      completedAt: FIXTURE.completedAt,
    });
    expect(ev.pvsExternalEventId).toBe(tomedoEventId.encounter("E1"));
    expect(ev.pvsExternalEventId).toBe("tomedo:encounter:E1");
    expect(ev.occurredAt).toBe(FIXTURE.completedAt);
  });

  it("InvoicePaid matches the canonical tuple", () => {
    const ev = normalizeInvoice("c", {
      id: "R1",
      patientId: "P1",
      appointmentId: "A1",
      amountCents: 12500,
      paidAt: FIXTURE.paidAt,
    });
    expect(ev.pvsExternalEventId).toBe(tomedoEventId.invoice("R1"));
    expect(ev.pvsExternalEventId).toBe("tomedo:invoice:R1");
    expect(ev.occurredAt).toBe(FIXTURE.paidAt);
  });

  it("RecallScheduled uses modifiedAt for occurredAt (matches DB-read), recallAt is the target", () => {
    const ev = normalizeRecall("c", {
      id: "RC1",
      patientId: "P1",
      modifiedAt: FIXTURE.modifiedAt,
      recallAt: FIXTURE.recallAt,
    });
    expect(ev.pvsExternalEventId).toBe(tomedoEventId.recall("RC1"));
    expect(ev.pvsExternalEventId).toBe("tomedo:recall:RC1");
    expect(ev.occurredAt).toBe(FIXTURE.modifiedAt);
    expect(ev.recallAt).toBe(FIXTURE.recallAt);
  });
});

describe("tomedo timestamp normalisation (isoUtc)", () => {
  it("normalises non-canonical inputs so they match the DB-read toISOString output", () => {
    // Second-precision Z, +00:00 offset, and a non-UTC offset all collapse to
    // the same canonical ms-precision UTC string the DB-read path emits.
    expect(isoUtc("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05.000Z");
    expect(isoUtc("2026-01-02T03:04:05+00:00")).toBe("2026-01-02T03:04:05.000Z");
    expect(isoUtc("2026-01-02T04:04:05+01:00")).toBe("2026-01-02T03:04:05.000Z");
  });

  it("an unparseable timestamp passes through unchanged (portal Zod surfaces it)", () => {
    expect(isoUtc("not-a-date")).toBe("not-a-date");
    expect(isoUtc("")).toBe("");
  });

  it("the REST adapter applies isoUtc so a coarse API timestamp still dedups", () => {
    // Same logical instant as FIXTURE.paidAt but second-precision from the API.
    const ev = normalizeInvoice("c", {
      id: "R1",
      patientId: "P1",
      appointmentId: "A1",
      amountCents: 100,
      paidAt: "2026-03-05T11:22:33Z",
    });
    expect(ev.occurredAt).toBe(FIXTURE.paidAt);
    expect(ev.paidAt).toBe(FIXTURE.paidAt);
  });
});
