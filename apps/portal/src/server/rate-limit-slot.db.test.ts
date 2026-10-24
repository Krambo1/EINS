/**
 * Integration test against a REAL local Postgres (V3 Neben 2): a parallel
 * burst of reservations on one bucket hands out exactly `limit` slots, a
 * release gives one back, and a release from an old window changes nothing.
 * Uses a throwaway key and deletes it afterwards.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   RATE_LIMIT_DB_TEST=1 npx vitest run src/server/rate-limit-slot.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.RATE_LIMIT_DB_TEST === "1";

describe.skipIf(!enabled)("rate-limit slots (local DB)", () => {
  it("hands out exactly `limit` slots to a parallel burst", async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { reserveRateLimitSlot, releaseRateLimitSlot } = await import("./rate-limit-slot");

    const scope = "test:slot-burst";
    const id = randomUUID();
    const key = `rl:${scope}:${id}`;
    const opts = { limit: 10, windowSeconds: 3600 };
    const readCount = async () => {
      const rows = (await db.execute(
        sql`SELECT count FROM rate_limits WHERE key = ${key}`
      )) as unknown as Array<{ count: number }>;
      return Number(rows[0]?.count ?? 0);
    };

    try {
      const results = await Promise.all(
        Array.from({ length: 40 }, () => reserveRateLimitSlot(scope, id, opts))
      );
      expect(results.filter((r) => r.ok)).toHaveLength(10);
      expect(await readCount()).toBe(10);

      const held = results.find((r) => r.ok);
      if (!held || !held.ok || !held.slot) throw new Error("no slot held");
      await releaseRateLimitSlot(held.slot);
      expect(await readCount()).toBe(9);
      expect((await reserveRateLimitSlot(scope, id, opts)).ok).toBe(true);
      expect((await reserveRateLimitSlot(scope, id, opts)).ok).toBe(false);

      // A slot from an earlier window is not given back to the current one.
      await releaseRateLimitSlot({ key, windowStart: "2000-01-01 00:00:00+00" });
      expect(await readCount()).toBe(10);

      // Window elapsed: the next reservation starts a fresh count.
      await db.execute(
        sql`UPDATE rate_limits SET window_start = now() - interval '2 hours' WHERE key = ${key}`
      );
      expect((await reserveRateLimitSlot(scope, id, opts)).ok).toBe(true);
      expect(await readCount()).toBe(1);
    } finally {
      await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`);
    }
  });
});
