import { QUEUES, type QueueName } from "@/lib/queues";

/**
 * Schedule registry for the worker's pg-boss timekeeper.
 *
 * Kept side-effect-free (no DB, no boss, no processor imports) so worker boot
 * AND a unit test can consume the exact same set. Crons are 5-field UTC
 * (pg-boss's default timezone), mirroring the cadences the old standalone cron.ts
 * used; the three former 15-minute repeats become five-field crons.
 */

export interface PlatformSchedule {
  /** Queue whose processor runs directly on this cron (takes no clinic arg). */
  queue: QueueName;
  cron: string;
}

export interface ClinicDispatcher {
  /** Dedicated fan-out queue, scheduled on `cron`. Its handler enumerates
   *  active clinics and sends one `target` job per clinic. */
  dispatchQueue: string;
  /** Per-clinic queue the dispatcher fans out to. */
  target: QueueName;
  cron: string;
  /** Builds the per-clinic job payload. Defaults to `{ clinicId }`. */
  data?: (clinicId: string) => Record<string, unknown>;
}

/** Name of the fan-out dispatcher queue for a per-clinic target queue. */
export function dispatcherQueueName(target: QueueName): string {
  return `${target}-dispatch`;
}

/** Platform-wide schedules: one job per tick, processor reads no clinic arg. */
export const PLATFORM_SCHEDULES: readonly PlatformSchedule[] = [
  { queue: QUEUES.slaCheck, cron: "*/15 * * * *" },
  { queue: QUEUES.refreshOauth, cron: "*/15 * * * *" },
  // EINS Bewertungen — scans due review_request recalls and enqueues emails.
  { queue: QUEUES.reviewRequestTick, cron: "*/15 * * * *" },
  { queue: QUEUES.dbBackup, cron: "30 3 * * *" },
  { queue: QUEUES.purgeAudit, cron: "0 4 * * 0" },
  // PVS Bridge — daily partition rotation 04:00.
  { queue: QUEUES.pvsPartitionRotate, cron: "0 4 * * *" },
  // PVS Bridge — reconciliation every 4 hours (stale-bridge alert latency).
  { queue: QUEUES.pvsReconcile, cron: "15 */4 * * *" },
  // PVS Bridge — daily treatment auto-mapping suggestions 04:30.
  { queue: QUEUES.pvsTreatmentSuggest, cron: "30 4 * * *" },
  // Anomaly scan every 6h at :30, offset from the top-of-hour per-clinic syncs.
  { queue: QUEUES.anomalyScan, cron: "30 */6 * * *" },
];

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Per-clinic schedules.
 *
 * pg-boss keys a schedule by queue, so instead of N repeatables (one per clinic
 * — the old model that had to be re-run whenever a clinic was added) we schedule
 * ONE dispatcher per job at the job's cron. The dispatcher's handler enumerates
 * active (non-archived) clinics at fire time and sends a per-clinic job, so new
 * clinics are covered automatically. The per-clinic processors are unchanged —
 * they still receive `{ clinicId }`.
 */
export const CLINIC_DISPATCHERS: readonly ClinicDispatcher[] = [
  {
    dispatchQueue: dispatcherQueueName(QUEUES.syncMeta),
    target: QUEUES.syncMeta,
    cron: "0 2 * * *",
  },
  {
    dispatchQueue: dispatcherQueueName(QUEUES.syncGoogle),
    target: QUEUES.syncGoogle,
    cron: "30 2 * * *",
  },
  {
    dispatchQueue: dispatcherQueueName(QUEUES.kpiRebuild),
    target: QUEUES.kpiRebuild,
    cron: "0 3 * * *",
    // Placeholder range — the processor derives yesterday itself if needed; we
    // include it for auditability, computed fresh at each fan-out.
    data: (clinicId) => ({ clinicId, from: yesterdayIso(), to: yesterdayIso() }),
  },
  {
    // Forecast snapshot — 03:15 UTC, after kpi-rebuild (03:00) so the engine
    // sees yesterday's rates fully aggregated.
    dispatchQueue: dispatcherQueueName(QUEUES.forecastSnapshot),
    target: QUEUES.forecastSnapshot,
    cron: "15 3 * * *",
  },
  {
    dispatchQueue: dispatcherQueueName(QUEUES.syncReviewsGoogle),
    target: QUEUES.syncReviewsGoogle,
    cron: "0 4 * * *",
  },
  {
    dispatchQueue: dispatcherQueueName(QUEUES.syncReviewsJameda),
    target: QUEUES.syncReviewsJameda,
    cron: "20 4 * * *",
  },
  {
    dispatchQueue: dispatcherQueueName(QUEUES.monthlyReport),
    target: QUEUES.monthlyReport,
    cron: "0 5 1 * *",
    data: (clinicId) => ({ clinicId, period: "__autoprev__" }),
  },
];
