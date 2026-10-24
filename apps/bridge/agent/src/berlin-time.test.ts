import { describe, expect, it } from "vitest";
import {
  berlinDateToUtcIso,
  berlinWallClockToUtcIso,
  berlinWallClockToUtcMs,
  naiveUtcDateAsBerlin,
} from "./berlin-time.js";

describe("berlin-time", () => {
  it("converts winter wall-clock (CET, +1)", () => {
    expect(berlinWallClockToUtcIso(2026, 1, 15, 14, 30, 0)).toBe(
      "2026-01-15T13:30:00.000Z"
    );
  });

  it("converts summer wall-clock (CEST, +2)", () => {
    expect(berlinWallClockToUtcIso(2026, 7, 15, 14, 30, 0)).toBe(
      "2026-07-15T12:30:00.000Z"
    );
  });

  it("anchors date-only values at Berlin noon so the calendar day survives in UTC", () => {
    expect(berlinDateToUtcIso(2026, 10, 1)).toBe("2026-10-01T10:00:00.000Z");
    expect(berlinDateToUtcIso(2026, 12, 1)).toBe("2026-12-01T11:00:00.000Z");
  });

  it("resolves the fall-back overlap to the first (CEST) occurrence", () => {
    // 2026-10-25 02:30 exists twice in Berlin.
    expect(berlinWallClockToUtcIso(2026, 10, 25, 2, 30, 0)).toBe(
      "2026-10-25T00:30:00.000Z"
    );
  });

  it("resolves the spring-forward gap one hour later", () => {
    // 2026-03-29 02:30 does not exist in Berlin; reads as 03:30 CEST.
    expect(berlinWallClockToUtcIso(2026, 3, 29, 2, 30, 0)).toBe(
      "2026-03-29T01:30:00.000Z"
    );
  });

  it("rejects impossible components", () => {
    expect(berlinWallClockToUtcMs(2026, 2, 30)).toBeNull();
    expect(berlinWallClockToUtcMs(2026, 13, 1)).toBeNull();
    expect(berlinWallClockToUtcMs(2026, 1, 1, 24, 0, 0)).toBeNull();
    expect(berlinWallClockToUtcMs(1800, 1, 1)).toBeNull();
  });

  it("re-interprets a driver Date built from a zone-less timestamp", () => {
    const naive = new Date("2026-07-15T14:30:00.000Z"); // Berlin wall-clock 14:30
    expect(naiveUtcDateAsBerlin(naive)?.toISOString()).toBe(
      "2026-07-15T12:30:00.000Z"
    );
  });
});
