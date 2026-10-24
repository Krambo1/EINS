/**
 * Integration test against a REAL local Postgres (H-03, migration 0086):
 * sends a Verzug notice through the console e-mail driver, checks the stored
 * row and the guarantee_delays link, then erases the throwaway Praxis.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   NOTICES_DB_TEST=1 npx vitest run src/server/clinic-notices.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.NOTICES_DB_TEST === "1";

describe.skipIf(!enabled)("clinic notices (local DB)", () => {
  it("stores the sent text and links it to a Verzug", async () => {
    process.env.EMAIL_DRIVER = "console";
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { sendClinicNotice, listClinicNotices } = await import("./clinic-notices");
    const { verzugNoticeText } = await import("./email/templates/clinic-notice");
    const { eraseClinicData } = await import("./dsgvo");

    const clinicId = randomUUID();
    const slug = `notice-test-${clinicId.slice(0, 8)}`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug, default_doctor_email)
      VALUES (${clinicId}, 'Notice Test', 'Notice Test', ${slug}, ${`Praxis-${slug}@example.test`})`);
    await db.execute(sql`INSERT INTO clinic_users (clinic_id, email, role)
      VALUES (${clinicId}, ${`${slug}@example.test`}, 'inhaber')`);

    try {
      const text = verzugNoticeText({ reason: "Klon-Aufnahme", dueOn: "2026-10-01", fulfilledOn: null });
      expect(text.body).not.toContain("—");
      const notice = await sendClinicNotice({
        clinicId,
        kind: "verzug",
        subject: text.subject,
        body: text.body,
        createdBy: "admin@example.test",
      });
      expect(notice.sentAt).not.toBeNull();
      expect(notice.recipients.sort()).toEqual(
        [`${slug}@example.test`, `praxis-${slug}@example.test`].sort()
      );

      const [delay] = (await db.execute(sql`
        INSERT INTO guarantee_delays (clinic_id, kind, from_date, reason, notified_at, created_by)
        VALUES (${clinicId}, 'verzug', '2026-10-02', 'Klon-Aufnahme', ${notice.sentAt!.toISOString()}::timestamptz, 'admin@example.test')
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      await db.execute(sql`UPDATE guarantee_delays SET notice_id = ${notice.id} WHERE id = ${delay!.id}`);

      const list = await listClinicNotices(clinicId);
      expect(list).toHaveLength(1);
      expect(list[0]!.bodyText).toBe(text.body);
      expect(list[0]!.recipients).toHaveLength(2);
    } finally {
      await eraseClinicData(clinicId, { email: "admin@example.test", slug, displayName: "Notice Test" });
    }
    const left = (await db.execute(
      sql`SELECT count(*)::int AS n FROM clinic_notices WHERE clinic_id = ${clinicId}`
    )) as unknown as Array<{ n: number }>;
    expect(left[0]!.n).toBe(0);
  }, 60_000);
});
