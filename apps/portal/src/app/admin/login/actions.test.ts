import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V3 Neben 2 (admin track): the admin password-failure buckets must hold
 * under a parallel burst. The slot store models the atomic conditional upsert
 * of `reserveRateLimitSlot` (real SQL: `server/rate-limit-slot.db.test.ts`);
 * the Argon2 verify is a slow fake so all attempts are in flight at once.
 */
const h = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  state: { verifyCalls: 0, verifyDelayMs: 25, passwordOk: false, ipBlocked: false },
}));

vi.mock("@/server/rate-limit-slot", () => ({
  reserveRateLimitSlot: vi.fn(async (scope: string, id: string, opts: { limit: number }) => {
    await Promise.resolve();
    const key = `rl:${scope}:${id}`;
    const c = h.counts.get(key) ?? 0;
    if (c >= opts.limit) return { ok: false };
    h.counts.set(key, c + 1);
    return { ok: true, slot: { key, windowStart: "w1" } };
  }),
  releaseRateLimitSlots: vi.fn(async (slots: Array<{ key: string } | null>) => {
    await Promise.resolve();
    for (const s of slots) {
      if (s) h.counts.set(s.key, Math.max(0, (h.counts.get(s.key) ?? 0) - 1));
    }
  }),
}));
vi.mock("@/server/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("@/auth/admin-password", () => ({
  verifyAdminPassword: vi.fn(async (email: string) => {
    h.state.verifyCalls += 1;
    await new Promise((r) => setTimeout(r, h.state.verifyDelayMs));
    return h.state.passwordOk ? { id: `admin-${email}` } : null;
  }),
  issueAdminPasswordResetLink: vi.fn(),
}));
vi.mock("@/auth/admin", () => ({
  createAdminSession: vi.fn(async () => {
    if (h.state.ipBlocked) {
      throw new Error("Admin-Anmeldung abgelehnt: IP-Adresse nicht in der Allowlist.");
    }
  }),
}));
vi.mock("@/auth/admin-magic-link", () => ({ issueAdminMagicLink: vi.fn() }));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/client-ip", () => ({ getTrustedClientIp: vi.fn(async () => "198.51.100.9") }));

import { adminPasswordLoginAction } from "./actions";

const LIMITED = "Zu viele Anmelde-Versuche. Bitte einen Moment warten.";
const WRONG = "E-Mail oder Passwort stimmt nicht.";
const EMAIL_KEY = "rl:admin-login:pw-fail:email:karam@eins.ag";
const IP_KEY = "rl:admin-login:pw-fail:ip:198.51.100.9";

function attempt(email: string, password = "falsch") {
  const f = new FormData();
  f.set("email", email);
  f.set("password", password);
  return adminPasswordLoginAction(undefined, f);
}

beforeEach(() => {
  h.counts.clear();
  Object.assign(h.state, { verifyCalls: 0, passwordOk: false, ipBlocked: false });
});

describe("adminPasswordLoginAction under a parallel burst (V3 Neben 2)", () => {
  it("runs at most 10 password checks per address, however many requests arrive at once", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => attempt("karam@eins.ag")));
    expect(h.state.verifyCalls).toBe(10);
    expect(results.filter((r) => r?.ok === false && r.error === WRONG)).toHaveLength(10);
    expect(results.filter((r) => r?.ok === false && r.error === LIMITED)).toHaveLength(15);
    expect(h.counts.get(EMAIL_KEY)).toBe(10);
    expect(h.counts.get(IP_KEY)).toBe(10);
  });

  it("runs at most 30 password checks per IP when the burst sprays addresses", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => attempt(`admin${i}@eins.ag`))
    );
    expect(h.state.verifyCalls).toBe(30);
    expect(results.filter((r) => r?.ok === false && r.error === LIMITED)).toHaveLength(20);
    expect(h.counts.get(IP_KEY)).toBe(30);
  });

  it("gives the slots back after a completed login", async () => {
    h.state.passwordOk = true;
    const results = await Promise.all(Array.from({ length: 5 }, () => attempt("karam@eins.ag", "richtig")));
    expect(results.every((r) => r?.ok === true)).toBe(true);
    expect(h.counts.get(EMAIL_KEY)).toBe(0);
    expect(h.counts.get(IP_KEY)).toBe(0);
  });

  it("counts a correct password from a blocked IP like a wrong one (no session, no oracle)", async () => {
    h.state.passwordOk = true;
    h.state.ipBlocked = true;
    expect(await attempt("karam@eins.ag", "richtig")).toEqual({ ok: false, error: WRONG });
    expect(h.counts.get(EMAIL_KEY)).toBe(1);
  });

  it("refuses without a password check once the address is locked", async () => {
    for (let i = 0; i < 10; i++) await attempt("karam@eins.ag");
    h.state.verifyCalls = 0;
    h.state.passwordOk = true;
    expect(await attempt("karam@eins.ag", "richtig")).toEqual({ ok: false, error: LIMITED });
    expect(h.state.verifyCalls).toBe(0);
  });
});
