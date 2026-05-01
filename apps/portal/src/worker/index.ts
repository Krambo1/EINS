import "../lib/load-env";
import { Worker, type Processor } from "bullmq";
import { workerConnection } from "./connection";
import { QUEUES } from "@/server/jobs";

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
