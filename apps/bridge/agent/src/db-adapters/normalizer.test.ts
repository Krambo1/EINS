import { describe, it, expect } from "vitest";
import { normalizeRow, applyTransform, _internal } from "./normalizer.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type { StreamConfig, VendorConfig } from "./types.js";

const PATIENT_YAML = `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: PatientUpserted
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, vorname, nachname, email, telefon, geburtsdatum,
             geschlecht, kommentar, modified_at
      FROM patient WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:patient:{id}:{modified_at}" }
      occurredAt: { from: modified_at, transform: isoDateTime }
      pvsPatientId: id
      fullName: { template: "{vorname} {nachname}" }
      email: { from: email, transform: lowerEmail }
      phone: { from: telefon, transform: phone }
      dob: { from: geburtsdatum, transform: isoDate }
      gender: { from: geschlecht, transform: gender }
      bemerkung: { from: kommentar, transform: bemerkung }
`;

const APPT_YAML = `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:appointment:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

async function load(yaml: string): Promise<{ vendor: VendorConfig; stream: StreamConfig }> {
  const vendor = await loadVendorConfigFromString(yaml, "test.yaml");
  return { vendor, stream: vendor.streams[0] };
}

describe("normalizer: direct column", () => {
  it("emits PatientUpserted with verbatim and templated fields", async () => {
    const { vendor, stream } = await load(PATIENT_YAML);
    const row = {
      id: "PAT-42",
      vorname: "Maria",
      nachname: "Müller",
      email: "Maria.Mueller@PRAXIS.de",
      telefon: "+49 30 12345",
      geburtsdatum: "1980-06-15",
      geschlecht: "w",
      kommentar: "EINS-Lead-ab12cd34",
      modified_at: new Date("2026-05-20T10:00:00Z"),
    };
    const event = normalizeRow(row, {
      clinicId: "11111111-1111-1111-1111-111111111111",
      vendor,
      stream,
    });
    expect(event).not.toBeNull();
    expect(event!.kind).toBe("PatientUpserted");
    expect(event!.clinicId).toBe("11111111-1111-1111-1111-111111111111");
    expect(event!.bridgeSource).toBe("tomedo");
    expect(event!.pvsExternalEventId).toBe(
      "tomedo:patient:PAT-42:2026-05-20T10:00:00.000Z"
    );
    expect(event!.occurredAt).toBe("2026-05-20T10:00:00.000Z");
    expect(event!.pvsPatientId).toBe("PAT-42");
    expect(event!.fullName).toBe("Maria Müller");
    expect(event!.email).toBe("maria.mueller@praxis.de");
    expect(event!.gender).toBe("f");
    expect(event!.bemerkung).toBe("EINS-Lead-ab12cd34");
  });

  it("drops half-NULL template fields cleanly", async () => {
    const { vendor, stream } = await load(PATIENT_YAML);
    const row = {
      id: "PAT-9",
      vorname: null,
      nachname: "Bauer",
      email: "",
      telefon: "",
      geburtsdatum: null,
      geschlecht: null,
      kommentar: null,
      modified_at: "2026-05-20T10:00:00Z",
    };
    const event = normalizeRow(row, {
      clinicId: "c",
      vendor,
      stream,
    });
    expect(event).not.toBeNull();
    expect(event!.fullName).toBe("Bauer");
    expect(event!.email).toBeUndefined();
    expect(event!.dob).toBeUndefined();
    expect(event!.gender).toBeUndefined();
  });

  it("returns null when occurredAt cannot be resolved", async () => {
    const { vendor, stream } = await load(APPT_YAML);
    const row = {
      id: "APPT-1",
      patient_id: "PAT-1",
      termin_zeit: null,
      modified_at: "2026-05-20T10:00:00Z",
    };
    const event = normalizeRow(row, { clinicId: "c", vendor, stream });
    expect(event).toBeNull();
  });
});

describe("transforms", () => {
  it("gender maps German + numeric codes", () => {
    expect(applyTransform("gender", "w")).toBe("f");
    expect(applyTransform("gender", "weiblich")).toBe("f");
    expect(applyTransform("gender", "M")).toBe("m");
    expect(applyTransform("gender", "1")).toBe("m");
    expect(applyTransform("gender", "2")).toBe("f");
    expect(applyTransform("gender", "3")).toBe("d");
    expect(applyTransform("gender", "")).toBeUndefined();
    expect(applyTransform("gender", null)).toBeUndefined();
  });

  it("appointmentStatus normalises German + English", () => {
    expect(applyTransform("appointmentStatus", "abgesagt")).toBe("cancelled");
    expect(applyTransform("appointmentStatus", "no_show")).toBe("no_show");
    expect(applyTransform("appointmentStatus", "Erschienen")).toBe("checked_in");
    expect(applyTransform("appointmentStatus", "behandelt")).toBe("completed");
    expect(applyTransform("appointmentStatus", "geplant")).toBe("scheduled");
    expect(applyTransform("appointmentStatus", "")).toBeUndefined();
  });

  it("amountToCents handles German comma + EUR prefix", () => {
    expect(applyTransform("amountToCents", "125,50")).toBe(12550);
    expect(applyTransform("amountToCents", "1.250,00 EUR")).toBe(125000);
    expect(applyTransform("amountToCents", "12.50")).toBe(1250);
    expect(applyTransform("amountToCents", 12.5)).toBe(1250);
    expect(applyTransform("amountToCents", "garbage")).toBeUndefined();
  });

  it("amountToCents reads a lone 3-digit group as thousands, not a fraction (finding 7)", () => {
    // The old parser read these as EUR 1.23 etc. — a 1000x under-count.
    expect(applyTransform("amountToCents", "1.234")).toBe(123400);
    expect(applyTransform("amountToCents", "1,234")).toBe(123400);
    expect(applyTransform("amountToCents", "12.500")).toBe(1250000);
    expect(applyTransform("amountToCents", "1.234.567")).toBe(123456700);
    // Genuine fractions are still parsed as fractions:
    expect(applyTransform("amountToCents", "1.50")).toBe(150);
    expect(applyTransform("amountToCents", "1,5")).toBe(150);
    expect(applyTransform("amountToCents", "0,99")).toBe(99);
    // Negatives stay rejected.
    expect(applyTransform("amountToCents", "-5,00")).toBeUndefined();
  });

  it("integerCents passes integers through", () => {
    expect(applyTransform("integerCents", 1250)).toBe(1250);
    expect(applyTransform("integerCents", "1250")).toBe(1250);
    expect(applyTransform("integerCents", -1)).toBeUndefined();
  });

  it("isoDateTime accepts Date and strings", () => {
    expect(applyTransform("isoDateTime", new Date("2026-05-20T10:00:00Z"))).toBe(
      "2026-05-20T10:00:00.000Z"
    );
    expect(applyTransform("isoDateTime", "2026-05-20")).toBe(
      "2026-05-20T00:00:00.000Z"
    );
    expect(applyTransform("isoDateTime", "garbage")).toBeUndefined();
  });

  it("isoDate truncates timestamps", () => {
    expect(applyTransform("isoDate", new Date("2026-05-20T10:00:00Z"))).toBe(
      "2026-05-20"
    );
    expect(applyTransform("isoDate", "2026-05-20")).toBe("2026-05-20");
  });

  it("lowerEmail validates RFC-loose addresses", () => {
    expect(applyTransform("lowerEmail", "Foo.Bar@PRAXIS.de")).toBe(
      "foo.bar@praxis.de"
    );
    expect(applyTransform("lowerEmail", "not-an-email")).toBeUndefined();
  });

  it("bemerkung clamps at 4000 chars", () => {
    const long = "x".repeat(5000);
    const result = applyTransform("bemerkung", long) as string;
    expect(result.length).toBe(4000);
  });
});

describe("expandTemplate", () => {
  it("returns undefined when no placeholders resolve", () => {
    const out = _internal.expandTemplate("{a} {b}", { a: null, b: null }, []);
    expect(out).toBeUndefined();
  });
  it("warns on unknown column reference but still expands the rest", () => {
    const warnings: string[] = [];
    const out = _internal.expandTemplate("{x} {y}", { x: "ok" }, warnings);
    expect(out).toBe("ok");
    expect(warnings.some((w) => w.includes("unknown column 'y'"))).toBe(true);
  });
});

// Review finding H6: a legacy MySQL / MariaDB zero-date (0000-00-00) arrives as
// an Invalid Date under mysql2's dateStrings:false. toISOString() on one throws
// RangeError; unguarded that crashed the whole poll and (via the runner's
// swallow) hot-looped the stream every 5s. The transforms and coerceScalar now
// treat an unrepresentable Date like a NULL: the field is dropped, the row is
// not crashed.
describe("normalizer: Invalid Date (legacy zero-date) is dropped, not thrown (H6)", () => {
  const invalid = new Date(NaN);

  it("coerceScalar returns undefined for an Invalid Date", () => {
    expect(_internal.coerceScalar(invalid)).toBeUndefined();
    // A valid Date still round-trips to ISO.
    expect(_internal.coerceScalar(new Date("2026-05-20T10:00:00Z"))).toBe(
      "2026-05-20T10:00:00.000Z"
    );
  });

  it("isoDateTime returns undefined for an Invalid Date", () => {
    expect(_internal.isoDateTime(invalid)).toBeUndefined();
    expect(_internal.isoDateTime(new Date("2026-05-20T10:00:00Z"))).toBe(
      "2026-05-20T10:00:00.000Z"
    );
  });

  it("isoDate returns undefined for an Invalid Date", () => {
    expect(_internal.isoDate(invalid)).toBeUndefined();
    expect(_internal.isoDate(new Date("2026-05-20T10:00:00Z"))).toBe(
      "2026-05-20"
    );
  });
});
