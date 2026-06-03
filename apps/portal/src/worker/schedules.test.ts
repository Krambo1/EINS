import { describe, expect, it } from "vitest";
import { QUEUES } from "@/lib/queues";
import {
  PLATFORM_SCHEDULES,
  CLINIC_DISPATCHERS,
  dispatcherQueueName,
} from "./schedules";

/**
 * Locks down the schedule set the worker registers with pg-boss. Mirrors the
 * cadences the old standalone cron.ts used, plus the new per-clinic fan-out
 * dispatcher model (one dispatcher per per-clinic job instead of N repeatables).
 */
describe("worker schedule registry", () => {
  it("registers the 9 platform-wide schedules with their crons", () => {
    expect(PLATFORM_SCHEDULES).toHaveLength(9);
    const map = Object.fromEntries(PLATFORM_SCHEDULES.map((s) => [s.queue, s.cron]));
    expect(map[QUEUES.slaCheck]).toBe("*/15 * * * *");
    expect(map[QUEUES.refreshOauth]).toBe("*/15 * * * *");
    expect(map[QUEUES.reviewRequestTick]).toBe("*/15 * * * *");
    expect(map[QUEUES.dbBackup]).toBe("30 3 * * *");
    expect(map[QUEUES.purgeAudit]).toBe("0 4 * * 0");
    expect(map[QUEUES.pvsPartitionRotate]).toBe("0 4 * * *");
    expect(map[QUEUES.pvsReconcile]).toBe("15 */4 * * *");
    expect(map[QUEUES.pvsTreatmentSuggest]).toBe("30 4 * * *");
    expect(map[QUEUES.anomalyScan]).toBe("30 */6 * * *");
  });

  it("registers one fan-out dispatcher per per-clinic queue", () => {
    expect(CLINIC_DISPATCHERS).toHaveLength(7);
    expect(new Set(CLINIC_DISPATCHERS.map((d) => d.target))).toEqual(
      new Set([
        QUEUES.syncMeta,
        QUEUES.syncGoogle,
        QUEUES.kpiRebuild,
        QUEUES.forecastSnapshot,
        QUEUES.syncReviewsGoogle,
        QUEUES.syncReviewsJameda,
        QUEUES.monthlyReport,
      ])
    );
  });

  it("names each dispatcher queue <target>-dispatch", () => {
    for (const d of CLINIC_DISPATCHERS) {
      expect(d.dispatchQueue).toBe(`${d.target}-dispatch`);
      expect(d.dispatchQueue).toBe(dispatcherQueueName(d.target));
    }
    expect(dispatcherQueueName(QUEUES.syncMeta)).toBe("sync-meta-dispatch");
  });

  it("matches the prior per-clinic cron cadences", () => {
    const map = Object.fromEntries(CLINIC_DISPATCHERS.map((d) => [d.target, d.cron]));
    expect(map[QUEUES.syncMeta]).toBe("0 2 * * *");
    expect(map[QUEUES.syncGoogle]).toBe("30 2 * * *");
    expect(map[QUEUES.kpiRebuild]).toBe("0 3 * * *");
    expect(map[QUEUES.forecastSnapshot]).toBe("15 3 * * *");
    expect(map[QUEUES.syncReviewsGoogle]).toBe("0 4 * * *");
    expect(map[QUEUES.syncReviewsJameda]).toBe("20 4 * * *");
    expect(map[QUEUES.monthlyReport]).toBe("0 5 1 * *");
  });

  it("builds per-clinic payloads, with extra fields for kpi-rebuild + monthly-report", () => {
    const byTarget = Object.fromEntries(CLINIC_DISPATCHERS.map((d) => [d.target, d]));

    // No custom builder → the worker defaults to { clinicId }.
    expect(byTarget[QUEUES.syncMeta].data).toBeUndefined();

    const kpi = byTarget[QUEUES.kpiRebuild].data?.("c1") as Record<string, unknown>;
    expect(kpi).toMatchObject({ clinicId: "c1" });
    expect(typeof kpi.from).toBe("string");
    expect(typeof kpi.to).toBe("string");

    expect(byTarget[QUEUES.monthlyReport].data?.("c1")).toEqual({
      clinicId: "c1",
      period: "__autoprev__",
    });
  });
});
