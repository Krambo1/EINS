import type { BatchPostResult, PostResult } from "./portal-client.js";
import { makeRateLimiter } from "./log-throttle.js";

/**
 * H10 + H11: the outbox flush cycle, extracted from index.ts so the
 * failure-handling policy is unit-testable without booting the whole agent.
 *
 * Two behaviours this module owns:
 *
 *   H10 (multi-day outage is loud locally): when a cycle sees failures it
 *   emits a rate-limited outage summary (queue depth, oldest pending age,
 *   last failure reason) so an operator tailing the log sees "nothing is
 *   uploading" instead of a silent-but-green process.
 *
 *   H11 (credential rotation must not destroy events): a signature/auth
 *   rejection is NOT permanent. Rows stay pending, flushing pauses (one
 *   slow probe every ~10 min instead of hammering every 5s), and the agent
 *   logs loudly that its secret looks wrong. A later successful flush clears
 *   the pause. Only genuine validation rejects (malformed events) are marked
 *   permanently failed.
 */

const AUTH_PROBE_INTERVAL_MS = 10 * 60_000;
const OUTAGE_LOG_INTERVAL_MS = 10 * 60_000;
const AUTH_LOG_INTERVAL_MS = 10 * 60_000;

/** Batch size per flush cycle; matches the pre-refactor dueRows(50). */
const FLUSH_BATCH = 50;

/** Circuit breaker: backoff after n consecutive transient batch failures. */
const TRANSIENT_BACKOFF_BASE_MS = 5_000;
const TRANSIENT_BACKOFF_MAX_MS = 5 * 60_000;
/** After this many consecutive batch-level 5xx, run one single-event cycle. */
const SINGLE_MODE_AFTER_5XX = 3;
/**
 * B4: a batch that keeps timing out (while heartbeats prove the portal is up)
 * or keeps coming back ambiguous usually has ONE event in it that the portal
 * cannot finish. Only the single-event path can isolate it, so it gets the same
 * treatment as repeated 5xx.
 */
const SINGLE_MODE_AFTER_STALLS = 3;
/**
 * B2 breaker: this many consecutive per-row permanent rejections that share one
 * HTTP status are not about the events (a misrouted portal URL, a bad deploy,
 * version skew), so none of them is dead-lettered and the cycle stops.
 */
const PERMANENT_BREAKER_AFTER = 5;

/**
 * Pass 2 (verifier): the batch-mode counterpart of the B2 breaker. When at
 * least PERMANENT_BREAKER_AFTER events AND more than half of a batch come
 * back permanently rejected for the SAME reason, the rejection is about the
 * route or a portal/agent version mismatch, not the events: they are held for
 * retry instead of dead-lettered. billing_conflict is excluded: dead-lettering
 * it is the intended outcome (another source owns billing for the clinic).
 */
export function systemicPermanentReason(
  batchSize: number,
  outcomes: ReadonlyArray<{ ok: boolean; retryable?: boolean; reason?: string } | undefined>
): string | null {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    if (!o || o.ok || o.retryable || !o.reason || o.reason === "billing_conflict") continue;
    counts.set(o.reason, (counts.get(o.reason) ?? 0) + 1);
  }
  for (const [reason, n] of counts) {
    if (n >= PERMANENT_BREAKER_AFTER && n * 2 > batchSize) return reason;
  }
  return null;
}

export interface FlushRow {
  id: number;
  payload: string;
}

/** Outbox "things are queued / broken" snapshot for the outage log line. */
export interface OutageSnapshot {
  /** All rows still status='pending' (the retry backlog). */
  pendingCount: number;
  /** Pending rows that have already failed at least once (attempt_count>0). */
  pendingWithAttemptsCount: number;
  /** Oldest created_at among pending rows (epoch-ms), or null. */
  oldestPendingAt: number | null;
  /** Rows permanently marked failed. */
  failedCount: number;
}

export interface FlushDeps {
  dueRows: (limit: number) => FlushRow[];
  postEvent: (payload: string) => Promise<PostResult>;
  /**
   * Optional batch transport. When present, a cycle sends its due rows as ONE
   * request and applies per-row outcomes. When absent the cycle uses the
   * single-event path exactly as before.
   */
  postBatch?: (payloads: string[]) => Promise<BatchPostResult>;
  markSent: (id: number) => void;
  /**
   * `rand` is ONE jitter source shared by every row that fails in the same
   * cycle (B3), so rows that failed together keep their relative order.
   */
  recordRetry: (id: number, reason: string, rand?: () => number) => void;
  markFailedPermanent: (id: number, reason: string) => void;
  outageSnapshot: () => OutageSnapshot;
  /** Wall clock (epoch-ms): timestamps and log text only. */
  now: () => number;
  /**
   * Monotonic clock (ms) for every in-memory gate: the auth-probe cadence and
   * the flush backoff gate. A wall clock that steps backwards (NTP fix, manual
   * change) must not freeze the loop. Defaults to `now` (tests).
   */
  monotonicNow?: () => number;
  /**
   * True while heartbeats are reaching the portal. Lets the cycle tell "the
   * portal is down" from "the portal is up but cannot finish this batch".
   * Defaults to true when absent.
   */
  portalReachable?: () => boolean;
  logWarn: (msg: string) => void;
  logError: (msg: string) => void;
}

