/**
 * Claim vs. delivery (V4 Neben 2, migration 0094) against a REAL local
 * Postgres: sendEmailOnce's email_send_log ledger and the new-request claim
 * on requests. The mail provider is mocked; the SQL is real.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL (the vitest setup
 * overrides it, so export it from .env.local first):
 *   EMAIL_ONCE_DB_TEST=1 DATABASE_URL=... npx vitest run src/server/email-once.db.test.ts
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.EMAIL_ONCE_DB_TEST === "1";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/server/email", async (orig) => {
  const real = await orig<typeof import("@/server/email")>();
  return { ...real, getEmailSender: () => ({ send }) };
});

const prefix = `email-once-test/${randomUUID()}`;

describe.skipIf(!enabled)("sendEmailOnce ledger (local DB)", () => {
  afterAll(async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM email_send_log WHERE idempotency_key LIKE ${prefix + "%"}`);
  });

  const mail = (key: string) => ({
    key: `${prefix}/${key}`,
    clinicId: null,
    to: "ops@example.test",
    subject: "Test",
    text: "Test",
  });

  async function row(key: string) {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const rows = (await db.execute(sql`
      SELECT sent_at, delivered_at FROM email_send_log WHERE idempotency_key = ${`${prefix}/${key}`}
    `)) as unknown as Array<{ sent_at: Date; delivered_at: Date | null }>;
    return rows[0] ?? null;
  }

  async function seedClaim(key: string, minutesAgo: number, delivered: boolean) {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO email_send_log (idempotency_key, clinic_id, sent_at, delivered_at)
      VALUES (${`${prefix}/${key}`}, NULL, now() - (${minutesAgo}::int * interval '1 minute'),
              ${delivered ? sql`now()` : null})
    `);
  }

  it("success: sends once with the key and marks delivered", async () => {
    const { sendEmailOnce } = await import("./email-once");
    send.mockReset().mockResolvedValue(undefined);
    expect(await sendEmailOnce(mail("ok"))).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].idempotencyKey).toBe(`${prefix}/ok`);
    expect((await row("ok"))?.delivered_at).toBeTruthy();
    expect(await sendEmailOnce(mail("ok"))).toBe("duplicate");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("thrown error: claim released, next call sends", async () => {
    const { sendEmailOnce } = await import("./email-once");
    send.mockReset().mockRejectedValueOnce(new Error("resend down")).mockResolvedValue(undefined);
    await expect(sendEmailOnce(mail("fail"))).rejects.toThrow("resend down");
    expect(await row("fail")).toBeNull();
    expect(await sendEmailOnce(mail("fail"))).toBe("sent");
  });

  it("stale undelivered claim (20 min) is taken again with the same key", async () => {
    const { sendEmailOnce } = await import("./email-once");
    await seedClaim("stale", 20, false);
    send.mockReset().mockResolvedValue(undefined);
    expect(await sendEmailOnce(mail("stale"))).toBe("sent");
    expect(send.mock.calls[0]![0].idempotencyKey).toBe(`${prefix}/stale`);
    expect((await row("stale"))?.delivered_at).toBeTruthy();
  });

  it("fresh undelivered claim (1 min) and old delivered row are not retried", async () => {
    const { sendEmailOnce } = await import("./email-once");
    await seedClaim("fresh", 1, false);
    await seedClaim("done", 600, true);
    send.mockReset().mockResolvedValue(undefined);
    expect(await sendEmailOnce(mail("fresh"))).toBe("duplicate");
    expect(await sendEmailOnce(mail("done"))).toBe("duplicate");
    expect(send).not.toHaveBeenCalled();
  });

  it("concurrent claims: exactly one sends (new key and stale key)", async () => {
    const { sendEmailOnce } = await import("./email-once");
    await seedClaim("race-stale", 30, false);
    send.mockReset().mockImplementation(() => new Promise((r) => setTimeout(r, 50)));
    for (const key of ["race-new", "race-stale"]) {
      send.mockClear();
      const results = await Promise.all(Array.from({ length: 6 }, () => sendEmailOnce(mail(key))));
      expect(results.filter((r) => r === "sent")).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
});

describe.skipIf(!enabled)("new-request claim (local DB)", () => {
  const clinicId = randomUUID();
  const requestId = randomUUID();

  afterAll(async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM requests WHERE clinic_id = ${clinicId}`);
    await db.execute(sql`DELETE FROM treatments WHERE clinic_id = ${clinicId}`);
    await db.execute(sql`DELETE FROM clinics WHERE id = ${clinicId}`);
  });

  it("stale claim retried, fresh claim not, concurrent only one, delivered never", async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { defaultDeps } = await import("./request-notify");
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Claim Test', 'Claim Test', ${`claim-test-${clinicId.slice(0, 8)}`})`);
    await db.execute(sql`INSERT INTO treatments (clinic_id, name, slug, is_active)
      VALUES (${clinicId}, 'Claimtest-Botox', 'claimtest-botox', true),
             (${clinicId}, 'Claimtest-Alt', 'claimtest-alt', false)`);
    await db.execute(sql`INSERT INTO requests (id, clinic_id, source, status, new_request_notified_at)
      VALUES (${requestId}, ${clinicId}, 'formular', 'neu', now() - interval '1 minute')`);

    // Fresh claim (1 min): nobody may take it.
    expect(await defaultDeps.claim(requestId)).toBeNull();

    // Stale claim (20 min), concurrent: exactly one wins.
    await db.execute(sql`UPDATE requests SET new_request_notified_at = now() - interval '20 minutes'
      WHERE id = ${requestId}`);
    const results = await Promise.all(Array.from({ length: 5 }, () => defaultDeps.claim(requestId)));
    expect(results.filter(Boolean)).toHaveLength(1);
    // L-13 (H2): the claim carries this Praxis's active catalogue names.
    expect(results.find(Boolean)!.catalogNames).toEqual(["Claimtest-Botox"]);

    // Released claim: taken again at once.
    await defaultDeps.release(requestId);
    expect(await defaultDeps.claim(requestId)).not.toBeNull();

    // Delivered: never again, even when the claim is old.
    await defaultDeps.markDelivered(requestId);
    await db.execute(sql`UPDATE requests SET new_request_notified_at = now() - interval '2 hours'
      WHERE id = ${requestId}`);
    expect(await defaultDeps.claim(requestId)).toBeNull();
    await defaultDeps.release(requestId);
    const [r] = (await db.execute(sql`SELECT new_request_notified_at FROM requests WHERE id = ${requestId}`)) as unknown as Array<{ new_request_notified_at: Date | null }>;
    expect(r!.new_request_notified_at).not.toBeNull();
  });
});
