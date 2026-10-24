/**
 * D6 against a REAL local Postgres, everything inside one transaction that is
 * rolled back at the end (no rows stay). Opt-in:
 *   GUARANTEE_DB_TEST=1 npx vitest run src/server/guarantee-test-spam.db.test.ts
 */
import { describe, expect, it } from "vitest";

const enabled = process.env.GUARANTEE_DB_TEST === "1";

class Rollback extends Error {}

describe.skipIf(!enabled)("D6 test spam (local DB, rolled back)", () => {
  it("sets spam, restores on undo, keeps spam when changed in between", async () => {
    const { db, schema } = await import("@/db/client");
    const { and, desc, eq, ne, sql } = await import("drizzle-orm");
    const m = await import("./guarantee-test-spam");
    const { firstAttemptAtSql } = await import("./queries/response-time");

    const [req] = await db
      .select({ id: schema.requests.id, clinicId: schema.requests.clinicId, status: schema.requests.status })
      .from(schema.requests)
      .where(and(ne(schema.requests.status, "spam"), sql`${schema.requests.pvsAppointmentId} IS NULL`))
      .limit(1);
    expect(req, "local DB needs one non-spam request").toBeTruthy();
    const args = { clinicId: req!.clinicId, requestId: req!.id };

    await expect(
      db.transaction(async (tx) => {
        const status = async () =>
          (
            await tx
              .select({ s: schema.requests.status, src: schema.requests.statusSource })
              .from(schema.requests)
              .where(eq(schema.requests.id, req!.id))
          )[0]!;
        const latestMeta = async () =>
          (
            await tx
              .select({ meta: schema.requestActivities.meta, actorId: schema.requestActivities.actorId })
              .from(schema.requestActivities)
              .where(
                and(
                  eq(schema.requestActivities.requestId, req!.id),
                  eq(schema.requestActivities.kind, "status_change")
                )
              )
              .orderBy(desc(schema.requestActivities.createdAt), desc(schema.requestActivities.id))
              .limit(1)
          )[0];
        const attemptBefore = (
          await tx
            .select({ a: firstAttemptAtSql() })
            .from(schema.requests)
            .where(eq(schema.requests.id, req!.id))
        )[0]!.a;

        // Other reasons change nothing.
        expect(await m.markTestInquiryAsSpam(tx, { ...args, reason: "bewerbung" })).toBeNull();
        expect((await status()).s).toBe(req!.status);

        // Step 1.
        expect(await m.markTestInquiryAsSpam(tx, { ...args, reason: "test_eintrag" })).toEqual({
          statusBefore: req!.status,
        });
        expect(await status()).toEqual({ s: "spam", src: "manual" });
        expect(await latestMeta()).toEqual({
          meta: { from: req!.status, to: "spam", via: m.TEST_SPAM_VIA },
          actorId: null,
        });
        // A spam status change is no contact attempt.
        const attemptAfter = (
          await tx
            .select({ a: firstAttemptAtSql() })
            .from(schema.requests)
            .where(eq(schema.requests.id, req!.id))
        )[0]!.a;
        expect(String(attemptAfter)).toBe(String(attemptBefore));
        // Already spam: second call is a no-op.
        expect(await m.markTestInquiryAsSpam(tx, { ...args, reason: "test_eintrag" })).toBeNull();

        // Step 2: restore.
        expect(await m.restoreTestInquiryStatus(tx, { ...args, reason: "test_eintrag" })).toEqual({
          restore: req!.status,
        });
        expect((await status()).s).toBe(req!.status);
        expect((await latestMeta())!.meta).toEqual({
          from: "spam",
          to: req!.status,
          via: m.TEST_SPAM_UNDO_VIA,
        });

        // Changed in between: spam again, then the Praxis writes its own change.
        await m.markTestInquiryAsSpam(tx, { ...args, reason: "test_eintrag" });
        await tx.insert(schema.requestActivities).values({
          requestId: req!.id,
          kind: "status_change",
          meta: { from: "spam", to: "spam" },
          createdAt: new Date(Date.now() + 60_000),
        });
        expect(await m.restoreTestInquiryStatus(tx, { ...args, reason: "test_eintrag" })).toEqual({
          keep: "status_geaendert",
        });
        expect((await status()).s).toBe("spam");

        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);

    const [after] = await db
      .select({ s: schema.requests.status })
      .from(schema.requests)
      .where(eq(schema.requests.id, req!.id));
    expect(after!.s).toBe(req!.status);
  }, 60_000);
});
