import { describe, expect, it, vi } from "vitest";
import {
  createFlushState,
  flushTick,
  runFlushCycle,
  uploadStateSnapshot,
  type FlushDeps,
  type FlushRow,
} from "./flush.js";
import type { BatchPostResult, PostResult } from "./portal-client.js";

/**
 * WP-C flush-loop hardening (A9, A12, B2 breaker, B3, B4, B5). runFlushCycle
 * takes injected deps, so wall clock, monotonic clock and transports are all
 * scripted here.
 */

function rows(n: number): FlushRow[] {
  return Array.from({ length: n }, (_, i) => ({ id: i + 1, payload: `{"i":${i + 1}}` }));
}

interface H {
  deps: FlushDeps;
  sent: number[];
  retried: Array<{ id: number; reason: string; rand?: () => number }>;
  failed: Array<[number, string]>;
  clock: { wall: number; mono: number };
  set: { rows: FlushRow[] };
}

function harness(opts: {
  postEvent?: (p: string) => Promise<PostResult>;
  postBatch?: (p: string[]) => Promise<BatchPostResult>;
  n?: number;
  portalReachable?: () => boolean;
}): H {
  const clock = { wall: 1_000_000_000_000, mono: 1_000 };
  const sent: number[] = [];
  const retried: H["retried"] = [];
  const failed: Array<[number, string]> = [];
  const set = { rows: rows(opts.n ?? 3) };
  const deps: FlushDeps = {
    dueRows: (limit) => set.rows.slice(0, limit),
    postEvent: opts.postEvent ?? (async () => ({ ok: true, deduped: false })),
    ...(opts.postBatch ? { postBatch: opts.postBatch } : {}),
    markSent: (id) => sent.push(id),
    recordRetry: (id, reason, rand) => retried.push({ id, reason, rand }),
    markFailedPermanent: (id, reason) => failed.push([id, reason]),
    outageSnapshot: () => ({
      pendingCount: 0,
      pendingWithAttemptsCount: 0,
      oldestPendingAt: null,
      failedCount: 0,
    }),
    now: () => clock.wall,
    monotonicNow: () => clock.mono,
    ...(opts.portalReachable ? { portalReachable: opts.portalReachable } : {}),
    logWarn: () => {},
    logError: () => {},
  };
  return { deps, sent, retried, failed, clock, set };
}

describe("A9: in-memory gates use the monotonic clock", () => {
  it("the auth-probe cadence survives a backward wall-clock step", async () => {
    const postEvent = vi.fn(async (): Promise<PostResult> => ({
      ok: false,
      retryable: false,
      authFailure: true,
      reason: "http 400 (auth rejected)",
    }));
    const h = harness({ postEvent });
    const state = createFlushState();
    await runFlushCycle(h.deps, state); // enters the pause, that cycle is the first probe
    expect(state.authPaused).toBe(true);
    expect(postEvent).toHaveBeenCalledTimes(1);

    // The clock is set back a day (NTP fix); 10 min 1 s of real time pass.
    h.clock.wall -= 24 * 3_600_000;
    h.clock.mono += 10 * 60_000 + 1_000;
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(2); // probed again, not frozen
  });

  it("flushTick is not frozen by a backward wall-clock step after a backoff", async () => {
    const postBatch = vi.fn(async (): Promise<BatchPostResult> => ({
      ok: false,
      retryable: true,
      reason: "http 503",
      httpStatus: 503,
    }));
    const h = harness({ postBatch });
    const state = createFlushState();
    expect(await flushTick(h.deps, state)).toBe(true); // runs, fails, backs off 5 s
    expect(state.retryAfterMs).toBe(5_000);

    // Immediately after: gate closed.
    h.clock.mono += 1_000;
    expect(await flushTick(h.deps, state)).toBe(false);

    // Wall clock jumps back a day, 6 s of real time have passed: gate opens.
    h.clock.wall -= 24 * 3_600_000;
    h.clock.mono += 5_000;
    expect(await flushTick(h.deps, state)).toBe(true);
    expect(postBatch).toHaveBeenCalledTimes(2);
  });

  it("flushTick never overlaps two cycles", async () => {
    let release: () => void = () => {};
    const postEvent = vi.fn(
      () =>
        new Promise<PostResult>((resolve) => {
          release = () => resolve({ ok: true, deduped: false });
        })
    );
    const h = harness({ postEvent, n: 1 });
    const state = createFlushState();
    const first = flushTick(h.deps, state);
    expect(await flushTick(h.deps, state)).toBe(false);
    release();
    await first;
    expect(postEvent).toHaveBeenCalledTimes(1);
  });
});

