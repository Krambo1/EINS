import { describe, it, expect } from "vitest";
import { normalizeInvoice as pabauInvoice } from "./pabau/normalize.js";
import { normalizePayment as consentzPayment } from "./consentz/normalize.js";
import { normalizeInvoice as tomedoInvoice } from "./tomedo/normalize.js";
import { sanitizeEvent } from "../canonical/sanitize.js";
import type { PabauInvoice } from "./pabau/client.js";
import type { ConsentzPayment } from "./consentz/client.js";

/**
 * Invoice findings, per adapter:
 *   4  refunds: Tomedo negative amount, Pabau/Consentz parent reference
 *   5  currency passes through as read; other currencies are never relabelled EUR
 *   7  a void/cancelled/refunded/draft/failed status beats paid_at
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
const T = "2026-06-01T11:00:00.000Z";

const pabau: PabauInvoice = {
  id: 901,
  client_id: 4711,
  booking_id: 51,
  total: 199.5,
  currency: "EUR",
  paid_at: T,
  status: "paid",
  modified_at: T,
};
const consentz: ConsentzPayment = {
  id: 77,
  client_id: 4711,
  appointment_id: 51,
  amount: 120,
  currency: "EUR",
  paid_at: T,
  status: "paid",
  updated_at: T,
};

describe("finding 4: refunds point at the ORIGINAL invoice", () => {
  it("pabau credit note with a parent reference: pvsInvoiceId = original, pvsRefundId = own id, dedup id unchanged", () => {
    const out = pabauInvoice(CLINIC, { ...pabau, total: -199.5, parent_invoice_id: 800 } as PabauInvoice);
    expect(out).toMatchObject({
      kind: "InvoiceRefunded",
      pvsInvoiceId: "800",
      pvsRefundId: "901",
      refundedAmountCents: 19950,
      pvsExternalEventId: "pabau:invoice-refund:901",
    });
  });
  it("pabau accepts the other common parent field names", () => {
    for (const k of ["original_invoice_id", "credit_note_for"]) {
      const out = pabauInvoice(CLINIC, { ...pabau, total: -1, [k]: "800" } as unknown as PabauInvoice);
      expect(out).toMatchObject({ pvsInvoiceId: "800", pvsRefundId: "901" });
    }
  });
  it("pabau without a parent keeps the old behaviour (own id, no refund id)", () => {
    const out = pabauInvoice(CLINIC, { ...pabau, total: -199.5 });
    expect(out).toMatchObject({ kind: "InvoiceRefunded", pvsInvoiceId: "901" });
    expect(out).not.toHaveProperty("pvsRefundId");
  });
  it("a blank parent reference counts as none", () => {
    const out = pabauInvoice(CLINIC, { ...pabau, total: -1, parent_invoice_id: "" } as unknown as PabauInvoice);
    expect(out).toMatchObject({ pvsInvoiceId: "901" });
    expect(out).not.toHaveProperty("pvsRefundId");
  });
  it("consentz refund with a parent reference", () => {
    const out = consentzPayment(CLINIC, { ...consentz, amount: -120, parent_payment_id: "70" } as ConsentzPayment);
    expect(out).toMatchObject({
      kind: "InvoiceRefunded",
      pvsInvoiceId: "70",
      pvsRefundId: "77",
      pvsExternalEventId: "consentz:payment-refund:77",
    });
  });
  it("consentz without a parent keeps the old behaviour", () => {
    const out = consentzPayment(CLINIC, { ...consentz, amount: -120 });
    expect(out).toMatchObject({ kind: "InvoiceRefunded", pvsInvoiceId: "77" });
    expect(out).not.toHaveProperty("pvsRefundId");
  });
  it("the sanitiser lets pvsRefundId through (the final gate is the portal mirror)", () => {
    const out = pabauInvoice(CLINIC, { ...pabau, total: -199.5, parent_invoice_id: 800 } as PabauInvoice)!;
    const r = sanitizeEvent(out);
    expect("event" in r && (r.event as { pvsRefundId?: string }).pvsRefundId).toBe("901");
  });

  const tomedo = { id: "i1", patientId: "p1", amountCents: -5000, paidAt: T, modifiedAt: T };
  it("tomedo: a negative amount is an InvoiceRefunded with the positive magnitude, not a dropped InvoicePaid", () => {
    const out = tomedoInvoice(CLINIC, tomedo);
    expect(out).toMatchObject({
      kind: "InvoiceRefunded",
      pvsInvoiceId: "i1",
      refundedAmountCents: 5000,
      refundedAt: T,
      currency: "EUR",
    });
    expect(out!.pvsExternalEventId).toBe(`tomedo:refund:i1:${T}`);
    expect("event" in sanitizeEvent(out!)).toBe(true);
  });
  it("tomedo: a positive amount stays an InvoicePaid", () => {
    expect(tomedoInvoice(CLINIC, { ...tomedo, amountCents: 5000 })).toMatchObject({ kind: "InvoicePaid", amountCents: 5000 });
  });
  it("tomedo: a negative amount without a valid date is still skipped", () => {
    expect(tomedoInvoice(CLINIC, { ...tomedo, paidAt: "" })).toBeNull();
  });
});

describe("finding 5: currency is passed through, never relabelled", () => {
  it("CHF stays CHF (pabau, consentz), lower case is normalised", () => {
    expect(pabauInvoice(CLINIC, { ...pabau, currency: "CHF" })).toMatchObject({ currency: "CHF" });
    expect(pabauInvoice(CLINIC, { ...pabau, currency: "chf" })).toMatchObject({ currency: "CHF" });
    expect(consentzPayment(CLINIC, { ...consentz, currency: "CHF" })).toMatchObject({ currency: "CHF" });
  });
  it("refunds keep their currency too", () => {
    expect(pabauInvoice(CLINIC, { ...pabau, total: -5, currency: "CHF" })).toMatchObject({ currency: "CHF" });
    expect(consentzPayment(CLINIC, { ...consentz, amount: -5, currency: "CHF" })).toMatchObject({ currency: "CHF" });
  });
  it("a missing currency defaults to EUR (DACH practices)", () => {
    expect(pabauInvoice(CLINIC, { ...pabau, currency: null })).toMatchObject({ currency: "EUR" });
    expect(consentzPayment(CLINIC, { ...consentz, currency: undefined })).toMatchObject({ currency: "EUR" });
  });
  it("USD / GBP is NOT relabelled EUR: it reaches the sanitiser as read and is rejected there", () => {
    for (const cur of ["USD", "gbp"]) {
      const p = pabauInvoice(CLINIC, { ...pabau, currency: cur })!;
      expect((p as { currency?: string }).currency).toBe(cur.toUpperCase());
      expect(sanitizeEvent(p)).toEqual({ drop: "InvoicePaid:unsupported_currency" });
      const c = consentzPayment(CLINIC, { ...consentz, currency: cur })!;
      expect(sanitizeEvent(c)).toEqual({ drop: "InvoicePaid:unsupported_currency" });
    }
    expect(sanitizeEvent(pabauInvoice(CLINIC, { ...pabau, total: -5, currency: "USD" })!)).toEqual({
      drop: "InvoiceRefunded:unsupported_currency",
    });
  });
});

describe("finding 7: a void status beats paid_at", () => {
  const dead = ["void", "voided", "cancelled", "canceled", "refunded", "draft", "failed", "VOID", " Cancelled "];
  it.each(dead)("pabau status %j with paid_at is not paid", (status) => {
    expect(pabauInvoice(CLINIC, { ...pabau, status })).toBeNull();
  });
  it.each(dead)("consentz status %j with paid_at is not paid", (status) => {
    expect(consentzPayment(CLINIC, { ...consentz, status })).toBeNull();
  });
  it("paid_at still counts when the status is empty or unknown", () => {
    for (const status of [null, "", "  ", "something_new"]) {
      expect(pabauInvoice(CLINIC, { ...pabau, status })).toMatchObject({ kind: "InvoicePaid" });
      expect(consentzPayment(CLINIC, { ...consentz, status })).toMatchObject({ kind: "InvoicePaid" });
    }
  });
  it("an explicit paid status still counts without paid_at (paidAt falls back to the modified time)", () => {
    expect(pabauInvoice(CLINIC, { ...pabau, paid_at: null })).toMatchObject({ kind: "InvoicePaid", paidAt: T });
    expect(consentzPayment(CLINIC, { ...consentz, status: "succeeded", paid_at: null })).toMatchObject({ kind: "InvoicePaid" });
  });
  it("no status and no paid_at is not paid", () => {
    expect(pabauInvoice(CLINIC, { ...pabau, status: null, paid_at: null })).toBeNull();
  });
});
