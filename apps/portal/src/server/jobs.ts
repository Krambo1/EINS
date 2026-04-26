import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import { env } from "@/lib/env";

/**
 * BullMQ producer-side facade.
 *
 * Worker definitions live under `src/worker/*` (run via `pnpm worker`).
 * Anything that needs to ENQUEUE a job goes through this module so:
 *   - we share a single Redis connection across the app
 *   - queue names and default options stay consistent
 *   - a missing/broken Redis never rejects the user's action — we log and
 *     return a sentinel so the calling route/server-action can proceed
 *
 * Failure mode: all `enqueue*` helpers swallow errors and return `null`
 * on failure. Callers decide whether that's acceptable (it usually is —
 * the lead is already persisted; scoring will retry next tick).
 */

// ---------------------------------------------------------------
// Shared connection
// ---------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __einsBullmqConn: Redis | undefined;
}

function connection(): Redis {
  if (!globalThis.__einsBullmqConn) {
    // BullMQ requires maxRetriesPerRequest: null — otherwise long-polling
    // blocking commands throw after 20 retries.
    globalThis.__einsBullmqConn = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    globalThis.__einsBullmqConn.on("error", (err) => {
      console.error("[bullmq] redis error:", err.message);
    });
  }
  return globalThis.__einsBullmqConn;
}

// ---------------------------------------------------------------
// Queue names — keep in sync with src/worker/index.ts
// ---------------------------------------------------------------
export const QUEUES = {
  aiScore: "ai-score",
  syncMeta: "sync-meta",
  syncGoogle: "sync-google",
  kpiRebuild: "kpi-rebuild",
  slaCheck: "sla-check",
  monthlyReport: "monthly-report",
  refreshOauth: "refresh-oauth",
  dbBackup: "db-backup",
  purgeAudit: "purge-audit",
  emailSend: "email-send",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// ---------------------------------------------------------------
// Queue cache (producer side)
// ---------------------------------------------------------------
const queueCache = new Map<string, Queue>();

function queue(name: QueueName): Queue {
  let q = queueCache.get(name);
  if (!q) {
    q = new Queue(name, { connection: connection() });
    queueCache.set(name, q);
  }
  return q;
}

// Sensible defaults: short backoff for scoring, longer for syncs.
const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 },
};

async function safeAdd<T>(
  name: QueueName,
  jobName: string,
  data: T,
  opts?: JobsOptions
): Promise<string | null> {
  try {
    const job = await queue(name).add(jobName, data, { ...DEFAULT_JOB_OPTS, ...opts });
    return job.id ?? null;
  } catch (err) {
    console.error(`[jobs] enqueue failed for ${name}/${jobName}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------
// Enqueue helpers
// ---------------------------------------------------------------

/**
 * Score a newly-arrived lead (AI category + score).
 * Called from /api/leads/intake and the manual "rescore" action.
 */
export function enqueueAiScore(requestId: string): Promise<string | null> {
  return safeAdd(QUEUES.aiScore, "score", { requestId });
}

/** Sync campaign snapshots for one clinic+platform. */
export function enqueueCampaignSync(
  clinicId: string,
  platform: "meta" | "google"
): Promise<string | null> {
  const q = platform === "meta" ? QUEUES.syncMeta : QUEUES.syncGoogle;
  return safeAdd(q, "sync", { clinicId });
}

/** Recompute kpi_daily rows from raw sources for a date range. */
export function enqueueKpiRebuild(
  clinicId: string,
  from: string,
  to: string
): Promise<string | null> {
  return safeAdd(QUEUES.kpiRebuild, "rebuild", { clinicId, from, to });
}

/** Produce + email the monthly report PDF for one clinic. */
export function enqueueMonthlyReport(
  clinicId: string,
  periodYyyyMm: string
): Promise<string | null> {
  return safeAdd(QUEUES.monthlyReport, "generate", { clinicId, period: periodYyyyMm });
}

/** Deliver an email via the configured sender. Used when routes prefer async send. */
export function enqueueEmail(payload: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<string | null> {
  return safeAdd(QUEUES.emailSend, "send", payload);
}
