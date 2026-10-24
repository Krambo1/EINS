import { beforeEach, describe, expect, it, vi } from "vitest";

let rows: Array<{ id: string }>;
const reapply = vi.fn();
const reenqueue = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => rows }),
        }),
      }),
    }),
  },
  schema: {
    pvsEventLog: { id: {}, appliedAt: {}, ingestedAt: {}, linkStatusAtIngest: {} },
  },
}));
vi.mock("@/server/pvs-events", () => ({
  reapplyLoggedEvent: (id: string) => reapply(id),
}));
vi.mock("@/server/ads-conversion-outbox", () => ({
  reenqueueStuckOutbox: (...a: unknown[]) => reenqueue(...a),
}));

import {
  processPvsApplySweep,
  PVS_APPLY_SWEEP_CRON,
  PVS_APPLY_SWEEP_QUEUE,
} from "./pvs-apply-sweep";

beforeEach(() => {
  rows = [];
  reapply.mockReset();
  reenqueue.mockReset();
  reenqueue.mockResolvedValue({ found: 0, enqueued: 0, failed: 0 });
});

describe("processPvsApplySweep", () => {
  it("exposes the suggested queue and cron", () => {
    expect(PVS_APPLY_SWEEP_QUEUE).toBe("pvs-apply-sweep");
    expect(PVS_APPLY_SWEEP_CRON).toBe("*/10 * * * *");
  });

  it("re-applies every row and resolves when all succeed", async () => {
    rows = [{ id: "a" }, { id: "b" }];
    reapply.mockResolvedValue({ ok: true, status: "reapplied" });
    const res = await processPvsApplySweep();
    expect(res).toMatchObject({ scanned: 2, reapplied: 2, failed: 0 });
    expect(reapply).toHaveBeenCalledTimes(2);
    expect(reenqueue).toHaveBeenCalledWith(30);
  });

  it("keeps going past a failure and throws at the end", async () => {
    rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    reapply
      .mockResolvedValueOnce({ ok: true, status: "reapplied" })
      .mockResolvedValueOnce({ ok: false, reason: "internal_error" })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(processPvsApplySweep()).rejects.toThrow(/2\/3 events failed/);
    expect(reapply).toHaveBeenCalledTimes(3);
    expect(reenqueue).toHaveBeenCalled(); // outbox sweep still runs
  });

  it("counts an unconfirmed enqueue as a failure", async () => {
    rows = [{ id: "a" }];
    reapply.mockResolvedValue({ ok: true, status: "unconfirmed" });
    await expect(processPvsApplySweep()).rejects.toThrow();
  });

  it("throws when the outbox re-enqueue itself fails", async () => {
    reenqueue.mockRejectedValue(new Error("db down"));
    await expect(processPvsApplySweep()).rejects.toThrow(/outbox/);
  });
});
