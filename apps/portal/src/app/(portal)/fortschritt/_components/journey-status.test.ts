import { describe, expect, it } from "vitest";
import {
  currentJourneyWeek,
  effectiveStatus,
  journeyStart,
  parsePhaseWeeks,
} from "./journey-status";

describe("parsePhaseWeeks", () => {
  it("reads the default journey labels", () => {
    expect(parsePhaseWeeks("Woche 1")).toEqual({ from: 1, to: 1 });
    expect(parsePhaseWeeks("Woche 1 bis 2")).toEqual({ from: 1, to: 2 });
    expect(parsePhaseWeeks("Ab Woche 2")).toEqual({ from: 2, to: Infinity });
    expect(parsePhaseWeeks("Tag 22")).toEqual({ from: 4, to: 4 });
    expect(parsePhaseWeeks("Nach 90 Tagen")).toEqual({ from: 13, to: 13 });
    expect(parsePhaseWeeks("Zum Start")).toEqual({ from: 1, to: 1 });
  });
  it("returns null for labels without a time window", () => {
    expect(parsePhaseWeeks("Erste qualifizierte Anfrage")).toBeNull();
    expect(parsePhaseWeeks("Laufend")).toBeNull();
    expect(parsePhaseWeeks("Monatlich")).toBeNull();
    expect(parsePhaseWeeks(null)).toBeNull();
  });
});

describe("currentJourneyWeek", () => {
  const start = new Date("2026-09-14T08:00:00Z");
  it("counts Berlin calendar weeks from the start day", () => {
    expect(currentJourneyWeek(start, new Date("2026-09-14T20:00:00Z"))).toBe(1);
    expect(currentJourneyWeek(start, new Date("2026-09-20T21:00:00Z"))).toBe(1);
    // 22:30 UTC on the 20th is already the 21st in Berlin (CEST).
    expect(currentJourneyWeek(start, new Date("2026-09-20T22:30:00Z"))).toBe(2);
    expect(currentJourneyWeek(start, new Date("2026-10-01T10:00:00Z"))).toBe(3);
  });
  it("never goes below week 1", () => {
    expect(currentJourneyWeek(start, new Date("2026-09-01T10:00:00Z"))).toBe(1);
  });
});

describe("effectiveStatus", () => {
  const phase = (phaseLabel: string, status = "geplant") => ({
    status,
    eventDate: null,
    phaseLabel,
  });
  it("follows the calendar for phases with a week window", () => {
    expect(effectiveStatus(phase("Woche 1 bis 2"), 3)).toBe("abgeschlossen");
    expect(effectiveStatus(phase("Woche 3 bis 4"), 3)).toBe("laeuft");
    expect(effectiveStatus(phase("Ab Woche 2"), 30)).toBe("laeuft");
    expect(effectiveStatus(phase("Woche 5"), 3)).toBe("geplant");
    expect(effectiveStatus(phase("Woche 1", "laeuft"), 4)).toBe("abgeschlossen");
  });
  it("keeps a step EINS marked as done, even early", () => {
    expect(effectiveStatus(phase("Woche 5", "abgeschlossen"), 1)).toBe("abgeschlossen");
  });
  it("keeps the stored status without a window, a date or a start", () => {
    expect(effectiveStatus(phase("Monatlich", "laeuft"), 8)).toBe("laeuft");
    expect(effectiveStatus(phase("Erste qualifizierte Anfrage"), 8)).toBe("geplant");
    expect(effectiveStatus(phase("Woche 1"), null)).toBe("geplant");
    expect(
      effectiveStatus(
        { status: "geplant", eventDate: new Date(), phaseLabel: "Woche 1" },
        9
      )
    ).toBe("geplant");
  });
});

describe("journeyStart", () => {
  it("takes the earliest createdAt of date-less phase entries", () => {
    const a = new Date("2026-09-14T08:00:00Z");
    const b = new Date("2026-09-15T08:00:00Z");
    expect(
      journeyStart([
        { eventDate: null, phaseLabel: "Woche 1", createdAt: b },
        { eventDate: null, phaseLabel: "Woche 1 bis 2", createdAt: a },
        { eventDate: new Date("2026-01-01"), phaseLabel: null, createdAt: new Date("2025-01-01") },
      ])
    ).toEqual(a);
    expect(journeyStart([])).toBeNull();
  });
});
