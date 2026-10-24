import { describe, expect, it } from "vitest";
import {
  buildClickConversionPayload,
  classifyOciFailure,
  clampConversionTime,
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

/** A partialFailureError body as Google returns it (one failed row). */
const partial = (code: string) => ({
  partialFailureError: {
    code: 3,
    message: `The conversion failed: ${code}`,
    details: [
      {
        "@type": "type.googleapis.com/google.ads.googleads.v23.errors.GoogleAdsFailure",
        errors: [{ errorCode: { conversionUploadError: code }, message: "x" }],
      },
    ],
  },
});

describe("classifyOciFailure (pass 2)", () => {
  it("a duplicate of an already uploaded conversion counts as sent", () => {
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("CLICK_CONVERSION_ALREADY_EXISTS") })).toBe("already_sent");
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("ORDER_ID_ALREADY_IN_USE") })).toBe("already_sent");
  });

  it("network errors, rate limits and server errors are retried", () => {
    expect(classifyOciFailure({ ok: false, status: 0, body: { error: "The operation was aborted due to timeout" } })).toBe("retry");
    expect(classifyOciFailure({ ok: false, status: 429, body: {} })).toBe("retry");
    expect(classifyOciFailure({ ok: false, status: 503, body: {} })).toBe("retry");
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("TOO_RECENT_CONVERSION_ACTION") })).toBe("retry");
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("CLICK_NOT_FOUND") })).toBe("retry");
  });

  it("errors no retry can fix are permanent", () => {
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("EXPIRED_CLICK") })).toBe("permanent");
    expect(classifyOciFailure({ ok: false, status: 200, body: partial("UNPARSEABLE_GCLID") })).toBe("permanent");
    expect(classifyOciFailure({ ok: false, status: 400, body: { error: { status: "INVALID_ARGUMENT" } } })).toBe("permanent");
    expect(classifyOciFailure({ ok: false, status: 0, body: { error: "no_click_id" } })).toBe("permanent");
  });
});

describe("clampConversionTime (pass 2)", () => {
  const click = new Date("2026-05-19T14:00:00Z");
  const now = new Date("2026-06-01T10:00:00Z");

  it("a payment dated before the click (date-only invoice at midnight) moves just after the click", () => {
    // Google rejects CONVERSION_PRECEDES_CLICK permanently.
    expect(clampConversionTime(new Date("2026-05-19T00:00:00Z"), click, now).toISOString()).toBe("2026-05-19T14:01:00.000Z");
  });

  it("a future-dated payment is sent as now", () => {
    expect(clampConversionTime(new Date("2026-06-05T00:00:00Z"), click, now).toISOString()).toBe(now.toISOString());
  });

  it("a normal payment keeps its time", () => {
    const paid = new Date("2026-05-25T09:30:00Z");
    expect(clampConversionTime(paid, click, now).toISOString()).toBe(paid.toISOString());
    expect(clampConversionTime(paid, null, now).toISOString()).toBe(paid.toISOString());
  });
});
