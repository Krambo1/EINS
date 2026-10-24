import { env } from "../config.js";
import {
  loadDueLinks,
  claimLink,
  checkpointSync,
  saveProgress,
  releaseLink,
  recordFailure,
  restoreLegacyErrorStatus,
  markInitialSyncStarted,
  completeInitialSync,
  type PvsLinkRow,
} from "../db/client.js";
import type { Adapter } from "../adapters/Adapter.js";
import { runInitialSync } from "./initial-sync.js";
import {
  PACE_MS,
  addOut,
  countRejects,
  describeSkips,
  newStats,
  postChunkWithRetry,
  topReasons,
  type SyncStats,
} from "./post-chunk.js";
import {
  parseInitialState,
  type InitialSyncState,
  type SyncChunk,
} from "../adapters/_shared/stream-sync.js";
import { tomedoAdapter } from "../adapters/tomedo/index.js";
import { pabauAdapter } from "../adapters/pabau/index.js";
import { consentzAdapter } from "../adapters/consentz/index.js";
import { healthHubAdapter } from "../adapters/healthhub/index.js";
import { redAdapter } from "../adapters/red/index.js";
import { markTickOk, setInFlight } from "../health.js";

/**
 * Bridge sync scheduler.
 *
 * Ticks every SCHEDULER_TICK_MS (30s default), lists due `pvs_link` rows and
 * dispatches up to SCHEDULER_CONCURRENCY of them at a time. The tick itself
 * never waits for link work, so one slow vendor cannot stall every other Praxis
 * and the tick heartbeat (/healthz) keeps beating while a long initial sync
 * runs. Per link:
 *
 *   0. CLAIM it atomically (claimLink: next_poll_at lease). Two machines
 *      listing the same due link both try; exactly one wins.
 *   1. No completed initial sync yet → backfill (default 12 months, override via
 *      connection_config.initialSyncMonths). REST adapters run RESUMABLY: one
 *      vendor page at a time, progress persisted after every accepted page, at
 *      most INITIAL_RUN_BUDGET_MS of work per run, batches paced under the
 *      portal's per-clinic limit. A run that ends early (budget, 429, restart)
 *      continues from the saved position next tick; only a fully drained
 *      backfill is marked complete and seeds the poll cursor with the FIRST
 *      run's start time.
 *   2. Initial sync complete + polling adapter → incremental poll, streamed
 *      page by page: post, then checkpoint when a stream is fully accepted.
 *
 * What blocks a checkpoint: network errors, HTTP 408/429/5xx/409 and retryable
 * per-event reasons (link_not_ready, vendor_mismatch, internal_error,
 * rate_limited, unknown). What does NOT: a few events the portal permanently
 * rejects or the pre-flight sanitiser drops; they are counted, summarised in
 * pvs_sync_status.last_error, and skipped so one poison row cannot freeze a
 * practice. But a stream whose chunk is mostly rejects (see REJECT_MIN and
 * REJECT_SHARE) is not silently skipped: its watermark is held and the poll
 * fails with the stream name and the top reasons, because a systematic reject
 * means a mapping or currency defect that would otherwise lose that stream's
 * rows for good. Failures are recorded in pvs_sync_status only; pvs_link.status
 * is never written.
 *
 * Streams are isolated: a failing stream (vendor 5xx, rejects) never keeps the
 * others from running and persisting their own watermark; the failures are
 * reported together after the last stream.
 *
 * Push adapters (HealthHub, RED) only take branch 1 (all-or-nothing, as they
 * have no resumable chunks); their live events arrive via inbound webhooks. The
 * due-link query does not list them at all yet (see loadDueLinks).
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
 * Wall-clock budgets (H15). Deadlines now CANCEL the work (an AbortSignal runs
 * through every vendor/portal fetch and sleep) rather than merely abandoning a
 * promise; raceDeadline stays as the backstop for an adapter that ignores it.
 *
 *   POLL_DEADLINE_MS            one incremental poll of one link
 *   INITIAL_RUN_BUDGET_MS       soft: a resumable initial-sync run stops pulling
 *                               new pages after this and resumes next tick
 *   INITIAL_RUN_DEADLINE_MS     hard cap on such a run
 *   LEGACY_INITIAL_DEADLINE_MS  non-resumable (push adapter) initial sync
 *
 * The claim lease outlives the deadline by LEASE_MARGIN_MS.
 */
