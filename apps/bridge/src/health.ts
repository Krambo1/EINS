/**
 * Process health shared between the scheduler (writer) and /healthz (reader).
 *
 * /healthz used to be a constant `{ok:true}`: it stayed green while the
 * scheduler was dead or the database unreachable, so Fly never restarted a
 * bridge that was doing nothing. Now it is 503 when
 *   - no scheduler tick completed its DB round trip within 3 tick intervals, or
 *   - `SELECT 1` does not answer within 2 s.
 * A vendor outage or a failing link does NOT turn it red (restarting the
 * machine would not help); that is reported in the body instead.
 */

const state = {
  startedAt: Date.now(),
  lastTickOkAt: Date.now(),
  inFlight: 0,
};

/** The tick reached the DB and completed its selection round trip. */
export function markTickOk(now = Date.now()): void {
  state.lastTickOkAt = now;
}

export function setInFlight(n: number): void {
  state.inFlight = n;
}

export function getSchedulerState(): Readonly<typeof state> {
  return state;
}

/** Test-only. */
export function _resetHealth(now = Date.now()): void {
  state.startedAt = now;
  state.lastTickOkAt = now;
  state.inFlight = 0;
}

export interface HealthReport {
  ok: boolean;
  status: 200 | 503;
  body: Record<string, unknown>;
}

export async function computeHealth(deps: {
  tickMs: number;
  now?: number;
  ping: () => Promise<boolean>;
  failingSummary?: () => Promise<{ failing: number; stuck: number } | null>;
}): Promise<HealthReport> {
  const now = deps.now ?? Date.now();
  const schedulerAgeMs = now - state.lastTickOkAt;
  const schedulerOk = schedulerAgeMs <= deps.tickMs * 3;
  const dbOk = await deps.ping();
  const ok = schedulerOk && dbOk;
  let failing: { failing: number; stuck: number } | null = null;
  if (dbOk && deps.failingSummary) {
    try {
      failing = await deps.failingSummary();
    } catch {
      failing = null; // informational only
    }
  }
  return {
    ok,
    status: ok ? 200 : 503,
    body: {
      ok,
      ts: new Date(now).toISOString(),
      db: dbOk,
      scheduler: {
        ok: schedulerOk,
        lastTickOkAt: new Date(state.lastTickOkAt).toISOString(),
        ageMs: schedulerAgeMs,
        inFlight: state.inFlight,
      },
      ...(failing ? { failingLinks: failing.failing, stuckLinks: failing.stuck } : {}),
    },
  };
}
