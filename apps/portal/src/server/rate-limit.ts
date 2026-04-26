import "server-only";
import Redis from "ioredis";
import { env } from "../lib/env";

/**
 * Sliding-window rate limiter backed by Redis atomic INCR/EXPIRE.
 *
 * Used on:
 *   - /login magic-link request         — 5/hour per email, 20/hour per IP
 *   - /login/mfa code verify            — 5/5min per user
 *   - /api/leads/intake                 — 60/min per clinic (per-form endpoint)
 *   - admin magic-link request          — 5/hour per email
 *
 * Failure mode: if Redis is down, we fail OPEN (log + allow). That's acceptable
 * because the secondary layer (magic-link is single-use, TOTP has ±1 window)
 * still makes brute-force impractical.
 */

declare global {
  // eslint-disable-next-line no-var
  var __einsRedis: Redis | undefined;
}

function redis(): Redis {
  if (!globalThis.__einsRedis) {
    globalThis.__einsRedis = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
    });
    globalThis.__einsRedis.on("error", (err) => {
      console.error("[redis] connection error:", err.message);
    });
  }
  return globalThis.__einsRedis;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Consume one unit from a bucket. Bucket is keyed `<scope>:<identifier>` and
 * is reset after `windowSeconds`.
 */
export async function rateLimit(
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number }
): Promise<RateLimitResult> {
  const key = `rl:${scope}:${identifier}`;
  try {
    const r = redis();
    const [count, ttl] = await r
      .multi()
      .incr(key)
      .ttl(key)
      .exec()
      .then((res) => {
        if (!res) throw new Error("redis multi returned null");
        return [res[0]?.[1] as number, res[1]?.[1] as number];
      });

    if (ttl < 0) {
      await r.expire(key, opts.windowSeconds);
    }
    const remaining = Math.max(0, opts.limit - count);
    const ok = count <= opts.limit;
    const resetInSeconds = ttl < 0 ? opts.windowSeconds : ttl;
    return { ok, remaining, resetInSeconds };
  } catch (err) {
    console.error("[rate-limit] redis error — failing open:", (err as Error).message);
    return { ok: true, remaining: opts.limit, resetInSeconds: opts.windowSeconds };
  }
}
