/**
 * Freigabe against a REAL local Postgres (migration 0101): the gate facts,
 * a batch with one normal and one clone post, the link decision (first wins,
 * replay returns the recorded decision), Inhaber-only in the portal path, an
 * expired link, and the Verzug job (exactly one delay per late batch over
 * two runs, closed after the last decision).
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   CONTENT_APPROVAL_DB_TEST=1 npx vitest run --pool=forks src/server/content-approval.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.CONTENT_APPROVAL_DB_TEST === "1";

describe.skipIf(!enabled)("content approval (local DB)", () => {
  it("sends a batch, decides by link and portal, and feeds the Verzug", async () => {
    // Never reach a real mail provider from a test.
    process.env.EMAIL_DRIVER = "console";
    delete process.env.RESEND_API_KEY;
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const approval = await import("./content-approval");
    const { eraseClinicData } = await import("./dsgvo");
    const { verzugStartDay } = await import("@/lib/content-gate");

    const admin = { email: "admin-test@eins.ag" };
    const clinicId = randomUUID();
    const slug = `freigabe-test-${clinicId.slice(0, 8)}`;
    const inhaberId = randomUUID();
    const marketingId = randomUUID();
    const tag = clinicId.slice(0, 8);
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Freigabe Test', 'Freigabe Test', ${slug})`);
    await db.execute(sql`INSERT INTO clinic_users (id, clinic_id, email, full_name, role) VALUES
      (${inhaberId}, ${clinicId}, ${`inhaber-${tag}@example.test`}, 'Dr. Test', 'inhaber'),
      (${marketingId}, ${clinicId}, ${`marketing-${tag}@example.test`}, 'Marketing Test', 'marketing')`);
    // Usable KI-Klon: consent, training opt-out, model.
    await db.execute(sql`INSERT INTO clone_records
      (clinic_id, person_name, tool, consent_signed_at, consent_document_key,
       training_optout_document_key, training_optout_confirmed_at, model_created_at)
      VALUES (${clinicId}, 'Dr. Test', 'fixture', now() - interval '10 days', ${`${clinicId}/c.pdf`},
              ${`${clinicId}/o.pdf`}, now() - interval '9 days', now() - interval '8 days')`);
    await db.execute(sql`INSERT INTO guarantee_clocks (clinic_id, signed_on)
      VALUES (${clinicId}, (now() - interval '20 days')::date)`);

    const insertItem = async (code: string, title: string, usesClone: boolean, caption: string) => {
      const rows = (await db.execute(sql`INSERT INTO content_items
        (clinic_id, code, title, format, uses_clone, ai_content, caption, created_by)
        VALUES (${clinicId}, ${code}, ${title}, 'reel', ${usesClone}, true, ${caption}, ${admin.email})
        RETURNING id`)) as unknown as Array<{ id: string }>;
      return rows[0]!.id;
    };
    const statusOf = async (id: string) =>
      ((await db.execute(sql`SELECT status FROM content_items WHERE id = ${id}`)) as unknown as Array<{ status: string }>)[0]!
        .status;

    try {
      const normalId = await insertItem("b7k2x", "Lidstraffung erklärt", false, "Was passiert bei einer Lidstraffung? KI-generiert");
      const cloneId = await insertItem("c8m3z", "Dr. Test erklärt Filler", true, "Ihre Ärztin erklärt Filler. KI-generiert");

      // Gate: without the HWG check and the confirmation, nothing is sent.
      await expect(approval.createApprovalBatch(admin, clinicId, [normalId])).rejects.toThrow(/Prüf-Schranke/);
      for (const id of [normalId, cloneId]) {
        expect(await approval.runHwgCheckForItem(admin, { clinicId, id })).toBe("clean");
        await approval.setNoBeforeAfterConfirmation(admin, { clinicId, id, confirmed: true });
      }

      // Batch: both posts, one transaction, tokens stored only as hashes.
      const batch = await approval.createApprovalBatch(admin, clinicId, [normalId, cloneId]);
      expect(batch.posts).toHaveLength(2);
      expect(await statusOf(normalId)).toBe("zur_freigabe");
      const stored = (await db.execute(sql`SELECT token_hash, inhaber_only, content_item_id FROM content_approvals
        WHERE batch_id = ${batch.batchId}`)) as unknown as Array<{ token_hash: string; inhaber_only: boolean; content_item_id: string }>;
      const normalPost = batch.posts.find((p) => p.itemId === normalId)!;
      const clonePost = batch.posts.find((p) => p.itemId === cloneId)!;
      expect(stored.find((r) => r.content_item_id === normalId)!.token_hash).toBe(approval.hashApprovalToken(normalPost.token));
      expect(stored.some((r) => r.token_hash === normalPost.token)).toBe(false);
      expect(stored.find((r) => r.content_item_id === cloneId)!.inhaber_only).toBe(true);
      // A post cannot sit in two open batches.
      await expect(approval.createApprovalBatch(admin, clinicId, [normalId])).rejects.toThrow();

      // E-mails: Inhaber gets both posts, Marketing only the normal one.
      const mail = await approval.sendApprovalBatchEmails(batch);
      expect(mail.sent.sort()).toEqual([`inhaber-${tag}@example.test`, `marketing-${tag}@example.test`]);
      expect(mail.postsWithoutRecipient).toEqual([]);

      // Marketing cannot decide the clone post in the portal.
      const marketing = { clinicId, userId: marketingId, email: `marketing-${tag}@example.test`, role: "marketing" as const };
      const denied = await approval.decideApprovalInPortal(marketing, clonePost.approvalId, "freigegeben", null);
      expect(denied).toMatchObject({ ok: false, reason: "forbidden" });
      expect(await statusOf(cloneId)).toBe("zur_freigabe");
      // Another Praxis' session does not even find it.
      const foreign = await approval.decideApprovalInPortal(
        { ...marketing, clinicId: randomUUID(), role: "inhaber" },
        clonePost.approvalId,
        "freigegeben",
        null
      );
      expect(foreign).toMatchObject({ ok: false, reason: "not_found" });

      // aenderung needs a text.
      expect(await approval.decideApprovalByToken(normalPost.token, "aenderung", "  ")).toMatchObject({
        ok: false,
        reason: "invalid",
      });

      // Link decision: first wins, status freigegeben.
      const first = await approval.decideApprovalByToken(normalPost.token, "freigegeben", null);
      expect(first).toMatchObject({ ok: true, recorded: true, decision: { decision: "freigegeben", decidedVia: "link" } });
      expect(await statusOf(normalId)).toBe("freigegeben");
      // Replay (other button, portal) returns the recorded decision, no change.
      const replay = await approval.decideApprovalByToken(normalPost.token, "aenderung", "Bitte anders");
      expect(replay).toMatchObject({ ok: true, recorded: false, decision: { decision: "freigegeben" } });
      const portalReplay = await approval.decideApprovalInPortal(marketing, normalPost.approvalId, "aenderung", "Doch nicht");
      expect(portalReplay).toMatchObject({ ok: true, recorded: false, decision: { decision: "freigegeben" } });
      expect(await statusOf(normalId)).toBe("freigegeben");
      const [row] = (await db.execute(sql`SELECT decided_by_user_id, decided_via, change_text FROM content_approvals
        WHERE id = ${normalPost.approvalId}`)) as unknown as Array<Record<string, unknown>>;
      expect(row).toEqual({ decided_by_user_id: null, decided_via: "link", change_text: null });

      // Reads: the public page, the portal list (through RLS) and the admin tab.
      const page = await approval.loadApprovalForLink(normalPost.token);
      expect(page).toMatchObject({ title: "Lidstraffung erklärt", practiceName: "Freigabe Test", decision: { decision: "freigegeben" } });
      expect(await approval.loadApprovalForLink("0".repeat(64))).toBeNull();
      const practice = await approval.listApprovalsForPractice(clinicId, marketingId);
      expect(practice.get(cloneId)).toMatchObject({ inhaberOnly: true, decision: null });
      expect(practice.get(normalId)?.decision?.decision).toBe("freigegeben");
      const adminData = await approval.loadApprovalAdminData(clinicId);
      expect(adminData.batches[0]?.posts).toHaveLength(2);
      expect(adminData.gate.get(normalId)?.result).toEqual({ ok: false, reasons: ["status"] });

      // Expired link is rejected while the post is open.
      await db.execute(sql`UPDATE content_approvals SET token_expires_at = now() - interval '1 minute'
        WHERE id = ${clonePost.approvalId}`);
      const expired = await approval.decideApprovalByToken(clonePost.token, "freigegeben", null);
      expect(expired).toMatchObject({ ok: false, reason: "expired" });
      expect(await statusOf(cloneId)).toBe("zur_freigabe");

      // Verzug: make the batch late; two runs create exactly one delay.
      await db.execute(sql`UPDATE content_approval_batches
        SET sent_at = now() - interval '6 days', due_at = now() - interval '2 days'
        WHERE id = ${batch.batchId}`);
      const run1 = await approval.processContentApprovalVerzug({ clinicId });
      const run2 = await approval.processContentApprovalVerzug({ clinicId });
      expect(run1.created).toBe(1);
      expect(run2.created).toBe(0);
      const delays = (await db.execute(sql`SELECT id, kind, from_date::text AS from_date, to_date, notified_at, created_by, reason
        FROM guarantee_delays WHERE approval_batch_id = ${batch.batchId}`)) as unknown as Array<Record<string, unknown>>;
      expect(delays).toHaveLength(1);
      const [due] = (await db.execute(sql`SELECT due_at FROM content_approval_batches WHERE id = ${batch.batchId}`)) as unknown as Array<{ due_at: Date | string }>;
      expect(delays[0]).toMatchObject({
        kind: "verzug",
        from_date: verzugStartDay(new Date(due!.due_at)),
        to_date: null,
        notified_at: null,
        created_by: "system",
      });
      expect(String(delays[0]!.reason)).toMatch(/^Freigabe der Beiträge vom \d{2}\.\d{2}\.\d{4} nicht innerhalb von 2 Werktagen$/);

      // The Inhaber decides the clone post in the portal: the Verzug closes.
      const inhaber = { clinicId, userId: inhaberId, email: `inhaber-${tag}@example.test`, role: "inhaber" as const };
      const change = await approval.decideApprovalInPortal(inhaber, clonePost.approvalId, "aenderung", "Bitte den Schluss kürzen.");
      expect(change).toMatchObject({ ok: true, recorded: true, decision: { decision: "aenderung", decidedVia: "portal" } });
      expect(await statusOf(cloneId)).toBe("aenderung");
      const [closed] = (await db.execute(sql`SELECT to_date::text AS to_date FROM guarantee_delays
        WHERE approval_batch_id = ${batch.batchId}`)) as unknown as Array<{ to_date: string | null }>;
      expect(closed!.to_date).not.toBeNull();
      expect((await approval.processContentApprovalVerzug({ clinicId })).created).toBe(0);

      // The job closes a Verzug the decision path missed.
      await db.execute(sql`UPDATE guarantee_delays SET to_date = NULL WHERE approval_batch_id = ${batch.batchId}`);
      const sweep = await approval.processContentApprovalVerzug({ clinicId });
      expect(sweep).toEqual({ created: 0, closed: 1 });

      // Pull-back of a waiting post removes its open approval.
      const thirdId = await insertItem("d9n4p", "Dritter Beitrag", false, "Hautpflege im Herbst. KI-generiert");
      await approval.runHwgCheckForItem(admin, { clinicId, id: thirdId });
      await approval.setNoBeforeAfterConfirmation(admin, { clinicId, id: thirdId, confirmed: true });
      await approval.createApprovalBatch(admin, clinicId, [thirdId]);
      const { moveContentStatus } = await import("./content");
      await moveContentStatus(admin, { clinicId, id: thirdId, to: "entwurf" });
      expect(await statusOf(thirdId)).toBe("entwurf");
      const open = (await db.execute(sql`SELECT count(*)::int AS n FROM content_approvals
        WHERE content_item_id = ${thirdId} AND decision IS NULL`)) as unknown as Array<{ n: number }>;
      expect(open[0]!.n).toBe(0);
    } finally {
      await eraseClinicData(clinicId, { email: admin.email, slug, displayName: "Freigabe Test" });
      await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${clinicId}`);
    }
  }, 60_000);
});
