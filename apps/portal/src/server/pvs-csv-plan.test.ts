import { describe, expect, it } from "vitest";
import {
  CsvMappingSchema,
  parseAmountToCents,
  parseCsvDateTime,
  planCsvRows,
} from "./pvs-csv-mapper";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const UPLOAD = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("parseAmountToCents", () => {
  it.each([
    ["350,00", 35000],
    ["350.00", 35000],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["1.000", 100000],
    ["12,5", 1250],
    ["1.234.567,89", 123456789],
    ["120,00 EUR", 12000],
    ["€ 99,90", 9990],
    ["120,00-", -12000],
    ["(45,00)", -4500],
    ["−10,00", -1000],
    ["-10,00", -1000],
  ])("%s -> %d cents", (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it("rejects garbage", () => {
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("1,23,456")).toBeNull();
  });

  it("cents unit", () => {
    expect(parseAmountToCents("35000", "cents")).toBe(35000);
  });
});

describe("parseCsvDateTime", () => {
  it("reads 07.10.2026 as 7 October, not 10 July", () => {
    expect(parseCsvDateTime("07.10.2026", "DD.MM.YYYY")).toBe("2026-10-07T10:00:00.000Z");
  });
  it("accepts 25.10.2026 (invalid for month/day swap)", () => {
    expect(parseCsvDateTime("25.10.2026", "DD.MM.YYYY")).toBe("2026-10-25T11:00:00.000Z");
  });
  it("accepts D.M.YYYY and DD.MM.YY", () => {
    expect(parseCsvDateTime("7.1.2026", "DD.MM.YYYY")).toBe("2026-01-07T11:00:00.000Z");
    expect(parseCsvDateTime("07.10.26", "DD.MM.YYYY")).toBe("2026-10-07T10:00:00.000Z");
  });
  it("treats times as Berlin wall clock (summer and winter)", () => {
    expect(parseCsvDateTime("07.10.2026 14:30", "DD.MM.YYYY")).toBe("2026-10-07T12:30:00.000Z");
    expect(parseCsvDateTime("07.01.2026 14:30:15", "DD.MM.YYYY")).toBe("2026-01-07T13:30:15.000Z");
  });
  it("accepts ISO dates and honours explicit offsets", () => {
    expect(parseCsvDateTime("2026-10-07", "YYYY-MM-DD")).toBe("2026-10-07T10:00:00.000Z");
    expect(parseCsvDateTime("2026-05-18T10:30:00Z", "ISO_DATETIME")).toBe("2026-05-18T10:30:00.000Z");
  });
  it("rejects impossible dates", () => {
    expect(parseCsvDateTime("31.02.2026", "DD.MM.YYYY")).toBeNull();
    expect(parseCsvDateTime("garbage", "DD.MM.YYYY")).toBeNull();
  });
});

function invMapping(extra: Record<string, unknown> = {}, cols: Record<string, string> = {}) {
  return CsvMappingSchema.parse({
    stream: "invoices",
    columns: {
      pvsPatientId: "Pat.-Nr.",
      pvsInvoiceId: "Rechnungsnummer",
      amount: "Betrag",
      paidAt: "Zahldatum",
      ...cols,
    },
    ...extra,
  });
}

const row = (inv: string, amount: string, date = "07.10.2026", extra = {}) => ({
  "Pat.-Nr.": "P-1",
  Rechnungsnummer: inv,
  Betrag: amount,
  Zahldatum: date,
  ...extra,
});

describe("planCsvRows invoices", () => {
  it("defaults: DD.MM.YYYY and auto decimal separator", () => {
    const m = invMapping({ allRowsPaidConfirmed: true });
    expect(m.dateFormat).toBe("DD.MM.YYYY");
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: m,
      rows: [row("R-1", "350.00"), row("R-2", "350,00")],
    });
    expect(plan.errors).toEqual([]);
    const cents = plan.entries.map((e) => (e.event.kind === "InvoicePaid" ? e.event.amountCents : -1));
    expect(cents).toEqual([35000, 35000]);
  });

  it("refuses to plan without status column and confirmation", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping(),
      rows: [row("R-1", "10,00")],
    });
    expect(plan.fatal).toBe("status_unmapped_without_confirmation");
    expect(plan.entries).toEqual([]);
  });

  it("aggregates line items per invoice, latest date, total in the event id", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({ allRowsPaidConfirmed: true }),
      rows: [
        row("R-7", "100,00", "01.10.2026"),
        row("R-7", "50,50", "03.10.2026"),
        row("R-7", "49,50", "02.10.2026"),
      ],
    });
    expect(plan.entries).toHaveLength(1);
    const e = plan.entries[0]!.event;
    if (e.kind !== "InvoicePaid") throw new Error("kind");
    expect(e.amountCents).toBe(20000);
    expect(e.pvsInvoiceId).toBe("R-7");
    expect(e.pvsExternalEventId).toBe("csv:invoice:R-7:20000");
    expect(e.paidAt).toBe("2026-10-03T10:00:00.000Z");
  });

  it("books a negative Storno row as InvoiceRefunded", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({ allRowsPaidConfirmed: true }),
      rows: [row("R-8", "-80,00")],
    });
    const e = plan.entries[0]!.event;
    if (e.kind !== "InvoiceRefunded") throw new Error("kind");
    expect(e.refundedAmountCents).toBe(8000);
  });

  it("with a status column counts only paid rows and skips storno/open", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({}, { statusColumn: "Status" }),
      rows: [
        row("R-1", "100,00", "07.10.2026", { Status: "bezahlt" }),
        row("R-2", "200,00", "07.10.2026", { Status: "offen" }),
        row("R-3", "300,00", "07.10.2026", { Status: "storniert" }),
        row("R-4", "400,00", "07.10.2026", { Status: "Bezahlt (Überweisung)" }),
        row("R-5", "50,00", "07.10.2026", { Status: "bar" }),
        row("R-3", "-300,00", "07.10.2026", { Status: "storniert" }),
      ],
    });
    // Pass 2: R-3's storniert line now opens the invoice aggregate (it adds
    // 0), so R-3 sits at its first row; the amounts are unchanged.
    expect(plan.entries.map((e) => e.event.pvsExternalEventId ?? "")).toEqual([
      "csv:invoice:R-1:10000",
      "csv:invoice:R-3:-30000",
      "csv:invoice:R-4:40000",
      "csv:invoice:R-5:5000",
    ]);
    expect(plan.skipped).toEqual({ unpaid: 1, storniert: 1, nettoNull: 0 });
  });

  it("emits invoices whose lines net to zero as 0 € (storno of an earlier upload)", () => {
    // Pass 2: skipping them left the amount of an earlier upload standing
    // forever. A 0 € version is the newest state of the invoice; derive
    // treats the drop as a refund and no Purchase is sent for 0 €.
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({ allRowsPaidConfirmed: true }),
      rows: [row("R-9", "100,00"), row("R-9", "-100,00")],
    });
    expect(plan.entries).toHaveLength(1);
    const ev = plan.entries[0]!.event;
    expect(ev.kind).toBe("InvoicePaid");
    expect(ev.pvsExternalEventId).toBe("csv:invoice:R-9:0");
    expect(ev.kind === "InvoicePaid" ? ev.amountCents : -1).toBe(0);
    expect(plan.skipped.nettoNull).toBe(1);
  });

  it("emits an invoice whose only line is storniert as 0 €", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({}, { statusColumn: "Status" }),
      rows: [row("R-7", "250,00", "07.10.2026", { Status: "storniert" })],
    });
    expect(plan.entries.map((e) => e.event.pvsExternalEventId)).toEqual([
      "csv:invoice:R-7:0",
    ]);
    expect(plan.skipped.storniert).toBe(1);
  });

  it("a storniert line next to a paid line of the same invoice keeps the paid amount", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({}, { statusColumn: "Status" }),
      rows: [
        row("R-8", "300,00", "07.10.2026", { Status: "bezahlt" }),
        row("R-8", "200,00", "07.10.2026", { Status: "storniert" }),
      ],
    });
    expect(plan.entries.map((e) => e.event.pvsExternalEventId)).toEqual([
      "csv:invoice:R-8:30000",
    ]);
  });

  it("collects row errors", () => {
    const plan = planCsvRows({
      clinicId: CLINIC,
      uploadId: UPLOAD,
      mapping: invMapping({ allRowsPaidConfirmed: true }),
      rows: [row("R-1", "abc"), row("R-2", "10,00", "kein Datum")],
    });
    expect(plan.errors.map((e) => e.row)).toEqual([1, 2]);
  });
});
