import { describe, expect, it } from "vitest";
import { buildFortschritt, phaseStand } from "./steps";

// Journey set up on Monday 14.09.2026, Berlin morning.
const start = new Date("2026-09-14T08:00:00Z");
const day = (n: number) => new Date(Date.UTC(2026, 8, 14 + n, 10));

describe("phaseStand", () => {
  it("says when a planned phase starts", () => {
    expect(phaseStand("geplant", "Ab Woche 2", start, day(0))).toBe("In 7 Tagen");
    expect(phaseStand("geplant", "Ab Woche 2", start, day(6))).toBe("Morgen");
    expect(phaseStand("geplant", "Nach 90 Tagen", start, day(3))).toBe("In 3 Monaten");
  });
  it("says what is left of a running phase", () => {
    expect(phaseStand("laeuft", "Woche 1", start, day(0))).toBe("Noch 7 Tage");
    expect(phaseStand("laeuft", "Woche 1 bis 2", start, day(0))).toBe("Noch 2 Wochen");
    expect(phaseStand("laeuft", "Woche 1 bis 2", start, day(5))).toBe("Noch 9 Tage");
    expect(phaseStand("laeuft", "Woche 1 bis 2", start, day(12))).toBe("Endet morgen");
    expect(phaseStand("laeuft", "Woche 1 bis 2", start, day(13))).toBe("Endet heute");
  });
  it("says since when an open-ended phase runs", () => {
    expect(phaseStand("laeuft", "Ab Woche 2", start, day(7))).toBe("Heute gestartet");
    expect(phaseStand("laeuft", "Ab Woche 2", start, day(10))).toBe("Seit 3 Tagen aktiv");
  });
  it("is null where there is no stand to tell", () => {
    expect(phaseStand("abgeschlossen", "Woche 1", start, day(20))).toBeNull();
    expect(phaseStand("geplant", "Laufend", start, day(0))).toBeNull();
    expect(phaseStand("laeuft", "Woche 1", null, day(0))).toBeNull();
    // EINS set a step running before its window: no countdown to a start.
    expect(phaseStand("geplant", "Woche 1", start, day(3))).toBeNull();
  });
  it("counts Berlin calendar days across the switch to winter time", () => {
    const late = new Date("2026-10-19T22:30:00Z"); // 20.10. 00:30 Berlin
    expect(phaseStand("laeuft", "Woche 1 bis 2", late, new Date("2026-10-26T12:00:00Z"))).toBe("Noch 8 Tage");
  });
});

const entry = (
  id: string,
  over: Partial<{ title: string; description: string | null; status: string; eventDate: Date | null; phaseLabel: string | null; sortOrder: number }>
) => ({
  id,
  title: over.title ?? id,
  description: over.description ?? null,
  status: over.status ?? "geplant",
  eventDate: over.eventDate ?? null,
  phaseLabel: over.phaseLabel ?? null,
  sortOrder: over.sortOrder ?? 0,
  createdAt: start,
});

describe("buildFortschritt", () => {
  it("sorts the journey into the three cards with a stand per phase", () => {
    const v = buildFortschritt(
      [
        entry("a", { phaseLabel: "Woche 1", sortOrder: 10 }),
        entry("b", { phaseLabel: "Woche 1 bis 2", sortOrder: 20 }),
        entry("c", { phaseLabel: "Ab Woche 2", sortOrder: 30 }),
        entry("d", { phaseLabel: "Laufend", sortOrder: 40 }),
      ],
      day(9)
    );
    expect(v.week).toBe(2);
    expect(v.active.map((r) => [r.id, r.meta])).toEqual([
      ["b", ["Woche 1 bis 2", "Noch 5 Tage"]],
      ["c", ["Ab Woche 2", "Seit 2 Tagen aktiv"]],
    ]);
    expect(v.upcoming.map((r) => [r.id, r.meta])).toEqual([["d", ["Laufend"]]]);
    expect(v.done.map((r) => [r.id, r.meta])).toEqual([["a", ["Woche 1"]]]);
  });

  it("lists finished steps newest first: dated, then phases from the last back", () => {
    const v = buildFortschritt(
      [
        entry("p1", { phaseLabel: "Woche 1", sortOrder: 10, status: "abgeschlossen" }),
        entry("p2", { phaseLabel: "Woche 1 bis 2", sortOrder: 20, status: "abgeschlossen" }),
        entry("old", { eventDate: new Date("2026-09-20T10:00:00Z"), status: "abgeschlossen" }),
        entry("new", { eventDate: new Date("2026-09-25T10:00:00Z"), status: "abgeschlossen" }),
      ],
      day(20)
    );
    expect(v.done.map((r) => r.id)).toEqual(["new", "old", "p2", "p1"]);
  });

  it("keeps a step without date and phase, an unknown status and empty text", () => {
    const v = buildFortschritt(
      [
        entry("x", { status: "pausiert", description: "  " }),
        entry("y", { status: "laeuft", eventDate: day(-1), description: "Text" }),
      ],
      day(0)
    );
    expect(v.week).toBeNull();
    expect(v.upcoming).toEqual([{ id: "x", title: "x", description: null, meta: ["Ohne Datum"] }]);
    expect(v.active[0]).toMatchObject({ id: "y", description: "Text", meta: ["Seit gestern aktiv", "13.09.2026"] });
  });

  it("is empty without entries", () => {
    expect(buildFortschritt([], day(0))).toEqual({ week: null, active: [], upcoming: [], done: [] });
  });
});
