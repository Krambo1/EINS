import { describe, expect, it } from "vitest";
import { _internal, normalizeRow } from "./normalizer.js";
import { loadVendorConfigFromString } from "./vendor-config.js";

const PATIENT_YAML = `
vendor: tomedo-db
driver: firebird
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
      SELECT id, vorname, kommentar, modified_at FROM patient
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:patient:{id}:{modified_at}" }
      occurredAt: { from: modified_at, transform: isoDateTime }
      pvsPatientId: id
      fullName: vorname
      bemerkung: { from: kommentar, transform: bemerkung }
`;

describe("finding 3: function-valued cells (lazy Firebird blobs)", () => {
  it("coerceScalar maps any function to null", () => {
    expect(_internal.coerceScalar(() => 1)).toBeNull();
    expect(_internal.coerceScalar(function lazyBlob() { return "x"; })).toBeNull();
  });

  it("clampBemerkung never yields JS source text", () => {
    const fn = function (cb: () => void) { cb(); };
    expect(_internal.clampBemerkung(fn)).toBeUndefined();
    const out = _internal.clampBemerkung(() => "EINS-Lead-12345678");
    expect(out === undefined || !String(out).startsWith("function")).toBe(true);
    expect(out).toBeUndefined();
  });

  it("a function in a mapped column drops the field instead of emitting source text", async () => {
    const vendor = await loadVendorConfigFromString(PATIENT_YAML, "t.yaml");
    const stream = vendor.streams[0];
    const lazy = function (cb: () => void) { cb(); };
    const event = normalizeRow(
      { id: "1", vorname: lazy, kommentar: lazy, modified_at: "2026-05-20T10:00:00Z" },
      { clinicId: "c", vendor, stream }
    );
    expect(event).not.toBeNull();
    expect(event!.bemerkung).toBeUndefined();
    expect(event!.fullName).toBeUndefined();
    expect(JSON.stringify(event)).not.toContain("function");
  });
});

describe("finding 8: driver decimal strings", () => {
  const INVOICE_YAML = (extra: string, fieldExtra = "") => `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: InvoicePaid
    cursorColumn: modified_at
    cursorType: timestamp
${extra}
    query: |
      SELECT id, betrag, bezahlt_am, patient_id, termin_id, modified_at FROM rechnung
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:invoice:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      pvsAppointmentId: termin_id
      paidAt: { from: bezahlt_am, transform: isoDateTime }
      amountCents: { from: betrag, transform: amountToCents${fieldExtra} }
`;
  const row = (betrag: string) => ({
    id: "1",
    betrag,
    bezahlt_am: "2026-05-20T10:00:00Z",
    patient_id: "p",
    termin_id: "t",
    modified_at: "2026-05-20T10:00:00Z",
  });

  it("amountToCents reads '.' as the decimal point by default", () => {
    expect(_internal.amountToCents("12.500")).toBe(1250);
    expect(_internal.amountToCents("0.500")).toBe(50);
    expect(_internal.amountToCents("1.234")).toBe(123);
    expect(_internal.amountToCents("125,50")).toBe(12550);
    expect(_internal.amountToCents("1.250,00 EUR")).toBe(125000);
    expect(_internal.absAmountToCents("-12.500")).toBe(1250);
  });

  it("a driver string flows through the mapped field unchanged by the German heuristic", async () => {
    const vendor = await loadVendorConfigFromString(INVOICE_YAML(""), "t.yaml");
    const ev = normalizeRow(row("12.500"), { clinicId: "c", vendor, stream: vendor.streams[0] });
    expect(ev!.amountCents).toBe(1250);
  });

  it("decimalFormat: de on the field restores German thousands", async () => {
    const vendor = await loadVendorConfigFromString(
      INVOICE_YAML("", ", decimalFormat: de"),
      "t.yaml"
    );
    const ev = normalizeRow(row("1.234,56"), { clinicId: "c", vendor, stream: vendor.streams[0] });
    expect(ev!.amountCents).toBe(123456);
    const ev2 = normalizeRow(row("1.234"), { clinicId: "c", vendor, stream: vendor.streams[0] });
    expect(ev2!.amountCents).toBe(123400);
  });

  it("decimalFormat: de on the stream applies to its amount fields", async () => {
    const vendor = await loadVendorConfigFromString(
      INVOICE_YAML("    decimalFormat: de"),
      "t.yaml"
    );
    expect(vendor.streams[0].decimalFormat).toBe("de");
    const ev = normalizeRow(row("1.234,56"), { clinicId: "c", vendor, stream: vendor.streams[0] });
    expect(ev!.amountCents).toBe(123456);
  });

  it("rejects an unknown decimalFormat", async () => {
    await expect(
      loadVendorConfigFromString(INVOICE_YAML("    decimalFormat: fr"), "t.yaml")
    ).rejects.toThrow(/decimalFormat/);
  });
});

