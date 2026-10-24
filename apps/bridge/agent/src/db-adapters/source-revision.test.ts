import { describe, expect, it } from "vitest";
import { normalizeRow } from "./normalizer.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import { domainNowMs } from "./time-utils.js";

/**
 * Pass 2: DB invoice / refund events carry the row's modified_at as
 * sourceRevision (epoch ms), so derive keeps the newest version of a row even
 * when an older version arrives later (dead-letter requeue, retry) or the
 * correction moved the payment date earlier.
 */
const YAML = (kind: "InvoicePaid" | "InvoiceRefunded" | "PatientUpserted", cursorType = "timestamp") => {
  const map =
    kind === "InvoicePaid"
      ? `      pvsExternalEventId: { template: "tomedo:invoice:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      pvsAppointmentId: termin_id
      paidAt: { from: bezahlt_am, transform: isoDateTime }
      amountCents: { from: betrag, transform: amountToCents }`
      : kind === "InvoiceRefunded"
        ? `      pvsExternalEventId: { template: "tomedo:refund:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      refundedAmountCents: { from: betrag, transform: absAmountToCents }
      refundedAt: { from: bezahlt_am, transform: isoDateTime }`
        : `      pvsExternalEventId: { template: "tomedo:patient:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id`;
  return `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: ${kind}
    cursorColumn: modified_at
    cursorType: ${cursorType}
    query: |
      SELECT id, betrag, bezahlt_am, patient_id, termin_id, modified_at FROM rechnung
      WHERE modified_at > :cursor LIMIT :limit
    map:
${map}
`;
};

const row = (modifiedAt: unknown, betrag = "125.00") => ({
  id: "R-1",
  betrag,
  bezahlt_am: "2026-05-20T10:00:00Z",
  patient_id: "p",
  termin_id: "t",
  modified_at: modifiedAt,
});

async function normalize(
  kind: Parameters<typeof YAML>[0],
  r: Record<string, unknown>,
  cursorType = "timestamp"
) {
  const vendor = await loadVendorConfigFromString(YAML(kind, cursorType), "t.yaml");
  return normalizeRow(r, { clinicId: "c", vendor, stream: vendor.streams[0] });
}

describe("pass 2: DB invoice events carry modified_at as sourceRevision", () => {
  it("InvoicePaid: integer epoch ms, higher for a later modified_at", async () => {
    const a = await normalize("InvoicePaid", row(new Date("2026-05-20T10:00:00Z")));
    const b = await normalize("InvoicePaid", row(new Date("2026-05-21T10:00:00Z"), "99.00"));
    expect(Number.isSafeInteger(a!.sourceRevision)).toBe(true);
    expect(a!.sourceRevision).toBeGreaterThan(0);
    expect(b!.sourceRevision as number).toBeGreaterThan(a!.sourceRevision as number);
  });

  it("InvoiceRefunded carries it too", async () => {
    const ev = await normalize("InvoiceRefunded", row(new Date("2026-05-20T10:00:00Z"), "-50.00"));
    expect(Number.isSafeInteger(ev!.sourceRevision)).toBe(true);
  });

  it("a bare touch (only modified_at changed) keeps the event id, so it dedups", async () => {
    const a = await normalize("InvoicePaid", row(new Date("2026-05-20T10:00:00Z")));
    const b = await normalize("InvoicePaid", row(new Date("2026-05-22T10:00:00Z")));
    expect(b!.pvsExternalEventId).toBe(a!.pvsExternalEventId);
    // a real change still gets a new id
    const c = await normalize("InvoicePaid", row(new Date("2026-05-22T10:00:00Z"), "99.00"));
    expect(c!.pvsExternalEventId).not.toBe(a!.pvsExternalEventId);
  });

  it("is not emitted on other kinds", async () => {
    const ev = await normalize("PatientUpserted", row(new Date("2026-05-20T10:00:00Z")));
    expect(ev).not.toBeNull();
    expect("sourceRevision" in ev!).toBe(false);
  });

  it("is omitted for a sentinel / pre-1970 / unparseable modified_at (portal rejects negatives)", async () => {
    for (const bad of [new Date("9999-12-31T00:00:00Z"), new Date("1899-12-30T00:00:00Z"), null, "kaputt"]) {
      const ev = await normalize("InvoicePaid", row(bad));
      expect(ev).not.toBeNull();
      expect("sourceRevision" in ev!).toBe(false);
    }
  });

  it("is omitted when the cursor is not a timestamp", async () => {
    const ev = await normalize("InvoicePaid", { ...row(null), modified_at: 4711 }, "integer");
    expect(ev).not.toBeNull();
    expect("sourceRevision" in ev!).toBe(false);
  });
});

describe("pass 2 (verifier): a recent row keeps its revision under a Berlin wall-clock cursor", () => {
  it("modified_at 30 minutes ago in the DB's own (Berlin) clock is not treated as future", async () => {
    // The driver hands a zone-less Berlin wall clock over as if it were UTC,
    // so it reads 1-2 h ahead of the real now. Comparing it with the real
    // Date.now() dropped the revision of every row from the last ~2 hours,
    // which is every row a normal poll reads.
    const recent = new Date(domainNowMs(Date.now() - 30 * 60_000, "native", "Europe/Berlin"));
    const ev = await normalize("InvoicePaid", row(recent));
    expect(ev).not.toBeNull();
    expect(ev!.sourceRevision).toBe(recent.getTime());
  });
});