describe("A12: an all-retryable 201 batch is a transient batch failure", () => {
  const allRetryable = (n: number): BatchPostResult => ({
    ok: true,
    outcomes: Array.from({ length: n }, () => ({
      ok: false as const,
      retryable: true,
      reason: "internal_error",
    })),
  });

  it("backs the cycle off exponentially instead of re-posting every tick", async () => {
    const postBatch = vi.fn(async () => allRetryable(3));
    const h = harness({ postBatch });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.retried.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(state.consecutiveTransientFailures).toBe(1);
    expect(state.retryAfterMs).toBe(5_000);
    await runFlushCycle(h.deps, state);
    expect(state.consecutiveTransientFailures).toBe(2);
    expect(state.retryAfterMs).toBe(10_000);
  });

  it("a batch with at least one stored event does not back off and resets the counter", async () => {
    const results: BatchPostResult[] = [
      allRetryable(3),
      {
        ok: true,
        outcomes: [
          { ok: true },
          { ok: false, retryable: true, reason: "internal_error" },
          { ok: false, retryable: true, reason: "internal_error" },
        ],
      },
    ];
    const postBatch = vi.fn(async () => results.shift()!);
    const h = harness({ postBatch });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(state.consecutiveTransientFailures).toBe(1);
    await runFlushCycle(h.deps, state);
    expect(state.consecutiveTransientFailures).toBe(0);
    expect(state.retryAfterMs).toBeNull();
  });
});

describe("B4: repeated batch timeouts and ambiguous responses switch to single mode", () => {
  const timeout: BatchPostResult = {
    ok: false,
    retryable: true,
    networkFailure: true,
    timedOut: true,
    reason: "timeout after 30000ms",
  };

  it("3 consecutive timeouts while the portal is reachable set singleModeNext", async () => {
    const h = harness({ postBatch: async () => timeout, portalReachable: () => true });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    await runFlushCycle(h.deps, state);
    expect(state.singleModeNext).toBe(false);
    await runFlushCycle(h.deps, state);
    expect(state.singleModeNext).toBe(true);
  });

  it("does not switch while heartbeats fail (the portal is simply down)", async () => {
    const h = harness({ postBatch: async () => timeout, portalReachable: () => false });
    const state = createFlushState();
    for (let i = 0; i < 5; i++) await runFlushCycle(h.deps, state);
    expect(state.singleModeNext).toBe(false);
  });

  it("a success in between resets the timeout streak", async () => {
    const seq: BatchPostResult[] = [
      timeout,
      timeout,
      { ok: true, outcomes: [{ ok: true }, { ok: true }, { ok: true }] },
      timeout,
      timeout,
    ];
    const h = harness({ postBatch: async () => seq.shift()! });
    const state = createFlushState();
    for (let i = 0; i < 5; i++) await runFlushCycle(h.deps, state);
    expect(state.singleModeNext).toBe(false);
  });

  it("3 consecutive ambiguous responses set singleModeNext", async () => {
    const h = harness({
      postBatch: async () => ({
        ok: false,
        retryable: true,
        ambiguous: true,
        reason: "ambiguous batch response",
      }),
    });
    const state = createFlushState();
    for (let i = 0; i < 3; i++) await runFlushCycle(h.deps, state);
    expect(state.singleModeNext).toBe(true);
  });

  it("the isolation cycle then sends row by row", async () => {
    const postEvent = vi.fn(async (): Promise<PostResult> => ({ ok: true, deduped: false }));
    const h = harness({ postBatch: async () => timeout, postEvent });
    const state = createFlushState();
    for (let i = 0; i < 3; i++) await runFlushCycle(h.deps, state);
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(3);
    expect(h.sent).toEqual([1, 2, 3]);
  });
});

describe("B3: rows that fail in one cycle share one jitter draw", () => {
  it("single mode: every retry of a cycle gets the same rand source", async () => {
    const h = harness({
      n: 4,
      postEvent: async () => ({ ok: false, retryable: true, reason: "http 503", httpStatus: 503 }),
    });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.retried).toHaveLength(4);
    const draws = h.retried.map((r) => r.rand!());
    expect(new Set(draws).size).toBe(1);
    // and a repeated call on the same source is stable within the cycle
    expect(h.retried[0]!.rand!()).toBe(draws[0]);
  });

  it("a later cycle draws a fresh value", async () => {
    const h = harness({
      n: 1,
      postEvent: async () => ({ ok: false, retryable: true, reason: "http 503", httpStatus: 503 }),
    });
    const state = createFlushState();
    const spy = vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    await runFlushCycle(h.deps, state);
    await runFlushCycle(h.deps, state);
    spy.mockRestore();
    expect(h.retried[0]!.rand!()).toBe(0.1);
    expect(h.retried[1]!.rand!()).toBe(0.9);
  });

  it("single mode with 5xx also sets a cycle-level backoff", async () => {
    const h = harness({
      n: 3,
      postEvent: async () => ({ ok: false, retryable: true, reason: "http 503", httpStatus: 503 }),
    });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(state.retryAfterMs).toBe(5_000);
    await runFlushCycle(h.deps, state);
    expect(state.retryAfterMs).toBe(10_000);
  });
});