describe("finding 12: refunds carry their own id and may point at the original invoice", () => {
  const REFUND_YAML = (extraMap = "") => `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: InvoiceRefunded
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, patient_id, betrag, storno_von, modified_at FROM rechnung
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:refund:{id}:{modified_at}" }
      occurredAt: { from: modified_at, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      refundedAmountCents: { from: betrag, transform: absAmountToCents }
      refundedAt: { from: modified_at, transform: isoDateTime }
${extraMap}
`;
  const row = (stornoVon: unknown) => ({
    id: "G-77",
    patient_id: "p1",
    betrag: "-50.00",
    storno_von: stornoVon,
    modified_at: "2026-05-20T10:00:00Z",
  });

  it("emits pvsRefundId = the refund row's own id, stable across modified_at", async () => {
    const vendor = await loadVendorConfigFromString(REFUND_YAML(), "t.yaml");
    const stream = vendor.streams[0];
    const a = normalizeRow(row(null), { clinicId: "c", vendor, stream });
    const b = normalizeRow(
      { ...row(null), modified_at: "2026-05-21T10:00:00Z" },
      { clinicId: "c", vendor, stream }
    );
    expect(a!.pvsRefundId).toBe("G-77");
    expect(b!.pvsRefundId).toBe("G-77");
    // flag-flip case: no original reference mapped, the row id stays the invoice id
    expect(a!.pvsInvoiceId).toBe("G-77");
  });

  it("uses the mapped originalInvoiceId as pvsInvoiceId when non-null, else keeps the row id", async () => {
    const vendor = await loadVendorConfigFromString(
      REFUND_YAML("      originalInvoiceId: storno_von"),
      "t.yaml"
    );
    const stream = vendor.streams[0];
    const withRef = normalizeRow(row("R-100"), { clinicId: "c", vendor, stream });
    expect(withRef!.pvsInvoiceId).toBe("R-100");
    expect(withRef!.pvsRefundId).toBe("G-77");
    expect("originalInvoiceId" in withRef!).toBe(false);
    for (const empty of [null, "", "  "]) {
      const ev = normalizeRow(row(empty), { clinicId: "c", vendor, stream });
      expect(ev!.pvsInvoiceId).toBe("G-77");
      expect(ev!.pvsRefundId).toBe("G-77");
    }
  });

  it("originalInvoiceId is only valid on InvoiceRefunded streams", async () => {
    const bad = REFUND_YAML("      originalInvoiceId: storno_von")
      .replace("kind: InvoiceRefunded", "kind: InvoicePaid")
      .split("refundedAmountCents: { from: betrag, transform: absAmountToCents }")
      .join("pvsAppointmentId: id\n      amountCents: { from: betrag, transform: amountToCents }")
      .split("refundedAt: {")
      .join("paidAt: {");
    await expect(loadVendorConfigFromString(bad, "t.yaml")).rejects.toThrow(/originalInvoiceId/);
  });
});
