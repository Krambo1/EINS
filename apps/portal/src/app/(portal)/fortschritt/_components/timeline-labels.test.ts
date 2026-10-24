import { describe, expect, it } from "vitest";
import { dateParts, isPhaseStep, isRecommendation } from "./timeline-labels";

// 08.10.2026, 10:00 Berlin (CEST, UTC+2).
const NOW = new Date("2026-10-08T08:00:00Z");

describe("dateParts", () => {
  it("never says Heute for a planned date in the past", () => {
    expect(dateParts("geplant", new Date("2026-07-25T10:00:00Z"), NOW)).toEqual([
      "Geplant seit 25.07.2026",
    ]);
  });
  it("says Heute only on the same Berlin day", () => {
    expect(dateParts("geplant", new Date("2026-10-08T20:00:00Z"), NOW)).toEqual([
      "Heute geplant",
      "08.10.2026",
    ]);
    // 23:30 UTC on the 8th is already the 9th in Berlin.
    expect(dateParts("geplant", new Date("2026-10-08T23:30:00Z"), NOW)).toEqual([
      "Morgen",
      "09.10.2026",
    ]);
  });
  it("keeps the relative words for future and past dates", () => {
    expect(dateParts("geplant", new Date("2026-10-14T10:00:00Z"), NOW)[0]).toBe("In 6 Tagen");
    expect(dateParts("laeuft", new Date("2026-10-07T10:00:00Z"), NOW)[0]).toBe(
      "Seit gestern aktiv"
    );
    expect(dateParts("abgeschlossen", new Date("2026-10-02T10:00:00Z"), NOW)[0]).toBe(
      "Vor 6 Tagen"
    );
  });
  it("does not say Heute for future running or done entries", () => {
    expect(dateParts("laeuft", new Date("2026-10-12T10:00:00Z"), NOW)).toEqual([
      "Geplant ab 12.10.2026",
    ]);
    expect(dateParts("abgeschlossen", new Date("2026-10-12T10:00:00Z"), NOW)).toEqual([
      "12.10.2026",
    ]);
  });
});

describe("isPhaseStep", () => {
  it("skips recommendations and dated entries", () => {
    expect(isRecommendation("Empfehlung: Automatische Erinnerungen aktivieren")).toBe(true);
    expect(
      isPhaseStep({ title: "Ihre ersten Beiträge gehen live", eventDate: null, phaseLabel: "Woche 3 bis 4" })
    ).toBe(true);
    expect(
      isPhaseStep({ title: "Empfehlung: Erinnerungen", eventDate: null, phaseLabel: "Laufend" })
    ).toBe(false);
    expect(
      isPhaseStep({ title: "Monatsbericht", eventDate: new Date(), phaseLabel: null })
    ).toBe(false);
  });
});
