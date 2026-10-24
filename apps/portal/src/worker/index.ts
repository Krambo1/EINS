import "./shim-server-only";
import "../lib/load-env";
import type PgBoss from "pg-boss";
import { isNull } from "drizzle-orm";
import { workerBoss } from "./connection";
import { db, schema } from "@/db/client";
import {
  WORKER_BEAT_INTERVAL_MS,
  getJobSuccessTimes,
  planCatchUps,
  recordJobSuccess,
  recordWorkerBeat,
  CATCH_UP_AFTER_MS,
} from "@/server/worker-heartbeat";
import {
  QUEUES,
  type QueueName,
  DEFAULT_RETRY,
  PVS_RETRY_QUEUES,
  PVS_DEAD_LETTER_QUEUE,
  PVS_DEAD_LETTER_RETENTION_MINUTES,
  retryOptionsFor,
  DEDUP_QUEUES,
  PVS_CSV_INGEST_EXPIRE_SECONDS,
  LATENCY_SENSITIVE,
  FAST_POLL_SECONDS,
  SLOW_POLL_SECONDS,
} from "@/lib/queues";
import {
  PLATFORM_SCHEDULES,
  CLINIC_DISPATCHERS,
  type ClinicDispatcher,
} from "./schedules";

import { processAiScore } from "./processors/ai-score";
import { processSyncMeta } from "./processors/sync-meta";
import { processSyncGoogle } from "./processors/sync-google";
import { processKpiRebuild } from "./processors/kpi-rebuild";
import { processSlaCheck } from "./processors/sla-check";
import { processRefreshOauth } from "./processors/refresh-oauth";
import { processPurgeAudit } from "./processors/purge-audit";
import { processMonthlyReport } from "./processors/monthly-report";
import { processDbBackup } from "./processors/db-backup";
import { processEmailSend } from "./processors/email-send";
import { processReviewRequestTick } from "./processors/review-request";
import { processSyncReviewsGoogle } from "./processors/sync-reviews-google";
import { processSyncReviewsJameda } from "./processors/sync-reviews-jameda";
import { processPvsStatusDerive } from "./processors/pvs-status-derive";
import { processPvsCsvIngest } from "./processors/pvs-csv-ingest";
import { processPvsLinkBackfill } from "./processors/pvs-link-backfill";
import { processPvsLeadTokenWrite } from "./processors/pvs-lead-token-write";
import { processPvsPartitionRotate } from "./processors/pvs-partition-rotate";
import { processPvsReconcile } from "./processors/pvs-reconcile";
import { processPvsTreatmentSuggest } from "./processors/pvs-treatment-suggest";
import { processPvsAgentHealthScan } from "./processors/pvs-agent-health-scan";
import { processPvsApplySweep } from "./processors/pvs-apply-sweep";
import { processCapiPurchase } from "./processors/capi-purchase";
import { processOciPurchase } from "./processors/oci-purchase";
import { processForecastSnapshot } from "./processors/forecast-snapshot";
import { processAnomalyScan } from "./processors/anomaly-scan";
import { processRetreatmentRefresh } from "./processors/retreatment-refresh";
import { processRetreatmentReminderTick } from "./processors/retreatment-reminder";
import { processContentApprovalVerzug } from "./processors/content-approval-verzug";

/**
 * Worker entry point — run as `pnpm worker`. Always-on (Fly `eins-worker`,
 * deliberately no `[[services]]` so Fly never health-checks a port).
 *
 * Transport is pg-boss (Postgres-backed). This single process owns the entire
 * queue lifecycle:
 *   1. boss.start()      — creates/upgrades the `pgboss` schema (migrate:true).
 *   2. createQueue(...)   — every processor queue + every fan-out dispatcher
 *                           (idempotent; required before send/work/schedule).
 *   3. work(...)          — one handler per queue. batchSize is 1, so each
 *                           handler call processes exactly one job and a thrown
 *                           error fails only that job (per-job retry semantics).
 *   4. schedule(...)      — platform-wide crons + per-clinic fan-out
 *                           dispatchers (replaces the old standalone cron.ts).
 *
 * The job logic (the 24 processors) is unchanged — only the transport moved.
 * SIGTERM/SIGINT drain in-flight jobs via boss.stop({ graceful: true }).
 */

