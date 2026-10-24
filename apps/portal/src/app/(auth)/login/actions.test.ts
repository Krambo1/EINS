import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V3 Neben 2: the password-failure buckets must hold under a parallel burst.
 * The slot store below models the atomic conditional upsert of
 * `reserveRateLimitSlot` (each reservation is one indivisible step, like the
 * locked row in Postgres); the real SQL is covered by
 * `server/rate-limit-slot.db.test.ts`. Argon2 is replaced by a slow fake so all
 * attempts are in flight at the same time.
 */
const h = vi.hoisted(() => {
  const counts = new Map<string, number>();
  const state = { verifyCalls: 0, verifyDelayMs: 25, passwordOk: false };
  return { counts, state };
});

vi.mock("@/server/rate-limit-slot", () => ({
  reserveRateLimitSlot: vi.fn(
    async (scope: string, id: string, opts: { limit: number }) => {
      await Promise.resolve();
      const key = `rl:${scope}:${id}`;
      const c = h.counts.get(key) ?? 0;
      if (c >= opts.limit) return { ok: false };
      h.counts.set(key, c + 1);
      return { ok: true, slot: { key, windowStart: "w1" } };
    }
  ),
  releaseRateLimitSlots: vi.fn(
    async (slots: Array<{ key: string; windowStart: string } | null>) => {
      await Promise.resolve();
      for (const s of slots) {
        if (!s) continue;
        h.counts.set(s.key, Math.max(0, (h.counts.get(s.key) ?? 0) - 1));
      }
    }
  ),
}));
vi.mock("@/server/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/auth/password", () => ({
  verifyPassword: vi.fn(async () => {
    h.state.verifyCalls += 1;
    await new Promise((r) => setTimeout(r, h.state.verifyDelayMs));
    return h.state.passwordOk;
  }),
}));
vi.mock("@/auth/user-lookup", () => ({
  findActiveClinicUserByEmail: vi.fn(async (email: string) => ({
    id: `user-${email}`,
    clinicId: "clinic-1",
    role: "inhaber",
    passwordHash: "$argon2id$fake",
  })),
}));
vi.mock("@/auth/session", () => ({ createSession: vi.fn(async () => undefined) }));
vi.mock("@/auth/post-login-path", () => ({ postLoginPath: vi.fn(async () => "/dashboard") }));
vi.mock("@/auth/magic-link", () => ({ issueMagicLink: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/client-ip", () => ({ getTrustedClientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));

import { passwordLoginAction } from "./actions";

const TOO_MANY =
  "Zu viele falsche Anmelde-Versuche. Bitte warten Sie etwas oder melden Sie sich per E-Mail-Link an.";
const WRONG = "E-Mail oder Passwort stimmt nicht.";

function form(email: string, password = "falsch"): FormData {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return f;
}

async function attempt(email: string, password?: string) {
  try {
    return await passwordLoginAction(undefined, form(email, password));
  } catch (err) {
    if ((err as Error).message === "NEXT_REDIRECT") return { redirected: true } as const;
    throw err;
  }
}

beforeEach(() => {
  h.counts.clear();
  h.state.verifyCalls = 0;
  h.state.passwordOk = false;
});

describe("passwordLoginAction under a parallel burst (V3 Neben 2)", () => {
  it("runs at most 10 password checks per address, however many requests arrive at once", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => attempt("inhaber@praxis.de"))
    );
    expect(h.state.verifyCalls).toBe(10);
    expect(results.filter((r) => r && "error" in r && r.error === WRONG)).toHaveLength(10);
    expect(results.filter((r) => r && "error" in r && r.error === TOO_MANY)).toHaveLength(15);
    expect(h.counts.get("rl:login:pw-fail:email:inhaber@praxis.de")).toBe(10);
    // Refused attempts are not counted against the IP either.
    expect(h.counts.get("rl:login:pw-fail:ip:203.0.113.7")).toBe(10);
  });

  it("runs at most 30 password checks per IP when the burst sprays many addresses", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => attempt(`person${i}@praxis.de`))
    );
    expect(h.state.verifyCalls).toBe(30);
    expect(results.filter((r) => r && "error" in r && r.error === TOO_MANY)).toHaveLength(20);
    expect(h.counts.get("rl:login:pw-fail:ip:203.0.113.7")).toBe(30);
    // Addresses refused by the IP bucket got their per-address slot back.
    const perAddress = [...h.counts.entries()].filter(([k]) => k.startsWith("rl:login:pw-fail:email:"));
    expect(perAddress.reduce((sum, [, v]) => sum + v, 0)).toBe(30);
  });

  it("gives the slots back after a correct password (successes never fill the buckets)", async () => {
    h.state.passwordOk = true;
    // Three waves of 30 simultaneous logins from one IP: more successes than
    // the IP limit, none refused, nothing left counted afterwards.
    for (let wave = 0; wave < 3; wave++) {
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => attempt(`team${i % 5}@praxis.de`, "richtig"))
      );
      expect(results.every((r) => r && "redirected" in r)).toBe(true);
    }
    for (const v of h.counts.values()) expect(v).toBe(0);
  });

  it("keeps the failure count and still lets the right password in below the limit", async () => {
    for (let i = 0; i < 9; i++) expect(await attempt("a@praxis.de")).toEqual({ ok: false, error: WRONG });
    expect(h.counts.get("rl:login:pw-fail:email:a@praxis.de")).toBe(9);
    h.state.passwordOk = true;
    expect(await attempt("a@praxis.de", "richtig")).toEqual({ redirected: true });
    expect(h.counts.get("rl:login:pw-fail:email:a@praxis.de")).toBe(9);
  });

  it("refuses without a password check once the address is locked", async () => {
    for (let i = 0; i < 10; i++) await attempt("b@praxis.de");
    h.state.verifyCalls = 0;
    h.state.passwordOk = true;
    expect(await attempt("b@praxis.de", "richtig")).toEqual({ ok: false, error: TOO_MANY });
    expect(h.state.verifyCalls).toBe(0);
  });
});
