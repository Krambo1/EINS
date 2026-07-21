import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db/client.js", () => ({
  loadDueLinks: vi.fn(),
  checkpointSync: vi.fn(),
  recordFailure: vi.fn(),
  markInitialSyncStarted: vi.fn(),
  completeInitialSync: vi.fn(),
}));
vi.mock("../portal-client.js", () => ({
  postAll: vi.fn(),
  postBatch: vi.fn(),
}));
vi.mock("../config.js", () => ({
  env: () => ({
    SCHEDULER_TICK_MS: 30_000,
    FAIL_THRESHOLD: 5,
    PORTAL_BASE_URL: "http://portal.test",
  }),
}));

import {
  checkpointSync,
  recordFailure,
  markInitialSyncStarted,
  completeInitialSync,
  type PvsLinkRow,
} from "../db/client.js";
import { postAll, postBatch } from "../portal-client.js";
import { _internal } from "./scheduler.js";
import { tomedoAdapter } from "../adapters/tomedo/index.js";
import type { Adapter } from "../adapters/Adapter.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * Scheduler branch coverage for the two poll-path criticals:
 *
 *   C5 — the incremental cursor must round-trip: runPoll reads
 *        link.lastCursor (joined from pvs_sync_status by loadDueLinks) and
 *        checkpointSync persists the adapter's nextCursor back to the same
 *        place. The old code read connectionConfig.lastCursor, which
 *        nothing ever wrote → permanent full-history refetch.
 *
 *   C7 — a link without a completed initial sync runs the historical
 *        backfill first; on success the poll cursor is seeded with the
 *        sync-start watermark; on any error nothing is marked complete.
 */

function link(overrides: Partial<PvsLinkRow> = {}): PvsLinkRow {
  return {
    id: "link-1",
    clinicId: "clinic-1",
    pvsVendor: "tomedo",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: {},
    lastCursor: null,
    initialSyncCompletedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function event(id: string): CanonicalEvent {
  return {
    kind: "PatientUpserted",
    clinicId: "clinic-1",
    bridgeSource: "tomedo",
    pvsExternalEventId: id,
    occurredAt: "2026-07-01T00:00:00.000Z",
  } as CanonicalEvent;
}

beforeEach(() => {
  vi.mocked(checkpointSync).mockReset().mockResolvedValue(undefined);
  vi.mocked(recordFailure).mockReset().mockResolvedValue(undefined);
  vi.mocked(markInitialSyncStarted).mockReset().mockResolvedValue(undefined);
  vi.mocked(completeInitialSync).mockReset().mockResolvedValue(undefined);
  vi.mocked(postAll)
    .mockReset()
    .mockResolvedValue({ ingested: 0, deduped: 0, errors: 0 });
  vi.mocked(postBatch)
    .mockReset()
    .mockResolvedValue({ ok: true, status: 200, body: { ingested: 1 } });
});

describe("runPoll cursor round-trip (C5)", () => {
  it("passes the pvs_sync_status cursor to the adapter and checkpoints the next one", async () => {
    const poll = vi.fn(async () => ({
      events: [event("e1")],
      nextCursor: "CURSOR-NEXT",
      recommendedDelayMs: 1_000,
    }));
    const adapter: Adapter = {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll,
    };
    const l = link({ lastCursor: "CURSOR-PREV" });
    await _internal.runPoll(l, adapter);
    expect(poll).toHaveBeenCalledWith(l, "CURSOR-PREV");
    expect(checkpointSync).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({ cursor: "CURSOR-NEXT" })
    );
  });

  it("passes null on the very first poll (no cursor persisted yet)", async () => {
    const poll = vi.fn(async () => ({
      events: [],
      nextCursor: "C1",
    }));
    const adapter: Adapter = {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll,
    };
    const l = link({ lastCursor: null });
    await _internal.runPoll(l, adapter);
    expect(poll).toHaveBeenCalledWith(l, null);
  });
});

describe("runInitialLoad (C7)", () => {
  function backfillAdapter(opts: {
    events: CanonicalEvent[];
    seed?: (iso: string) => string;
  }): Adapter {
    return {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {
        yield* opts.events;
      },
      seedCursor: opts.seed,
    };
  }

  it("marks completion and seeds the cursor with the sync-start watermark", async () => {
    vi.mocked(postBatch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { ingested: 1, deduped: 0, errors: [] },
    });
    const adapter = backfillAdapter({
      events: [event("e1")],
      seed: (iso) => `seed:${iso}`,
    });
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), adapter);
    expect(markInitialSyncStarted).toHaveBeenCalledWith("link-1");
    expect(completeInitialSync).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({
        cursor: expect.stringMatching(
          /^seed:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        ),
        eventsIngested: 1,
      })
    );
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("does NOT mark completion when a batch is rejected; records a failure instead", async () => {
    vi.mocked(postBatch).mockResolvedValue({
      ok: false,
      status: 502,
      body: {},
    });
    const adapter = backfillAdapter({ events: [event("e1")] });
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), adapter);
    expect(completeInitialSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      "link-1",
      expect.stringContaining("initial sync"),
      5
    );
  });

  it("does NOT mark completion when the portal reports per-event errors", async () => {
    vi.mocked(postBatch).mockResolvedValue({
      ok: true,
      status: 200,
      body: { ingested: 0, deduped: 0, errors: [{ index: 0 }] },
    });
    const adapter = backfillAdapter({ events: [event("e1")] });
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), adapter);
    expect(completeInitialSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalled();
  });
});

