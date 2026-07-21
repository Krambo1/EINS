import { describe, it, expect } from "vitest";
import { isoUtc, pickMaxIso } from "./iso.js";

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
