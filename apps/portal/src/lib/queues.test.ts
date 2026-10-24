import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY,
  PVS_RETRY,
  PVS_RETRY_QUEUES,
  QUEUES,
  retryOptionsFor,
} from "./queues";

describe("PVS retry policy", () => {
  it("gives the seven PVS queues 8 tries from 30 s with backoff", () => {
    expect([...PVS_RETRY_QUEUES].sort()).toEqual(
      [
        QUEUES.pvsStatusDerive,
        QUEUES.pvsLinkBackfill,
        QUEUES.pvsLeadTokenWrite,
        QUEUES.pvsAgentHealthScan,
        QUEUES.pvsReconcile,
        QUEUES.pvsPartitionRotate,
        QUEUES.pvsApplySweep,
      ].sort()
    );
    for (const q of PVS_RETRY_QUEUES) {
      expect(retryOptionsFor(q)).toEqual({
        retryLimit: 8,
        retryDelay: 30,
        retryBackoff: true,
      });
    }
    expect(PVS_RETRY).toEqual({ retryLimit: 8, retryDelay: 30, retryBackoff: true });
  });

  it("leaves every other queue on the default policy", () => {
    expect(retryOptionsFor(QUEUES.emailSend)).toEqual(DEFAULT_RETRY);
    expect(retryOptionsFor(QUEUES.pvsCsvIngest)).toEqual(DEFAULT_RETRY);
  });
});