const boss = workerBoss();

/**
 * Wrap a processor so errors are logged before pg-boss retries. The handler
 * receives a batch (pg-boss v10 always hands an array); batchSize is 1 for
 * every queue, so there is exactly one job per call and rethrowing fails just
 * that job — preserving the previous per-job retry behaviour.
 */
function wrap<T>(
  name: string,
  fn: (data: T) => Promise<void>
): PgBoss.WorkHandler<unknown> {
  return async (jobs) => {
    const job = jobs[0];
    const started = Date.now();
    try {
      // pg-boss delivers scheduled (cron) jobs with `data: null`. Processors
      // default their payload to `{}` (e.g. `job: SlaCheckJob = {}`), but a JS
      // default only applies to `undefined`, not `null` — so a raw null would
      // crash any processor that reads an optional field (job.clinicId, etc.).
      // Coalesce here so every processor sees `{}` when no payload was sent.
      await fn((job.data ?? {}) as T);
      console.log(`[${name}] done id=${job.id} in ${Date.now() - started}ms`);
      // Last-success stamp for PVS queues: the boot-time catch-up reads it to
      // spot a cron tick missed while the worker was down.
      if (PVS_RETRY_QUEUES.has(job.name)) await recordJobSuccess(job.name);
    } catch (err) {
      console.error(`[${name}] failed id=${job.id}:`, err);
      throw err; // pg-boss marks the job failed → retries per the queue policy
    }
  };
}

interface QueueDef {
  name: QueueName;
  handler: PgBoss.WorkHandler<unknown>;
}

// One entry per processor queue (26). Concurrency is intentionally serial
// (batchSize 1) — volume is ~zero and per-job retry isolation matters more
// than parallelism. Latency-sensitive queues simply poll faster.
const QUEUE_DEFS: QueueDef[] = [
  { name: QUEUES.aiScore, handler: wrap("ai-score", processAiScore) },
  { name: QUEUES.syncMeta, handler: wrap("sync-meta", processSyncMeta) },
  { name: QUEUES.syncGoogle, handler: wrap("sync-google", processSyncGoogle) },
  { name: QUEUES.kpiRebuild, handler: wrap("kpi-rebuild", processKpiRebuild) },
  { name: QUEUES.slaCheck, handler: wrap("sla-check", processSlaCheck) },
  { name: QUEUES.refreshOauth, handler: wrap("refresh-oauth", processRefreshOauth) },
  { name: QUEUES.purgeAudit, handler: wrap("purge-audit", processPurgeAudit) },
  { name: QUEUES.monthlyReport, handler: wrap("monthly-report", processMonthlyReport) },
  { name: QUEUES.dbBackup, handler: wrap("db-backup", processDbBackup) },
  { name: QUEUES.emailSend, handler: wrap("email-send", processEmailSend) },
  { name: QUEUES.reviewRequestTick, handler: wrap("review-request", processReviewRequestTick) },
  { name: QUEUES.syncReviewsGoogle, handler: wrap("sync-reviews-google", processSyncReviewsGoogle) },
  { name: QUEUES.syncReviewsJameda, handler: wrap("sync-reviews-jameda", processSyncReviewsJameda) },
  { name: QUEUES.pvsStatusDerive, handler: wrap("pvs-status-derive", processPvsStatusDerive) },
  { name: QUEUES.pvsCsvIngest, handler: wrap("pvs-csv-ingest", processPvsCsvIngest) },
  { name: QUEUES.pvsLinkBackfill, handler: wrap("pvs-link-backfill", processPvsLinkBackfill) },
  { name: QUEUES.pvsLeadTokenWrite, handler: wrap("pvs-lead-token-write", processPvsLeadTokenWrite) },
  { name: QUEUES.pvsPartitionRotate, handler: wrap("pvs-partition-rotate", processPvsPartitionRotate) },
  { name: QUEUES.pvsReconcile, handler: wrap("pvs-reconcile", processPvsReconcile) },
  { name: QUEUES.pvsTreatmentSuggest, handler: wrap("pvs-treatment-suggest", processPvsTreatmentSuggest) },
  { name: QUEUES.pvsAgentHealthScan, handler: wrap("pvs-agent-health-scan", processPvsAgentHealthScan) },
  { name: QUEUES.pvsApplySweep, handler: wrap("pvs-apply-sweep", async (j) => void (await processPvsApplySweep(j))) },
  { name: QUEUES.capiPurchase, handler: wrap("capi-purchase", processCapiPurchase) },
  { name: QUEUES.ociPurchase, handler: wrap("oci-purchase", processOciPurchase) },
  { name: QUEUES.forecastSnapshot, handler: wrap("forecast-snapshot", processForecastSnapshot) },
  { name: QUEUES.anomalyScan, handler: wrap("anomaly-scan", processAnomalyScan) },
  { name: QUEUES.retreatmentRefresh, handler: wrap("retreatment-refresh", processRetreatmentRefresh) },
  {
    name: QUEUES.retreatmentReminderTick,
    handler: wrap("retreatment-reminder", processRetreatmentReminderTick),
  },
  {
    name: QUEUES.contentApprovalVerzug,
    handler: wrap("content-approval-verzug", processContentApprovalVerzug),
  },
];

