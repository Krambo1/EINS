/**
 * KI-Klon records against a REAL local Postgres (migration 0101): the model
 * gate (no model without the documented training opt-out), and the
 * revocation that flags exactly the clone posts not yet stopped, once.
 * The mail provider is mocked; the SQL is real.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL (the vitest setup
 * overrides it, so export it from .env.local first):
 *   CLONE_DB_TEST=1 DATABASE_URL=... npx vitest run --pool=forks src/server/clone.db.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.CLONE_DB_TEST === "1";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/server/email", async (orig) => {
  const real = await orig<typeof import("@/server/email")>();
  return { ...real, getEmailSender: () => ({ send }) };
});

describe.skipIf(!enabled)("KI-Klon gate and revocation (local DB)", () => {
  it("gates the model on the opt-out and flags clone posts exactly once", async () => {
    process.env.OPS_ALERT_EMAIL = "ops@example.test";
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const clone = await import("./clone");
    const { eraseClinicData } = await import("./dsgvo");
    const { MODEL_GATE_MESSAGE } = await import("@/lib/clone-record");

    const admin = { email: "klon-test@example.test" };
    const clinicId = randomUUID();
    const slug = `klon-test-${clinicId.slice(0, 8)}`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Klon Test', 'Klon Test', ${slug})`);
    const recordIds: string[] = [];
    try {
      const { id } = await clone.createCloneRecord(admin, { clinicId, personName: "Dr. Test", tool: "HeyGen" });
      recordIds.push(id);
      const at = new Date(Date.now() - 60_000);

      // No consent, no opt-out: rejected.
      await expect(clone.setModelCreated(admin, { clinicId, id, at })).rejects.toThrow(MODEL_GATE_MESSAGE);

      // A document key outside klon/<clinicId>/ is refused before any write.
      await expect(
        clone.updateCloneRecord(admin, {
          clinicId,
          id,
          kind: "einwilligung",
          signedOn: "2026-10-01",
          documentKey: `${clinicId}/uploads/${randomUUID()}.pdf`,
        })
      ).rejects.toThrow("gehört nicht zu dieser Praxis");

      // Consent only (documents set directly, storage is not under test): still rejected.
      const consentKey = `klon/${clinicId}/${randomUUID()}.pdf`;
      await db.execute(sql`UPDATE clone_records
        SET consent_signed_at = now() - interval '2 days', consent_document_key = ${consentKey}
        WHERE id = ${id}`);
      await expect(clone.setModelCreated(admin, { clinicId, id, at })).rejects.toThrow(MODEL_GATE_MESSAGE);
      const [noModel] = (await db.execute(sql`SELECT model_created_at FROM clone_records WHERE id = ${id}`)) as unknown as Array<{
        model_created_at: Date | null;
      }>;
      expect(noModel!.model_created_at).toBeNull();

      // With the documented opt-out: accepted.
      const optoutKey = `klon/${clinicId}/${randomUUID()}.pdf`;
      await db.execute(sql`UPDATE clone_records
        SET training_optout_document_key = ${optoutKey}, training_optout_confirmed_at = now() - interval '1 day'
        WHERE id = ${id}`);
      await clone.setModelCreated(admin, { clinicId, id, at });
      const [withModel] = (await db.execute(sql`SELECT model_created_at FROM clone_records WHERE id = ${id}`)) as unknown as Array<{
        model_created_at: Date | null;
      }>;
      expect(withModel!.model_created_at).not.toBeNull();

      // Posts: clone draft, clone live, clone already stopped, non-clone live.
      await db.execute(sql`INSERT INTO content_items (clinic_id, code, title, format, uses_clone, status, stop_reason) VALUES
        (${clinicId}, 'b7k2x', 'Klon Entwurf', 'reel', true, 'entwurf', NULL),
        (${clinicId}, 'c8m3z', 'Klon live', 'reel', true, 'live', NULL),
        (${clinicId}, 'd9n4q', 'Klon gestoppt', 'reel', true, 'gestoppt', 'Test'),
        (${clinicId}, 'f2p5r', 'Ohne Klon', 'reel', false, 'live', NULL)`);

      const r1 = await clone.revokeClone(admin, { clinicId, id, note: "Per E-Mail am Test-Tag" });
      expect(r1).toMatchObject({ postsToStop: 2, newlyFlagged: 2, mail: "sent" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toMatchObject({
        to: "ops@example.test",
        subject: "Widerruf KI-Klon: Klon Test, 1 Beitrag zu stoppen",
      });

      type Row = { code: string; stop_requested_at: Date | null; stop_requested_reason: string | null };
      const flags = async () =>
        (await db.execute(sql`SELECT code, stop_requested_at, stop_requested_reason
          FROM content_items WHERE clinic_id = ${clinicId} ORDER BY code`)) as unknown as Row[];
      const first = await flags();
      const flagged = first.filter((r) => r.stop_requested_at).map((r) => r.code);
      expect(flagged).toEqual(["b7k2x", "c8m3z"]);
      expect(first.find((r) => r.code === "b7k2x")!.stop_requested_reason).toMatch(/^Widerruf KI-Klon am \d{2}\.\d{2}\.\d{4}$/);
      // Not live: stopped at once. Live: stays live, flagged until taken down.
      const statuses = async () =>
        Object.fromEntries(
          ((await db.execute(sql`SELECT code, status FROM content_items WHERE clinic_id = ${clinicId}`)) as unknown as Array<{
            code: string;
            status: string;
          }>).map((r) => [r.code, r.status])
        );
      expect(await statuses()).toMatchObject({ b7k2x: "gestoppt", c8m3z: "live", d9n4q: "gestoppt", f2p5r: "live" });
      // The revoked clone is owed for deletion at once, even without a contract end.
      expect((await clone.listCloneDeletionTasks()).find((t) => t.id === id)).toMatchObject({ contractEndOn: null });

      // After the revocation the model cannot be recorded again and the record is unusable.
      await expect(clone.revokeClone(admin, { clinicId, id, note: "nochmal" })).rejects.toThrow("schon erfasst");
      expect(send).toHaveBeenCalledTimes(1);
      expect(await flags()).toEqual(first);

      // A second record of the same Praxis: earlier flags are not overwritten,
      // a new clone post is flagged.
      const second = await clone.createCloneRecord(admin, { clinicId, personName: "Dr. Zwei", tool: "Synthesia" });
      recordIds.push(second.id);
      await db.execute(sql`INSERT INTO content_items (clinic_id, code, title, format, uses_clone, status)
        VALUES (${clinicId}, 'g3q6s', 'Klon neu', 'story', true, 'geplant')`);
      await db.execute(sql`UPDATE content_items SET stop_requested_reason = 'Erste Markierung'
        WHERE clinic_id = ${clinicId} AND code = 'b7k2x'`);
      const r2 = await clone.revokeClone(admin, { clinicId, id: second.id, note: "Zweiter Widerruf" });
      expect(r2).toMatchObject({ postsToStop: 2, newlyFlagged: 1 });
      expect(await statuses()).toMatchObject({ g3q6s: "gestoppt", c8m3z: "live" });
      const after = await flags();
      expect(after.filter((r) => r.stop_requested_at).map((r) => r.code)).toEqual(["b7k2x", "c8m3z", "g3q6s"]);
      expect(after.find((r) => r.code === "b7k2x")!.stop_requested_reason).toBe("Erste Markierung");
      expect(after.find((r) => r.code === "c8m3z")!.stop_requested_at).toEqual(
        first.find((r) => r.code === "c8m3z")!.stop_requested_at
      );

      // Read side: open stop list and the admin home task count.
      const open = await clone.getStopRequestedPosts(clinicId);
      expect(open.map((p) => p.code).sort()).toEqual(["c8m3z"]);
      const tasks = await clone.listStopTasks();
      expect(tasks.find((t) => t.clinicId === clinicId)).toMatchObject({ count: 1, clinicName: "Klon Test" });

      // Deletion: owed after the contract end, gone from the list once marked.
      await clone.updateCloneRecord(admin, { clinicId, id, kind: "vertragsende", contractEndOn: "2026-08-01" });
      expect((await clone.listCloneDeletionTasks()).some((t) => t.id === id)).toBe(true);
      await clone.markDeleted(admin, { clinicId, id, note: "Beim Werkzeug gelöscht" });
      expect((await clone.listCloneDeletionTasks()).some((t) => t.id === id)).toBe(false);
      await expect(clone.markDeleted(admin, { clinicId, id, note: "nochmal" })).rejects.toThrow("schon vermerkt");
    } finally {
      await db.execute(
        sql`DELETE FROM email_send_log WHERE idempotency_key = ANY(${sql.param(recordIds.map((r) => `clone-revocation/${r}`))}::text[])`
      );
      await eraseClinicData(clinicId, { email: admin.email, slug, displayName: "Klon Test" });
      await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${clinicId}`);
    }
  });
});
