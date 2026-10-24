import { describe, expect, it } from "vitest";
import { createFlushState, runFlushCycle, type FlushDeps, type FlushRow } from "./flush.js";
import type { BatchPostResult } from "./portal-client.js";

/**
 * Pass 2 (verifier): the B2 breaker only guarded single-event mode. In batch
 * mode (the default) a per-event permanent reject inside a 201 was
 * dead-lettered at once, so a portal/agent schema mismatch after a deploy
 * dead-lettered every batch until someone ran --requeue-failed on the PC.
 * When most of a batch is rejected for the SAME reason it is about the
 * route or the version, not the events: hold them all for retry.
 */

function harness(postBatch: (p: string[]) => Promise<BatchPostResult>, n: number) {
  const sent: number[] = [];
  const retried: number[] = [];
  const failed: number[] = [];
  const errors: string[] = [];
  const rows: FlushRow[] = Array.from({ length: n }, (_, i) => ({ id: i + 1, payload: `{"i":${i + 1}}` }));
  const deps: FlushDeps = {
    dueRows: (limit) => rows.slice(0, limit),
    postEvent: async () => ({ ok: true, deduped: false }),
    postBatch,
    markSent: (id) => sent.push(id),
    recordRetry: (id) => retried.push(id),
    markFailedPermanent: (id) => failed.push(id),
    outageSnapshot: () => ({ pendingCount: 0, pendingWithAttemptsCount: 0, oldestPendingAt: null, failedCount: 0 }),
    now: () => 1_000_000_000_000,
    monotonicNow: () => 1_000,
    logWarn: () => {},
    logError: (m) => errors.push(m),
  };
  return { deps, sent, retried, failed, errors };
}

const outcomes = (spec: Array<"ok" | "bad" | "other">): BatchPostResult => ({
  ok: true,
  outcomes: spec.map((s) =>
    s === "ok"
      ? { ok: true as const, deduped: false }
      : { ok: false as const, retryable: false, reason: s === "bad" ? "invalid_envelope" : "billing_conflict" }
  ),
});

describe("pass 2: batch-mode breaker for systemic permanent rejects", () => {
  it("a batch rejected entirely for one reason dead-letters nothing and backs off", async () => {
    const h = harness(async (p) => outcomes(p.map(() => "bad")), 20);
    const state = createFlushState();
    await runFlushCycle(h.deps, state);
    expect(h.failed).toEqual([]);
    expect(h.retried).toHaveLength(20);
    expect(state.retryAfterMs).not.toBeNull();
    expect(h.errors.join("\n")).toContain("invalid_envelope");
  });

  it("a few genuinely bad events in a healthy batch are still dead-lettered", async () => {
    const spec: Array<"ok" | "bad"> = Array.from({ length: 20 }, (_, i) => (i < 5 ? "bad" : "ok"));
    const h = harness(async () => outcomes(spec), 20);
    await runFlushCycle(h.deps, createFlushState());
    expect(h.failed).toEqual([1, 2, 3, 4, 5]);
    expect(h.sent).toHaveLength(15);
  });

  it("fewer than 5 permanent rejects are dead-lettered even when they are the whole batch", async () => {
    const h = harness(async (p) => outcomes(p.map(() => "bad")), 3);
    await runFlushCycle(h.deps, createFlushState());
    expect(h.failed).toEqual([1, 2, 3]);
  });
});
