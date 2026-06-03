import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Producer-facade tests. We mock `pg-boss` so the facade never touches a real
 * Postgres — the point is to lock down the option mapping: default retry policy
 * on every send, singletonKey on the three dedup queues, best-effort swallow on
 * failure, and a single lazy `start()` across many enqueues.
 */

const { sendMock, startMock, onMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  startMock: vi.fn(),
  onMock: vi.fn(),
}));

// pg-boss is a CommonJS `export =` default export; `__esModule: true` makes the
// `import PgBoss from "pg-boss"` default-interop resolve to the class itself.
vi.mock("pg-boss", () => ({
  __esModule: true,
  default: class FakePgBoss {
    send = sendMock;
    start = startMock;
    on = onMock;
    constructor(_opts: unknown) {}
  },
}));

import {
  enqueueAiScore,
  enqueuePvsStatusDerive,
  enqueueCapiPurchase,
  enqueueOciPurchase,
  enqueueAnomalyScan,
} from "./jobs";

const RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true };

beforeEach(() => {
  sendMock.mockReset();
  sendMock.mockResolvedValue("job-1");
  startMock.mockReset();
  startMock.mockResolvedValue(undefined);
  onMock.mockReset();
  // Reset the lazy singleton so each test builds a fresh boss.
  globalThis.__einsPgBoss = undefined;
  globalThis.__einsPgBossStart = undefined;
});

describe("jobs producer facade", () => {
  it("maps a plain enqueue to boss.send with the default retry policy", async () => {
    const id = await enqueueAiScore("req-1");
    expect(id).toBe("job-1");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("ai-score", { requestId: "req-1" }, RETRY);
  });

  it("passes singletonKey for the derive dedup queue", async () => {
    await enqueuePvsStatusDerive("clinic-1", "patient-2");
    expect(sendMock).toHaveBeenCalledWith(
      "pvs-status-derive",
      { clinicId: "clinic-1", portalPatientId: "patient-2" },
      { ...RETRY, singletonKey: "clinic-1__patient-2" }
    );
  });

  it("passes channel-scoped singletonKey for capi/oci purchases", async () => {
    await enqueueCapiPurchase("outbox-9");
    await enqueueOciPurchase("outbox-9");
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      "capi-purchase",
      { outboxId: "outbox-9" },
      { ...RETRY, singletonKey: "capi-purchase__outbox-9" }
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      "oci-purchase",
      { outboxId: "outbox-9" },
      { ...RETRY, singletonKey: "oci-purchase__outbox-9" }
    );
  });

  it("returns null and swallows when the queue rejects (best-effort)", async () => {
    sendMock.mockRejectedValueOnce(new Error("queue does not exist"));
    const id = await enqueueAiScore("req-err");
    expect(id).toBeNull();
  });

  it("treats a coalesced send (null id from singletonKey) as a no-op", async () => {
    sendMock.mockResolvedValueOnce(null);
    const id = await enqueuePvsStatusDerive("c", "p");
    expect(id).toBeNull();
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it("starts the boss exactly once across many enqueues", async () => {
    await enqueueAiScore("a");
    await enqueueAiScore("b");
    await enqueueAnomalyScan();
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
