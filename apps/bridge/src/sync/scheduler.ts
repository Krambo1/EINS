import { env } from "../config.js";
import {
  loadDueLinks,
  checkpointSync,
  recordFailure,
  markInitialSyncStarted,
  completeInitialSync,
} from "../db/client.js";
import type { Adapter } from "../adapters/Adapter.js";
import { postAll } from "../portal-client.js";
import { runInitialSync } from "./initial-sync.js";
import { tomedoAdapter } from "../adapters/tomedo/index.js";
import { pabauAdapter } from "../adapters/pabau/index.js";
import { consentzAdapter } from "../adapters/consentz/index.js";
import { healthHubAdapter } from "../adapters/healthhub/index.js";
import { redAdapter } from "../adapters/red/index.js";

/**
 * Bridge sync scheduler.
 *
 * Ticks every SCHEDULER_TICK_MS (30s default) and pulls due `pvs_link`
 * rows. Per link (C7):
 *
 *   1. No completed initial sync yet → run the adapter's initialSync
 *      (historical backfill, default 12 months, override via
 *      connection_config.initialSyncMonths). On success the incremental
 *      cursor is SEEDED with the sync-start watermark so the first poll
 *      continues where the backfill ended instead of refetching history
 *      from the epoch. On any error nothing is marked complete; the
 *      attempt retries with the normal failure backoff, and the portal's
 *      dedup absorbs the re-posted overlap.
 *   2. Initial sync complete + polling adapter → incremental poll with the
 *      cursor from pvs_sync_status (C5: the one place it is written).
 *
 * Push adapters (HealthHub, RED) only take branch 1; their live events
 * arrive via inbound webhooks, so after the backfill the scheduler leaves
 * them alone.
 */

const ADAPTERS: Record<string, Adapter | undefined> = {
  tomedo: tomedoAdapter,
  pabau: pabauAdapter,
  consentz: consentzAdapter,
  healthhub: healthHubAdapter,
  red: redAdapter,
};

const DEFAULT_INITIAL_SYNC_MONTHS = 12;

/**
 * Per-link wall-clock budgets (H15). Even with a 30s per-fetch timeout, an
 * adapter that makes many sequential requests (or an inbound path that keeps
 * re-arming) could keep a single link's work running long enough to matter.
 * The scheduler awaits each link's work before scheduling the next tick, so a
 * runaway link would stall polling for ALL Praxen. These budgets fail the
 * offending link via recordFailure and let the tick move on. A poll is a
 * short incremental delta (minutes at most); an initial sync is a bounded
 * historical backfill (up to an hour for a large practice).
 */
const POLL_DEADLINE_MS = 10 * 60_000;
const INITIAL_SYNC_DEADLINE_MS = 60 * 60_000;

/**
 * Race `work` against a wall-clock deadline. Resolves/rejects with whichever
 * settles first. When the deadline wins it rejects with a labeled error; the
 * `work` promise keeps running but its rejection is swallowed so it can never
 * surface as an unhandledRejection after the race is already decided. Callers
 * pass a `hasLost()` closure into their work body and MUST skip any state
 * mutation (checkpoint / mark-complete) once it returns true, so a link that
 * lost the race cannot corrupt sync state when its adapter finally resolves.
 */
