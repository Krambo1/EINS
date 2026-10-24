import { describe, it, expect } from "vitest";
import { sanitizeEvent } from "./sanitize.js";
import type { CanonicalEvent } from "./types.js";

/**
 * Sanitiser findings:
 *   4  pvsRefundId is passed through to the portal
 *   5  only EUR and CHF go out; any other currency drops the event (value-free reason)
 *   8  bemerkung carries ONLY the EINS-Lead token, never clinical free text
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";

const base = {
  clinicId: CLINIC,
  bridgeSource: "pabau",
  occurredAt: "2026-10-01T10:00:00.000Z",
};

const patient = (over: Record<string, unknown> = {}) =>
  ({ ...base, kind: "PatientUpserted", pvsExternalEventId: "pabau:patient:1:x", pvsPatientId: "1", ...over }) as unknown as CanonicalEvent;
const appointment = (over: Record<string, unknown> = {}) =>
  ({
    ...base,
    kind: "AppointmentCreated",
    pvsExternalEventId: "pabau:appointment:5",
    pvsPatientId: "1",
    pvsAppointmentId: "5",
    scheduledAt: "2026-10-02T10:00:00.000Z",
    ...over,
  }) as unknown as CanonicalEvent;
const paid = (over: Record<string, unknown> = {}) =>
  ({
    ...base,
    kind: "InvoicePaid",
    pvsExternalEventId: "pabau:invoice:9",
    pvsPatientId: "1",
    pvsInvoiceId: "9",
    amountCents: 1000,
    currency: "EUR",
    paidAt: "2026-10-01T10:00:00.000Z",
    ...over,
  }) as unknown as CanonicalEvent;
const refunded = (over: Record<string, unknown> = {}) =>
  ({
    ...base,
    kind: "InvoiceRefunded",
    pvsExternalEventId: "pabau:invoice-refund:12",
    pvsPatientId: "1",
    pvsInvoiceId: "9",
    refundedAmountCents: 1000,
    currency: "EUR",
    refundedAt: "2026-10-01T10:00:00.000Z",
    ...over,
  }) as unknown as CanonicalEvent;

function ok(e: CanonicalEvent): Record<string, unknown> {
  const r = sanitizeEvent(e);
  if (!("event" in r)) throw new Error(`dropped: ${r.drop}`);
  return r.event as unknown as Record<string, unknown>;
}

describe("finding 4: pvsRefundId reaches the portal", () => {
  it("is passed through", () => {
    expect(ok(refunded({ pvsRefundId: "12" })).pvsRefundId).toBe("12");
  });
  it("stays absent when the normalizer had none", () => {
    expect(ok(refunded())).not.toHaveProperty("pvsRefundId");
  });
  it("a blank one is treated as absent", () => {
    expect(ok(refunded({ pvsRefundId: "  " }))).not.toHaveProperty("pvsRefundId");
  });
});

describe("finding 5: currency", () => {
  it("EUR and CHF pass through unchanged", () => {
    expect(ok(paid({ currency: "EUR" })).currency).toBe("EUR");
    expect(ok(paid({ currency: "CHF" })).currency).toBe("CHF");
    expect(ok(refunded({ currency: "CHF" })).currency).toBe("CHF");
  });
  it("an event without a currency keeps none (the portal default applies)", () => {
    expect(ok(paid({ currency: undefined }))).not.toHaveProperty("currency");
  });
  it("any other currency drops the event with a value-free reason", () => {
    expect(sanitizeEvent(paid({ currency: "USD" }))).toEqual({ drop: "InvoicePaid:unsupported_currency" });
    expect(sanitizeEvent(refunded({ currency: "GBP" }))).toEqual({ drop: "InvoiceRefunded:unsupported_currency" });
  });
});

describe("finding 8: bemerkung is the lead token only", () => {
  const TOKEN = "EINS-Lead-1a2b3c4d";
  it("free text around the token is removed", () => {
    expect(ok(patient({ bemerkung: `Allergie gegen Penicillin. ${TOKEN}, VIP` })).bemerkung).toBe(TOKEN);
    expect(ok(appointment({ bemerkung: `Botox ${TOKEN} nuechtern kommen` })).bemerkung).toBe(TOKEN);
  });
  it("without a token the field is omitted", () => {
    expect(ok(patient({ bemerkung: "Diabetes Typ 2, Marcumar" }))).not.toHaveProperty("bemerkung");
    expect(ok(appointment({ bemerkung: "Erstberatung" }))).not.toHaveProperty("bemerkung");
  });
  it("the token is found case-insensitively, as the portal parses it", () => {
    expect(ok(patient({ bemerkung: "x EINS-Lead-1A2B3C4D y" })).bemerkung).toBe("EINS-Lead-1A2B3C4D");
  });
  it("a token far beyond the old 4000 character cut is no longer lost", () => {
    expect(ok(patient({ bemerkung: `${"x".repeat(6000)} ${TOKEN}` })).bemerkung).toBe(TOKEN);
  });
  it("a near miss is not a token", () => {
    expect(ok(patient({ bemerkung: "EINS-Lead-1a2b3c4" }))).not.toHaveProperty("bemerkung");
    expect(ok(patient({ bemerkung: "EINS-Lead-zzzzzzzz" }))).not.toHaveProperty("bemerkung");
  });
});
