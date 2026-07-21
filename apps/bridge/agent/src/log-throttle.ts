/**
 * H10 / H11: tiny rate limiter for operator-facing log lines.
 *
 * A multi-day portal outage would otherwise either produce ZERO local
 * output (the failure only lands in the SQLite outbox) or, if we logged
 * every 5-second flush cycle, bury the workstation's log in thousands of
 * identical lines. This gate lets a caller emit at most one line per
 * interval while always emitting the FIRST occurrence immediately, so the
 * operator sees the problem start without being spammed.
 *
 * Pure and side-effect free: `now` is passed in rather than read from the
 * clock, so tests drive it deterministically without fake timers.
 */
export function makeRateLimiter(intervalMs: number): (now: number) => boolean {
  let lastFiredAt: number | null = null;
  return (now: number): boolean => {
    if (lastFiredAt === null || now - lastFiredAt >= intervalMs) {
      lastFiredAt = now;
      return true;
    }
    return false;
  };
}
