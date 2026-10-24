import { describe, expect, it } from "vitest";
import {
  CATCH_UP_AFTER_MS,
  WORKER_STALE_MS,
  isWorkerStale,
  planCatchUps,
} from "./worker-heartbeat";

const NOW = new Date("2026-07-21T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const H = 3_600_000;

describe("isWorkerStale", () => {
  it("is stale past 10 minutes", () => {
    expect(isWorkerStale(ago(WORKER_STALE_MS + 1000), NOW)).toBe(true);
    expect(isWorkerStale(ago(WORKER_STALE_MS - 1000), NOW)).toBe(false);
  });
  it("never fails the probe on missing evidence (no beat yet)", () => {
    expect(isWorkerStale(null, NOW)).toBe(false);
  });
});

describe("planCatchUps", () => {
  it("catches up jobs that never succeeded", () => {
    expect(planCatchUps(new Map(), NOW).sort()).toEqual(
      Object.keys(CATCH_UP_AFTER_MS).sort()
    );
  });
  it("catches up only the overdue job", () => {
    const last = new Map([
      ["pvs-partition-rotate", ago(30 * H)], // daily, overdue
      ["pvs-reconcile", ago(1 * H)], // 4-hourly, fine
    ]);
    expect(planCatchUps(last, NOW)).toEqual(["pvs-partition-rotate"]);
  });
  it("does nothing when both ran within their period", () => {
    const last = new Map([
      ["pvs-partition-rotate", ago(10 * H)],
      ["pvs-reconcile", ago(2 * H)],
    ]);
    expect(planCatchUps(last, NOW)).toEqual([]);
  });
});
