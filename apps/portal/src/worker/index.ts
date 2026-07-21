import "./shim-server-only";
import "../lib/load-env";
import type PgBoss from "pg-boss";
import { isNull } from "drizzle-orm";
import { workerBoss } from "./connection";
import { db, schema } from "@/db/client";
import {
  QUEUES,
  type QueueName,
  DEFAULT_RETRY,
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
import { processCapiPurchase } from "./processors/capi-purchase";
import { processOciPurchase } from "./processors/oci-purchase";
import { processForecastSnapshot } from "./processors/forecast-snapshot";
import { processAnomalyScan } from "./processors/anomaly-scan";

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

// One entry per processor queue (25). Concurrency is intentionally serial
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
  { name: QUEUES.capiPurchase, handler: wrap("capi-purchase", processCapiPurchase) },
  { name: QUEUES.ociPurchase, handler: wrap("oci-purchase", processOciPurchase) },
  { name: QUEUES.forecastSnapshot, handler: wrap("forecast-snapshot", processForecastSnapshot) },
  { name: QUEUES.anomalyScan, handler: wrap("anomaly-scan", processAnomalyScan) },
];

/** createQueue options (queue policy) for a processor queue. */
function queueOptions(name: QueueName): PgBoss.Queue {
  const opts: PgBoss.Queue = { name, ...DEFAULT_RETRY };
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
      const id = await boss.send(d.target, buildData(c.id), { ...DEFAULT_RETRY });
      if (id) sent += 1;
    }
    console.log(
      `[fanout:${d.dispatchQueue}] dispatched ${sent}/${clinics.length} → ${d.target}`
    );
  };
}

async function main() {
  await boss.start();
  console.log("[worker] pg-boss started; pgboss schema ready");

  // 1. Create every queue (idempotent) BEFORE work/schedule — pg-boss requires
  //    the queue row + its job partition to exist first.
  for (const def of QUEUE_DEFS) {
    await boss.createQueue(def.name, queueOptions(def.name));
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
