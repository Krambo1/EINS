/**
 * "Anfrage anlegen" (Empfang) against a REAL local Postgres: the entry is
 * stored as source 'manuell' with confidence 'praxis_eingabe' and the
 * self-report, the same person within 30 days becomes an activity on the
 * existing Anfrage instead of a second one, a treatment of another Praxis is
 * refused, and the Garantie-Uhr never proposes the entry as a trigger.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   MANUAL_ENTRY_DB_TEST=1 npx vitest run --pool=forks src/server/manual-entry.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.MANUAL_ENTRY_DB_TEST === "1";

describe.skipIf(!enabled)("createManualRequest (local DB)", () => {
  it("stores a Praxis-Eingabe, merges a repeat and never triggers the invoice", async () => {
    delete process.env.OPENAI_API_KEY;
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { createManualRequest, UnknownTreatmentError } = await import("./manual-entry");
    const { parseManualEntry, MANUAL_ENTRY_REPEAT_BODY } = await import("@/lib/manual-entry");
    const { eraseClinicData } = await import("./dsgvo");
    const { eligibleInquiries } = await import("@/lib/guarantee-clock");

    const clinicId = randomUUID();
    const otherClinicId = randomUUID();
    const slug = `manual-test-${clinicId.slice(0, 8)}`;
    const otherSlug = `manual-test-${otherClinicId.slice(0, 8)}`;
    const treatmentId = randomUUID();
    const foreignTreatmentId = randomUUID();
    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'Manual Test', 'Manual Test', ${slug}),
             (${otherClinicId}, 'Manual Other', 'Manual Other', ${otherSlug})`);
    await db.execute(sql`INSERT INTO treatments (id, clinic_id, name, slug)
      VALUES (${treatmentId}, ${clinicId}, 'Lidstraffung Test', 'lidstraffung-test'),
             (${foreignTreatmentId}, ${otherClinicId}, 'Fremd', 'fremd')`);
    try {
      const entry = (fields: Record<string, unknown>) => {
        const r = parseManualEntry(fields);
        if (!r.ok) throw new Error(r.message);
        return r.entry;
      };

      const first = await createManualRequest(
        clinicId,
        entry({
          contactName: "Anna Empfang",
          contactPhone: "+49 171 5556666",
          treatmentId,
          selfReportedSource: "anruf_praxis",
        })
      );
      expect(first.status).toBe("inserted");
      const [req] = (await db.execute(sql`
        SELECT source, attribution_confidence, self_reported_source, treatment_id, status, utm, consents
        FROM requests WHERE id = ${first.id}`)) as unknown as Array<Record<string, unknown>>;
      expect(req).toMatchObject({
        source: "manuell",
        attribution_confidence: "praxis_eingabe",
        self_reported_source: "anruf_praxis",
        treatment_id: treatmentId,
        status: "neu",
        utm: null,
        consents: null,
      });

      // Same person (same phone, other formatting) within 30 days.
      const again = await createManualRequest(
        clinicId,
        entry({
          contactName: "Anna E.",
          contactPhone: "0171 5556666",
          selfReportedSource: "empfehlung",
        })
      );
      expect(again).toEqual({ status: "same_contact", id: first.id });
      const [counts] = (await db.execute(sql`
        SELECT (SELECT count(*)::int FROM requests WHERE clinic_id = ${clinicId}) AS requests,
               (SELECT count(*)::int FROM request_activities
                 WHERE request_id = ${first.id} AND body = ${MANUAL_ENTRY_REPEAT_BODY}
                   AND meta->>'entry' = 'manuell') AS merged
      `)) as unknown as Array<{ requests: number; merged: number }>;
      expect(counts).toEqual({ requests: 1, merged: 1 });

      // A treatment id of another Praxis is refused, nothing is written.
      await expect(
        createManualRequest(
          clinicId,
          entry({
            contactName: "Ben",
            contactEmail: `ben-${clinicId.slice(0, 8)}@example.test`,
            treatmentId: foreignTreatmentId,
            selfReportedSource: "instagram",
          })
        )
      ).rejects.toBeInstanceOf(UnknownTreatmentError);

      // A second person, e-mail only, self-report Instagram: still a Praxis-Eingabe.
      const second = await createManualRequest(
        clinicId,
        entry({
          contactName: "Clara",
          contactEmail: `clara-${clinicId.slice(0, 8)}@example.test`,
          selfReportedSource: "instagram",
        })
      );
      expect(second.status).toBe("inserted");

      const rows = (await db.execute(sql`
        SELECT id, created_at, source, utm, contact_email, contact_phone, status, attribution_confidence
        FROM requests WHERE clinic_id = ${clinicId}`)) as unknown as Array<Record<string, unknown>>;
      expect(rows.map((r) => r.attribution_confidence)).toEqual(["praxis_eingabe", "praxis_eingabe"]);
      // Berlin calendar day (the Garantie-Uhr's day), not UTC: around midnight they differ.
      const today = (await import("@/lib/guarantee-clock")).berlinDate(new Date());
      const eligible = eligibleInquiries(
        rows.map((r) => ({
          id: String(r.id),
          createdAt: new Date(String(r.created_at)),
          source: String(r.source),
          utm: r.utm,
          contactEmail: r.contact_email as string | null,
          contactPhone: r.contact_phone as string | null,
          status: String(r.status),
        })),
        { signedOn: "2026-01-01", deadline: today, rejectedIds: new Set() }
      );
      expect(eligible).toEqual([]);
    } finally {
      for (const [id, s, name] of [
        [clinicId, slug, "Manual Test"],
        [otherClinicId, otherSlug, "Manual Other"],
      ] as const) {
        await eraseClinicData(id, { email: "manual@example.test", slug: s, displayName: name });
        await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${id}`);
      }
    }
  }, 60_000);
});