export interface FlushState {
  /** True while the portal is rejecting our signature; flushing is paused. */
  authPaused: boolean;
  /** epoch-ms the pause began (for operator forensics), or null. */
  authPausedSince: number | null;
  /** MONOTONIC ms of the last probe attempt while paused (gates the 10-min cadence). */
  lastAuthProbeAt: number;
  /**
   * M-A3: backoff (ms) the last cycle picked up from a portal Retry-After
   * header before aborting, or null when the last cycle set no backoff. Reset
   * at the start of every cycle. The scheduler (in index.ts) MAY read this to
   * delay the next flush; the flush module itself only surfaces it.
   */
  retryAfterMs: number | null;
  /** Consecutive transient (network / retryable) batch-level failures; circuit breaker. */
  consecutiveTransientFailures: number;
  /** Consecutive batch-level 5xx responses. */
  consecutive5xx: number;
  /** When true the next cycle runs in single-event mode to isolate a poison event. */
  singleModeNext: boolean;
  /** Consecutive batch timeouts (portal reachable) / ambiguous responses. */
  consecutiveStalls: number;
  /** B5: the most recent upload error, as the heartbeat reports it. */
  lastBatchError: string | null;
  /** B5: wall-clock epoch-ms of that error. */
  lastBatchErrorAt: number | null;
  /** B5: wall-clock epoch-ms the portal last stored at least one event. */
  lastSuccessAt: number | null;
  /** MONOTONIC ms before which flushTick() does not start a cycle. */
  nextFlushAllowedAtMono: number;
  /** A cycle is running (single-flight guard for flushTick). */
  inFlight: boolean;
  shouldLogOutage: (now: number) => boolean;
  shouldLogAuth: (now: number) => boolean;
}

export function createFlushState(): FlushState {
  return {
    authPaused: false,
    authPausedSince: null,
    lastAuthProbeAt: 0,
    retryAfterMs: null,
    consecutiveTransientFailures: 0,
    consecutive5xx: 0,
    singleModeNext: false,
    consecutiveStalls: 0,
    lastBatchError: null,
    lastBatchErrorAt: null,
    lastSuccessAt: null,
    nextFlushAllowedAtMono: 0,
    inFlight: false,
    shouldLogOutage: makeRateLimiter(OUTAGE_LOG_INTERVAL_MS),
    shouldLogAuth: makeRateLimiter(AUTH_LOG_INTERVAL_MS),
  };
}

/** True when this result is an authentication/signature rejection that a
 *  re-enrollment (or restoring the correct secret) would fix. */
function isAuthFailure(result: PostResult): boolean {
  return result.ok === false && result.authFailure === true;
}

/** M-A3: true when the result is a transport-level failure or our own abort
 *  timeout, i.e. the portal is unreachable and every other due row would fail
 *  identically after burning its own full timeout. */
function isNetworkFailure(result: PostResult): boolean {
  return result.ok === false && result.networkFailure === true;
}

function monoOf(deps: FlushDeps): number {
  return (deps.monotonicNow ?? deps.now)();
}

/**
 * One jitter draw per cycle (B3). Every row that fails in the same cycle shares
 * it, so they come back in the order they went out; independent per-row jitter
 * (+/-20 %) scrambled rows of the same invoice or patient, and the portal
 * resolves equal-time ties by arrival order.
 */
function makeCycleRand(): () => number {
  const draw = Math.random();
  return () => draw;
}

/** Cycle-level exponential backoff for a transient batch/cycle failure. */
function applyTransientBackoff(state: FlushState): void {
  state.consecutiveTransientFailures++;
  state.retryAfterMs = Math.min(
    TRANSIENT_BACKOFF_MAX_MS,
    TRANSIENT_BACKOFF_BASE_MS * 2 ** (state.consecutiveTransientFailures - 1)
  );
}

function noteUploadError(state: FlushState, deps: FlushDeps, reason: string): void {
  state.lastBatchError = reason.slice(0, 300);
  state.lastBatchErrorAt = deps.now();
}

