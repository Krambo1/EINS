import "../lib/load-env";
import { Queue, QueueEvents, type RepeatOptions } from "bullmq";
import { isNull } from "drizzle-orm";
import { workerConnection } from "./connection";
import { db, schema } from "@/db/client";
import { QUEUES } from "@/server/jobs";

/**
 * Cron — runs as `pnpm cron`. Schedules repeating jobs via BullMQ's built-in
 * repeat feature. Idempotent: we compute a stable jobId per schedule so
 * re-running cron.ts doesn't create duplicate recurring entries.
 *
 * Schedules (UTC):
 *   sla-check          every 15 min
 *   refresh-oauth      every 15 min
 *   sync-meta          02:00   (per connected clinic)
 *   sync-google        02:30   (per connected clinic)
 *   kpi-rebuild        03:00   (per clinic — yesterday only)
 *   db-backup          03:30
 *   purge-audit        Sunday 04:00
 *   monthly-report     1st of month 05:00 (per clinic)
 *
 * This file exits after scheduling — BullMQ handles the actual firing.
 */

const connection = workerConnection();

function makeQueue(name: string): Queue {
  return new Queue(name, { connection });
}

async function scheduleRepeating(
  queueName: string,
  jobName: string,
  data: unknown,
  repeat: RepeatOptions,
  jobId: string
): Promise<void> {
  const q = makeQueue(queueName);
  await q.add(jobName, data, {
    repeat,
    jobId,
    removeOnComplete: { age: 3600, count: 100 },
    removeOnFail: { age: 24 * 3600 },
  });
}

async function main() {
  const events = new QueueEvents(QUEUES.slaCheck, { connection });
  events.on("completed", ({ jobId }) => console.log(`[cron] sla-check ${jobId} done`));

  // --- Platform-wide (no clinic arg) ---
  await scheduleRepeating(
    QUEUES.slaCheck,
    "scan",
    {},
    { every: 15 * 60 * 1000 },
    "sla-check-every-15m"
  );
  await scheduleRepeating(
    QUEUES.refreshOauth,
    "refresh",
    {},
    { every: 15 * 60 * 1000 },
    "refresh-oauth-every-15m"
  );
  await scheduleRepeating(
    QUEUES.dbBackup,
    "dump",
    {},
    { pattern: "30 3 * * *" },
    "db-backup-daily-0330"
  );
  await scheduleRepeating(
    QUEUES.purgeAudit,
    "purge",
    {},
    { pattern: "0 4 * * 0" },
    "purge-audit-weekly-sun-0400"
  );

  // --- Per-clinic jobs: one recurring schedule each ---
  const clinics = await db
    .select({ id: schema.clinics.id })
    .from(schema.clinics)
    .where(isNull(schema.clinics.archivedAt));

  for (const c of clinics) {
    await scheduleRepeating(
      QUEUES.syncMeta,
      "sync",
      { clinicId: c.id },
      { pattern: "0 2 * * *" },
      `sync-meta-${c.id}`
    );
    await scheduleRepeating(
      QUEUES.syncGoogle,
      "sync",
      { clinicId: c.id },
      { pattern: "30 2 * * *" },
      `sync-google-${c.id}`
    );
    await scheduleRepeating(
      QUEUES.kpiRebuild,
      "rebuild",
      {
        clinicId: c.id,
        // Placeholder — the processor derives yesterday from `new Date()`
        // if needed. We include the param for auditability.
        from: yesterdayIso(),
        to: yesterdayIso(),
      },
      { pattern: "0 3 * * *" },
      `kpi-rebuild-${c.id}`
    );
    await scheduleRepeating(
      QUEUES.monthlyReport,
      "generate",
      { clinicId: c.id, period: "__autoprev__" },
      { pattern: "0 5 1 * *" },
      `monthly-report-${c.id}`
    );
  }

  console.log(`[cron] scheduled jobs for ${clinics.length} clinics`);
  await events.close();
  process.exit(0);
}

function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error("[cron] failed:", err);
  process.exit(1);
});