const POLL_DEADLINE_MS = 10 * 60_000;
const INITIAL_RUN_BUDGET_MS = 8 * 60_000;
const INITIAL_RUN_DEADLINE_MS = 12 * 60_000;
const LEGACY_INITIAL_DEADLINE_MS = 60 * 60_000;
const LEASE_MARGIN_MS = 60_000;
/** After a poll that hit its page cap, come back quickly. */
const MORE_WORK_DELAY_MS = 10_000;
/** A poll stops pulling new pages at this share of its deadline, so what is
 *  already read can still be posted and persisted before the hard cut. */
const POLL_WALK_SHARE = 0.8;
/** A stream with at least this many rejected events ... */
const REJECT_MIN = 5;
/** ... in a chunk where more than this share of the events were rejected, is
 *  not advanced (see the header). */
const REJECT_SHARE = 0.5;
/** A link released on shutdown becomes due again this soon. */
const SHUTDOWN_RELEASE_MS = 5_000;

/**
 * Race `work` against a wall-clock deadline. Resolves/rejects with whichever
 * settles first. When the deadline wins it rejects with a labeled error and
 * aborts `controller` (cancelling in-flight fetches/sleeps); the `work` promise
 * may still settle later but its rejection is swallowed so it can never surface
 * as an unhandledRejection. Callers pass a `hasLost()` closure into their work
 * body and MUST skip any state mutation (checkpoint / mark-complete) once it
 * returns true, so a link that lost the race cannot corrupt sync state.
 */
