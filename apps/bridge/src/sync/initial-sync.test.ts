import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../portal-client.js", () => ({
  postBatch: vi.fn(),
}));

import { postBatch } from "../portal-client.js";
import { runInitialSync } from "./initial-sync.js";
import type { Adapter } from "../adapters/Adapter.js";
import type { PvsLinkRow } from "../db/client.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * Failure semantics of the initial-sync driver (reliability review C7):
 * a rejected batch must ABORT the sync (throw) instead of being counted
 * and skipped — otherwise a "completed" sync can silently be missing
 * whole batches.
 */

const link: PvsLinkRow = {
  id: "link-1",
  clinicId: "clinic-1",
  pvsVendor: "tomedo",
  status: "connected",
  preferredPath: "auto",
  connectionConfig: {},
};

function event(id: string): CanonicalEvent {
  return {
    kind: "PatientUpserted",
    clinicId: "clinic-1",
    bridgeSource: "tomedo",
    pvsExternalEventId: id,
    occurredAt: "2026-07-01T00:00:00.000Z",
  } as CanonicalEvent;
}

function adapterYielding(events: CanonicalEvent[]): Adapter {
  return {
    vendor: "tomedo",
    async connect() {
      return { ok: true as const };
    },
    async *initialSync() {
      yield* events;
    },
  };
}

const mockedPostBatch = vi.mocked(postBatch);

beforeEach(() => {
  mockedPostBatch.mockReset();
});

describe("runInitialSync", () => {
  it("streams events through postBatch and aggregates the portal counts", async () => {
    mockedPostBatch.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ingested: 2, deduped: 1, errors: [] },
    });
    const report = await runInitialSync(
      link,
      adapterYielding([event("a"), event("b"), event("c")]),
      "2025-07-01T00:00:00.000Z"
    );
    expect(mockedPostBatch).toHaveBeenCalledTimes(1);
    expect(mockedPostBatch).toHaveBeenCalledWith("clinic-1", [
      expect.objectContaining({ pvsExternalEventId: "a" }),
      expect.objectContaining({ pvsExternalEventId: "b" }),
      expect.objectContaining({ pvsExternalEventId: "c" }),
    ]);
    expect(report.totalProcessed).toBe(3);
    expect(report.ingested).toBe(2);
    expect(report.deduped).toBe(1);
    expect(report.errors).toBe(0);
  });

  it("THROWS when the portal rejects a batch instead of counting and continuing (C7)", async () => {
    mockedPostBatch.mockResolvedValue({
      ok: false,
      status: 500,
      body: { error: "boom" },
    });
    await expect(
      runInitialSync(
        link,
        adapterYielding([event("a"), event("b")]),
        "2025-07-01T00:00:00.000Z"
      )
    ).rejects.toThrow(/rejected batch/);
  });

  it("surfaces per-event portal errors in the report so the caller can refuse completion", async () => {
    mockedPostBatch.mockResolvedValue({
      ok: true,
      status: 200,
      body: { ingested: 1, deduped: 0, errors: [{ index: 1 }] },
    });
    const report = await runInitialSync(
      link,
      adapterYielding([event("a"), event("b")]),
      "2025-07-01T00:00:00.000Z"
    );
    expect(report.errors).toBe(1);
  });
});
