import PgBoss from "pg-boss";
import { bossConnectionString } from "@/lib/env";

/**
 * pg-boss instance for the WORKER process (separate from the send-only producer
 * boss in `src/server/jobs.ts`). The worker owns the entire transport:
 *   - migrate:   create/upgrade the `pgboss` schema on boot (needs CREATE; the
 *                worker connects as the superuser DATABASE_URL).
 *   - supervise: maintenance loop — archive/expire completed jobs + recover
 *                stalled (expired-active) jobs.
 *   - schedule:  cron timekeeper that fires the repeating schedules.
 *
 * Uses the DIRECT (session-mode) endpoint via `bossConnectionString()`:
 * pg-boss holds long-lived workers and takes advisory locks for maintenance,
 * which a transaction-mode pooler (Neon `-pooler` / PgBouncer) would break.
 */
let boss: PgBoss | undefined;

export function workerBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss({
      connectionString: bossConnectionString(),
      migrate: true,
      supervise: true,
      schedule: true,
    });
    boss.on("error", (err) =>
      console.error(
        "[worker][pg-boss]",
        err instanceof Error ? err.message : err
      )
    );
  }
  return boss;
}
