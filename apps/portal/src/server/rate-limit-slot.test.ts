import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { execute: executeMock } }));

import {
  releaseRateLimitSlot,
  releaseRateLimitSlots,
  reserveRateLimitSlot,
} from "./rate-limit-slot";

beforeEach(() => executeMock.mockReset());

/** Raw SQL text of a drizzle `sql` object (StringChunks only). */
function sqlText(query: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(n.queryChunks)) n.queryChunks.forEach(walk);
    else if (Array.isArray(n.value)) out.push(n.value.join(""));
  };
  walk(query);
  return out.join(" ").replace(/\s+/g, " ");
}

/** Bound parameter values of a drizzle `sql` object. */
function boundValues(query: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (node: unknown) => {
    if (node === null || node === undefined) return;
    if (typeof node !== "object") {
      out.push(node);
      return;
    }
    const n = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(n.queryChunks)) n.queryChunks.forEach(walk);
    else if ("value" in n && !Array.isArray(n.value)) out.push(n.value);
  };
  walk(query);
  return out;
}

const opts = { limit: 10, windowSeconds: 3600 };

describe("reserveRateLimitSlot", () => {
  it("increments only behind the count < limit guard, in one statement", async () => {
    executeMock.mockResolvedValueOnce([{ count: 1, window_start: "2026-10-07 20:00:00.123456+00" }]);
    await reserveRateLimitSlot("login:pw-fail:email", "a@b.de", opts);
    const q = executeMock.mock.calls[0]![0];
    const text = sqlText(q);
    expect(text).toMatch(/INSERT INTO rate_limits/);
    expect(text).toMatch(/ON CONFLICT \(key\) DO UPDATE SET/);
    expect(text).toMatch(/WHERE rate_limits\.window_start <= now\(\) -/);
    expect(text).toMatch(/OR rate_limits\.count < /);
    expect(boundValues(q)).toContain("rl:login:pw-fail:email:a@b.de");
    expect(boundValues(q)).toContain(10);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("returns the slot with its window when the guard lets it through", async () => {
    executeMock.mockResolvedValueOnce([{ count: 10, window_start: "2026-10-07 20:00:00.123456+00" }]);
    expect(await reserveRateLimitSlot("s", "i", opts)).toEqual({
      ok: true,
      slot: { key: "rl:s:i", windowStart: "2026-10-07 20:00:00.123456+00" },
    });
  });

  it("refuses when the guard blocks the update (no row returned)", async () => {
    executeMock.mockResolvedValueOnce([]);
    expect(await reserveRateLimitSlot("s", "i", opts)).toEqual({ ok: false });
  });

  it("never hands out a slot above the limit", async () => {
    executeMock.mockResolvedValueOnce([{ count: 11, window_start: "x" }]);
    expect(await reserveRateLimitSlot("s", "i", opts)).toEqual({ ok: false });
  });

  it("fails CLOSED in production and OPEN (nothing to release) in dev", async () => {
    const prev = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      executeMock.mockRejectedValueOnce(new Error("db down"));
      expect(await reserveRateLimitSlot("s", "i", opts)).toEqual({ ok: false });
      (process.env as Record<string, string>).NODE_ENV = "development";
      executeMock.mockRejectedValueOnce(new Error("db down"));
      expect(await reserveRateLimitSlot("s", "i", opts)).toEqual({ ok: true, slot: null });
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    }
  });
});

describe("releaseRateLimitSlot", () => {
  it("decrements only the window the slot was taken in", async () => {
    executeMock.mockResolvedValueOnce([]);
    await releaseRateLimitSlot({ key: "rl:s:i", windowStart: "2026-10-07 20:00:00.123456+00" });
    const q = executeMock.mock.calls[0]![0];
    expect(sqlText(q)).toMatch(/UPDATE rate_limits SET count = count - 1 WHERE key = \s*AND window_start = \s*::timestamptz AND count > 0/);
    expect(boundValues(q)).toEqual(["rl:s:i", "2026-10-07 20:00:00.123456+00"]);
  });

  it("does nothing without a slot and swallows DB errors", async () => {
    await releaseRateLimitSlot(null);
    expect(executeMock).not.toHaveBeenCalled();
    executeMock.mockRejectedValueOnce(new Error("db down"));
    await expect(releaseRateLimitSlot({ key: "k", windowStart: "w" })).resolves.toBeUndefined();
  });

  it("releases every held slot of an attempt", async () => {
    executeMock.mockResolvedValue([]);
    await releaseRateLimitSlots([{ key: "a", windowStart: "w" }, null, { key: "b", windowStart: "w" }]);
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});