async function raceDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  label: string,
  controller?: AbortController
): Promise<T> {
  work.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} exceeded wall-clock budget ${deadlineMs}ms`);
      controller?.abort(err);
      reject(err);
    }, deadlineMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Record a failure without ever throwing: one link's bookkeeping error must
 *  not abort the others. */
async function safeRecordFailure(
  linkId: string,
  message: string,
  retryAfterMs?: number
): Promise<void> {
  try {
    if (retryAfterMs !== undefined && retryAfterMs > 0) {
      await recordFailure(linkId, message, env().FAIL_THRESHOLD, retryAfterMs);
    } else {
      await recordFailure(linkId, message, env().FAIL_THRESHOLD);
    }
  } catch (err) {
    console.error(
      `[scheduler] could not record failure for link ${linkId} (${message}):`,
      (err as Error).message
    );
  }
}

/** Thrown when the portal did not accept events that must be retried. */
class PostBlockedError extends Error {
  constructor(
    message: string,
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

function blocked(prefix: string, errors: number, failure?: string, retryAfterMs?: number) {
  return new PostBlockedError(
    `${prefix}: ${errors} event(s) failed to post to portal (${failure ?? "unknown"}); cursor not advanced`,
    retryAfterMs
  );
}

export function startScheduler(): {
  stop: () => void;
  /** Resolves when no link is in flight any more, or after `timeoutMs`. */
  idle: (timeoutMs?: number) => Promise<void>;
} {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const shutdown = new AbortController();
  const inFlight = new Set<string>();
  const running = new Set<Promise<void>>();
  /** Due links from the latest tick that have not been started yet. */
  let pending: PvsLinkRow[] = [];

  async function processLink(link: PvsLinkRow): Promise<void> {
    const adapter = ADAPTERS[link.pvsVendor];
    if (!adapter) return;
    const initial = !link.initialSyncCompletedAt;
    if (!initial && !adapter.poll && !adapter.pollChunks) return;
    const budget = initial
      ? adapter.initialChunks
        ? INITIAL_RUN_DEADLINE_MS
        : LEGACY_INITIAL_DEADLINE_MS
      : POLL_DEADLINE_MS;
    // loadDueLinks only lists candidates: take the lease before doing anything.
    if (!(await claimLink(link.id, budget + LEASE_MARGIN_MS))) return;
    if (link.status === "error") {
      try {
        await restoreLegacyErrorStatus(link.id);
      } catch (err) {
        console.warn(
          `[scheduler] could not clear legacy status=error on ${link.id}:`,
          (err as Error).message
        );
      }
    }
    if (initial) await runInitialLoad(link, adapter, { signal: shutdown.signal });
    else await runPoll(link, adapter, { signal: shutdown.signal });
  }

  /** Start pending links until every concurrency slot is busy. */
  function fill() {
    while (!stopped && inFlight.size < env().SCHEDULER_CONCURRENCY) {
      const link = pending.shift();
      if (!link) return;
      if (inFlight.has(link.id)) continue;
      inFlight.add(link.id);
      setInFlight(inFlight.size);
      const p: Promise<void> = processLink(link)
        .catch((err) =>
          console.error(
            `[scheduler] ${link.pvsVendor}/${link.clinicId} worker crashed:`,
            (err as Error).message
          )
        )
        .finally(() => {
          inFlight.delete(link.id);
          running.delete(p);
          setInFlight(inFlight.size);
          // A slot just freed up: do not leave it idle until the next tick
          // (30 s) while due links are waiting. Bounded by the concurrency check.
          fill();
        });
      running.add(p);
    }
  }

  async function tick() {
    if (stopped) return;
    try {
      pending = await loadDueLinks(new Date());
      // Reaching here means the DB answered the selection: that is the tick
      // heartbeat /healthz watches (independent of how long link work takes).
      markTickOk();
      fill();
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
    `[scheduler] started, tick every ${env().SCHEDULER_TICK_MS}ms, concurrency ${env().SCHEDULER_CONCURRENCY}`
  );
  return {
    stop() {
      stopped = true;
      pending = [];
      if (timer) clearTimeout(timer);
      shutdown.abort(new Error("scheduler stopped"));
    },
    async idle(timeoutMs = 25_000) {
      let t: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((resolve) => {
        t = setTimeout(resolve, timeoutMs);
        t.unref?.();
      });
      try {
        await Promise.race([Promise.allSettled([...running]).then(() => undefined), timeout]);
      } finally {
        if (t) clearTimeout(t);
      }
    },
  };
}

/** Test-only handles (same convention as the agent's framework._internal). */
export const _internal = {
  runPoll,
  runInitialLoad,
  ADAPTERS,
};

interface RunOptions {
  deadlineMs?: number;
  /** Shutdown signal; an abort from here is not a link failure. */
  signal?: AbortSignal;
  /** Initial sync only: soft per-run time budget. */
  runBudgetMs?: number;
}

function linkedController(signal?: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  }
  return ac;
}

/**
 * Shutdown (SIGTERM) cancelled this link's work: give the lease back now. The
 * claim lease would otherwise sit on the link for its whole length (a poll's
 * 10 minutes plus margin) and the link would not be worked until a new machine
 * waited it out. Never throws: the process is on its way out.
 */
async function releaseAfterShutdown(linkId: string): Promise<void> {
  try {
    await releaseLink(linkId, new Date(Date.now() + SHUTDOWN_RELEASE_MS));
  } catch (err) {
    console.warn(
      `[scheduler] could not release link ${linkId} on shutdown:`,
      (err as Error).message
    );
  }
}

/** Adapters that only implement the buffered `poll` run as a single chunk. */
async function* bufferedPoll(
  adapter: Adapter,
  link: PvsLinkRow,
  cursor: string | null,
  signal: AbortSignal,
  now: Date,
  onDelay: (ms: number | undefined) => void
): AsyncIterable<SyncChunk> {
  const result = await adapter.poll!(link, cursor, { signal, now });
  onDelay(result.recommendedDelayMs);
  yield { events: result.events, cursor: result.nextCursor };
}

/**
 * One-time historical backfill for a freshly connected link (C7). REST adapters
 * run resumably; others all-or-nothing (see runInitialSync).
 */
async function runInitialLoad(
  link: PvsLinkRow,
  adapter: Adapter,
  opts: RunOptions = {}
): Promise<void> {
  const label = `${link.pvsVendor}/${link.clinicId} initial sync`;
  const resumable = typeof adapter.initialChunks === "function";
  const deadlineMs =
    opts.deadlineMs ?? (resumable ? INITIAL_RUN_DEADLINE_MS : LEGACY_INITIAL_DEADLINE_MS);
  const ac = linkedController(opts.signal);
  let lost = false;
  const work = resumable
    ? resumableInitial(link, adapter, ac.signal, () => lost, opts.runBudgetMs)
    : legacyInitial(link, adapter, ac.signal, () => lost);
  try {
    await raceDeadline(work, deadlineMs, label, ac);
  } catch (err) {
    lost = true;
    ac.abort(err);
    if (opts.signal?.aborted) {
      // Shutting down: not a failure, but do not leave the lease held.
      await releaseAfterShutdown(link.id);
      return;
    }
    const msg = (err as Error).message;
    console.error(`[scheduler] ${label} failed:`, msg);
    await safeRecordFailure(
      link.id,
      err instanceof PostBlockedError ? msg : `initial sync: ${msg}`,
      err instanceof PostBlockedError ? err.retryAfterMs : undefined
    );
  }
}

function initialMonths(link: PvsLinkRow): number {
  const m = link.connectionConfig?.initialSyncMonths;
  return typeof m === "number" && m > 0 ? m : DEFAULT_INITIAL_SYNC_MONTHS;
}

async function legacyInitial(
  link: PvsLinkRow,
  adapter: Adapter,
  signal: AbortSignal,
  hasLost: () => boolean
): Promise<void> {
  const startedAt = Date.now();
  // Watermark FIRST, then sync: anything modified while the sync runs is
  // re-fetched by the first incremental poll and deduped.
  const syncStartIso = new Date(startedAt).toISOString();
  const since = new Date(startedAt);
  since.setMonth(since.getMonth() - initialMonths(link));
  await markInitialSyncStarted(link.id);
  console.log(
    `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync starting (since=${since.toISOString()})`
  );
  const report = await runInitialSync(link, adapter, since.toISOString(), { signal });
  if (report.errors > 0) {
    throw new Error(
      `initial sync finished with ${report.errors} failed event(s) of ${report.totalProcessed} (${report.failure ?? "unknown"}); not marking complete`
    );
  }
  // H15: if the deadline already fired we lost the race; do NOT mark the sync
  // complete, or a link the scheduler already failed would race back to
  // "complete" and drop the failure/backoff state.
  if (hasLost()) return;
  await completeInitialSync(link.id, {
    cursor: adapter.seedCursor ? adapter.seedCursor(syncStartIso) : null,
    eventsIngested: report.ingested,
    nextPollAt: new Date(),
    warning: describeSkips(report),
  });
  console.log(
    `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync complete: ` +
      `processed=${report.totalProcessed} ingested=${report.ingested} ` +
      `deduped=${report.deduped} skipped=${report.skipped} dropped=${report.dropped} (${report.elapsedMs}ms)`
  );
}

async function resumableInitial(
  link: PvsLinkRow,
  adapter: Adapter,
  signal: AbortSignal,
  hasLost: () => boolean,
  runBudgetMs = INITIAL_RUN_BUDGET_MS
): Promise<void> {
  const startedAt = Date.now();
  const stats = newStats();
  let state: InitialSyncState | null = parseInitialState(link.lastCursor);
  if (!state) {
    // First run. The FIRST run's start is the watermark handed to the poller.
    const since = new Date(startedAt);
    since.setMonth(since.getMonth() - initialMonths(link));
    state = {
      v: 1,
      start: new Date(startedAt).toISOString(),
      since: since.toISOString(),
      i: 0,
      p: null,
    };
    await markInitialSyncStarted(link.id);
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync starting (since=${state.since})`
    );
  } else {
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync resuming (stream #${state.i}, position ${state.p ?? "start"})`
    );
  }

  let unsaved = 0;
  let outOfTime = false;
  const notes: string[] = [];
  for await (const chunk of adapter.initialChunks!(link, state, { signal })) {
    if (hasLost()) return;
    stats.skippedRows += chunk.skippedRows ?? 0;
    if (chunk.disabledStream) {
      // An optional stream the account does not have: skip it, keep going.
      notes.push(
        `${chunk.disabledStream.stream} is not enabled for this account (HTTP ${chunk.disabledStream.status}), skipped`
      );
    }
    if (chunk.events.length > 0) {
      const out = await postChunkWithRetry(link.clinicId, chunk.events, {
        signal,
        paceMs: PACE_MS,
      });
      addOut(stats, out);
      unsaved += out.ingested ?? 0;
      if ((out.errors ?? 0) > 0) {
        // Keep what was accepted before this chunk; the resume token still
        // points at this chunk, so it is re-sent after the backoff.
        throw blocked("initial sync", out.errors, out.failure, out.retryAfterMs);
      }
    }
    if (hasLost()) return;
    if (chunk.cursor) {
      await saveProgress(link.id, { cursor: chunk.cursor, eventsIngested: unsaved });
      unsaved = 0;
    }
    if (Date.now() - startedAt > runBudgetMs) {
      outOfTime = true;
      break;
    }
  }
  if (hasLost()) return;

  if (outOfTime) {
    // Progress is saved: continue next tick, not a failure.
    await releaseLink(link.id, new Date(Date.now() + 5_000));
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync run budget used up; will resume ` +
        `(ingested=${stats.ingested} deduped=${stats.deduped} skipped=${stats.skipped} dropped=${stats.dropped})`
    );
    return;
  }
  await completeInitialSync(link.id, {
    cursor: adapter.seedCursor ? adapter.seedCursor(state.start) : null,
    eventsIngested: unsaved,
    nextPollAt: new Date(),
    warning: [describeSkips(stats), ...notes].filter(Boolean).join("; ") || null,
  });
  console.log(
    `[scheduler] ${link.pvsVendor}/${link.clinicId} initial sync complete: ` +
      `ingested=${stats.ingested} deduped=${stats.deduped} skipped=${stats.skipped} ` +
      `dropped=${stats.dropped} (${Date.now() - startedAt}ms this run)`
  );
}

async function runPoll(
  link: PvsLinkRow,
  adapter: Adapter,
  opts: RunOptions = {}
): Promise<void> {
  const startedAt = Date.now();
  const deadlineMs = opts.deadlineMs ?? POLL_DEADLINE_MS;
  const label = `${link.pvsVendor}/${link.clinicId} poll`;
  const ac = linkedController(opts.signal);
  let lost = false;
  const stats: SyncStats = newStats();
  const work = (async () => {
    // C5: the cursor comes from pvs_sync_status.last_incremental_cursor
    // (joined in by loadDueLinks): the same place checkpointSync writes it.
    const cursor = link.lastCursor ?? null;
    const pollStart = new Date();
    let legacyDelay: number | undefined;
    // Streams this poll refuses to advance (see the reject rule below). The
    // adapter reads the set while it walks and leaves such a stream's
    // watermark where it was.
    const failedStreams = new Set<string>();
    const chunks: AsyncIterable<SyncChunk> = adapter.pollChunks
      ? adapter.pollChunks(link, cursor, {
          signal: ac.signal,
          now: pollStart,
          // Stop pulling new pages a little before the hard deadline so what was
          // read can still be posted and persisted.
          deadlineAt: startedAt + deadlineMs * POLL_WALK_SHARE,
          failedStreams,
        })
      : bufferedPoll(adapter, link, cursor, ac.signal, pollStart, (d) => {
          legacyDelay = d;
        });

    let lastCursor: string | null = null;
    let unsaved = 0;
    let more = false;
    const rejectsByStream = new Map<string, { total: number; byReason: Record<string, number> }>();
    const streamFailures: string[] = [];
    const notes: string[] = [];
    let walkError: Error | undefined;
    try {
      for await (const chunk of chunks) {
        // H15: lost the wall-clock race, do not post or checkpoint from the loser.
        if (lost) return;
        stats.skippedRows += chunk.skippedRows ?? 0;
        if (chunk.disabledStream) {
          // An optional stream the account does not have (401/403/404): the poll
          // still succeeds, but the gap must be visible in last_error.
          notes.push(
            `${chunk.disabledStream.stream} is not enabled for this account (HTTP ${chunk.disabledStream.status}), skipped`
          );
          continue;
        }
        if (chunk.events.length > 0) {
          const out = await postChunkWithRetry(link.clinicId, chunk.events, {
            signal: ac.signal,
            paceMs: PACE_MS,
          });
          addOut(stats, out);
          unsaved += out.ingested ?? 0;
          // H14: events that must be retried block the checkpoint: those events
          // would never be re-fetched unless the source row is modified again.
          // Back off so the next poll re-runs from the SAME cursor; portal dedup
          // absorbs the re-send of what already went in. (A few permanently
          // rejected events are NOT in `errors`: they are skipped so one poison
          // row cannot freeze the stream.)
          if ((out.errors ?? 0) > 0) {
            console.error(
              `[scheduler] ${link.pvsVendor}/${link.clinicId} ` +
                `${out.errors} event(s) failed to post (${out.failure ?? "unknown"}); not checkpointing past them`
            );
            throw blocked("poll", out.errors, out.failure, out.retryAfterMs);
          }
          // A MOSTLY rejected chunk is a systematic defect (mapping, currency),
          // not one poison row: skipping it would drop the stream's rows for
          // good. Hold this stream's watermark and fail the poll instead; the
          // other streams carry on.
          const rejected = countRejects(out);
          if (chunk.stream && rejected.count > 0) {
            const acc = rejectsByStream.get(chunk.stream) ?? { total: 0, byReason: {} };
            acc.total += rejected.count;
            for (const [k, v] of Object.entries(rejected.byReason)) {
              acc.byReason[k] = (acc.byReason[k] ?? 0) + v;
            }
            rejectsByStream.set(chunk.stream, acc);
            if (
              acc.total >= REJECT_MIN &&
              rejected.count > chunk.events.length * REJECT_SHARE &&
              !failedStreams.has(chunk.stream)
            ) {
              failedStreams.add(chunk.stream);
              streamFailures.push(
                `${chunk.stream}: ${acc.total} event(s) rejected for good (${topReasons(acc.byReason)}); watermark not advanced`
              );
            }
          }
        }
        if (chunk.more) more = true;
        if (chunk.cursor) {
          // A stream is fully accepted: persist its watermark now, so a later
          // stream failing does not redo this one.
          if (lost) return;
          lastCursor = chunk.cursor;
          if (adapter.pollChunks) {
            await saveProgress(link.id, { cursor: chunk.cursor, eventsIngested: unsaved });
            unsaved = 0;
          }
        }
      }
    } catch (err) {
      // Post failures and cancellations end the poll as before; a stream-level
      // error from the engine only arrives after every stream ran.
      if (err instanceof PostBlockedError || ac.signal.aborted) throw err;
      walkError = err as Error;
    }
    if (lost) return;
    const problems = [...streamFailures];
    if (walkError) problems.push(walkError.message);
    if (problems.length > 0) {
      if (unsaved > 0 && adapter.pollChunks) {
        await saveProgress(link.id, { cursor: null, eventsIngested: unsaved });
      }
      throw new PostBlockedError(`poll: ${problems.join("; ")}`);
    }
    const nextDelay = more
      ? MORE_WORK_DELAY_MS
      : (legacyDelay ??
        (stats.ingested + stats.quarantined === 0 ? 5 * 60_000 : 60_000));
    // Sticky: any reject or skipped stream keeps last_error set; only a poll
    // with none of them clears it.
    const warning = [describeSkips(stats), ...notes].filter(Boolean).join("; ") || null;
    await checkpointSync(link.id, {
      cursor: lastCursor,
      eventsIngested: unsaved,
      nextPollAt: new Date(Date.now() + nextDelay),
      warning,
    });
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} ` +
        `ingested=${stats.ingested} deduped=${stats.deduped} quarantined=${stats.quarantined} ` +
        `skipped=${stats.skipped} dropped=${stats.dropped} ` +
        `nextIn=${nextDelay}ms (${Date.now() - startedAt}ms)`
    );
  })();
  try {
    await raceDeadline(work, deadlineMs, label, ac);
  } catch (err) {
    lost = true;
    ac.abort(err);
    if (opts.signal?.aborted) {
      // Shutting down: not a failure, but do not leave the lease held.
      await releaseAfterShutdown(link.id);
      return;
    }
    const msg = (err as Error).message;
    console.error(`[scheduler] ${label} failed:`, msg);
    await safeRecordFailure(
      link.id,
      err instanceof PostBlockedError ? msg : `poll: ${msg}`,
      err instanceof PostBlockedError ? err.retryAfterMs : undefined
    );
  }
}