describe("B2: breaker on consecutive per-row permanent failures with one status", () => {
  const perm = (status: number): PostResult => ({
    ok: false,
    retryable: false,
    reason: `http ${status}: {"error":{"code":"clinic_not_found"}}`,
    httpStatus: status,
  });

  it("20 rows all rejected 404 dead-letter nothing and stop after 5 requests", async () => {
    const postEvent = vi.fn(async () => perm(404));
    const h = harness({ n: 20, postEvent });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(5);
    expect(h.failed).toEqual([]);
    expect(h.retried.map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(state.retryAfterMs).not.toBeNull();
  });

  it("fewer than 5 in a row are still dead-lettered", async () => {
    const results: PostResult[] = [perm(400), perm(400), perm(400), { ok: true, deduped: false }, perm(400)];
    const h = harness({ n: 5, postEvent: async () => results.shift()! });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.failed.map(([id]) => id)).toEqual([1, 2, 3, 5]);
    expect(h.sent).toEqual([4]);
  });

  it("different statuses do not accumulate", async () => {
    const results = [perm(400), perm(404), perm(400), perm(404), perm(400), perm(404)];
    const h = harness({ n: 6, postEvent: async () => results.shift()! });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.failed).toHaveLength(6);
  });

  it("an unrecognized response (HTML) aborts the cycle after one request", async () => {
    const postEvent = vi.fn(
      async (): Promise<PostResult> => ({
        ok: false,
        retryable: true,
        reason: "http 404: <html>",
        httpStatus: 404,
        unrecognizedResponse: true,
      })
    );
    const h = harness({ n: 10, postEvent });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(postEvent).toHaveBeenCalledTimes(1);
    expect(h.retried.map((r) => r.id)).toEqual([1]);
    expect(h.failed).toEqual([]);
    expect(state.retryAfterMs).toBe(5_000);
  });
});

describe("B5: upload state snapshot", () => {
  it("records the last batch error, its time, the streak and the last success", async () => {
    const seq: BatchPostResult[] = [
      { ok: false, retryable: true, reason: "http 502", httpStatus: 502 },
      { ok: true, outcomes: [{ ok: true }, { ok: true }, { ok: true }] },
    ];
    const h = harness({ postBatch: async () => seq.shift()! });
    const state = createFlushState();
    expect(uploadStateSnapshot(state)).toEqual({
      authPaused: false,
      lastBatchError: null,
      lastBatchErrorAt: null,
      consecutiveTransientFailures: 0,
      lastSuccessAt: null,
    });
    await runFlushCycle(h.deps, state);
    expect(uploadStateSnapshot(state)).toMatchObject({
      authPaused: false,
      lastBatchError: "http 502",
      lastBatchErrorAt: h.clock.wall,
      consecutiveTransientFailures: 1,
      lastSuccessAt: null,
    });
    h.clock.wall += 60_000;
    await runFlushCycle(h.deps, state);
    expect(uploadStateSnapshot(state)).toMatchObject({
      consecutiveTransientFailures: 0,
      lastSuccessAt: h.clock.wall,
    });
  });

  it("reports an auth pause", async () => {
    const h = harness({
      postEvent: async () => ({
        ok: false,
        retryable: false,
        authFailure: true,
        reason: "http 401 (auth rejected)",
      }),
    });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(uploadStateSnapshot(state)).toMatchObject({
      authPaused: true,
      lastBatchError: "http 401 (auth rejected)",
    });
  });

  it("a per-event retry reason in a 201 batch is reported as the last error", async () => {
    const h = harness({
      postBatch: async () => ({
        ok: true,
        outcomes: [
          { ok: false, retryable: true, reason: "link_not_ready" },
          { ok: false, retryable: true, reason: "link_not_ready" },
          { ok: false, retryable: true, reason: "link_not_ready" },
        ],
      }),
    });
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(uploadStateSnapshot(state).lastBatchError).toBe("link_not_ready");
  });
});