/** B5: the upload state the heartbeat reports. */
export function uploadStateSnapshot(state: FlushState): {
  authPaused: boolean;
  lastBatchError: string | null;
  lastBatchErrorAt: number | null;
  consecutiveTransientFailures: number;
  lastSuccessAt: number | null;
} {
  return {
    authPaused: state.authPaused,
    lastBatchError: state.lastBatchError,
    lastBatchErrorAt: state.lastBatchErrorAt,
    consecutiveTransientFailures: state.consecutiveTransientFailures,
    lastSuccessAt: state.lastSuccessAt,
  };
}

/**
 * One scheduler tick: single-flight, and gated by the portal's requested
 * backoff on the MONOTONIC clock (A9). Returns true when a cycle ran.
 */
export async function flushTick(
  deps: FlushDeps,
  state: FlushState
): Promise<boolean> {
  if (state.inFlight) return false;
  if (monoOf(deps) < state.nextFlushAllowedAtMono) return false;
  state.inFlight = true;
  try {
    await runFlushCycle(deps, state);
    if (state.retryAfterMs != null) {
      state.nextFlushAllowedAtMono = monoOf(deps) + state.retryAfterMs;
    }
  } catch (err) {
    // runFlushCycle handles per-row failures via the outbox helpers, so
    // reaching here means the loop itself blew up. Log and let the guard
    // release so the next tick can retry.
    deps.logError(
      `[agent] flush loop error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    );
  } finally {
    state.inFlight = false;
  }
  return true;
}

export async function runFlushCycle(
  deps: FlushDeps,
  state: FlushState
): Promise<void> {
  const now = deps.now();
  const mono = monoOf(deps);

  // M-A3: clear any backoff surfaced by the previous cycle; only THIS cycle's
  // outcome should influence the scheduler's next-flush delay.
  state.retryAfterMs = null;

  // While auth-paused we do NOT hammer the portal every 5s: one probe
  // flush every ~10 min is enough to notice the operator fixed the secret.
  if (state.authPaused) {
    if (mono - state.lastAuthProbeAt < AUTH_PROBE_INTERVAL_MS) return;
    state.lastAuthProbeAt = mono; // this cycle IS the probe
  }

  const rows = deps.dueRows(FLUSH_BATCH);
  const cycleRand = makeCycleRand();

  if (deps.postBatch && rows.length > 0) {
    if (state.singleModeNext) {
      // Isolation cycle after repeated batch-level 5xx / timeouts: send row by
      // row below, then return to batch mode.
      state.singleModeNext = false;
    } else {
      const handled = await runBatchCycle(deps, state, rows, now, mono, cycleRand, deps.postBatch);
      if (handled) return;
      // fallbackToSingle: run this cycle through the single-event path.
    }
  }

  let failuresThisCycle = 0;
  let lastReason: string | null = null;
  let sentThisCycle = 0;
  let saw5xx = false;

  // B2 breaker: permanent rejections are held back until it is clear they are
  // about the events and not about the route. A run of PERMANENT_BREAKER_AFTER
  // with one HTTP status turns them all into retries and stops the cycle.
  let streak: { status: number; items: Array<{ id: number; reason: string }> } | null = null;
  const commitStreak = (): void => {
    if (!streak) return;
    for (const item of streak.items) {
      deps.markFailedPermanent(item.id, item.reason);
      failuresThisCycle++;
      lastReason = item.reason;
    }
    streak = null;
  };

  for (const row of rows) {
    const result = await deps.postEvent(row.payload);
    if (result.ok) {
      commitStreak();
      deps.markSent(row.id);
      sentThisCycle++;
      state.lastSuccessAt = deps.now();
      if (state.authPaused) {
        // A successful send proves the secret is good again.
        state.authPaused = false;
        state.authPausedSince = null;
        deps.logWarn(
          "[agent] portal authentication recovered; resuming normal outbox flush."
        );
      }
      continue;
    }
    if (isAuthFailure(result)) {
      commitStreak();
      failuresThisCycle++;
      lastReason = result.reason;
      noteUploadError(state, deps, result.reason);
      enterOrRefreshAuthPause(deps, state, now, mono, result.reason);
      // Every remaining due row would fail identically against the same
      // wrong secret; stop the cycle and leave them pending (not dropped).
      break;
    }
    if (result.retryable) {
      commitStreak();
      failuresThisCycle++;
      lastReason = result.reason;
      noteUploadError(state, deps, result.reason);
      deps.recordRetry(row.id, result.reason, cycleRand);
      // M-A3: the portal asked us to back off (429 / 503 Retry-After). Every
      // remaining due row hits the same limiter, so stop the cycle and surface
      // the delay for the scheduler. Checked before the network-class abort
      // because a Retry-After is a live-but-throttled portal, not an outage.
      if (result.retryAfterMs !== undefined) {
        state.retryAfterMs = result.retryAfterMs;
        break;
      }
      // M-A3: fast-abort on the first transport failure / abort timeout. The
      // portal is unreachable, so continuing would burn a full 30s timeout on
      // each of the up to 49 remaining rows (~25 min of dead flushing). They
      // stay pending (never attempted) and retry next cycle.
      if (isNetworkFailure(result)) break;
      // A3: a page that is not the portal's (proxy, CDN, captive portal, bad
      // deploy) will be the answer for every other row too.
      if (result.unrecognizedResponse) {
        applyTransientBackoff(state);
        break;
      }
      if (result.httpStatus !== undefined && result.httpStatus >= 500) saw5xx = true;
      continue;
    }
    // Permanent: a validation reject or billing_conflict (non-auth 4xx with a
    // known portal error code). Retrying forever is pointless and masks the
    // bug, so this stays permanent unless the breaker below says the rejection
    // is systemic.
    const status = result.httpStatus;
    if (status === undefined) {
      commitStreak();
      deps.markFailedPermanent(row.id, result.reason);
      failuresThisCycle++;
      lastReason = result.reason;
      continue;
    }
    if (streak && streak.status !== status) commitStreak();
    if (!streak) streak = { status, items: [] };
    streak.items.push({ id: row.id, reason: result.reason });
    if (streak.items.length >= PERMANENT_BREAKER_AFTER) {
      for (const item of streak.items) {
        deps.recordRetry(item.id, item.reason, cycleRand);
        failuresThisCycle++;
        lastReason = item.reason;
      }
      noteUploadError(
        state,
        deps,
        `${streak.items.length} events in a row rejected with http ${status}: ${streak.items[0]!.reason}`
      );
      deps.logError(
        `[agent] the portal rejected ${streak.items.length} events in a row with HTTP ${status}. ` +
          `That points at the route or a version mismatch, not at the events, so none of them ` +
          `was dead-lettered; they stay queued and are retried later. Last answer: ${streak.items[0]!.reason}`
      );
      streak = null;
      applyTransientBackoff(state);
      break;
    }
  }
  commitStreak();

  if (sentThisCycle > 0) {
    state.consecutiveTransientFailures = 0;
  } else if (saw5xx && state.retryAfterMs === null) {
    // B3: single mode against a failing portal backs off as a CYCLE, not row
    // by row with independent jitter.
    applyTransientBackoff(state);
  }

  // The auth-pause path already logs loudly; don't double up with a generic
  // outage line on the same probe cycle.
  if (failuresThisCycle > 0 && !state.authPaused) {
    maybeLogOutage(deps, state, mono, lastReason);
  }
}

/**
 * Send all due rows as one batch and apply the outcomes. Returns true when the
 * cycle is fully handled, false when the caller should fall back to the
 * single-event path for these rows.
 */
async function runBatchCycle(
  deps: FlushDeps,
  state: FlushState,
  rows: FlushRow[],
  now: number,
  mono: number,
  cycleRand: () => number,
  postBatch: NonNullable<FlushDeps["postBatch"]>
): Promise<boolean> {
  const result = await postBatch(rows.map((r) => r.payload));

  if (result.ok) {
    state.consecutive5xx = 0;
    state.consecutiveStalls = 0;
    if (state.authPaused) {
      state.authPaused = false;
      state.authPausedSince = null;
      deps.logWarn(
        "[agent] portal authentication recovered; resuming normal outbox flush."
      );
    }
    let failures = 0;
    let stored = 0;
    let retryable = 0;
    let lastReason: string | null = null;
    const systemic = systemicPermanentReason(rows.length, result.outcomes);
    rows.forEach((row, i) => {
      const o = result.outcomes[i];
      if (!o) {
        // Defensive: portal-client guarantees alignment; never mark sent on a gap.
        deps.recordRetry(row.id, "missing batch outcome", cycleRand);
        failures++;
        retryable++;
        lastReason = "missing batch outcome";
      } else if (o.ok) {
        deps.markSent(row.id);
        stored++;
      } else if (o.retryable) {
        deps.recordRetry(row.id, o.reason, cycleRand);
        failures++;
        retryable++;
        lastReason = o.reason;
      } else if (systemic !== null && o.reason === systemic) {
        // Pass 2: held, not dead-lettered (see systemicPermanentReason).
        deps.recordRetry(row.id, o.reason, cycleRand);
        failures++;
        lastReason = o.reason;
      } else {
        deps.markFailedPermanent(row.id, o.reason);
        failures++;
        lastReason = o.reason;
      }
    });
    if (systemic !== null) {
      if (stored > 0) state.lastSuccessAt = deps.now();
      deps.logError(
        `[agent] the portal rejected most of a batch with "${systemic}". That points at the route ` +
          `or a version mismatch, not at the events, so none of them was dead-lettered; they stay ` +
          `queued and are retried later.`
      );
      noteUploadError(state, deps, `batch rejected: ${systemic}`);
      applyTransientBackoff(state);
      if (failures > 0) maybeLogOutage(deps, state, mono, lastReason);
      return true;
    }
    if (stored > 0) state.lastSuccessAt = deps.now();
    if (lastReason !== null) noteUploadError(state, deps, lastReason);
    if (rows.length > 0 && retryable === rows.length) {
      // A12: the portal answered 201 but every event came back retryable
      // (internal_error, link_not_ready, ...). Re-posting the same rows every
      // tick only burns the batch rate limit and the attempt counters: back
      // off exactly like a failed batch.
      applyTransientBackoff(state);
    } else {
      state.consecutiveTransientFailures = 0;
    }
    if (failures > 0) maybeLogOutage(deps, state, mono, lastReason);
    return true;
  }

  noteUploadError(state, deps, result.reason);

  if (result.authFailure) {
    enterOrRefreshAuthPause(deps, state, now, mono, result.reason);
    return true;
  }

  if (result.fallbackToSingle) return false;

  // Batch-level retryable failure: rows stay untouched (attempt counts kept).
  const is5xx = result.httpStatus !== undefined && result.httpStatus >= 500;
  if (is5xx) {
    state.consecutive5xx++;
    state.consecutiveStalls = 0;
    if (state.consecutive5xx >= SINGLE_MODE_AFTER_5XX) {
      state.singleModeNext = true;
      state.consecutive5xx = 0;
    }
  } else {
    state.consecutive5xx = 0;
    // B4: a timeout while heartbeats succeed, or an answer we cannot align with
    // the request, repeated: one event is probably stuck inside the batch.
    const reachable = deps.portalReachable ? deps.portalReachable() : true;
    const stalled = (result.timedOut === true && reachable) || result.ambiguous === true;
    if (stalled) {
      state.consecutiveStalls++;
      if (state.consecutiveStalls >= SINGLE_MODE_AFTER_STALLS) {
        state.singleModeNext = true;
        state.consecutiveStalls = 0;
      }
    } else {
      state.consecutiveStalls = 0;
    }
  }

  if (result.retryAfterMs !== undefined) {
    // The portal asked for a specific backoff (429 / 503 Retry-After).
    state.retryAfterMs = result.retryAfterMs;
  } else {
    applyTransientBackoff(state);
  }
  maybeLogOutage(deps, state, mono, result.reason);
  return true;
}

function enterOrRefreshAuthPause(
  deps: FlushDeps,
  state: FlushState,
  now: number,
  mono: number,
  reason: string
): void {
  if (!state.authPaused) {
    state.authPaused = true;
    state.authPausedSince = now;
  }
  state.lastAuthProbeAt = mono;
  if (state.shouldLogAuth(mono)) {
    deps.logError(
      `[agent] PORTAL REJECTED THE AGENT SIGNATURE (${reason}). The stored PVS secret ` +
        `looks wrong or stale (a rotated / re-issued enrollment, or an out-of-sync ` +
        `secure-store). Events are being HELD, not dropped, and uploads are paused ` +
        `with a slow retry. Nothing will upload until the secret is fixed; re-enrollment ` +
        `may be required. This also stops heartbeat telemetry, so the portal will show ` +
        `this agent as silent.`
    );
  }
}

function maybeLogOutage(
  deps: FlushDeps,
  state: FlushState,
  now: number,
  lastReason: string | null
): void {
  if (!state.shouldLogOutage(now)) return;
  const snap = deps.outageSnapshot();
  const oldestAgeMin =
    snap.oldestPendingAt !== null
      ? Math.max(0, Math.round((now - snap.oldestPendingAt) / 60_000))
      : 0;
  deps.logWarn(
    `[agent] portal upload is failing: ${snap.pendingCount} event(s) queued ` +
      `(${snap.pendingWithAttemptsCount} already retrying), oldest ${oldestAgeMin} min old, ` +
      `${snap.failedCount} permanently failed. Last error: ${lastReason ?? "unknown"}. ` +
      `The agent keeps retrying; check portal reachability / network / proxy.`
  );
}
