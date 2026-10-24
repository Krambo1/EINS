import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { execute: executeMock } }));

import {
  ADMIN_AUTH_BUCKETS,
  AUTH_BUCKETS,
  emailBucketId,
  ipBucketId,
  rateLimitKey,
} from "./rate-limit-policy";
import { peekRateLimit, rateLimit } from "../server/rate-limit";

beforeEach(() => executeMock.mockReset());

/**
 * Collect the bound parameter values of a drizzle `sql` object: interpolated
 * primitives sit directly in `queryChunks`, raw SQL text in StringChunks
 * (`{ value: string[] }`), nested `sql` fragments recurse.
 */
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

describe("auth rate-limit buckets (B-5)", () => {
  it("separates password failures from link requests (a lockout never blocks recovery)", () => {
    const scopes = Object.values(AUTH_BUCKETS).map((b) => b.scope);
    expect(new Set(scopes).size).toBe(scopes.length);
    expect(AUTH_BUCKETS.passwordFailByEmail.scope).not.toBe(AUTH_BUCKETS.linkByEmailHour.scope);
  });

  it("keeps clinic and admin scopes disjoint", () => {
    const clinic = new Set<string>(Object.values(AUTH_BUCKETS).map((b) => b.scope));
    for (const b of Object.values(ADMIN_AUTH_BUCKETS)) expect(clinic.has(b.scope)).toBe(false);
  });

  it("normalises identifiers", () => {
    expect(emailBucketId("  Dr.Muster@Praxis.DE ")).toBe("dr.muster@praxis.de");
    expect(ipBucketId(" 2001:DB8::1 ")).toBe("2001:db8::1");
    expect(ipBucketId(null)).toBe("unknown");
    expect(ipBucketId("")).toBe("unknown");
  });

  it("builds the same key server/rate-limit.ts stores", async () => {
    const bucket = AUTH_BUCKETS.passwordFailByEmail;
    const id = emailBucketId("A@B.de");
    executeMock.mockResolvedValueOnce([{ count: 1, reset_in: 60 }]);
    await rateLimit(bucket.scope, id, bucket);
    expect(boundValues(executeMock.mock.calls[0]![0])).toContain(rateLimitKey(bucket.scope, id));

    executeMock.mockResolvedValueOnce([]);
    await peekRateLimit(bucket.scope, id, bucket);
    expect(boundValues(executeMock.mock.calls[1]![0])).toContain("rl:login:pw-fail:email:a@b.de");
  });
});

describe("peekRateLimit (failure-only buckets)", () => {
  const opts = { limit: 3, windowSeconds: 600 };

  it("allows when the bucket is empty or expired", async () => {
    executeMock.mockResolvedValueOnce([]);
    expect(await peekRateLimit("s", "i", opts)).toEqual({ ok: true, remaining: 3, resetInSeconds: 600 });
  });

  it("allows below the limit and blocks once the limit is reached", async () => {
    executeMock.mockResolvedValueOnce([{ count: 2, reset_in: 100 }]);
    expect((await peekRateLimit("s", "i", opts)).ok).toBe(true);
    executeMock.mockResolvedValueOnce([{ count: 3, reset_in: 100 }]);
    const r = await peekRateLimit("s", "i", opts);
    expect(r).toEqual({ ok: false, remaining: 0, resetInSeconds: 100 });
  });

  it("never writes (SELECT only)", async () => {
    executeMock.mockResolvedValueOnce([]);
    await peekRateLimit("s", "i", opts);
    const chunks = JSON.stringify(
      (executeMock.mock.calls[0]![0] as { queryChunks: unknown[] }).queryChunks.filter(
        (c) => typeof c === "object" && c !== null && "value" in (c as object) && Array.isArray((c as { value: unknown }).value)
      )
    );
    expect(chunks).toMatch(/SELECT/);
    expect(chunks).not.toMatch(/INSERT|UPDATE/);
  });

  it("fails closed in production", async () => {
    const prev = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      executeMock.mockRejectedValueOnce(new Error("db down"));
      expect((await peekRateLimit("s", "i", opts)).ok).toBe(false);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = prev ?? "test";
    }
  });
});
