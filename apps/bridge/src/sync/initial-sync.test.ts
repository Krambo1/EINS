import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../portal-client.js", () => ({
  postAll: vi.fn(),
  POST_CHUNK: 200,
}));

import { postAll, type PostAllResult } from "../portal-client.js";
import { runInitialSync } from "./initial-sync.js";
import type { Adapter } from "../adapters/Adapter.js";
import type { PvsLinkRow } from "../db/client.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * Failure semantics of the all-or-nothing initial-sync driver (push adapters;
 * REST adapters are resumable and covered in scheduler.resilience.test.ts):
 *   - events failing RETRYABLY abort the run (so a sync can never "complete"
 *     with whole batches missing);
 *   - permanently rejected events are skipped and counted, never block.
 */

const link: PvsLinkRow = {
  id: "link-1",
  clinicId: "clinic-1",
  pvsVendor: "healthhub",
  status: "connected",
  preferredPath: "auto",
  connectionConfig: {},
};

function event(id: string): CanonicalEvent {
  return {
    kind: "PatientUpserted",
    clinicId: "clinic-1",
    bridgeSource: "healthhub",
    pvsExternalEventId: id,
    occurredAt: "2026-07-01T00:00:00.000Z",
    pvsPatientId: id,
  };
}

function adapterYielding(events: CanonicalEvent[]): Adapter {
  return {
    vendor: "healthhub",
    async connect() {
      return { ok: true as const };
    },
    async *initialSync() {
      yield* events;
    },
  };
}

function res(over: Partial<PostAllResult> = {}): PostAllResult {
  return {
    ingested: 0,
    deduped: 0,
    quarantined: 0,
    errors: 0,
    skipped: 0,
    skippedByReason: {},
    dropped: 0,
    droppedByReason: {},
    ...over,
  };
}

const mockedPostAll = vi.mocked(postAll);
beforeEach(() => {
  mockedPostAll.mockReset();
});

describe("runInitialSync", () => {
  it("streams events through postAll (paced) and aggregates the portal counts", async () => {
    mockedPostAll.mockResolvedValue(res({ ingested: 2, deduped: 1 }));
    const report = await runInitialSync(
      link,
      adapterYielding([event("a"), event("b"), event("c")]),
      "2025-07-01T00:00:00.000Z"
    );
    expect(mockedPostAll).toHaveBeenCalledTimes(1);
    expect(mockedPostAll).toHaveBeenCalledWith(
      "clinic-1",
      [
        expect.objectContaining({ pvsExternalEventId: "a" }),
        expect.objectContaining({ pvsExternalEventId: "b" }),
        expect.objectContaining({ pvsExternalEventId: "c" }),
      ],
      expect.objectContaining({ paceMs: 10_000 })
    );
    expect(report.totalProcessed).toBe(3);
    expect(report.ingested).toBe(2);
    expect(report.deduped).toBe(1);
    expect(report.errors).toBe(0);
  });

  it("batches at 200 events", async () => {
    mockedPostAll.mockResolvedValue(res({ ingested: 200 }));
    const many = Array.from({ length: 450 }, (_, i) => event(`e${i}`));
    await runInitialSync(link, adapterYielding(many), "2025-07-01T00:00:00.000Z");
    expect(mockedPostAll.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([200, 200, 50]);
  });

  it("THROWS with status + reason when events fail retryably, instead of counting and continuing (C7)", async () => {
    mockedPostAll.mockResolvedValue(res({ errors: 2, failure: "http 502: http_502 x2" }));
    await expect(
      runInitialSync(link, adapterYielding([event("a"), event("b")]), "2025-07-01T00:00:00.000Z")
    ).rejects.toThrow(/did not accept 2 event\(s\).*http 502/);
    expect(mockedPostAll).toHaveBeenCalledTimes(1); // did not keep pounding
  });

  it("permanently rejected / dropped events are counted in the report and do not abort", async () => {
    mockedPostAll.mockResolvedValue(
      res({ ingested: 1, skipped: 1, skippedByReason: { invalid_envelope: 1 }, dropped: 1, droppedByReason: { "PatientUpserted:email": 1 } })
    );
    const report = await runInitialSync(
      link,
      adapterYielding([event("a"), event("b")]),
      "2025-07-01T00:00:00.000Z"
    );
    expect(report.errors).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.skippedByReason).toEqual({ invalid_envelope: 1 });
    expect(report.dropped).toBe(1);
  });
});
