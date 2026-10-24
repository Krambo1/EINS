import { afterEach, describe, expect, it, vi } from "vitest";
import {
  berlinDay,
  berlinHour,
  berlinStartOfDay,
  dashboardRangeWindow,
  priorDashboardWindow,
} from "./dashboard-range";

afterEach(() => {
  vi.useRealTimers();
});

function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("dashboardRangeWindow (Europe/Berlin)", () => {
  it("23:30 Berlin (summer) is still the same Berlin day", () => {
    at("2026-07-14T21:30:00Z"); // 23:30 CEST
    const w = dashboardRangeWindow("heute");
    expect(w.fromDate).toBe("2026-07-14");
    expect(w.toDate).toBe("2026-07-14");
    expect(w.from.toISOString()).toBe("2026-07-13T22:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-07-14T21:59:59.999Z");
    expect(w.days).toBe(1);
  });

  it("00:30 Berlin (summer) is already the next Berlin day, although UTC is the day before", () => {
    at("2026-07-14T22:30:00Z"); // 00:30 CEST on 15.07.
    const w = dashboardRangeWindow("heute");
    expect(w.fromDate).toBe("2026-07-15");
    expect(w.from.toISOString()).toBe("2026-07-14T22:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-07-15T21:59:59.999Z");
  });

  it("00:30 and 23:30 Berlin in winter", () => {
    at("2026-01-14T23:30:00Z"); // 00:30 CET on 15.01.
    expect(dashboardRangeWindow("heute").fromDate).toBe("2026-01-15");
    expect(dashboardRangeWindow("heute").from.toISOString()).toBe("2026-01-14T23:00:00.000Z");
    at("2026-01-15T22:30:00Z"); // 23:30 CET on 15.01.
    expect(dashboardRangeWindow("heute").toDate).toBe("2026-01-15");
    expect(dashboardRangeWindow("heute").to.toISOString()).toBe("2026-01-15T22:59:59.999Z");
  });

  it("spring-forward day (29.03.2026) has 23 hours", () => {
    at("2026-03-29T10:00:00Z");
    const w = dashboardRangeWindow("heute");
    expect(w.from.toISOString()).toBe("2026-03-28T23:00:00.000Z"); // 00:00 CET
    expect(w.to.toISOString()).toBe("2026-03-29T21:59:59.999Z"); // 23:59:59 CEST
    expect(w.to.getTime() - w.from.getTime() + 1).toBe(23 * 3_600_000);
  });

  it("fall-back day (25.10.2026) has 25 hours", () => {
    at("2026-10-25T10:00:00Z");
    const w = dashboardRangeWindow("heute");
    expect(w.from.toISOString()).toBe("2026-10-24T22:00:00.000Z"); // 00:00 CEST
    expect(w.to.toISOString()).toBe("2026-10-25T22:59:59.999Z"); // 23:59:59 CET
    expect(w.to.getTime() - w.from.getTime() + 1).toBe(25 * 3_600_000);
  });

  it("30-day window across the spring switch is 30 whole Berlin days", () => {
    at("2026-04-10T08:00:00Z");
    const w = dashboardRangeWindow("mon");
    expect(w.days).toBe(30);
    expect(w.fromDate).toBe("2026-03-12");
    expect(w.toDate).toBe("2026-04-10");
    expect(w.from.toISOString()).toBe("2026-03-11T23:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-04-10T21:59:59.999Z");
  });

  it("prior window is the same number of whole days right before", () => {
    at("2026-11-05T08:00:00Z");
    const w = dashboardRangeWindow("mon");
    const p = priorDashboardWindow(w);
    expect(p.days).toBe(30);
    expect(p.toDate).toBe("2026-10-06");
    expect(p.fromDate).toBe("2026-09-07");
    expect(p.to.getTime() + 1).toBe(w.from.getTime());
    expect(berlinDay(p.from)).toBe("2026-09-07");
  });

  it("heute vs gestern at 00:30 Berlin", () => {
    at("2026-07-14T22:30:00Z");
    const p = priorDashboardWindow(dashboardRangeWindow("heute"));
    expect(p.fromDate).toBe("2026-07-14");
    expect(p.toDate).toBe("2026-07-14");
  });
});

describe("berlin helpers", () => {
  it("berlinHour follows Berlin wall time", () => {
    expect(berlinHour(new Date("2026-07-14T04:30:00Z"))).toBe(6);
    expect(berlinHour(new Date("2026-07-14T21:30:00Z"))).toBe(23);
    expect(berlinHour(new Date("2026-01-14T23:30:00Z"))).toBe(0);
  });

  it("berlinStartOfDay on both DST switch days", () => {
    expect(berlinStartOfDay("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(berlinStartOfDay("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(berlinStartOfDay("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(berlinStartOfDay("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });
});
