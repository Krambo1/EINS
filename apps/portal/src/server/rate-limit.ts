import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db/client";

/**
 * Fixed-window rate limiter backed by Postgres (table `rate_limits`).
 *
 * Used on:
 *   - /login magic-link request         — 5/hour per email, 20/hour per IP
 *   - /api/leads/intake                 — 60/min per clinic (per-form endpoint)
 *   - admin magic-link request          — 5/hour per email
 *   - several PVS + review-token endpoints (per-IP + per-clinic)
 *
 * One atomic upsert per call increments the bucket, resetting it once the
 * window has elapsed (equivalent to the previous Redis INCR + EXPIRE). Uses the
 * superuser `db` connection (not the RLS app role) — these rows are not
 * clinic-scoped.
 *
 * Failure mode: if Postgres is unreachable, we fail OPEN (log + allow). That's
 * acceptable because the secondary layer (magic-links are single-use) still
 * makes brute-force impractical. Expired rows are pruned by the weekly
 * `purge-audit` job.
 */

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Consume one unit from a bucket. Bucket is keyed `<scope>:<identifier>` and
 * resets after `windowSeconds`.
 */
export async function rateLimit(
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number }
): Promise<RateLimitResult> {
  const key = `rl:${scope}:${identifier}`;
  const { limit, windowSeconds } = opts;
  try {
    // Single round-trip: insert-or-increment, resetting count + window_start
    // when the existing window has already elapsed. RETURNING gives us the
    // post-increment count and the seconds left in the current window.
    const window = sql`(${windowSeconds}::int * interval '1 second')`;
    const result = await db.execute(sql`
      INSERT INTO rate_limits (key, count, window_start)
      VALUES (${key}, 1, now())
      ON CONFLICT (key) DO UPDATE SET
        count = CASE
          WHEN rate_limits.window_start <= now() - ${window}
          THEN 1 ELSE rate_limits.count + 1 END,
        window_start = CASE
          WHEN rate_limits.window_start <= now() - ${window}
          THEN now() ELSE rate_limits.window_start END
      RETURNING
        count,
        GREATEST(0, CEIL(EXTRACT(EPOCH FROM (rate_limits.window_start + ${window} - now()))))::int AS reset_in
    `);

    const row = (result as unknown as Array<{ count: number; reset_in: number }>)[0];
    if (!row) throw new Error("rate_limits upsert returned no row");

    const count = Number(row.count);
    const resetInSeconds = Number(row.reset_in);
    return {
      ok: count <= limit,
      remaining: Math.max(0, limit - count),
      resetInSeconds: resetInSeconds > 0 ? resetInSeconds : windowSeconds,
    };
  } catch (err) {
    console.error(
      "[rate-limit] postgres error — failing open:",
      (err as Error).message
    );
    return { ok: true, remaining: limit, resetInSeconds: windowSeconds };
  }
}
