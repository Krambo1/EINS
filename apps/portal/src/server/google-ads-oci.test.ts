import { describe, expect, it } from "vitest";
import {
  buildClickConversionPayload,
  formatGoogleConversionDateTime,
} from "./google-ads-oci";

const BASE = {
  clinicId: "00000000-0000-0000-0000-000000000001",
  customerId: "1234567890",
  loginCustomerId: "5556667777",
  conversionAction: "customers/1234567890/conversionActions/9876543210",
  developerToken: "dev-token",
  occurredAt: new Date("2026-05-19T11:22:33Z"),
  valueEur: 1234.56,
  orderId: "outbox-event-uuid-1",
};

describe("formatGoogleConversionDateTime", () => {
  it("emits Google's space-separated format with `+00:00` UTC offset", () => {
    // Google rejects ISO 8601's `T` separator. They want a space.
    expect(formatGoogleConversionDateTime(new Date("2026-05-19T11:22:33Z"))).toBe(
      "2026-05-19 11:22:33+00:00"
    );
  });

  it("zero-pads single-digit month/day/hour/minute/second", () => {
    expect(formatGoogleConversionDateTime(new Date("2026-01-03T04:05:06Z"))).toBe(
      "2026-01-03 04:05:06+00:00"
    );
  });

  it("converts any local-zoned Date to UTC", () => {
    // 13:00 Berlin (CEST = UTC+2) → 11:00 UTC.
    const d = new Date("2026-06-15T13:00:00+02:00");
    expect(formatGoogleConversionDateTime(d)).toBe("2026-06-15 11:00:00+00:00");
  });
});

describe("buildClickConversionPayload", () => {
  it("prefers gclid over wbraid over gbraid", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: "g-1",
      wbraid: "w-1",
      gbraid: "b-1",
    });
    expect("reason" in built).toBe(false);
    if ("reason" in built) return;
    expect(built.gclid).toBe("g-1");
    expect(built.wbraid).toBeUndefined();
    expect(built.gbraid).toBeUndefined();
  });

  it("falls back to wbraid when gclid is absent", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: null,
      wbraid: "w-only",
      gbraid: "b-also",
    });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.gclid).toBeUndefined();
    expect(built.wbraid).toBe("w-only");
    expect(built.gbraid).toBeUndefined();
  });

  it("falls back to gbraid as the last resort", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: null,
      wbraid: null,
      gbraid: "b-last",
    });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.gbraid).toBe("b-last");
  });

  it("returns reason='no_click_id' when none of the three are present", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: null,
      wbraid: null,
      gbraid: null,
    });
    expect(built).toEqual({ reason: "no_click_id" });
  });

  it("rounds EUR value to 2 decimal places (Google wants float)", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: "g",
      valueEur: 12.3456789,
    });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.conversionValue).toBe(12.35);
    expect(built.currencyCode).toBe("EUR");
  });

  it("uses orderId for cross-retry dedup (Google's 24h order_id window)", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: "g",
      orderId: "outbox-row-id-XYZ",
    });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.orderId).toBe("outbox-row-id-XYZ");
  });

  it("attaches hashed email + phone as enhanced-conversions userIdentifiers", () => {
    const built = buildClickConversionPayload({
      ...BASE,
      gclid: "g",
      hashedEmail: "EMAIL_HASH",
      hashedPhone: "PHONE_HASH",
    });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.userIdentifiers).toEqual([
      { hashedEmail: "EMAIL_HASH" },
      { hashedPhoneNumber: "PHONE_HASH" },
    ]);
  });

  it("omits userIdentifiers when neither hashed PII is present", () => {
    const built = buildClickConversionPayload({ ...BASE, gclid: "g" });
    if ("reason" in built) throw new Error("expected payload");
    expect(built.userIdentifiers).toBeUndefined();
  });
});
