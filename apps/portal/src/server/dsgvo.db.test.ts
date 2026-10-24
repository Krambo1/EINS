/**
 * Integration test against a REAL local Postgres (G-03/G-04): builds a
 * throwaway Praxis with rows in every table whose FK to clinic_users has no
 * ON DELETE (feedback, Fragebogen, Checkliste, client_uploads, followups),
 * plus files in local storage, erases it and checks nothing is left.
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL:
 *   DSGVO_DB_TEST=1 npx vitest run src/server/dsgvo.db.test.ts
 */
import { describe, expect, it } from "vitest";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const enabled = process.env.DSGVO_DB_TEST === "1";

describe.skipIf(!enabled)("eraseClinicData (local DB)", () => {
  it("deletes every clinic row, file and keeps an anonymised audit trail", async () => {
    // Local storage driver for the test, never R2.
    for (const k of ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
      delete process.env[k];
    }
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const { eraseClinicData, exportClinicDataChunks } = await import("./dsgvo");

    const clinicId = randomUUID();
    const userId = randomUUID();
    const requestId = randomUUID();
    const slug = `dsgvo-test-${clinicId.slice(0, 8)}`;
    const keys = [
      `${clinicId}/checkliste/a.jpg`,
      `${clinicId}/uploads/b.pdf`,
      `${clinicId}/assets/c.mp4`,
      `avatars/${userId}.webp`,
    ];
    const root = path.resolve(process.cwd(), "storage");
    for (const k of keys) {
      await mkdir(path.dirname(path.join(root, k)), { recursive: true });
      await writeFile(path.join(root, k), "x");
    }
    // Aborted presigned upload: object without any DB row (L-12 / J-5).
    const orphan = `${clinicId}/uploads/orphan-${randomUUID()}.jpg`;
    await mkdir(path.dirname(path.join(root, orphan)), { recursive: true });
    await writeFile(path.join(root, orphan), "x");

    await db.execute(sql`INSERT INTO clinics (id, legal_name, display_name, slug)
      VALUES (${clinicId}, 'DSGVO Test', 'DSGVO Test', ${slug})`);
    await db.execute(sql`INSERT INTO clinic_users (id, clinic_id, email, role, avatar_key)
      VALUES (${userId}, ${clinicId}, ${`${slug}@example.test`}, 'inhaber', ${keys[3]!})`);
    await db.execute(sql`INSERT INTO magic_links (email, token_hash, user_id, intent, expires_at)
      VALUES (${`${slug}@example.test`}, ${`h-${clinicId}`}, ${userId}, 'login', now() + interval '1 hour')`);
    await db.execute(sql`INSERT INTO requests (id, clinic_id, source, assigned_to)
      VALUES (${requestId}, ${clinicId}, 'website', ${userId})`);
    await db.execute(sql`INSERT INTO request_activities (request_id, actor_id, kind)
      VALUES (${requestId}, ${userId}, 'note')`);
    await db.execute(sql`INSERT INTO request_followups (clinic_id, request_id, due_at, created_by)
      VALUES (${clinicId}, ${requestId}, now(), ${userId})`);
    await db.execute(sql`INSERT INTO feedback (clinic_id, submitted_by, category, message)
      VALUES (${clinicId}, ${userId}, 'lob', 'gut')`);
    await db.execute(sql`INSERT INTO discovery_fragebogen (clinic_id, submitted_by, updated_by)
      VALUES (${clinicId}, ${userId}, ${userId})`);
    await db.execute(sql`INSERT INTO checklist_items (clinic_id, item_id, delivered_by, updated_by)
      VALUES (${clinicId}, 'k1', ${userId}, ${userId})`);
    await db.execute(sql`INSERT INTO checklist_files (clinic_id, item_id, storage_key, original_filename, size_bytes, uploaded_by)
      VALUES (${clinicId}, 'k1', ${keys[0]!}, 'a.jpg', 1, ${userId})`);
    await db.execute(sql`INSERT INTO client_uploads (clinic_id, storage_key, original_filename, size_bytes, uploaded_by)
      VALUES (${clinicId}, ${keys[1]!}, 'b.pdf', 1, ${userId})`);
    await db.execute(sql`INSERT INTO assets (clinic_id, kind, title, storage_key)
      VALUES (${clinicId}, 'video', 'c', ${keys[2]!})`);
    await db.execute(sql`INSERT INTO audit_log (clinic_id, actor_id, actor_email, action, ip_address, diff)
      VALUES (${clinicId}, ${userId}, ${`${slug}@example.test`}, 'login', '10.0.0.1', '{"x":1}'::jsonb)`);

    // Export runs over every table and contains the fixtures.
    const tables = new Set<string>();
    for await (const chunk of exportClinicDataChunks(clinicId)) tables.add(chunk.table);
    expect(tables).toContain("feedback");
    expect(tables).toContain("client_uploads");
    expect(tables).toContain("checklist_files");
    expect(tables).toContain("request_followups");

    const result = await eraseClinicData(clinicId, {
      email: "admin@example.test",
      slug,
      displayName: "DSGVO Test",
    });
    expect(result.storageKeys).toBe(4);
    expect(result.storageFailed).toEqual([]);
    expect(result.prefixRemoved).toBe(1); // the orphan; known keys were already gone
    expect(result.prefixFailed).toBe(0);
    await expect(access(path.join(root, orphan))).rejects.toBeTruthy();

    // No row with this clinic_id survives anywhere except the audit log.
    const left = (await db.execute(sql`
      SELECT c.relname AS t FROM pg_class c
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'clinic_id'
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p')
        AND NOT c.relispartition AND c.relname <> 'audit_log'
    `)) as unknown as Array<{ t: string }>;
    for (const { t } of left) {
      const [row] = (await db.execute(
        sql.raw(`SELECT count(*)::int AS n FROM "${t}" WHERE clinic_id = '${clinicId}'`)
      )) as unknown as Array<{ n: number }>;
      expect({ t, n: row!.n }).toEqual({ t, n: 0 });
    }
    const [ml] = (await db.execute(
      sql`SELECT count(*)::int AS n FROM magic_links WHERE email = ${`${slug}@example.test`}`
    )) as unknown as Array<{ n: number }>;
    expect(ml!.n).toBe(0);

    const audit = (await db.execute(sql`
      SELECT action, entity_kind, actor_email, ip_address, diff FROM audit_log
      WHERE clinic_id = ${clinicId} ORDER BY created_at
    `)) as unknown as Array<Record<string, unknown>>;
    const login = audit.find((a) => a.action === "login")!;
    expect(login.actor_email).toBeNull();
    expect(login.ip_address).toBeNull();
    expect(login.diff).toBeNull();
    expect(audit.some((a) => a.entity_kind === "dsgvo_erasure" && a.action === "delete")).toBe(true);
    expect(audit.some((a) => a.action === "dsgvo_storage_removed")).toBe(true);

    for (const k of keys) {
      await expect(access(path.join(root, k))).rejects.toBeTruthy();
    }

    // Clean the anonymised audit rows of the throwaway clinic.
    await db.execute(sql`DELETE FROM audit_log WHERE clinic_id = ${clinicId}`);
  }, 60_000);
});
