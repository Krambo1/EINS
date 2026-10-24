import { describe, expect, it } from "vitest";
import {
  openCountsAtPoints,
  openQueuePoints,
  statusBefore,
  type SweepChange,
  type SweepRequest,
} from "./requests-open-queue";

/**
 * The decided reading, evaluated naively per point: status at T = status
 * before the earliest status change after T (meta.from, else the new status
 * of the previous change, else 'neu'), else the current status. Rows
 * without from/to are ignored.
 */
function reference(points: number[], requests: SweepRequest[], changes: SweepChange[]): number[] {
  const real = changes.filter((c) => c.from != null || c.to != null);
  return points.map((t) =>
    requests.filter((r) => {
      if (r.createdAt > t) return false;
      const mine = real.filter((c) => c.requestId === r.id);
      const idx = mine.findIndex((c) => c.createdAt > t);
      if (idx === -1) return r.status === "neu";
      const prevTo = idx > 0 ? mine[idx - 1]!.to : mine[0]!.prevTo;
      return statusBefore(mine[idx]!, prevTo) === "neu";
    }).length
  );
}

/** Manual status change as the portal writes it (from + to). */
const manual = (requestId: string, createdAt: number, from: string, to: string): SweepChange => ({
  requestId,
  createdAt,
  from,
  to,
});

/** Older PVS row: only meta.derivedStatus (passed as `to`), no from. */
const pvs = (requestId: string, createdAt: number, derived: string): SweepChange => ({
  requestId,
  createdAt,
  from: null,
  to: derived,
});

/** "PVS: Umsatz entfernt" without any status key. */
const revenueOnly = (requestId: string, createdAt: number): SweepChange => ({
  requestId,
  createdAt,
  from: null,
  to: null,
});

