import { describe, expect, it, vi } from "vitest";
import {
  createFlushState,
  runFlushCycle,
  type FlushDeps,
  type FlushRow,
  type OutageSnapshot,
} from "./flush.js";
import type { PostResult } from "./portal-client.js";

/**
 * H10 + H11 flush-policy tests. runFlushCycle takes injected deps, so we drive
 * it with fake rows, a scripted postEvent, and a controllable clock — no real
 * outbox, portal, or timers.
 */

interface Harness {
  deps: FlushDeps;
  marks: { sent: number[]; retried: Array<[number, string]>; failed: Array<[number, string]> };
  logs: { warn: string[]; error: string[] };
  setNow: (n: number) => void;
  setRows: (rows: FlushRow[]) => void;
}

function harness(
  postEvent: (payload: string) => Promise<PostResult>,
  snapshot: OutageSnapshot = {
    pendingCount: 0,
    pendingWithAttemptsCount: 0,
    oldestPendingAt: null,
    failedCount: 0,
  }
): Harness {
  let now = 1_000_000;
  let rows: FlushRow[] = [];
  const marks = {
    sent: [] as number[],
    retried: [] as Array<[number, string]>,
    failed: [] as Array<[number, string]>,
  };
  const logs = { warn: [] as string[], error: [] as string[] };
  const deps: FlushDeps = {
    dueRows: (limit) => rows.slice(0, limit),
    postEvent,
    markSent: (id) => marks.sent.push(id),
    recordRetry: (id, reason) => marks.retried.push([id, reason]),
    markFailedPermanent: (id, reason) => marks.failed.push([id, reason]),
    outageSnapshot: () => snapshot,
    now: () => now,
    logWarn: (m) => logs.warn.push(m),
    logError: (m) => logs.error.push(m),
  };
  return {
    deps,
    marks,
    logs,
    setNow: (n) => (now = n),
    setRows: (r) => (rows = r),
  };
}

const authReject: PostResult = {
  ok: false,
  retryable: false,
  authFailure: true,
  reason: "http 400 (auth rejected): {\"error\":{\"code\":\"invalid_request\"}}",
};
const validationReject: PostResult = {
  ok: false,
  retryable: false,
  reason: "http 400: invalid_envelope",
};
const transientReject: PostResult = {
  ok: false,
  retryable: true,
  reason: "http 503",
};
const networkReject: PostResult = {
  ok: false,
  retryable: true,
  networkFailure: true,
  reason: "timeout after 30000ms",
};
const retryAfterReject: PostResult = {
  ok: false,
  retryable: true,
  reason: "http 429",
  retryAfterMs: 120_000,
};
const ok: PostResult = { ok: true, deduped: false };

describe("runFlushCycle — H11 auth-pause", () => {
  it("keeps rows pending, pauses, and logs loudly on an auth rejection (no permanent-fail)", async () => {
    const h = harness(async () => authReject);
    h.setRows([{ id: 1, payload: "a" }, { id: 2, payload: "b" }]);
    const state = createFlushState();

    await runFlushCycle(h.deps, state);

    // No row mutated: not sent, not retried, NOT permanently failed.
    expect(h.marks.failed).toEqual([]);
    expect(h.marks.retried).toEqual([]);
    expect(h.marks.sent).toEqual([]);
    // Pause engaged + loud log.
    expect(state.authPaused).toBe(true);
    expect(state.authPausedSince).not.toBeNull();
    expect(h.logs.error.length).toBe(1);
    expect(h.logs.error[0]).toMatch(/REJECTED THE AGENT SIGNATURE/);
  });

  it("stops after the first auth failure instead of hammering every due row", async () => {
    const postEvent = vi.fn(async () => authReject);
    const h = harness(postEvent);
    h.setRows([
      { id: 1, payload: "a" },
      { id: 2, payload: "b" },
      { id: 3, payload: "c" },
    ]);
    await runFlushCycle(h.deps, createFlushState());
    // Only the first row was attempted; the loop broke.
    expect(postEvent).toHaveBeenCalledTimes(1);
  });

  it("probes at most once per ~10 min while paused, then recovers on success", async () => {
    let result: PostResult = authReject;
    const postEvent = vi.fn(async () => result);
    const h = harness(postEvent);
    h.setRows([{ id: 1, payload: "a" }]);
    const state = createFlushState();

    // Cycle 1 at t0: enters pause, one attempt.
    h.setNow(1_000_000);
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(state.authPaused).toBe(true);

    // Cycle 2, +5 min: still paused, before the probe window → no attempt.
    h.setNow(1_000_000 + 5 * 60_000);
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(1);

    // Cycle 3, +10 min: probe fires. Secret fixed → success clears the pause.
    result = ok;
    h.setNow(1_000_000 + 10 * 60_000);
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(2);
    expect(state.authPaused).toBe(false);
    expect(state.authPausedSince).toBeNull();
    expect(h.marks.sent).toEqual([1]);
    expect(h.logs.warn.some((m) => /authentication recovered/.test(m))).toBe(true);
  });
});

