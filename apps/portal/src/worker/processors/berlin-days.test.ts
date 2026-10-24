import { describe, expect, it } from "vitest";
import {
  addDaysIso,
  berlinToday,
  berlinYesterday,
  isIsoDay,
  isPatientMailWindow,
  isYearMonth,
  previousBerlinMonth,
} from "./berlin-days";

describe("berlin-days", () => {
  it("shifts calendar days across month and year ends", () => {
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-10-07", -7)).toBe("2026-09-30");
  });

  it("uses the Berlin day, not the UTC day", () => {
    // 22:30 UTC on 30 Sep (summer time) is already 1 Oct 00:30 in Berlin.
    const now = new Date("2026-09-30T22:30:00Z");
    expect(berlinToday(now)).toBe("2026-10-01");
    expect(berlinYesterday(now)).toBe("2026-09-30");
    expect(previousBerlinMonth(now)).toBe("2026-09");
  });

  it("previous month wraps the year", () => {
    expect(previousBerlinMonth(new Date("2027-01-01T05:00:00Z"))).toBe("2026-12");
    // 31 Dec 23:30 UTC is 1 Jan 00:30 Berlin (winter time).
    expect(previousBerlinMonth(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
  });

  it("patient mail window is Mon-Fri 09-18 Berlin", () => {
    // Wed 7 Oct 2026, 07:30 UTC = 09:30 Berlin (summer time).
    expect(isPatientMailWindow(new Date("2026-10-07T07:30:00Z"))).toBe(true);
    // 06:30 UTC = 08:30 Berlin: too early.
    expect(isPatientMailWindow(new Date("2026-10-07T06:30:00Z"))).toBe(false);
    // 16:00 UTC = 18:00 Berlin: closed.
    expect(isPatientMailWindow(new Date("2026-10-07T16:00:00Z"))).toBe(false);
    // Sat 10 Oct 2026 noon.
    expect(isPatientMailWindow(new Date("2026-10-10T10:00:00Z"))).toBe(false);
    // Winter: Mon 7 Dec 2026, 08:30 UTC = 09:30 Berlin.
    expect(isPatientMailWindow(new Date("2026-12-07T08:30:00Z"))).toBe(true);
  });

  it("validates period and day strings", () => {
    expect(isYearMonth("2026-09")).toBe(true);
    expect(isYearMonth("__autoprev__")).toBe(false);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isIsoDay("2026-02-29")).toBe(false);
    expect(isIsoDay("2028-02-29")).toBe(true);
  });
});
