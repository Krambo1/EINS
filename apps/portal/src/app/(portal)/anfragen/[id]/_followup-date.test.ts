import { describe, expect, it } from "vitest";
import {
  FOLLOWUP_DATE_MISSING,
  FOLLOWUP_DATE_PAST,
  followupInputError,
  isPastBerlinDay,
} from "./_followup-date";

// 07.10.2026 23:30 in Berlin (CEST) = 21:30 UTC; UTC still says 07.10.
const NOW = new Date("2026-10-07T21:30:00Z");

describe("isPastBerlinDay", () => {
  it("allows today, also an earlier hour, and later days", () => {
    expect(isPastBerlinDay(new Date("2026-10-07T06:00:00Z"), NOW)).toBe(false);
    expect(isPastBerlinDay(new Date("2026-10-08T08:00:00Z"), NOW)).toBe(false);
  });

  it("rejects earlier Berlin days", () => {
    expect(isPastBerlinDay(new Date("2020-01-01T09:00:00Z"), NOW)).toBe(true);
    // 06.10. 23:30 Berlin is 21:30 UTC on the 6th: yesterday.
    expect(isPastBerlinDay(new Date("2026-10-06T21:30:00Z"), NOW)).toBe(true);
  });

  it("uses the Berlin day after midnight, not the UTC day", () => {
    // 08.10. 00:30 Berlin = 07.10. 22:30 UTC; "now" is 08.10. 00:10 Berlin.
    const afterMidnight = new Date("2026-10-07T22:10:00Z");
    // 07.10. 23:00 Berlin is yesterday from there.
    expect(isPastBerlinDay(new Date("2026-10-07T21:00:00Z"), afterMidnight)).toBe(true);
    expect(isPastBerlinDay(new Date("2026-10-07T22:30:00Z"), afterMidnight)).toBe(false);
  });
});

describe("followupInputError", () => {
  it("asks for a date when empty", () => {
    expect(followupInputError("", NOW)).toBe(FOLLOWUP_DATE_MISSING);
    expect(followupInputError("  ", NOW)).toBe(FOLLOWUP_DATE_MISSING);
  });

  it("rejects a past day and accepts today and later", () => {
    expect(followupInputError("2020-01-01T10:00", NOW)).toBe(FOLLOWUP_DATE_PAST);
    expect(followupInputError("2026-10-07T08:00", NOW)).toBeNull();
    expect(followupInputError("2026-10-08T10:00", NOW)).toBeNull();
  });
});
