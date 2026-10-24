/**
 * Retention rules (L-4) against a REAL local Postgres. Seeds three throwaway
 * Praxen, runs the sweep restricted to them (onlyClinicIds), checks every
 * rule, runs it again (idempotent: nothing changes) and removes everything it
 * created. A global dry-run count runs first and changes nothing.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   RETENTION_DB_TEST=1 npx vitest run src/worker/processors/purge-retention.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.RETENTION_DB_TEST === "1";

describe.skipIf(!enabled)("processPurgeRetention (local DB)", () => {
  it("applies every rule to seeded rows only, twice without change", async () => {
    for (const k of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "OPS_ALERT_EMAIL"]) {
      delete process.env[k];
    }
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { processPurgeRetention } = await import("./purge-retention");
    const { eraseClinicData } = await import("@/server/dsgvo");

    // 0. Global dry run: counts only.
    const dry = await processPurgeRetention({ dryRun: true });
    console.log("[retention test] global dry run", JSON.stringify(dry));
    expect(dry.dryRun).toBe(true);

    const active = randomUUID();
    const archivedNoExport = randomUUID();
    const archivedExported = randomUUID();
    const ids = [active, archivedNoExport, archivedExported];
    const mk = async (id: string, archivedDaysAgo: number | null) => {
      const slug = `ret-test-${id.slice(0, 8)}`;
      await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug, archived_at)
        VALUES (${id}, 'Ret Test', 'Ret Test', ${slug},
          ${archivedDaysAgo === null ? null : sql`now() - (${archivedDaysAgo}::int * interval '1 day')`})`);
      return slug;
    };
    const activeSlug = await mk(active, null);
    const noExportSlug = await mk(archivedNoExport, 100);
    await mk(archivedExported, 100);
    await db.execute(sql`INSERT INTO audit_log (clinic_id, actor_email, action, entity_kind, entity_id, diff, created_at)
      VALUES (${archivedExported}, 'admin@example.test', 'export', 'dsgvo_export', ${archivedExported},
        '{"status":"complete","rows":1}'::jsonb, now() - interval '50 days')`);
    // An export BEFORE archiving does not count.
    await db.execute(sql`INSERT INTO audit_log (clinic_id, actor_email, action, entity_kind, entity_id, diff, created_at)
      VALUES (${archivedNoExport}, 'admin@example.test', 'export', 'dsgvo_export', ${archivedNoExport},
        '{"status":"complete","rows":1}'::jsonb, now() - interval '200 days')`);

    // V1 REFUTED: the landing page stores the full page URL incl. click ids.
    const URL_WITH_CLICK = "https://praxis.example/botox?utm_source=ig&fbclid=f1&gclid=g1#form";
    const URL_STRIPPED = "https://praxis.example/botox?utm_source=ig#form";
    const req = async (
      fields: { status?: string; daysAgo: number; extra?: ReturnType<typeof sql> }
    ) => {
      const id = randomUUID();
      await db.execute(sql`INSERT INTO requests
        (id, clinic_id, source, status, created_at, contact_name, contact_email, contact_phone, message,
         raw_payload, ai_signals, ai_reasoning, dsgvo_consent_ip, utm,
         fbclid, gclid, fbc, fbp, click_user_agent, click_ip_anon)
        VALUES (${id}, ${active}, 'formular', ${fields.status ?? "neu"},
          now() - (${fields.daysAgo}::int * interval '1 day'),
          'Max Muster', 'max@example.test', '+49 171 0000000', 'Freitext',
          ${JSON.stringify({ contactName: "Max", attribution: { gclid: "g1" }, utm: { utm_source: "ig", fbclid: "f1" }, quiz: { fbc: "c", fbp: "p", notes: "n", sourceUrl: URL_WITH_CLICK } })}::jsonb,
          ${JSON.stringify({ quiz: { notes: "Notiz", fbc: "c", fbp: "p", branch: "qualified", treatmentSelection: "Botox", sourceUrl: URL_WITH_CLICK } })}::jsonb,
          'KI sagt', '10.0.0.0', ${JSON.stringify({ utm_source: "ig", fbclid: "f1" })}::jsonb,
          'f1', 'g1', 'c', 'p', 'UA', '10.0.0.0')`);
      await db.execute(sql`INSERT INTO request_activities (request_id, kind, body)
        VALUES (${id}, 'note', 'Patientin heißt Max')`);
      return id;
    };

    try {
      const spamOld = await req({ status: "spam", daysAgo: 100 });
      const spamNew = await req({ status: "spam", daysAgo: 10 });
      const clickOld = await req({ status: "kontaktiert", daysAgo: 100 });
      const clickNew = await req({ status: "neu", daysAgo: 30 });
      const unbooked = await req({ status: "verloren", daysAgo: 800 });
      await db.execute(sql`INSERT INTO request_followups (clinic_id, request_id, due_at, note)
        VALUES (${active}, ${unbooked}, now() - interval '700 days', 'Rückruf Max')`);
      const bookedThenLost = await req({ status: "verloren", daysAgo: 800 });
      await db.execute(sql`INSERT INTO request_activities (request_id, kind, meta)
        VALUES (${bookedThenLost}, 'status_change', '{"from":"kontaktiert","to":"termin_vereinbart"}'::jsonb)`);
      const won = await req({ status: "gewonnen", daysAgo: 800 });
      // Click id only inside the stored page URL (no column, no utm key).
      const urlOnly = await req({ status: "kontaktiert", daysAgo: 100 });
      await db.execute(sql`UPDATE requests SET fbclid = NULL, gclid = NULL, fbc = NULL, fbp = NULL,
          click_user_agent = NULL, click_ip_anon = NULL, utm = NULL,
          raw_payload = '{"quiz":{"sourceUrl":"https://praxis.example/?ttclid=t1"}}'::jsonb,
          ai_signals = '{"quiz":{"sourceUrl":"https://praxis.example/?TTCLID=t1"}}'::jsonb
        WHERE id = ${urlOnly}`);
      // V1 Neben: free text in treatment_wish / budget_indication goes at
      // 24 months, a catalogue name and a fixed quiz category stay.
      await db.execute(sql`INSERT INTO treatments (clinic_id, name, slug)
        VALUES (${active}, 'Botox', ${`botox-${active.slice(0, 8)}`})`);
      await db.execute(sql`UPDATE requests SET treatment_wish = 'Brigitte Meier möchte Lippen',
          budget_indication = 'bis 5000 bar' WHERE id = ${unbooked}`);
      const unbookedCategory = await req({ status: "verloren", daysAgo: 800 });
      await db.execute(sql`UPDATE requests SET treatment_wish = ' botox',
          budget_indication = 'Investitionsrahmen passt' WHERE id = ${unbookedCategory}`);

      // Dry run restricted to the seed: counts, no change.
      const seedDry = await processPurgeRetention({ dryRun: true, onlyClinicIds: ids });
      expect(seedDry).toMatchObject({
        spamDeleted: 1,
        // spamOld, clickOld, unbooked, bookedThenLost, won, urlOnly,
        // unbookedCategory (older than 90 days); the real run deletes
        // spamOld first, so it clears 6.
        clickIdsCleared: 7,
        requestsAnonymised: 2,
        archivedClinicsErased: 1,
        archivedClinicsBlocked: 1,
      });
      const [stillThere] = (await db.execute(
        sql`SELECT count(*)::int AS n FROM requests WHERE id = ${spamOld}`
      )) as unknown as Array<{ n: number }>;
      expect(stillThere!.n).toBe(1);

      const first = await processPurgeRetention({ onlyClinicIds: ids });
      expect(first).toMatchObject({
        dryRun: false,
        spamDeleted: 1,
        clickIdsCleared: 6,
        requestsAnonymised: 2,
        archivedClinicsErased: 1,
        archivedClinicsBlocked: 1,
        incomplete: false,
      });

      const row = async (id: string) =>
        ((await db.execute(sql`SELECT * FROM requests WHERE id = ${id}`)) as unknown as Array<
          Record<string, unknown>
        >)[0];

      expect(await row(spamOld)).toBeUndefined();
      expect(await row(spamNew)).toBeDefined();
      const [spamActs] = (await db.execute(
        sql`SELECT count(*)::int AS n FROM request_activities WHERE request_id = ${spamOld}`
      )) as unknown as Array<{ n: number }>;
      expect(spamActs!.n).toBe(0);

      const c = (await row(clickOld))!;
      expect([c.fbclid, c.gclid, c.fbc, c.fbp, c.click_user_agent, c.click_ip_anon]).toEqual([
        null, null, null, null, null, null,
      ]);
      expect(c.utm).toEqual({ utm_source: "ig" });
      expect(c.raw_payload).toEqual({
        contactName: "Max",
        utm: { utm_source: "ig" },
        quiz: { notes: "n", sourceUrl: URL_STRIPPED },
      });
      expect((c.ai_signals as { quiz: Record<string, unknown> }).quiz.fbc).toBeUndefined();
      expect((c.ai_signals as { quiz: Record<string, unknown> }).quiz.sourceUrl).toBe(URL_STRIPPED);
      const n = (await row(clickNew))!;
      expect((n.ai_signals as { quiz: Record<string, unknown> }).quiz.sourceUrl).toBe(URL_WITH_CLICK);
      const uo = (await row(urlOnly))!;
      expect(uo.raw_payload).toEqual({ quiz: { sourceUrl: "https://praxis.example/" } });
      expect(uo.ai_signals).toEqual({ quiz: { sourceUrl: "https://praxis.example/" } });
      expect(c.contact_name).toBe("Max Muster"); // only click ids at 90 days
      expect((await row(clickNew))!.gclid).toBe("g1");

      const u = (await row(unbooked))!;
      expect([u.contact_name, u.contact_email, u.contact_phone, u.message, u.raw_payload, u.ai_reasoning, u.dsgvo_consent_ip]).toEqual([
        null, null, null, null, null, null, null,
      ]);
      expect(u.status).toBe("verloren");
      expect((u.ai_signals as { quiz: Record<string, unknown> }).quiz).toEqual({
        branch: "qualified",
        treatmentSelection: "Botox",
        sourceUrl: URL_STRIPPED,
      });
      expect([u.treatment_wish, u.budget_indication]).toEqual([null, null]);
      const uc = (await row(unbookedCategory))!;
      expect([uc.contact_name, uc.treatment_wish, uc.budget_indication]).toEqual([
        null, " botox", "Investitionsrahmen passt",
      ]);
      const [uAct] = (await db.execute(
        sql`SELECT body FROM request_activities WHERE request_id = ${unbooked}`
      )) as unknown as Array<{ body: string | null }>;
      expect(uAct!.body).toBeNull();
      const [uFup] = (await db.execute(
        sql`SELECT note FROM request_followups WHERE request_id = ${unbooked}`
      )) as unknown as Array<{ note: string | null }>;
      expect(uFup!.note).toBeNull();

      expect((await row(bookedThenLost))!.contact_name).toBe("Max Muster");
      expect((await row(won))!.contact_name).toBe("Max Muster");

      const clinicsLeft = (await db.execute(
        sql`SELECT id FROM clinics WHERE id IN (${archivedNoExport}, ${archivedExported})`
      )) as unknown as Array<{ id: string }>;
      expect(clinicsLeft.map((r) => r.id)).toEqual([archivedNoExport]);

      // Second run: nothing left to do.
      const second = await processPurgeRetention({ onlyClinicIds: ids });
      expect(second).toMatchObject({
        spamDeleted: 0,
        clickIdsCleared: 0,
        requestsAnonymised: 0,
        archivedClinicsErased: 0,
        archivedClinicsBlocked: 1,
      });
    } finally {
      for (const [id, slug] of [
        [active, activeSlug],
        [archivedNoExport, noExportSlug],
      ] as const) {
        const [exists] = (await db.execute(
          sql`SELECT 1 AS x FROM clinics WHERE id = ${id}`
        )) as unknown as unknown[];
        if (exists) await eraseClinicData(id, { email: "test@example.test", slug, displayName: "Ret Test" });
      }
      for (const id of ids) {
        await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${id}`);
        await db.execute(
          sql`DELETE FROM ops_alert_log WHERE scope_key LIKE ${`${id}:%`}`
        );
      }
    }
  }, 120_000);
});
