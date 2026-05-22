import "./shim-server-only";
import "../lib/load-env";
import { Worker, type Processor } from "bullmq";
import { workerConnection } from "./connection";
import { QUEUES } from "@/lib/queues";

import { processAiScore, type AiScoreJob } from "./processors/ai-score";
import { processSyncMeta, type SyncMetaJob } from "./processors/sync-meta";
import { processSyncGoogle, type SyncGoogleJob } from "./processors/sync-google";
import { processKpiRebuild, type KpiRebuildJob } from "./processors/kpi-rebuild";
import { processSlaCheck, type SlaCheckJob } from "./processors/sla-check";
import { processRefreshOauth } from "./processors/refresh-oauth";
import { processPurgeAudit } from "./processors/purge-audit";
import { processMonthlyReport, type MonthlyReportJob } from "./processors/monthly-report";
import { processDbBackup } from "./processors/db-backup";
import { processEmailSend, type EmailSendJob } from "./processors/email-send";
import {
  processReviewRequestTick,
  type ReviewRequestTickJob,
} from "./processors/review-request";
import {
  processSyncReviewsGoogle,
  type SyncReviewsGoogleJob,
} from "./processors/sync-reviews-google";
import {
  processSyncReviewsJameda,
  type SyncReviewsJamedaJob,
} from "./processors/sync-reviews-jameda";
import {
  processPvsStatusDerive,
  type PvsStatusDeriveJob,
} from "./processors/pvs-status-derive";
import {
  processPvsCsvIngest,
  type PvsCsvIngestJob,
} from "./processors/pvs-csv-ingest";
import {
  processPvsLinkBackfill,
  type PvsLinkBackfillJob,
} from "./processors/pvs-link-backfill";
import {
  processPvsLeadTokenWrite,
  type PvsLeadTokenWriteJob,
} from "./processors/pvs-lead-token-write";
import {
  processPvsPartitionRotate,
  type PvsPartitionRotateJob,
} from "./processors/pvs-partition-rotate";
import {
  processPvsReconcile,
  type PvsReconcileJob,
} from "./processors/pvs-reconcile";
import {
  processPvsTreatmentSuggest,
  type PvsTreatmentSuggestJob,
} from "./processors/pvs-treatment-suggest";
import {
  processCapiPurchase,
  type CapiPurchaseJob,
} from "./processors/capi-purchase";
import {
  processOciPurchase,
  type OciPurchaseJob,
} from "./processors/oci-purchase";
import {
  processForecastSnapshot,
  type ForecastSnapshotJob,
} from "./processors/forecast-snapshot";
import {
  processAnomalyScan,
  type AnomalyScanJob,
} from "./processors/anomaly-scan";

/**
 * Worker entry point — run as `pnpm worker`.
 *
 * Spawns one BullMQ Worker per queue. We keep concurrency intentionally
 * low (2-4) to avoid API rate-limit spikes. Errors bubble so BullMQ retries
 * per the default options set in `server/jobs.ts`.
 *
 * SIGTERM handling closes all workers cleanly so in-flight jobs finish.
 */

const connection = workerConnection();

// Tiny helper: wrap a processor so errors get logged before BullMQ retries.
function wrap<T>(name: string, fn: (data: T) => Promise<void>): Processor<T> {
  return async (job) => {
    const started = Date.now();
    try {
      await fn(job.data);
      console.log(`[${name}] done id=${job.id} in ${Date.now() - started}ms`);
    } catch (err) {
      console.error(`[${name}] failed id=${job.id}:`, err);
      throw err;
    }
  };
}

