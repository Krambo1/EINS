import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rate-limiter mapping tests. We mock the db layer so the upsert SQL isn't run
 * (its window/reset behaviour is verified live against Postgres); here we lock
 * down how the RETURNING row maps to ok / remaining / resetInSeconds, and that
 * a DB error fails OPEN.
 */
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { execute: executeMock } }));

import { rateLimit } from "./rate-limit";

beforeEach(() => executeMock.mockReset());

describe("rateLimit (Postgres-backed)", () => {
  it("allows while under the limit and reports remaining + reset", async () => {
    executeMock.mockResolvedValueOnce([{ count: 1, reset_in: 3600 }]);
    const r = await rateLimit("login:email", "a@b.de", {
      limit: 5,
      windowSeconds: 3600,
    });
    expect(r).toEqual({ ok: true, remaining: 4, resetInSeconds: 3600 });
  });

  it("blocks once the count exceeds the limit", async () => {
    executeMock.mockResolvedValueOnce([{ count: 6, reset_in: 120 }]);
    const r = await rateLimit("login:email", "a@b.de", {
      limit: 5,
      windowSeconds: 3600,
    });
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.resetInSeconds).toBe(120);
  });

  it("treats count == limit as the last allowed hit", async () => {
    executeMock.mockResolvedValueOnce([{ count: 5, reset_in: 60 }]);
    const r = await rateLimit("x", "y", { limit: 5, windowSeconds: 60 });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(0);
  });

  it("falls back to the full window when reset_in is non-positive", async () => {
    executeMock.mockResolvedValueOnce([{ count: 2, reset_in: 0 }]);
    const r = await rateLimit("x", "y", { limit: 5, windowSeconds: 900 });
    expect(r.resetInSeconds).toBe(900);
  });

  it("fails OPEN when Postgres errors", async () => {
    executeMock.mockRejectedValueOnce(new Error("db down"));
    const r = await rateLimit("leads-intake", "clinic-1", {
      limit: 60,
      windowSeconds: 60,
    });
    expect(r).toEqual({ ok: true, remaining: 60, resetInSeconds: 60 });
  });
});
