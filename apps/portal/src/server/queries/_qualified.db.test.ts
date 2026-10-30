/**
 * Kosten pro qualifizierter Anfrage against a REAL local Postgres, everything
 * inside one transaction that is rolled back at the end (no rows stay). Opt-in
 * (the vitest setup overrides DATABASE_URL, so export it from .env.local first):
 *   QUALIFIED_DB_TEST=1 DATABASE_URL=... npx vitest run --pool=forks src/server/queries/_qualified.db.test.ts
 */
import { describe, expect, it } from "vitest";

const enabled = process.env.QUALIFIED_DB_TEST === "1";

class Rollback extends Error {}

describe.skipIf(!enabled)("qualified ad Anfragen (local DB, rolled back)", () => {
  it("counts only Messweg Anfragen with phone or e-mail, never spam", async () => {
    const { db, schema } = await import("@/db/client");
    const { adInquiriesByDay } = await import("./_ad-inquiries");
    const { costPerQualified } = await import("./_qualified");

    const [clinic] = await db.select({ id: schema.clinics.id }).from(schema.clinics).limit(1);
    expect(clinic, "local DB needs one clinic").toBeTruthy();

    // A slot ten days ahead: no real Anfrage sits there, so the counts are exact.
    const at = new Date(Date.now() + 10 * 86_400_000);
    const start = new Date(at.getTime() - 3_600_000);
    const end = new Date(at.getTime() + 3_600_000);
    const metaAd = { utm_source: "facebook", utm_medium: "paid" };
    const googleAd = { utm_source: "google", utm_medium: "cpc" };

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.requests).values([
          // Zielseite via Meta ad, phone: qualified.
          { clinicId: clinic!.id, source: "formular", utm: metaAd, contactPhone: "+49 211 000000", createdAt: at },
          // Zielseite via Meta ad, e-mail only: qualified.
          { clinicId: clinic!.id, source: " Formular ", utm: metaAd, contactEmail: "a@example.com", createdAt: at },
          // Zielseite via Meta ad, no contact data: an Anfrage, not qualified.
          { clinicId: clinic!.id, source: "formular", utm: metaAd, contactPhone: "  ", createdAt: at },
          // Meta instant form: an ad Anfrage, but no EINS-Messweg.
          { clinicId: clinic!.id, source: "meta_lead_form", contactEmail: "b@example.com", createdAt: at },
          // Google ad, spam: not counted at all.
          {
            clinicId: clinic!.id,
            source: "formular",
            utm: googleAd,
            contactEmail: "c@example.com",
            status: "spam",
            createdAt: at,
          },
          // Organic post: no ad, never in the ad counts.
          {
            clinicId: clinic!.id,
            source: "formular",
            utm: { utm_source: "instagram", utm_medium: "social" },
            contactPhone: "+49 211 111111",
            createdAt: at,
          },
        ]);

        const days = await adInquiriesByDay(
          tx as unknown as Parameters<typeof adInquiriesByDay>[0],
          clinic!.id,
          start,
          end
        );
        const meta = days.filter((d) => d.platform === "meta");
        expect(meta.reduce((s, d) => s + d.inquiries, 0)).toBe(4);
        expect(meta.reduce((s, d) => s + d.qualified, 0)).toBe(2);
        expect(days.filter((d) => d.platform === "google")).toEqual([]);

        expect(costPerQualified(300, 2)).toBe(150);
        expect(costPerQualified(300, 0)).toBeNull();
        expect(costPerQualified(0, 2)).toBeNull();

        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
  }, 60_000);

  it("counts a campaign's Anfragen and cost the same way", async () => {
    const { db, schema } = await import("@/db/client");
    const { and, eq } = await import("drizzle-orm");
    const { berlinDay } = await import("@/lib/dashboard-range");
    const { campaignsForPeriodTx } = await import("./campaigns");

    const [clinic] = await db.select({ id: schema.clinics.id }).from(schema.clinics).limit(1);
    expect(clinic, "local DB needs one clinic").toBeTruthy();

    // A campaign id no real Anfrage carries, an hour ago (inside "last 7 days").
    const campaignId = `qualified-test-${Date.now()}`;
    const at = new Date(Date.now() - 3_600_000);
    const today = berlinDay();

    await expect(
      db.transaction(async (tx) => {
        // One snapshot per (clinic, day, platform): clear today's csv row first.
        await tx
          .delete(schema.campaignSnapshots)
          .where(
            and(
              eq(schema.campaignSnapshots.clinicId, clinic!.id),
              eq(schema.campaignSnapshots.platform, "csv"),
              eq(schema.campaignSnapshots.snapshotDate, today)
            )
          );
        // A Werbebudget large enough to land in the top 20 rows.
        await tx.insert(schema.campaignSnapshots).values({
          clinicId: clinic!.id,
          snapshotDate: today,
          platform: "csv",
          spendEur: "90000.00",
          rawPayload: { campaign_id: campaignId, campaign_name: "Testkampagne" },
        });
        const base = { clinicId: clinic!.id, sourceCampaignId: campaignId, createdAt: at };
        await tx.insert(schema.requests).values([
          { ...base, source: "formular", contactPhone: "+49 211 000000" },
          { ...base, source: "formular", contactEmail: "a@example.com" },
          { ...base, source: "formular", contactPhone: "  " },
          { ...base, source: "meta_lead_form", contactEmail: "b@example.com" },
          { ...base, source: "formular", contactEmail: "c@example.com", status: "spam" },
        ]);

        const rows = await campaignsForPeriodTx(
          tx as unknown as Parameters<typeof campaignsForPeriodTx>[0],
          clinic!.id,
          7
        );
        const row = rows.find((r) => r.campaignId === campaignId);
        expect(row?.leads).toBe(2);
        expect(row?.cplEur).toBe(45000);

        throw new Rollback();
      })
    ).rejects.toBeInstanceOf(Rollback);
  }, 60_000);
});
