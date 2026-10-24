/**
 * K-5 + L-6 against a REAL local Postgres: persistLead stores the consent
 * record, scores the request inline (no worker), and a second scorer run
 * (the worker picking up the same job) changes nothing.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   LEADS_DB_TEST=1 npx vitest run src/server/leads.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.LEADS_DB_TEST === "1";

describe.skipIf(!enabled)("persistLead inline score + consents (local DB)", () => {
  it("scores once, stores consents, stays idempotent", async () => {
    delete process.env.OPENAI_API_KEY; // never call OpenAI from a test
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { persistLead, buildLandingConsents } = await import("./leads");
    const { processAiScore } = await import("@/worker/processors/ai-score");
    const { eraseClinicData } = await import("./dsgvo");

    const clinicId = randomUUID();
    const slug = `leads-test-${clinicId.slice(0, 8)}`;
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Leads Test', 'Leads Test', ${slug})`);
    try {
      const at = new Date(Date.now() - 60_000);
      const { id } = await persistLead(clinicId, {
        source: "formular",
        contactName: "Test",
        contactEmail: "test@example.test",
        dsgvoConsent: true,
        consentAt: at,
        consents: buildLandingConsents({
          at,
          privacyVersion: "2026-10-07",
          ageGate: true,
          aiGiven: false,
          marketingGiven: false,
        }),
        quiz: {
          treatmentSlug: "botox",
          treatmentSelection: "Botox",
          branch: "qualified",
          hasPhone: false,
          marketingConsent: false,
          eventId: randomUUID(),
        },
      });

      // Inline score runs fire-and-forget outside a request scope.
      let row: Record<string, unknown> | undefined;
      for (let i = 0; i < 50; i++) {
        [row] = (await db.execute(
          sql`SELECT ai_score, ai_prompt_version, consents, dsgvo_consent_at FROM requests WHERE id = ${id}`
        )) as unknown as Array<Record<string, unknown>>;
        if (row?.ai_score !== null) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(row!.ai_score).not.toBeNull();
      expect(row!.ai_prompt_version).toBe("rules-v2");
      expect((row!.consents as { basis: string; privacy: { version: string } }).basis).toBe("landing_form");
      expect((row!.consents as { privacy: { version: string } }).privacy.version).toBe("2026-10-07");
      expect(new Date(row!.dsgvo_consent_at as string).getTime()).toBe(at.getTime());

      await processAiScore({ requestId: id }); // worker runs the same job later
      const [acts] = (await db.execute(
        sql`SELECT count(*)::int AS n FROM request_activities WHERE request_id = ${id} AND kind = 'ai_rescore'`
      )) as unknown as Array<{ n: number }>;
      expect(acts!.n).toBe(1);
    } finally {
      await eraseClinicData(clinicId, { email: "test@example.test", slug, displayName: "Leads Test" });
      await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${clinicId}`);
    }
  }, 60_000);
});
