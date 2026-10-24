import { describe, it, expect } from "vitest";
import { isoUtc, pickMaxIso, resolveTimezone, shiftIso, DEFAULT_TIMEZONE } from "./iso.js";

/**
 * M-S5: cursor watermark comparison must normalise timestamps before comparing
 * (mixed offsets/precision mis-order under raw lexical comparison), and must
 * never let a missing candidate empty an existing cursor cell.
 */

describe("isoUtc", () => {
  it("normalises offsets and precision to canonical UTC", () => {
    expect(isoUtc("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05.000Z");
    expect(isoUtc("2026-01-02T04:04:05+01:00")).toBe("2026-01-02T03:04:05.000Z");
    expect(isoUtc("2026-01-02T03:04:05.000Z")).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns '' for empty/nullish and the raw value for unparseable input", () => {
    expect(isoUtc("")).toBe("");
    expect(isoUtc(null)).toBe("");
    expect(isoUtc(undefined)).toBe("");
    expect(isoUtc("not-a-date")).toBe("not-a-date");
  });
});

describe("pickMaxIso", () => {
  it("picks the chronologically later instant even across mixed offsets", () => {
    // Same wall-clock string but different offsets: "+01:00" is EARLIER in UTC.
    // Raw lexical comparison would wrongly pick the "+01:00" string (sorts
    // after "Z"); normalisation fixes the ordering.
    const zulu = "2026-01-02T03:04:05Z"; // 03:04:05 UTC
    const plusOne = "2026-01-02T03:04:05+01:00"; // 02:04:05 UTC (earlier)
    expect(pickMaxIso(plusOne, zulu)).toBe("2026-01-02T03:04:05.000Z");
    expect(pickMaxIso(zulu, plusOne)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("returns the normalised current cursor when the candidate is missing", () => {
    expect(pickMaxIso("2026-01-02T03:04:05.000Z", undefined)).toBe(
      "2026-01-02T03:04:05.000Z"
    );
    expect(pickMaxIso("2026-01-02T03:04:05.000Z", null)).toBe(
      "2026-01-02T03:04:05.000Z"
    );
    expect(pickMaxIso("2026-01-02T03:04:05.000Z", "")).toBe(
      "2026-01-02T03:04:05.000Z"
    );
  });

  it("adopts the candidate when the current cursor is empty", () => {
    expect(pickMaxIso("", "2026-01-02T03:04:05Z")).toBe(
      "2026-01-02T03:04:05.000Z"
    );
  });

  it("keeps the later of two canonical values and stays byte-stable", () => {
    const a = "2026-05-21T00:00:00.000Z";
    const b = "2026-06-01T09:30:00.000Z";
    expect(pickMaxIso(a, b)).toBe(b);
    expect(pickMaxIso(b, a)).toBe(b);
  });
});

describe("isoUtc with a timezone (zone-less vendor timestamps)", () => {
  const BERLIN = "Europe/Berlin";

  it("applies Berlin CEST (+2) in summer and CET (+1) in winter", () => {
    expect(isoUtc("2026-10-01 10:00:00", BERLIN)).toBe("2026-10-01T08:00:00.000Z");
    expect(isoUtc("2026-10-01T10:00:00", BERLIN)).toBe("2026-10-01T08:00:00.000Z");
    expect(isoUtc("2026-01-15T10:00:00", BERLIN)).toBe("2026-01-15T09:00:00.000Z");
    expect(isoUtc("2026-01-15 10:00", BERLIN)).toBe("2026-01-15T09:00:00.000Z");
    expect(isoUtc("2026-01-15T10:00:00.123", BERLIN)).toBe("2026-01-15T09:00:00.123Z");
  });

  it("resolves the DST boundaries without drifting", () => {
    // 2026-03-29 02:00 -> 03:00 (spring forward); 2026-10-25 03:00 -> 02:00 (fall back).
    expect(isoUtc("2026-03-29T01:59:59", BERLIN)).toBe("2026-03-29T00:59:59.000Z");
    expect(isoUtc("2026-03-29T03:00:00", BERLIN)).toBe("2026-03-29T01:00:00.000Z");
    expect(isoUtc("2026-10-25T01:59:59", BERLIN)).toBe("2026-10-24T23:59:59.000Z");
    expect(isoUtc("2026-10-25T03:00:00", BERLIN)).toBe("2026-10-25T02:00:00.000Z");
    // Non-existent (02:30 on spring-forward day) and ambiguous (02:30 on fall-back
    // day) local times map to a consistent instant: deterministic, so dedup ids are stable.
    const gap = isoUtc("2026-03-29T02:30:00", BERLIN);
    expect(gap).toBe(isoUtc("2026-03-29T02:30:00", BERLIN));
    expect(Number.isNaN(Date.parse(gap))).toBe(false);
    const overlap = isoUtc("2026-10-25T02:30:00", BERLIN);
    expect(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]).toContain(overlap);
  });

  it("works for other zones", () => {
    expect(isoUtc("2026-10-01T10:00:00", "America/New_York")).toBe("2026-10-01T14:00:00.000Z");
    expect(isoUtc("2026-10-01T10:00:00", "UTC")).toBe("2026-10-01T10:00:00.000Z");
    expect(isoUtc("2026-10-01T10:00:00", "Asia/Kolkata")).toBe("2026-10-01T04:30:00.000Z");
  });

  it("is applied ONLY to zone-less values", () => {
    expect(isoUtc("2026-10-01T10:00:00Z", BERLIN)).toBe("2026-10-01T10:00:00.000Z");
    expect(isoUtc("2026-10-01T10:00:00+05:00", BERLIN)).toBe("2026-10-01T05:00:00.000Z");
    expect(isoUtc("2026-10-01", BERLIN)).toBe("2026-10-01T00:00:00.000Z"); // date-only: untouched
    expect(isoUtc("", BERLIN)).toBe("");
    expect(isoUtc("not-a-date", BERLIN)).toBe("not-a-date");
  });

  it("without a timezone argument behaviour is unchanged (cross-path contract)", () => {
    expect(isoUtc("2026-01-02T03:04:05Z")).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("resolveTimezone", () => {
  it("defaults to Europe/Berlin and rejects invalid zone names", () => {
    expect(DEFAULT_TIMEZONE).toBe("Europe/Berlin");
    expect(resolveTimezone({})).toBe("Europe/Berlin");
    expect(resolveTimezone(undefined)).toBe("Europe/Berlin");
    expect(resolveTimezone({ timezone: "Nope/Zone" })).toBe("Europe/Berlin");
    expect(resolveTimezone({ timezone: 5 })).toBe("Europe/Berlin");
    expect(resolveTimezone({ timezone: "Europe/Zurich" })).toBe("Europe/Zurich");
  });
});

describe("shiftIso", () => {
  it("shifts by ms and leaves unparseable values alone", () => {
    expect(shiftIso("2026-10-01T10:00:00.000Z", -600_000)).toBe("2026-10-01T09:50:00.000Z");
    expect(shiftIso("nope", 5)).toBe("nope");
  });
});