async function raceDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  label: string
): Promise<T> {
  // Swallow a late rejection from the loser so it is never unhandled.
  work.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} exceeded wall-clock budget ${deadlineMs}ms`)),
      deadlineMs
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function startScheduler(): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (stopped) return;
    try {
      const due = await loadDueLinks(new Date());
      for (const link of due) {
        const adapter = ADAPTERS[link.pvsVendor];
        if (!adapter) continue;
        if (!link.initialSyncCompletedAt) {
          await runInitialLoad(link, adapter);
          continue;
        }
        if (!adapter.poll) continue;
        await runPoll(link, adapter);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env().SCHEDULER_TICK_MS);
      }
    }
  }
  timer = setTimeout(tick, env().SCHEDULER_TICK_MS);
  console.log(
    `[scheduler] started, tick every ${env().SCHEDULER_TICK_MS}ms`
  );
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Test-only handles (same convention as the agent's framework._internal). */
export const _internal = {
  runPoll,
  runInitialLoad,
  ADAPTERS,
};

/**
 * One-time historical backfill for a freshly connected link (C7). Streams
 * adapter.initialSync into batched portal POSTs, then marks completion and
 * seeds the poll cursor. All-or-nothing: any batch error fails the whole
 * attempt (nothing is marked complete) so a "completed" sync can never
 * silently be missing batches; the retry re-streams from the top and the
 * portal dedup absorbs the overlap.
 */
async function runInitialLoad(
  link: import("../db/client.js").PvsLinkRow,
  adapter: Adapter,
  opts: { deadlineMs?: number } = {}
): Promise<void> {
  const startedAt = Date.now();
  // Watermark FIRST, then sync: anything modified while the sync runs is
  // re-fetched by the first incremental poll and deduped.
  const syncStartIso = new Date(startedAt).toISOString();
  const months =
    typeof link.connectionConfig?.initialSyncMonths === "number" &&
    link.connectionConfig.initialSyncMonths > 0
      ? (link.connectionConfig.initialSyncMonths as number)
      : DEFAULT_INITIAL_SYNC_MONTHS;
  const since = new Date(startedAt);
  since.setMonth(since.getMonth() - months);
  const deadlineMs = opts.deadlineMs ?? INITIAL_SYNC_DEADLINE_MS;
  let lost = false;
  const work = (async () => {
    await markInitialSyncStarted(link.id);
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync starting (since=${since.toISOString()})`
    );
    const report = await runInitialSync(link, adapter, since.toISOString());
    if (report.errors > 0) {
      throw new Error(
        `initial sync finished with ${report.errors} failed event(s) of ${report.totalProcessed}; not marking complete`
      );
    }
    // H15: if the deadline already fired we lost the race; do NOT mark the
    // sync complete, or a link the scheduler already failed would race back
    // to "complete" and drop the failure/backoff state.
    if (lost) return;
    await completeInitialSync(link.id, {
      cursor: adapter.seedCursor ? adapter.seedCursor(syncStartIso) : null,
      eventsIngested: report.ingested,
      nextPollAt: new Date(),
    });
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync complete: ` +
        `processed=${report.totalProcessed} ingested=${report.ingested} ` +
        `deduped=${report.deduped} (${report.elapsedMs}ms)`
    );
  })();
  try {
    await raceDeadline(work, deadlineMs, `${link.pvsVendor}/${link.clinicId} initial sync`);
  } catch (err) {
    lost = true;
    const msg = (err as Error).message;
    console.error(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync failed:`,
      msg
    );
    await recordFailure(link.id, `initial sync: ${msg}`, env().FAIL_THRESHOLD);
  }
}

async function runPoll(
  link: import("../db/client.js").PvsLinkRow,
  adapter: Adapter,
  opts: { deadlineMs?: number } = {}
): Promise<void> {
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? POLL_DEADLINE_MS;
  let lost = false;
  const work = (async () => {
    // C5: the cursor comes from pvs_sync_status.last_incremental_cursor
    // (joined in by loadDueLinks): the same place checkpointSync writes
    // it. The old code read connectionConfig.lastCursor, which nothing
    // ever wrote, so every poll restarted from the epoch.
    const cursor = link.lastCursor ?? null;
    const result = await adapter.poll!(link, cursor);
    const out = await postAll(link.clinicId, result.events);
    // H15: lost the wall-clock race, do not checkpoint from the loser.
    if (lost) return;
    // H14: postAll swallows non-ok portal responses into an error count. If
    // ANY chunk failed to post, do NOT advance the cursor: those events would
    // never be re-fetched unless the source row is modified again. Back off
    // via recordFailure so the next poll re-runs from the SAME cursor; portal
    // dedup absorbs the re-send of the chunks that already succeeded.
    if (out.errors > 0) {
      console.error(
        `[scheduler] ${link.pvsVendor}/${link.clinicId} ` +
          `${out.errors} event(s) failed to post; not checkpointing`
      );
      await recordFailure(
        link.id,
        `poll: ${out.errors} event(s) failed to post to portal; cursor not advanced`,
        env().FAIL_THRESHOLD
      );
      return;
    }
    const nextDelay = result.recommendedDelayMs ?? 60_000;
    await checkpointSync(link.id, {
      cursor: result.nextCursor,
      eventsIngested: out.ingested,
      nextPollAt: new Date(Date.now() + nextDelay),
    });
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} ` +
        `events=${result.events.length} ingested=${out.ingested} ` +
        `deduped=${out.deduped} errors=${out.errors} ` +
        `nextIn=${nextDelay}ms (${Date.now() - startedAt}ms)`
    );
  })();
  try {
    await raceDeadline(work, deadlineMs, `${link.pvsVendor}/${link.clinicId} poll`);
  } catch (err) {
    lost = true;
    const msg = (err as Error).message;
    console.error(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} failed:`,
      msg
    );
    await recordFailure(link.id, msg, env().FAIL_THRESHOLD);
  }
}