const workers: Worker[] = [
  new Worker<AiScoreJob>(QUEUES.aiScore, wrap("ai-score", processAiScore), {
    connection,
    concurrency: 4,
  }),
  new Worker<SyncMetaJob>(QUEUES.syncMeta, wrap("sync-meta", processSyncMeta), {
    connection,
    concurrency: 2,
  }),
  new Worker<SyncGoogleJob>(
    QUEUES.syncGoogle,
    wrap("sync-google", processSyncGoogle),
    { connection, concurrency: 2 }
  ),
  new Worker<KpiRebuildJob>(
    QUEUES.kpiRebuild,
    wrap("kpi-rebuild", processKpiRebuild),
    { connection, concurrency: 2 }
  ),
  new Worker<SlaCheckJob>(QUEUES.slaCheck, wrap("sla-check", processSlaCheck), {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUES.refreshOauth, wrap("refresh-oauth", processRefreshOauth), {
    connection,
    concurrency: 1,
  }),
  new Worker(QUEUES.purgeAudit, wrap("purge-audit", processPurgeAudit), {
    connection,
    concurrency: 1,
  }),
  new Worker<MonthlyReportJob>(
    QUEUES.monthlyReport,
    wrap("monthly-report", processMonthlyReport),
    { connection, concurrency: 1 }
  ),
  new Worker(QUEUES.dbBackup, wrap("db-backup", processDbBackup), {
    connection,
    concurrency: 1,
  }),
  new Worker<EmailSendJob>(QUEUES.emailSend, wrap("email-send", processEmailSend), {
    connection,
    concurrency: 5,
  }),
  new Worker<ReviewRequestTickJob>(
    QUEUES.reviewRequestTick,
    wrap("review-request", processReviewRequestTick),
    { connection, concurrency: 1 }
  ),
  new Worker<SyncReviewsGoogleJob>(
    QUEUES.syncReviewsGoogle,
    wrap("sync-reviews-google", processSyncReviewsGoogle),
    { connection, concurrency: 2 }
  ),
  new Worker<SyncReviewsJamedaJob>(
    QUEUES.syncReviewsJameda,
    wrap("sync-reviews-jameda", processSyncReviewsJameda),
    // Be polite to Jameda — one HTTP request at a time across all clinics.
    { connection, concurrency: 1 }
  ),
  new Worker<PvsStatusDeriveJob>(
    QUEUES.pvsStatusDerive,
    wrap("pvs-status-derive", processPvsStatusDerive),
    // Replay-per-patient is bounded; allow some parallelism to keep up
    // with bursts from the initial-sync of a new clinic.
    { connection, concurrency: 4 }
  ),
  new Worker<PvsCsvIngestJob>(
    QUEUES.pvsCsvIngest,
    wrap("pvs-csv-ingest", processPvsCsvIngest),
    // CSV uploads are an interactive flow (inhaber is watching) but heavy
    // (50k rows). One job at a time keeps DB IOPS predictable.
    { connection, concurrency: 1 }
  ),
  new Worker<PvsLinkBackfillJob>(
    QUEUES.pvsLinkBackfill,
    wrap("pvs-link-backfill", processPvsLinkBackfill),
    { connection, concurrency: 2 }
  ),
  new Worker<PvsLeadTokenWriteJob>(
    QUEUES.pvsLeadTokenWrite,
    wrap("pvs-lead-token-write", processPvsLeadTokenWrite),
    { connection, concurrency: 2 }
  ),
  new Worker<PvsPartitionRotateJob>(
    QUEUES.pvsPartitionRotate,
    wrap("pvs-partition-rotate", processPvsPartitionRotate),
    { connection, concurrency: 1 }
  ),
  new Worker<PvsReconcileJob>(
    QUEUES.pvsReconcile,
    wrap("pvs-reconcile", processPvsReconcile),
    { connection, concurrency: 1 }
  ),
  new Worker<PvsTreatmentSuggestJob>(
    QUEUES.pvsTreatmentSuggest,
    wrap("pvs-treatment-suggest", processPvsTreatmentSuggest),
    { connection, concurrency: 1 }
  ),
  // Closed-loop ads attribution — kept at low concurrency to stay well
  // below Meta and Google rate limits (Graph API: 200 req/hour/token for
  // smaller accounts; Google Ads OCI: 15 req/min/account).
  new Worker<CapiPurchaseJob>(
    QUEUES.capiPurchase,
    wrap("capi-purchase", processCapiPurchase),
    { connection, concurrency: 2 }
  ),
  new Worker<OciPurchaseJob>(
    QUEUES.ociPurchase,
    wrap("oci-purchase", processOciPurchase),
    { connection, concurrency: 2 }
  ),
  // Forecast snapshots: bootstrap is CPU-bound (~50ms per clinic at 500
  // resamples, dominated by sort cost). Concurrency 2 keeps the nightly
  // run quick without monopolizing the worker.
  new Worker<ForecastSnapshotJob>(
    QUEUES.forecastSnapshot,
    wrap("forecast-snapshot", processForecastSnapshot),
    { connection, concurrency: 2 }
  ),
  // Anomaly scanner. Runs every 6h, sweeps all clinics. Per-clinic cost is
  // dominated by the LLM enrichment path which only fires for "extreme"
  // candidates (rare in steady state), so concurrency 1 is plenty.
  new Worker<AnomalyScanJob>(
    QUEUES.anomalyScan,
    wrap("anomaly-scan", processAnomalyScan),
    { connection, concurrency: 1 }
  ),
];

for (const w of workers) {
  w.on("ready", () => console.log(`[worker] ${w.name} ready`));
  w.on("error", (err) => console.error(`[worker] ${w.name} error:`, err));
}

// Graceful shutdown.
async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, closing...`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

console.log(`[worker] started with ${workers.length} queues`);
