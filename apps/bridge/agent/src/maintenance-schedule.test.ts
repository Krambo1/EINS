import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleMaintenance } from "./maintenance-schedule.js";

/**
 * WP-C A7: the vacuum / prune / failure-summary tick only ever fired after 24 h
 * of CONTINUOUS uptime, which a Praxis PC that is shut down every night never
 * reaches. It now runs once shortly after start, then every 24 h.
 */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("scheduleMaintenance", () => {
  it("runs once within 2 minutes of start, then every 24 h", async () => {
    const run = vi.fn();
    scheduleMaintenance({ run });
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("the first run is about 60 s after start", async () => {
    const run = vi.fn();
    scheduleMaintenance({ run });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stop() cancels both the first run and the interval", async () => {
    const run = vi.fn();
    const handle = scheduleMaintenance({ run });
    handle.stop();
    await vi.advanceTimersByTimeAsync(48 * 3_600_000);
    expect(run).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a throwing run does not kill the schedule", async () => {
    const run = vi.fn(() => {
      throw new Error("disk full");
    });
    const errors: unknown[] = [];
    scheduleMaintenance({ run, onError: (e) => errors.push(e) });
    await vi.advanceTimersByTimeAsync(60_000 + 24 * 3_600_000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(errors).toHaveLength(2);
  });

  it("a rejecting async run is contained too", async () => {
    const run = vi.fn(async () => {
      throw new Error("portal down");
    });
    const errors: unknown[] = [];
    scheduleMaintenance({ run, onError: (e) => errors.push(e) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toHaveLength(1);
  });
});