/** createQueue options (queue policy) for a processor queue. */
function queueOptions(name: QueueName): PgBoss.Queue {
  const opts: PgBoss.Queue = { name, ...retryOptionsFor(name) };
  // PVS queues: exhausted jobs move to the dead-letter queue, not nowhere.
  if (PVS_RETRY_QUEUES.has(name)) opts.deadLetter = PVS_DEAD_LETTER_QUEUE;
  // dedup queues coalesce redundant pending enqueues by singletonKey.
  if (DEDUP_QUEUES.has(name)) opts.policy = "short";
  // long CSV ingest: handler is raced against expireInSeconds.
  if (name === QUEUES.pvsCsvIngest) {
    opts.expireInSeconds = PVS_CSV_INGEST_EXPIRE_SECONDS;
  }
  return opts;
}

/** work() options — batchSize 1 everywhere; poll fast only where latency matters. */
function workOptions(name: QueueName): PgBoss.WorkOptions {
  return {
    batchSize: 1,
    pollingIntervalSeconds: LATENCY_SENSITIVE.has(name)
      ? FAST_POLL_SECONDS
      : SLOW_POLL_SECONDS,
  };
}

/**
 * Fan-out dispatcher handler: enumerate active (non-archived) clinics and send
 * one per-clinic job to the target queue. Mirrors the enumeration the old
 * cron.ts did, but runs at fire time so clinics added after boot are covered.
 */
function fanout(d: ClinicDispatcher): PgBoss.WorkHandler<unknown> {
  const buildData = d.data ?? ((clinicId: string) => ({ clinicId }));
  return async () => {
    const clinics = await db
      .select({ id: schema.clinics.id })
      .from(schema.clinics)
      .where(isNull(schema.clinics.archivedAt));
    let sent = 0;
    for (const c of clinics) {
      const id = await boss.send(d.target, buildData(c.id), {
        ...retryOptionsFor(d.target),
      });
      if (id) sent += 1;
    }
    console.log(
      `[fanout:${d.dispatchQueue}] dispatched ${sent}/${clinics.length} → ${d.target}`
    );
  };
}

const HEARTBEAT_MAX_FAILURE_MS = 5 * 60 * 1000;
let heartbeatFailingSince: number | null = null;

async function beat(): Promise<void> {
  try {
    await recordWorkerBeat();
    heartbeatFailingSince = null;
  } catch (err) {
    heartbeatFailingSince ??= Date.now();
    console.error("[worker] heartbeat write failed:", err);
    if (Date.now() - heartbeatFailingSince > HEARTBEAT_MAX_FAILURE_MS) {
      console.error("[worker] heartbeat failing for > 5 min, exiting for restart");
      process.exit(1);
    }
  }
}

function startHeartbeat(): void {
  void beat();
  setInterval(() => void beat(), WORKER_BEAT_INTERVAL_MS);
}

