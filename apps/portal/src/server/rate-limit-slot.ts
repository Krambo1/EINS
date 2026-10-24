import "server-only";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { rateLimitKey } from "../auth/rate-limit-policy";

/**
 * Reserve-then-release slots on the Postgres fixed-window buckets
 * (`rate_limits`, same keys and windows as `server/rate-limit.ts`).
 *
 * For "count failures only" buckets in front of an expensive check (Argon2).
 * The old pattern was peek, verify, then count the failure: N parallel
 * requests all peeked the same pre-count state and every one of them got a
 * password guess (V3 Neben 2). Now the attempt takes a slot atomically BEFORE
 * the check:
 *
 *   - `reserveRateLimitSlot` increments only while `count < limit` (or the
 *     window has elapsed). The guard runs inside the `ON CONFLICT DO UPDATE`
 *     on the locked row, so concurrent reservations serialise and at most
 *     `limit` of them succeed per window. A refused reservation writes nothing.
 *   - `releaseRateLimitSlot` gives the slot back when the attempt turned out
 *     not to be a failure (correct password). It only decrements the window
 *     the slot was taken in; if that window has rolled over, there is nothing
 *     to give back.
 *
 * Failure mode matches `rateLimit`: production fails CLOSED (no slot, attempt
 * refused), dev fails OPEN (allowed, nothing to release). A failed release is
 * logged and swallowed: the slot then simply counts as a failure until the
 * window ends, which never weakens the limit.
 */

export interface RateLimitSlot {
  key: string;
  /** `window_start` of the bucket the slot was taken in, as Postgres text. */
  windowStart: string;
}

export type ReserveSlotResult =
  | { ok: true; slot: RateLimitSlot | null }
  | { ok: false };

export async function reserveRateLimitSlot(
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number }
): Promise<ReserveSlotResult> {
  const key = rateLimitKey(scope, identifier);
  const { limit, windowSeconds } = opts;
  try {
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
      WHERE rate_limits.window_start <= now() - ${window}
         OR rate_limits.count < ${limit}::int
      RETURNING count, window_start::text AS window_start
    `);
    const row = (result as unknown as Array<{ count: number; window_start: string }>)[0];
    // No row: the guard refused the update, the bucket is full for this window.
    if (!row) return { ok: false };
    // Defence in depth: never hand out a slot above the limit.
    if (Number(row.count) > limit) return { ok: false };
    return { ok: true, slot: { key, windowStart: String(row.window_start) } };
  } catch (err) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[rate-limit] postgres error on reserve, failing CLOSED:",
        (err as Error).message
      );
      return { ok: false };
    }
    console.error(
      "[rate-limit] postgres error on reserve, failing open (dev only):",
      (err as Error).message
    );
    return { ok: true, slot: null };
  }
}

export async function releaseRateLimitSlot(slot: RateLimitSlot | null): Promise<void> {
  if (!slot) return;
  try {
    await db.execute(sql`
      UPDATE rate_limits
      SET count = count - 1
      WHERE key = ${slot.key}
        AND window_start = ${slot.windowStart}::timestamptz
        AND count > 0
    `);
  } catch (err) {
    console.error("[rate-limit] postgres error on release:", (err as Error).message);
  }
}

/** Release several slots (e.g. the per-address and per-IP slot of one attempt). */
export async function releaseRateLimitSlots(slots: ReadonlyArray<RateLimitSlot | null>): Promise<void> {
  await Promise.all(slots.map((s) => releaseRateLimitSlot(s)));
}