describe("runFlushCycle — non-auth failures", () => {
  it("marks a validation 400 permanently failed (unchanged behaviour)", async () => {
    const h = harness(async () => validationReject);
    h.setRows([{ id: 7, payload: "x" }]);
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.marks.failed).toEqual([[7, validationReject.reason]]);
    expect(state.authPaused).toBe(false);
  });

  it("re-queues a transient 5xx via recordRetry", async () => {
    const h = harness(async () => transientReject);
    h.setRows([{ id: 9, payload: "y" }]);
    await runFlushCycle(h.deps, createFlushState());
    expect(h.marks.retried).toEqual([[9, transientReject.reason]]);
  });

  it("marks a successful row sent", async () => {
    const h = harness(async () => ok);
    h.setRows([{ id: 3, payload: "z" }]);
    await runFlushCycle(h.deps, createFlushState());
    expect(h.marks.sent).toEqual([3]);
  });
});

describe("runFlushCycle — M-A3 fast-abort on unreachable portal", () => {
  it("stops after the first network/timeout failure instead of burning a timeout per row", async () => {
    const postEvent = vi.fn(async () => networkReject);
    const h = harness(postEvent);
    h.setRows([
      { id: 1, payload: "a" },
      { id: 2, payload: "b" },
      { id: 3, payload: "c" },
    ]);
    const state = createFlushState();

    await runFlushCycle(h.deps, state);

    // Only the first row was attempted; the cycle broke before the rest.
    expect(postEvent).toHaveBeenCalledTimes(1);
    // The attempted row is recorded as a retry; the un-attempted rows stay
    // fully pending (never sent, retried, or permanently failed).
    expect(h.marks.retried).toEqual([[1, networkReject.reason]]);
    expect(h.marks.sent).toEqual([]);
    expect(h.marks.failed).toEqual([]);
    // Not an auth failure, so flushing is not paused.
    expect(state.authPaused).toBe(false);
    // No Retry-After was set on a plain network failure.
    expect(state.retryAfterMs).toBeNull();
  });

  it("still grinds through all rows for a retryable failure that is NOT network-class (e.g. bare 5xx)", async () => {
    const postEvent = vi.fn(async () => transientReject);
    const h = harness(postEvent);
    h.setRows([
      { id: 1, payload: "a" },
      { id: 2, payload: "b" },
      { id: 3, payload: "c" },
    ]);
    await runFlushCycle(h.deps, createFlushState());
    // A bare 5xx (portal responding, per-row) does not fast-abort: each row is
    // cheap (no 30s timeout) so we keep draining the batch.
    expect(postEvent).toHaveBeenCalledTimes(3);
  });
});

describe("runFlushCycle — M-A3 Retry-After backoff", () => {
  it("aborts the cycle and surfaces the requested backoff on a Retry-After", async () => {
    const postEvent = vi.fn(async () => retryAfterReject);
    const h = harness(postEvent);
    h.setRows([
      { id: 1, payload: "a" },
      { id: 2, payload: "b" },
      { id: 3, payload: "c" },
    ]);
    const state = createFlushState();

    await runFlushCycle(h.deps, state);

    // Only the first row attempted; backoff surfaced for the scheduler.
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(state.retryAfterMs).toBe(120_000);
    expect(h.marks.retried).toEqual([[1, retryAfterReject.reason]]);
    expect(h.marks.sent).toEqual([]);
    expect(h.marks.failed).toEqual([]);
  });

  it("resets a stale backoff at the start of the next cycle", async () => {
    let result: PostResult = retryAfterReject;
    const h = harness(async () => result);
    h.setRows([{ id: 1, payload: "a" }]);
    const state = createFlushState();

    await runFlushCycle(h.deps, state);
    expect(state.retryAfterMs).toBe(120_000);

    // Next cycle succeeds → the backoff must clear, not linger.
    result = ok;
    await runFlushCycle(h.deps, state);
    expect(state.retryAfterMs).toBeNull();
  });
});

describe("runFlushCycle — H10 outage summary rate-limit", () => {
  it("logs the outage summary at most once per 10 min", async () => {
    const snapshot: OutageSnapshot = {
      pendingCount: 42,
      pendingWithAttemptsCount: 40,
      oldestPendingAt: 900_000,
      failedCount: 0,
    };
    const h = harness(async () => transientReject, snapshot);
    h.setRows([{ id: 1, payload: "a" }]);
    const state = createFlushState();

    h.setNow(1_000_000);
    await runFlushCycle(h.deps, state);
    h.setNow(1_000_000 + 60_000); // +1 min
    await runFlushCycle(h.deps, state);
    h.setNow(1_000_000 + 5 * 60_000); // +5 min
    await runFlushCycle(h.deps, state);

    const outageLines = h.logs.warn.filter((m) => /portal upload is failing/.test(m));
    expect(outageLines.length).toBe(1);
    expect(outageLines[0]).toMatch(/42 event\(s\) queued/);
    expect(outageLines[0]).toMatch(/40 already retrying/);

    // +10 min from the first: the summary is allowed again.
    h.setNow(1_000_000 + 10 * 60_000);
    await runFlushCycle(h.deps, state);
    expect(h.logs.warn.filter((m) => /portal upload is failing/.test(m)).length).toBe(2);
  });

  it("does not emit the generic outage line while auth-paused (auth log covers it)", async () => {
    const h = harness(async () => authReject, {
      pendingCount: 5,
      pendingWithAttemptsCount: 5,
      oldestPendingAt: 1,
      failedCount: 0,
    });
    h.setRows([{ id: 1, payload: "a" }]);
    await runFlushCycle(h.deps, createFlushState());
    expect(h.logs.warn.filter((m) => /portal upload is failing/.test(m))).toEqual([]);
  });
});
