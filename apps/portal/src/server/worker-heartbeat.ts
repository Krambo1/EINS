import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Worker liveness, stored in Postgres (table `worker_heartbeat`, migration 0079).
 *
 * The Fly worker owns every cron (health scan, derive, link backfill, partition
 * rotation, reconcile). If it dies nothing else notices, because every one of
 * those jobs is merely "not run". The worker therefore writes a beat every
 * 60 s under name `worker`, and /api/health turns a stale beat into a 503.
 *
 * Per-job rows (`job:<queue>`) record the last SUCCESSFUL run of a PVS queue so
 * a worker that was down across a cron tick can enqueue one catch-up run when
 * it boots (pg-boss does not replay missed cron ticks).
 *
 * All reads fail soft: a missing table (migration not applied yet) or a DB
 * hiccup must never be read as "worker stale".
 */

export const WORKER_BEAT_NAME = "worker";
export const WORKER_BEAT_INTERVAL_MS = 60_000;
/** /api/health reports `worker_stale` past this age. */
export const WORKER_STALE_MS = 10 * 60 * 1000;

export const jobSuccessName = (queue: string) => `job:${queue}`;

async function upsertBeat(name: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO worker_heartbeat (name, last_beat_at)
    VALUES (${name}, now())
    ON CONFLICT (name) DO UPDATE SET last_beat_at = now()
  `);
}

/** Worker process: "I am alive". Throws on DB failure so the caller can count. */
export function recordWorkerBeat(): Promise<void> {
  return upsertBeat(WORKER_BEAT_NAME);
}

/** Worker process: a PVS job finished successfully. Never throws. */
export async function recordJobSuccess(queue: string): Promise<void> {
  try {
    await upsertBeat(jobSuccessName(queue));
  } catch (err) {
    console.error(`[worker-heartbeat] success stamp failed for ${queue}:`, err);
  }
}

/** Last stamp for a name, or null when absent / unreadable. */
export async function getLastBeat(name: string): Promise<Date | null> {
  try {
    const rows = (await db.execute(
      sql`SELECT last_beat_at FROM worker_heartbeat WHERE name = ${name} LIMIT 1`
    )) as unknown as Array<{ last_beat_at: Date | string }>;
    const v = rows[0]?.last_beat_at;
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** Map of last-success stamps for the given queues (missing = absent). */
export async function getJobSuccessTimes(
  queues: readonly string[]
): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  for (const q of queues) {
    const d = await getLastBeat(jobSuccessName(q));
    if (d) out.set(q, d);
  }
  return out;
}

/**
 * Pure staleness decision. A missing beat is NOT stale: it means the worker was
 * never deployed against this database (dev, preview, or the portal shipping
 * before the first worker boot), and failing the deploy gate for that would
 * block the very deploy that fixes it.
 */
export function isWorkerStale(lastBeat: Date | null, now: Date): boolean {
  if (!lastBeat) return false;
  return now.getTime() - lastBeat.getTime() > WORKER_STALE_MS;
}

/** Catch-up periods: a job whose last success is older than this is overdue. */
export const CATCH_UP_AFTER_MS: Readonly<Record<string, number>> = {
  // cron 0 4 * * *  (daily)
  "pvs-partition-rotate": 26 * 60 * 60 * 1000,
  // cron 15 */4 * * *
  "pvs-reconcile": 5 * 60 * 60 * 1000,
};

/**
 * Queues that need an immediate catch-up run at worker boot: never succeeded
 * (no stamp) or last success older than the period.
 */
export function planCatchUps(
  lastSuccess: ReadonlyMap<string, Date>,
  now: Date
): string[] {
  return Object.entries(CATCH_UP_AFTER_MS)
    .filter(([queue, maxAge]) => {
      const last = lastSuccess.get(queue);
      return !last || now.getTime() - last.getTime() > maxAge;
    })
    .map(([queue]) => queue);
}
