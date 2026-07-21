import type { PostResult } from "./portal-client.js";
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
  markSent: (id: number) => void;
  recordRetry: (id: number, reason: string) => void;
  markFailedPermanent: (id: number, reason: string) => void;
  outageSnapshot: () => OutageSnapshot;
  now: () => number;
  logWarn: (msg: string) => void;
  logError: (msg: string) => void;
}

export interface FlushState {
  /** True while the portal is rejecting our signature; flushing is paused. */
  authPaused: boolean;
  /** epoch-ms the pause began (for operator forensics), or null. */
  authPausedSince: number | null;
  /** epoch-ms of the last probe attempt while paused (gates the 10-min cadence). */
  lastAuthProbeAt: number;
  /**
   * M-A3: backoff (ms) the last cycle picked up from a portal Retry-After
   * header before aborting, or null when the last cycle set no backoff. Reset
   * at the start of every cycle. The scheduler (in index.ts) MAY read this to
   * delay the next flush; the flush module itself only surfaces it.
   */
  retryAfterMs: number | null;
  shouldLogOutage: (now: number) => boolean;
  shouldLogAuth: (now: number) => boolean;
}

export function createFlushState(): FlushState {
  return {
    authPaused: false,
    authPausedSince: null,
    lastAuthProbeAt: 0,
    retryAfterMs: null,
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

export async function runFlushCycle(
  deps: FlushDeps,
  state: FlushState
): Promise<void> {
  const now = deps.now();

  // M-A3: clear any backoff surfaced by the previous cycle; only THIS cycle's
  // outcome should influence the scheduler's next-flush delay.
  state.retryAfterMs = null;

  // While auth-paused we do NOT hammer the portal every 5s: one probe
  // flush every ~10 min is enough to notice the operator fixed the secret.
  if (state.authPaused) {
    if (now - state.lastAuthProbeAt < AUTH_PROBE_INTERVAL_MS) return;
    state.lastAuthProbeAt = now; // this cycle IS the probe
  }

  const rows = deps.dueRows(FLUSH_BATCH);
  let failuresThisCycle = 0;
  let lastReason: string | null = null;

  for (const row of rows) {
    const result = await deps.postEvent(row.payload);
    if (result.ok) {
      deps.markSent(row.id);
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
      failuresThisCycle++;
      lastReason = result.reason;
      enterOrRefreshAuthPause(deps, state, now, result.reason);
      // Every remaining due row would fail identically against the same
      // wrong secret; stop the cycle and leave them pending (not dropped).
      break;
    }
    if (result.retryable) {
      failuresThisCycle++;
      lastReason = result.reason;
      deps.recordRetry(row.id, result.reason);
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
      continue;
    }
    // Truly permanent: a validation reject of a malformed event. Retrying
    // forever is pointless and masks the bug, so this stays permanent.
    deps.markFailedPermanent(row.id, result.reason);
    failuresThisCycle++;
    lastReason = result.reason;
  }

  // The auth-pause path already logs loudly; don't double up with a generic
  // outage line on the same probe cycle.
  if (failuresThisCycle > 0 && !state.authPaused) {
    maybeLogOutage(deps, state, now, lastReason);
  }
}

function enterOrRefreshAuthPause(
  deps: FlushDeps,
  state: FlushState,
  now: number,
  reason: string
): void {
  if (!state.authPaused) {
    state.authPaused = true;
    state.authPausedSince = now;
  }
  state.lastAuthProbeAt = now;
  if (state.shouldLogAuth(now)) {
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