describe("openCountsAtPoints", () => {
  it("matches the per-point definition on a hand-made case", () => {
    const requests: SweepRequest[] = [
      { id: "a", createdAt: 10, status: "kontaktiert" }, // neu until 25
      { id: "b", createdAt: 30, status: "neu" }, // always neu
      { id: "c", createdAt: 5, status: "neu" }, // neu, spam 12..18, neu again
      { id: "d", createdAt: 0, status: "gewonnen" }, // seeded terminal, no changes
    ];
    const changes: SweepChange[] = [
      manual("a", 25, "neu", "kontaktiert"),
      manual("c", 12, "neu", "spam"),
      manual("c", 18, "spam", "neu"),
    ];
    const points = [0, 5, 10, 12, 20, 25, 30, 40];
    expect(openCountsAtPoints(points, requests, changes)).toEqual([0, 1, 2, 1, 2, 1, 2, 2]);
    expect(openCountsAtPoints(points, requests, changes)).toEqual(
      reference(points, requests, changes)
    );
  });

  it("manual changes with from behave as before (status before = from)", () => {
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "verloren" }];
    const changes = [manual("a", 10, "neu", "kontaktiert"), manual("a", 20, "kontaktiert", "verloren")];
    expect(openCountsAtPoints([5, 15, 25], requests, changes)).toEqual([1, 0, 0]);
  });

  it("PVS change without from: neu -> termin via derivedStatus is open before, not after", () => {
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "termin_vereinbart" }];
    const changes = [pvs("a", 10, "termin_vereinbart")];
    expect(openCountsAtPoints([5, 15], requests, changes)).toEqual([1, 0]);
  });

  it("first change without from counts as leaving neu", () => {
    // Old sweep read a missing from as "not neu" and missed the open phase.
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "kontaktiert" }];
    const changes: SweepChange[] = [{ requestId: "a", createdAt: 10, from: null, to: "kontaktiert" }];
    expect(openCountsAtPoints([5, 15], requests, changes)).toEqual([1, 0]);
  });

  it("change without from takes the status of the previous change", () => {
    // neu -> kontaktiert (manual) -> termin (PVS without from): the PVS row
    // left kontaktiert, so the Anfrage is not open between the two.
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "termin_vereinbart" }];
    const changes = [manual("a", 10, "neu", "kontaktiert"), pvs("a", 20, "termin_vereinbart")];
    expect(openCountsAtPoints([5, 15, 25], requests, changes)).toEqual([1, 0, 0]);
  });

  it("prevTo from before the window decides the first change in the window", () => {
    // The change to kontaktiert happened before the window (not passed);
    // SQL LAG hands its new status over as prevTo.
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "termin_vereinbart" }];
    const changes: SweepChange[] = [
      { requestId: "a", createdAt: 20, from: null, to: "termin_vereinbart", prevTo: "kontaktiert" },
    ];
    expect(openCountsAtPoints([15, 25], requests, changes)).toEqual([0, 0]);
  });

  it("revenue-only PVS row is ignored", () => {
    // Current status neu, only a revenue row: stays open throughout.
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "neu" }];
    expect(openCountsAtPoints([5, 15], requests, [revenueOnly("a", 10)])).toEqual([1, 1]);
  });

  it("revenue-only row between two PVS changes does not reset to neu", () => {
    // neu -> termin (PVS derived) -> revenue row -> behandelt (PVS derived):
    // open before the first change, never open again after it.
    const requests: SweepRequest[] = [{ id: "a", createdAt: 0, status: "behandelt" }];
    const changes = [pvs("a", 10, "termin_vereinbart"), revenueOnly("a", 20), pvs("a", 30, "behandelt")];
    expect(openCountsAtPoints([5, 15, 25, 35], requests, changes)).toEqual([1, 0, 0, 0]);
  });

  it("matches the reference on random data (mixed manual, PVS and revenue rows)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const statuses = ["neu", "kontaktiert", "spam", "verloren", "gewonnen"];
    const pick = () => statuses[Math.floor(rnd() * 5)]!;
    for (let round = 0; round < 25; round++) {
      const requests: SweepRequest[] = [];
      const changes: SweepChange[] = [];
      for (let i = 0; i < 30; i++) {
        const createdAt = Math.floor(rnd() * 100);
        requests.push({ id: `r${i}`, createdAt, status: pick() });
        const n = Math.floor(rnd() * 4);
        const times = Array.from({ length: n }, () => createdAt + Math.floor(rnd() * 60)).sort(
          (a, b) => a - b
        );
        for (const t of times) {
          const kind = rnd();
          if (kind < 0.5) changes.push(manual(`r${i}`, t, pick(), pick()));
          else if (kind < 0.85) changes.push(pvs(`r${i}`, t, pick()));
          else changes.push(revenueOnly(`r${i}`, t));
        }
      }
      changes.sort((a, b) => a.createdAt - b.createdAt);
      const points = Array.from({ length: 20 }, (_, k) => k * 8 - 3);
      expect(openCountsAtPoints(points, requests, changes)).toEqual(
        reference(points, requests, changes)
      );
    }
  });

  it("returns an empty list for no points", () => {
    expect(openCountsAtPoints([], [{ id: "a", createdAt: 1, status: "neu" }], [])).toEqual([]);
  });
});

describe("openQueuePoints", () => {
  it("ends Berlin days correctly across the DST change on 2026-10-25", () => {
    // Window 2026-10-24 .. 2026-10-26, `from` at some instant of the first day.
    const { dates, priorAt, dayEnds } = openQueuePoints(
      new Date("2026-10-24T09:30:00Z"),
      new Date("2026-10-26T15:00:00Z")
    );
    expect(dates).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    // Midnight Berlin: 24th = 22:00Z on the 23rd (CEST), 25th = 22:00Z on the
    // 24th (CEST), 26th = 23:00Z on the 25th (CET), 27th = 23:00Z on the 26th.
    expect(new Date(priorAt + 1).toISOString()).toBe("2026-10-23T22:00:00.000Z");
    expect(dayEnds.map((t) => new Date(t + 1).toISOString())).toEqual([
      "2026-10-24T22:00:00.000Z",
      "2026-10-25T23:00:00.000Z",
      "2026-10-26T23:00:00.000Z",
    ]);
    // The 25th is 25 hours long.
    expect(dayEnds[1]! - dayEnds[0]!).toBe(25 * 3_600_000);
  });

  it("uses the Berlin day of `from`, not the UTC day", () => {
    // 23:30Z on 2026-10-24 is already 01:30 on the 25th in Berlin (CEST).
    const { dates, priorAt } = openQueuePoints(
      new Date("2026-10-24T23:30:00Z"),
      new Date("2026-10-25T12:00:00Z")
    );
    expect(dates).toEqual(["2026-10-25"]);
    expect(new Date(priorAt + 1).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });
});
