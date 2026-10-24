import { describe, it, expect } from "vitest";
import { sanitizeEvent, sanitizeEvents } from "./sanitize.js";
import { PvsEventMirror } from "./portal-schema.js";
import type { CanonicalEvent } from "./types.js";
import { normalizePatient as pabauPatient, normalizeInvoice as pabauInvoice } from "../adapters/pabau/normalize.js";
import { normalizeInvoice as tomedoInvoice, normalizePatient as tomedoPatient } from "../adapters/tomedo/normalize.js";

/**
 * Regression for defect 2 (one permanently-rejected event froze a practice):
 * these are the exact realistic vendor values the reviewer reproduced as
 * rejected by the portal Zod. After sanitising, every one must either pass the
 * portal schema or be dropped (never sent).
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
const T = "2026-10-01T10:00:00Z";

function patient(over: Record<string, unknown> = {}): CanonicalEvent {
  return {
    kind: "PatientUpserted",
    clinicId: CLINIC,
    bridgeSource: "pabau",
    pvsExternalEventId: "pabau:patient:1:x",
    occurredAt: "2026-10-01T10:00:00.000Z",
    pvsPatientId: "1",
    ...over,
  } as CanonicalEvent;
}

function ok(e: CanonicalEvent): Record<string, unknown> {
  const r = sanitizeEvent(e);
  if (!("event" in r)) throw new Error(`dropped: ${r.drop}`);
  expect(PvsEventMirror.safeParse(r.event).success).toBe(true);
  return r.event as unknown as Record<string, unknown>;
}

describe("optional patient fields", () => {
  it("'' / whitespace / n/a / - become undefined and keys disappear", () => {
    for (const v of ["", "   ", "n/a", "N/A", "-", "--", "null"]) {
      const e = ok(patient({ email: v, phone: v, fullName: v, bemerkung: v, dob: v }));
      expect(e).not.toHaveProperty("email");
      expect(e).not.toHaveProperty("phone");
      expect(e).not.toHaveProperty("fullName");
      expect(e).not.toHaveProperty("bemerkung");
      expect(e).not.toHaveProperty("dob");
    }
  });

  it("an invalid email is dropped to undefined, a valid one is kept", () => {
    expect(ok(patient({ email: "not an email" }))).not.toHaveProperty("email");
    expect(ok(patient({ email: "a@b" }))).not.toHaveProperty("email");
    expect(ok(patient({ email: "  Anna@Example.de " })).email).toBe("Anna@Example.de");
  });

  it("dob: only YYYY-MM-DD; an ISO datetime is cut to its date; garbage and impossible dates vanish", () => {
    expect(ok(patient({ dob: "1980-05-12" })).dob).toBe("1980-05-12");
    expect(ok(patient({ dob: "1980-05-12T00:00:00Z" })).dob).toBe("1980-05-12");
    expect(ok(patient({ dob: "12.05.1980" })).dob).toBe("1980-05-12");
    expect(ok(patient({ dob: "1980-13-40" }))).not.toHaveProperty("dob");
    expect(ok(patient({ dob: "yesterday" }))).not.toHaveProperty("dob");
  });

  it("truncates to the portal limits (name 200, phone 64); long notes no longer go out at all", () => {
    const e = ok(patient({ bemerkung: "x".repeat(5000), fullName: "n".repeat(300), phone: "1".repeat(100) }));
    // bemerkung is reduced to the EINS-Lead token (see sanitize.findings.test.ts); free text is omitted.
    expect(e).not.toHaveProperty("bemerkung");
    expect((e.fullName as string).length).toBe(200);
    expect((e.phone as string).length).toBe(64);
  });

  it("an unknown gender is dropped, a known one kept", () => {
    expect(ok(patient({ gender: "unbekannt" }))).not.toHaveProperty("gender");
    expect(ok(patient({ gender: "f" })).gender).toBe("f");
  });

  it("never splits a surrogate pair when truncating", () => {
    const e = ok(patient({ fullName: "a".repeat(199) + "\u{1F600}" }));
    const s = e.fullName as string;
    expect(s.length).toBe(199);
  });
});

describe("required fields drop the event with a value-free reason", () => {
  it("missing/invalid occurredAt, ids and datetimes", () => {
    for (const bad of [
      patient({ occurredAt: "" }),
      patient({ occurredAt: "not-a-date" }),
      patient({ occurredAt: "1" }),
      patient({ pvsPatientId: "" }),
      patient({ pvsExternalEventId: "x".repeat(201) }),
    ]) {
      const r = sanitizeEvent(bad);
      expect("drop" in r).toBe(true);
    }
  });

  it("an InvoicePaid without a valid paidAt is not an InvoicePaid", () => {
    const base = {
      kind: "InvoicePaid",
      clinicId: CLINIC,
      bridgeSource: "tomedo",
      pvsExternalEventId: "i1",
      occurredAt: "",
      pvsPatientId: "p",
      pvsInvoiceId: "i",
      amountCents: 5000,
      paidAt: "",
    } as unknown as CanonicalEvent;
    const r = sanitizeEvent(base);
    expect(r).toEqual({ drop: expect.stringMatching(/^InvoicePaid:(occurredAt|paidAt)$/) });
  });

  it("amounts: rounds a fractional value, drops negatives and > 1,000,000.00", () => {
    const inv = (amountCents: number) =>
      ({
        kind: "InvoicePaid",
        clinicId: CLINIC,
        bridgeSource: "pabau",
        pvsExternalEventId: "i1",
        occurredAt: T,
        pvsPatientId: "p",
        pvsInvoiceId: "i",
        amountCents,
        paidAt: T,
      }) as unknown as CanonicalEvent;
    expect(ok(inv(1234.6)).amountCents).toBe(1235);
    expect(sanitizeEvent(inv(-1))).toEqual({ drop: "InvoicePaid:amountCents" });
    expect(sanitizeEvent(inv(100_000_001))).toEqual({ drop: "InvoicePaid:amountCents" });
    expect(sanitizeEvent(inv(Number.NaN))).toEqual({ drop: "InvoicePaid:amountCents" });
  });

  it("csv_upload (reserved for the portal's own worker) and unknown kinds are dropped", () => {
    expect("drop" in sanitizeEvent(patient({ bridgeSource: "csv_upload" }))).toBe(true);
    expect("drop" in sanitizeEvent({ kind: "Nope" } as unknown as CanonicalEvent)).toBe(true);
  });

  it("the drop reason names kind and field only, never a value", () => {
    const r = sanitizeEvent(patient({ pvsPatientId: "SECRET-PATIENT-ID-" + "x".repeat(300) }));
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });
});

describe("the reviewer's reproduced poison events (normalizer output)", () => {
  const cases: Array<[string, CanonicalEvent | null]> = [
    ["pabau patient email ''", pabauPatient(CLINIC, { id: 1, email: "", first_name: "A", last_name: "B", modified_at: T } as never)],
    ["pabau patient email 'n/a'", pabauPatient(CLINIC, { id: 2, email: "n/a", modified_at: T } as never)],
    ["pabau patient dob ''", pabauPatient(CLINIC, { id: 3, dob: "", modified_at: T } as never)],
    ["pabau patient dob ISO datetime", pabauPatient(CLINIC, { id: 4, dob: "1980-05-12T00:00:00Z", modified_at: T } as never)],
    ["pabau patient notes > 4000", pabauPatient(CLINIC, { id: 5, notes: "x".repeat(4001), modified_at: T } as never)],
    ["pabau paid invoice paid_at ''", pabauInvoice(CLINIC, { id: 6, client_id: 1, total: 100, status: "paid", paid_at: "", modified_at: T } as never)],
    ["tomedo patient empty email", tomedoPatient(CLINIC, { id: "p1", email: "", firstName: "A", lastName: "B", modifiedAt: T })],
  ];
  for (const [label, ev] of cases) {
    it(`${label}: portal-valid after sanitising`, () => {
      expect(ev).not.toBeNull();
      ok(ev!);
    });
  }

  it("tomedo UNPAID invoice is skipped by the normalizer itself", () => {
    expect(tomedoInvoice(CLINIC, { id: "i1", patientId: "p1", amountCents: 5000, modifiedAt: T })).toBeNull();
  });

  it("a bad event no longer poisons its batch: only it is dropped", () => {
    const good = Array.from({ length: 499 }, (_, i) =>
      pabauPatient(CLINIC, { id: 1000 + i, email: `p${i}@example.de`, modified_at: T } as never)
    );
    const bad = pabauPatient(CLINIC, { id: 9, email: "", modified_at: T } as never);
    const out = sanitizeEvents([...good, bad]);
    expect(out.events).toHaveLength(500);
    expect(out.dropped).toBe(0); // the bad one was repairable
    const worse = sanitizeEvents([...good, { ...bad, pvsPatientId: "" } as CanonicalEvent]);
    expect(worse.events).toHaveLength(499);
    expect(worse.dropped).toBe(1);
    expect(worse.droppedByReason).toEqual({ "PatientUpserted:pvsPatientId": 1 });
  });
});
