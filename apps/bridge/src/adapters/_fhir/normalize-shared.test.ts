import { describe, it, expect } from "vitest";
import { decodeFhirBundle, type FhirBundle } from "./normalize-shared.js";

/**
 * H4 coverage for the shared FHIR translator: occurredAt must be deterministic
 * across webhook redeliveries. The wall-clock fallbacks that duplicated every
 * redelivery are gone; a stable clinical/business date wins, else the resource's
 * meta.lastUpdated, else the resource is rejected (no fabricated identity).
 */

const CLINIC = "00000000-0000-0000-0000-000000000001";

function bundle(...resources: Record<string, unknown>[]): FhirBundle {
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: resources.map((resource) => ({ resource: resource as never })),
  };
}

describe("fhir normalize-shared: Patient occurredAt (H4)", () => {
  it("uses meta.lastUpdated when the Patient carries no clinical date", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({
        resourceType: "Patient",
        id: "P1",
        name: [{ given: ["Maria"], family: "Müller" }],
        meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("PatientUpserted");
    expect(events[0].occurredAt).toBe("2026-07-10T12:00:00.000Z");
    // The id scheme embeds occurredAt and stays unchanged.
    expect(events[0].pvsExternalEventId).toBe(
      "healthhub:patient:P1:2026-07-10T12:00:00.000Z"
    );
  });

  it("is redelivery-stable: decoding the same Patient twice yields identical events", () => {
    const p: Record<string, unknown> = {
      resourceType: "Patient",
      id: "P1",
      meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
    };
    const first = decodeFhirBundle(CLINIC, "healthhub", bundle(p));
    const realNow = Date.now;
    Date.now = () => realNow() + 3_600_000;
    try {
      const second = decodeFhirBundle(CLINIC, "healthhub", bundle(p));
      expect(second).toEqual(first);
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects a Patient with neither a clinical date nor meta.lastUpdated", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({ resourceType: "Patient", id: "P1" })
    );
    expect(events).toEqual([]);
  });
});

describe("fhir normalize-shared: Encounter occurredAt (H4)", () => {
  const base = {
    resourceType: "Encounter",
    id: "E1",
    status: "finished",
    subject: { reference: "Patient/P1" },
  };

  it("prefers the clinical period.end over meta.lastUpdated", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({
        ...base,
        period: { end: "2026-06-01T09:30:00.000Z" },
        meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt).toBe("2026-06-01T09:30:00.000Z");
  });

  it("falls back to meta.lastUpdated when period.end is absent", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({ ...base, meta: { lastUpdated: "2026-07-10T12:00:00.000Z" } })
    );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt).toBe("2026-07-10T12:00:00.000Z");
  });

  it("rejects a finished Encounter with neither period.end nor meta.lastUpdated", () => {
    const events = decodeFhirBundle(CLINIC, "healthhub", bundle(base));
    expect(events).toEqual([]);
  });
});

describe("fhir normalize-shared: Invoice occurredAt (H4)", () => {
  const base = {
    resourceType: "Invoice",
    id: "INV1",
    status: "balanced",
    subject: { reference: "Patient/P1" },
    totalGross: { value: 350, currency: "EUR" },
  };

  it("prefers the invoice date over meta.lastUpdated", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({
        ...base,
        date: "2026-05-19T00:00:00.000Z",
        meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      })
    );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt).toBe("2026-05-19T00:00:00.000Z");
    expect((events[0] as { amountCents: number }).amountCents).toBe(35000);
  });

  it("falls back to meta.lastUpdated when date is absent", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({ ...base, meta: { lastUpdated: "2026-07-10T12:00:00.000Z" } })
    );
    expect(events).toHaveLength(1);
    expect(events[0].occurredAt).toBe("2026-07-10T12:00:00.000Z");
  });

  it("rejects a balanced Invoice with neither date nor meta.lastUpdated", () => {
    const events = decodeFhirBundle(CLINIC, "healthhub", bundle(base));
    expect(events).toEqual([]);
  });
});

describe("fhir normalize-shared: Appointment occurredAt (H4 accepted reschedule-dup)", () => {
  it("AppointmentCreated.occurredAt is the scheduled start (no creation timestamp exists in FHIR R4)", () => {
    const events = decodeFhirBundle(
      CLINIC,
      "healthhub",
      bundle({
        resourceType: "Appointment",
        id: "A1",
        status: "booked",
        start: "2026-06-01T10:00:00.000Z",
        participant: [{ actor: { reference: "Patient/P1" } }],
        meta: { lastUpdated: "2026-07-10T12:00:00.000Z" },
      })
    );
    const created = events.find((e) => e.kind === "AppointmentCreated");
    expect(created).toBeDefined();
    expect(created!.occurredAt).toBe("2026-06-01T10:00:00.000Z");
    // Id scheme carries no timestamp and is unchanged.
    expect(created!.pvsExternalEventId).toBe("healthhub:appointment:A1");
  });
});
