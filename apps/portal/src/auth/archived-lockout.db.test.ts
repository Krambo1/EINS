/**
 * Integration test against a REAL local Postgres (decision b, G-05 / B-12 /
 * B-11): an archived user and every user of an archived Praxis are rejected
 * at login (findActiveClinicUserByEmail) AND by the very next session check
 * (getSession), through the one joined session query.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   AUTH_DB_TEST=1 DATABASE_URL=… npx vitest run src/auth/archived-lockout.db.test.ts
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const enabled = process.env.AUTH_DB_TEST === "1";

// In-memory cookie jar + request headers in place of Next's request scope.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers({ "x-real-ip": "127.0.0.1", "user-agent": "vitest" }),
}));

describe.skipIf(!enabled)("archived lockout (local DB)", () => {
  it("locks out archived users and users of archived Praxen at login and per request", async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { createSession, getSession } = await import("./session");
    const { findActiveClinicUserByEmail, findActiveClinicUserById } = await import("./user-lookup");
    const { eraseClinicData } = await import("../server/dsgvo");

    const clinicId = randomUUID();
    const slug = `lockout-test-${clinicId.slice(0, 8)}`;
    const email = `${slug}@example.test`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug, default_doctor_email)
      VALUES (${clinicId}, 'Lockout Test', 'Lockout Test', ${slug}, ${`praxis-${slug}@example.test`})`);
    const [user] = (await db.execute(sql`INSERT INTO clinic_users (clinic_id, email, role)
      VALUES (${clinicId}, ${email}, 'inhaber') RETURNING id`)) as unknown as Array<{ id: string }>;
    const userId = user!.id;

    try {
      // Active: login lookup and session both work.
      expect((await findActiveClinicUserByEmail(email.toUpperCase()))?.id).toBe(userId);
      jar.clear();
      await createSession(userId);
      expect((await getSession())?.userId).toBe(userId);

      // Team member removed: next request and next login are refused.
      await db.execute(sql`UPDATE clinic_users SET archived_at = now() WHERE id = ${userId}`);
      expect(await getSession()).toBeNull();
      expect(await findActiveClinicUserByEmail(email)).toBeNull();
      expect(await findActiveClinicUserById(userId)).toBeNull();

      // Praxis archived (user itself still active): same lockout.
      await db.execute(sql`UPDATE clinic_users SET archived_at = NULL WHERE id = ${userId}`);
      expect((await getSession())?.userId).toBe(userId);
      await db.execute(sql`UPDATE clinics SET archived_at = now() WHERE id = ${clinicId}`);
      expect(await getSession()).toBeNull();
      expect(await findActiveClinicUserByEmail(email)).toBeNull();
      expect(await findActiveClinicUserById(userId)).toBeNull();
    } finally {
      await db.execute(sql`UPDATE clinics SET archived_at = NULL WHERE id = ${clinicId}`);
      await eraseClinicData(clinicId, { email: "admin@example.test", slug, displayName: "Lockout Test" });
      jar.clear();
    }
    const left = (await db.execute(
      sql`SELECT count(*)::int AS n FROM clinic_users WHERE clinic_id = ${clinicId}`
    )) as unknown as Array<{ n: number }>;
    expect(left[0]!.n).toBe(0);
  }, 30_000);

  it("magic link: peek never consumes, POST consume works once, archived users cannot use a link", async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { consumeMagicLink, peekMagicLink } = await import("./magic-link");
    const { generateToken, sha256Hex } = await import("../lib/crypto");
    const { eraseClinicData } = await import("../server/dsgvo");

    const clinicId = randomUUID();
    const slug = `link-test-${clinicId.slice(0, 8)}`;
    const email = `${slug}@example.test`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug, default_doctor_email)
      VALUES (${clinicId}, 'Link Test', 'Link Test', ${slug}, ${`praxis-${slug}@example.test`})`);
    const [user] = (await db.execute(sql`INSERT INTO clinic_users (clinic_id, email, role)
      VALUES (${clinicId}, ${email}, 'inhaber') RETURNING id`)) as unknown as Array<{ id: string }>;
    const insertLink = async () => {
      const token = generateToken(32);
      await db.execute(sql`INSERT INTO magic_links (email, token_hash, user_id, intent, expires_at)
        VALUES (${email}, ${sha256Hex(token)}, ${user!.id}, 'login', now() + interval '15 minutes')`);
      return token;
    };

    try {
      jar.clear();
      const token = await insertLink();
      // GET landing page (and mail scanners) only peek, any number of times.
      expect(await peekMagicLink(token)).toEqual({ ok: true, intent: "login" });
      expect(await peekMagicLink(token)).toEqual({ ok: true, intent: "login" });
      // The button POST consumes exactly once.
      expect((await consumeMagicLink(token)).ok).toBe(true);
      expect(await consumeMagicLink(token)).toMatchObject({ ok: false, reason: "consumed" });
      expect(await peekMagicLink(token)).toMatchObject({ ok: false, reason: "consumed" });

      // A fresh link of an archived Praxis is refused and not burned.
      const second = await insertLink();
      await db.execute(sql`UPDATE clinics SET archived_at = now() WHERE id = ${clinicId}`);
      expect(await peekMagicLink(second)).toMatchObject({ ok: false, reason: "no_user" });
      expect((await consumeMagicLink(second)).ok).toBe(false);
      await db.execute(sql`UPDATE clinics SET archived_at = NULL WHERE id = ${clinicId}`);
      expect(await peekMagicLink(second)).toEqual({ ok: true, intent: "login" });
    } finally {
      await db.execute(sql`UPDATE clinics SET archived_at = NULL WHERE id = ${clinicId}`);
      await eraseClinicData(clinicId, { email: "admin@example.test", slug, displayName: "Link Test" });
      await db.execute(sql`DELETE FROM magic_links WHERE email = ${email}`);
      jar.clear();
    }
  }, 30_000);
});