describe("runPoll post-error handling (H14)", () => {
  function pollAdapter(nextCursor: string): Adapter {
    return {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll: vi.fn(async () => ({
        events: [event("e1"), event("e2")],
        nextCursor,
        recommendedDelayMs: 1_000,
      })),
    };
  }

  it("does NOT checkpoint when postAll reports errors > 0; records a failure instead", async () => {
    vi.mocked(postAll).mockResolvedValue({ ingested: 1, deduped: 0, errors: 1 });
    await _internal.runPoll(link({ lastCursor: "CURSOR-PREV" }), pollAdapter("CURSOR-NEXT"));
    expect(checkpointSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      "link-1",
      expect.stringContaining("failed to post"),
      5
    );
  });

  it("checkpoints normally when errors == 0", async () => {
    vi.mocked(postAll).mockResolvedValue({ ingested: 2, deduped: 0, errors: 0 });
    await _internal.runPoll(link({ lastCursor: "CURSOR-PREV" }), pollAdapter("CURSOR-NEXT"));
    expect(checkpointSync).toHaveBeenCalledWith(
      "link-1",
      expect.objectContaining({ cursor: "CURSOR-NEXT" })
    );
    expect(recordFailure).not.toHaveBeenCalled();
  });
});

describe("runPoll wall-clock budget (H15)", () => {
  it("fails a hung poll via recordFailure without checkpointing, and returns (tick continues)", async () => {
    // Adapter poll never resolves. The injected deadline fires first.
    const adapter: Adapter = {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll: (() => new Promise(() => {})) as Adapter["poll"],
    };
    await expect(
      _internal.runPoll(link({ lastCursor: "CURSOR-PREV" }), adapter, {
        deadlineMs: 10,
      })
    ).resolves.toBeUndefined();
    expect(checkpointSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      "link-1",
      expect.stringContaining("wall-clock budget"),
      5
    );
  });

  it("a poll that eventually resolves AFTER losing the race never checkpoints", async () => {
    let resolvePoll: (v: {
      events: CanonicalEvent[];
      nextCursor: string;
    }) => void = () => {};
    const adapter: Adapter = {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll: (() =>
        new Promise((res) => {
          resolvePoll = res as typeof resolvePoll;
        })) as Adapter["poll"],
    };
    vi.mocked(postAll).mockResolvedValue({ ingested: 1, deduped: 0, errors: 0 });
    await _internal.runPoll(link({ lastCursor: "CURSOR-PREV" }), adapter, {
      deadlineMs: 10,
    });
    // The link already lost the race and was failed. Now let the adapter
    // resolve late; the loser must not checkpoint.
    resolvePoll({ events: [event("e1")], nextCursor: "LATE-CURSOR" });
    await new Promise((r) => setTimeout(r, 20));
    expect(checkpointSync).not.toHaveBeenCalled();
  });
});

describe("runInitialLoad wall-clock budget (H15)", () => {
  it("fails a hung initial sync via recordFailure without completing it", async () => {
    const adapter: Adapter = {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      // Never-ending initial sync stream.
      initialSync: () =>
        ({
          [Symbol.asyncIterator]() {
            return { next: () => new Promise<never>(() => {}) };
          },
        }) as AsyncIterable<CanonicalEvent>,
    };
    await expect(
      _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), adapter, {
        deadlineMs: 10,
      })
    ).resolves.toBeUndefined();
    expect(completeInitialSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledWith(
      "link-1",
      expect.stringContaining("wall-clock budget"),
      5
    );
  });
});

describe("seedCursor watermark format", () => {
  it("tomedo seeds every stream cursor at the sync-start timestamp", () => {
    const iso = "2026-07-19T10:00:00.000Z";
    expect(tomedoAdapter.seedCursor!(iso)).toBe(
      [iso, iso, iso, iso, iso].join(",")
    );
  });
});
