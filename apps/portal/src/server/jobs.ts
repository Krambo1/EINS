import "server-only";
import { Queue, type JobsOptions } from "bullmq";
import Redis from "ioredis";
import { env } from "@/lib/env";
import { QUEUES, type QueueName } from "@/lib/queues";

export { QUEUES, type QueueName };

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

// ---------------------------------------------------------------
// PVS Bridge producers
// ---------------------------------------------------------------

/**
 * Replay event-log history for one (clinicId, portalPatientId) tuple and
 * update requests.status, revenue, and patient lifetime_revenue accordingly.
 *
 * BullMQ jobId is `${clinicId}:${patientId}` so concurrent enqueues for the
 * same patient coalesce to one in-flight worker (BullMQ dedupes by jobId).
 * If an event-log row was just inserted for a patient with N in-flight
 * derive jobs, only one runs — the others are dropped because the queue
 * already has a job with that id.
 */
export function enqueuePvsStatusDerive(
  clinicId: string,
  portalPatientId: string
): Promise<string | null> {
  return safeAdd(
    QUEUES.pvsStatusDerive,
    "derive",
    { clinicId, portalPatientId },
    { jobId: `${clinicId}:${portalPatientId}` }
  );
}

/**
 * Process an uploaded CSV through the pvs-csv-ingest worker. The worker reads
 * `pvs_csv_uploads.storage_key`, applies `mapping_json`, and emits canonical
 * events through `applyPvsEvent` in-process.
 */
export function enqueuePvsCsvIngest(
  uploadId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsCsvIngest, "ingest", { uploadId });
}

/**
 * Re-run the Stage-3 fuzzy linker for one PVS patient id. Triggered by:
 *   • A new pvs_event_log row whose pvsPatientId has no existing map.
 *   • The "Re-check" button on the linking-failures inbox UI.
 *   • The nightly reconciliation job.
 */
export function enqueuePvsLinkBackfill(
  clinicId: string,
  pvsPatientId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsLinkBackfill, "backfill", {
    clinicId,
    pvsPatientId,
  });
}

/**
 * Direction A — write the `EINS-Lead-{8hex}` linking token into the PVS
 * bemerkung field for the patient implied by `requestId`. The processor
 * dispatches per-adapter (Tomedo writes via REST; HealthHub/RED via FHIR
 * Patient.note PATCH; GDT-Agent does NOT support write-back; n8n/CSV are
 * no-ops). For unsupported adapters the token remains only visible in the
 * portal UI for manual MFA copy-paste.
 */
export function enqueuePvsLeadTokenWrite(
  requestId: string
): Promise<string | null> {
  return safeAdd(QUEUES.pvsLeadTokenWrite, "write", { requestId });
}