async function enqueueCatchUps(): Promise<void> {
  try {
    const last = await getJobSuccessTimes(Object.keys(CATCH_UP_AFTER_MS));
    for (const queue of planCatchUps(last, new Date())) {
      const id = await boss.send(
        queue,
        {},
        {
          ...retryOptionsFor(queue),
          // One catch-up per hour even across crash-looping boots.
          singletonKey: "boot-catch-up",
          singletonSeconds: 3600,
        }
      );
      console.log(
        `[worker] catch-up enqueued for ${queue} (last success ` +
          `${last.get(queue)?.toISOString() ?? "never"}) id=${id}`
      );
    }
  } catch (err) {
    console.error("[worker] catch-up enqueue failed:", err);
  }
}

async function main() {
  await boss.start();
  console.log("[worker] pg-boss started; pgboss schema ready");

  // 1. Create every queue (idempotent) BEFORE work/schedule — pg-boss requires
  //    the queue row + its job partition to exist first.
  //    The dead-letter queue goes first (queues reference it by name). Nobody
  //    works it: jobs wait there for an operator, and the hourly agent-health
  //    scan emails ops when it is non-empty.
  await boss.createQueue(PVS_DEAD_LETTER_QUEUE, {
    name: PVS_DEAD_LETTER_QUEUE,
    retentionMinutes: PVS_DEAD_LETTER_RETENTION_MINUTES,
  });
  for (const def of QUEUE_DEFS) {
    await boss.createQueue(def.name, queueOptions(def.name));
    // createQueue never changes an existing queue. Re-apply the options of the
    // PVS queues on every boot so the longer retry policy + dead-letter reach
    // queues created under the old 3-try default. updateQueue resets `policy`
    // to 'standard' when omitted, which is why queueOptions() is passed whole.
    if (PVS_RETRY_QUEUES.has(def.name)) {
      await boss.updateQueue(def.name, queueOptions(def.name));
    }
  }
  for (const d of CLINIC_DISPATCHERS) {
    await boss.createQueue(d.dispatchQueue, {
      name: d.dispatchQueue,
      ...DEFAULT_RETRY,
    });
  }

  // 2. Register workers — processors and fan-out dispatchers.
  for (const def of QUEUE_DEFS) {
    await boss.work(def.name, workOptions(def.name), def.handler);
  }
  for (const d of CLINIC_DISPATCHERS) {
    await boss.work(
      d.dispatchQueue,
      { batchSize: 1, pollingIntervalSeconds: SLOW_POLL_SECONDS },
      fanout(d)
    );
  }

  // 3. Register schedules (persisted in Postgres; re-registering each boot is
  //    an idempotent upsert keyed by queue name).
  for (const s of PLATFORM_SCHEDULES) {
    await boss.schedule(s.queue, s.cron);
  }
  for (const d of CLINIC_DISPATCHERS) {
    await boss.schedule(d.dispatchQueue, d.cron);
  }

  // 4. Heartbeat: /api/health returns 503 worker_stale when this stops. If the
  //    beat cannot be written for 5 minutes straight (DB unreachable from this
  //    machine) the process exits so the Fly restart policy replaces it with a
  //    fresh one instead of leaving a zombie that polls nothing.
  startHeartbeat();

  // 5. pg-boss does not replay cron ticks missed while the worker was down.
  //    Enqueue one catch-up run for the daily/4-hourly PVS jobs whose last
  //    success is older than their period.
  await enqueueCatchUps();

  console.log(
    `[worker] online — ${QUEUE_DEFS.length} queues, ` +
      `${CLINIC_DISPATCHERS.length} fan-out dispatchers, ` +
      `${PLATFORM_SCHEDULES.length + CLINIC_DISPATCHERS.length} schedules`
  );
}

// Graceful shutdown — drain in-flight jobs, then close the pool.
async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, stopping...`);
  try {
    await boss.stop({ graceful: true });
  } catch (err) {
    console.error("[worker] error during stop:", err);
  }
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("[worker] fatal during boot:", err);
  process.exit(1);
});
