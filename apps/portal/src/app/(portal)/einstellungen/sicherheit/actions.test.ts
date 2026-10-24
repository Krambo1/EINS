import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * V3 Neben 2 (password change, B-16 bucket): parallel submits with a wrong
 * "aktuelles Passwort" must not run more than 10 Argon2 checks per user and
 * window. The slot store models the atomic conditional upsert of
 * `reserveRateLimitSlot` (real SQL: `server/rate-limit-slot.db.test.ts`).
 */
const h = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  state: { verifyCalls: 0, verifyDelayMs: 25, passwordOk: false, hashWrites: 0 },
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
  releaseRateLimitSlot: vi.fn(async (slot: { key: string } | null) => {
    await Promise.resolve();
    if (slot) h.counts.set(slot.key, Math.max(0, (h.counts.get(slot.key) ?? 0) - 1));
  }),
}));
vi.mock("@/auth/guards", () => ({
  requireSession: vi.fn(async () => ({
    userId: "user-1",
    clinicId: "clinic-1",
    email: "inhaber@praxis.de",
    sessionId: "session-1",
  })),
}));
vi.mock("@/auth/impersonation-guard", () => ({
  isImpersonating: () => false,
  impersonationBlockedMessage: () => "gesperrt",
}));
vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  const select = {
    from: () => select,
    where: () => select,
    limit: async () => [{ passwordHash: "$argon2id$fake" }],
  };
  const update = {
    set: () => update,
    where: async () => {
      h.state.hashWrites += 1;
    },
  };
  return { schema, db: { select: () => select, update: () => update } };
});
vi.mock("@/auth/password", () => ({
  checkPasswordPolicy: () => ({ ok: true }),
  hashPassword: async () => "$argon2id$new",
  verifyPassword: vi.fn(async () => {
    h.state.verifyCalls += 1;
    await new Promise((r) => setTimeout(r, h.state.verifyDelayMs));
    return h.state.passwordOk;
  }),
}));
vi.mock("@/auth/session", () => ({
  revokeAllSessionsForUser: vi.fn(),
  revokeOtherSessionsForUser: vi.fn(async () => undefined),
}));
vi.mock("@/server/audit", () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { changePasswordAction } from "./actions";

const TOO_MANY =
  "Zu viele falsche Eingaben des aktuellen Passworts. Bitte warten Sie eine Stunde oder setzen Sie das Passwort über „Passwort vergessen“ zurück.";
const WRONG = "Das aktuelle Passwort stimmt nicht.";
const KEY = "rl:pw-change:fail:user:user-1";

function submit(current = "falsch") {
  const f = new FormData();
  f.set("currentPassword", current);
  f.set("newPassword", "Neues-Passwort-2026!");
  f.set("newPassword2", "Neues-Passwort-2026!");
  return changePasswordAction(undefined, f);
}

beforeEach(() => {
  h.counts.clear();
  Object.assign(h.state, { verifyCalls: 0, passwordOk: false, hashWrites: 0 });
});

describe("changePasswordAction under a parallel burst (V3 Neben 2)", () => {
  it("runs at most 10 current-password checks per user, however many submits arrive at once", async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => submit()));
    expect(h.state.verifyCalls).toBe(10);
    expect(results.filter((r) => r?.ok === false && r.error === WRONG)).toHaveLength(10);
    expect(results.filter((r) => r?.ok === false && r.error === TOO_MANY)).toHaveLength(15);
    expect(h.counts.get(KEY)).toBe(10);
    expect(h.state.hashWrites).toBe(0);
  });

  it("gives the slot back when the current password is right", async () => {
    for (let i = 0; i < 3; i++) await submit();
    h.state.passwordOk = true;
    const r = await submit("richtig");
    expect(r).toEqual({ ok: true, message: "Passwort aktualisiert. Andere Sitzungen wurden beendet." });
    expect(h.counts.get(KEY)).toBe(3);
    expect(h.state.hashWrites).toBe(1);
  });

  it("refuses without a password check once the user is locked", async () => {
    for (let i = 0; i < 10; i++) await submit();
    h.state.verifyCalls = 0;
    h.state.passwordOk = true;
    expect(await submit("richtig")).toEqual({ ok: false, error: TOO_MANY });
    expect(h.state.verifyCalls).toBe(0);
    expect(h.state.hashWrites).toBe(0);
  });
});
