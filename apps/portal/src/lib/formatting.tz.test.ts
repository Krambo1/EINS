import { describe, expect, it, vi, afterEach } from "vitest";
import { berlinDateString, formatDateTime, formatDate, formatRelativeDay } from "./formatting";

describe("Berlin display time (server runs in UTC)", () => {
  afterEach(() => vi.useRealTimers());

  it("renders a summer evening instant in Berlin wall time", () => {
    // 21:30 UTC on 7 Oct 2026 = 23:30 CEST
    expect(formatDateTime(new Date("2026-10-07T21:30:00Z"))).toContain("23:30");
  });

  it("renders a winter instant in Berlin wall time", () => {
    // 23:30 UTC on 15 Jan 2026 = 00:30 CET next day
    const d = new Date("2026-01-15T23:30:00Z");
    expect(formatDateTime(d)).toContain("00:30");
    expect(formatDate(d)).toBe("16.01.2026");
  });

  it("berlinDateString flips at Berlin midnight, not UTC midnight", () => {
    expect(berlinDateString(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08");
    expect(berlinDateString(new Date("2026-10-07T21:59:00Z"))).toBe("2026-10-07");
  });

  it("formatRelativeDay uses the Berlin calendar day", () => {
    vi.useFakeTimers();
    // 00:30 Berlin on 8 Oct (22:30 UTC on 7 Oct)
    vi.setSystemTime(new Date("2026-10-07T22:30:00Z"));
    expect(formatRelativeDay("2026-10-08").label).toBe("Heute");
    expect(formatRelativeDay("2026-10-09").label).toBe("Morgen");
    expect(formatRelativeDay("2026-10-07").overdue).toBe(true);
    expect(formatRelativeDay(new Date("2026-10-07T23:00:00Z")).label).toBe("Heute");
  });
});
