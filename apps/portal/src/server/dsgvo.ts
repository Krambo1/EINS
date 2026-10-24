import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { describeErrorForLog } from "@/lib/error-log";
import { getStorage } from "@/server/storage";

/**
 * DSGVO-Werkzeuge (Art. 15 Auskunft / Art. 17 Löschung).
 *
 * Both functions derive the table list from the live catalog (every table
 * with a `clinic_id` column), so a new clinic-scoped table is exported and
 * erased without anyone remembering to add it here (G-15/F-13). Tables that
 * hang off a clinic only indirectly (request_activities via requests,
 * sessions/magic_links via clinic_users) are handled explicitly.
 *
 * Beide Funktionen gehören in admin-gated Server-Actions / API-Routen.
 * `db` ist der Superuser-Client (kein RLS).
 */

/** Tables never exported: EINS-internal records the Praxis does not see
 *  (guarantee clock, Rückruf enforcement) and the audit log, which is
 *  exported separately below with the same filter. */
const EXPORT_SKIP = new Set([
  "audit_log",
  "guarantee_clocks",
  "guarantee_delays",
  "guarantee_candidate_rejections",
  "response_enforcement_events",
  "email_send_log",
]);

/** Column names whose values are secrets or unminimised copies, not personal
 *  data the Praxis asked for: OAuth tokens, password/token hashes, bearer
 *  tokens in review/reminder links, raw intake payloads. Exported as null. */
const REDACT_COLUMN = /(_enc$|_hash$|^token$|_token$|secret|raw_payload)/i;

/** All base tables (no partitions) in `public` that carry a clinic_id column. */
async function clinicScopedTables(): Promise<string[]> {
  const rows = (await db.execute(sql`
    SELECT c.relname AS name
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'clinic_id' AND NOT a.attisdropped
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND NOT c.relispartition
    ORDER BY c.relname
  `)) as unknown as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe_identifier:${name}`);
  return `"${name}"`;
}

function redactRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = REDACT_COLUMN.test(k) ? (v == null ? null : "[entfernt]") : v;
  }
  return out;
}

const EXPORT_CHUNK = 2000;

/**
 * Art. 15 export as a sequence of (table, rows) chunks so the caller can
 * stream it: peak memory is one chunk, not the whole Praxis (G-15).
 * Rows are fetched in primary-key order with LIMIT/OFFSET.
 */
export async function* exportClinicDataChunks(
  clinicId: string
): AsyncGenerator<{ table: string; rows: Record<string, unknown>[] }> {
  const [clinic] = await db
    .select()
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) throw new Error("clinic_not_found");
  yield { table: "clinics", rows: [redactRow(clinic as unknown as Record<string, unknown>)] };

  const tables = (await clinicScopedTables()).filter((t) => !EXPORT_SKIP.has(t));
  for (const table of tables) {
    for (let offset = 0; ; offset += EXPORT_CHUNK) {
      const rows = (await db.execute(
        sql.raw(
          `SELECT * FROM ${ident(table)} WHERE clinic_id = '${clinicId}' ` +
            `ORDER BY 1 LIMIT ${EXPORT_CHUNK} OFFSET ${offset}`
        )
      )) as unknown as Record<string, unknown>[];
      if (rows.length > 0) yield { table, rows: rows.map(redactRow) };
      if (rows.length < EXPORT_CHUNK) break;
    }
  }

  // Indirect: activity history of this clinic's requests.
  for (let offset = 0; ; offset += EXPORT_CHUNK) {
    const rows = (await db.execute(sql`
      SELECT ra.* FROM request_activities ra
      JOIN requests r ON r.id = ra.request_id
      WHERE r.clinic_id = ${clinicId}
      ORDER BY ra.created_at, ra.id
      LIMIT ${EXPORT_CHUNK} OFFSET ${offset}
    `)) as unknown as Record<string, unknown>[];
    if (rows.length > 0) yield { table: "request_activities", rows: rows.map(redactRow) };
    if (rows.length < EXPORT_CHUNK) break;
  }

  // The Praxis' own audit trail (what its users did), as before.
  for (let offset = 0; ; offset += EXPORT_CHUNK) {
    const rows = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.clinicId, clinicId))
      .orderBy(schema.auditLog.createdAt, schema.auditLog.id)
      .limit(EXPORT_CHUNK)
      .offset(offset);
    if (rows.length > 0) {
      yield {
        table: "audit_log",
        rows: rows.map((r) => redactRow(r as unknown as Record<string, unknown>)),
      };
    }
    if (rows.length < EXPORT_CHUNK) break;
  }
}

/** Every object key in storage that belongs to the clinic. */
export async function collectClinicStorageKeys(clinicId: string): Promise<string[]> {
  const [assets, documents, checklistFiles, clientUploads, animations, avatars, csvUploads] =
    await Promise.all([
      db
        .select({ k: schema.assets.storageKey })
        .from(schema.assets)
        .where(eq(schema.assets.clinicId, clinicId)),
      db
        .select({ k: schema.documents.storageKey })
        .from(schema.documents)
        .where(eq(schema.documents.clinicId, clinicId)),
      db
        .select({ k: schema.checklistFiles.storageKey })
        .from(schema.checklistFiles)
        .where(eq(schema.checklistFiles.clinicId, clinicId)),
      db
        .select({ k: schema.clientUploads.storageKey })
        .from(schema.clientUploads)
        .where(eq(schema.clientUploads.clinicId, clinicId)),
      db
        .select({ k: schema.animationInstances.storageKeyCustomized })
        .from(schema.animationInstances)
        .where(eq(schema.animationInstances.clinicId, clinicId)),
      db
        .select({ k: schema.clinicUsers.avatarKey })
        .from(schema.clinicUsers)
        .where(eq(schema.clinicUsers.clinicId, clinicId)),
      db
        .select({ k: schema.pvsCsvUploads.storageKey })
        .from(schema.pvsCsvUploads)
        .where(eq(schema.pvsCsvUploads.clinicId, clinicId)),
    ]);
  const keys = new Set<string>();
  for (const list of [assets, documents, checklistFiles, clientUploads, animations, avatars, csvUploads]) {
    for (const { k } of list) if (k) keys.add(k);
  }
  return [...keys];
}

export interface ErasureResult {
  storageKeys: number;
  storageFailed: string[];
  /** Objects removed by the folder sweep (aborted uploads, files without a DB row). */
  prefixRemoved: number;
  /** Objects the folder sweep could not delete, or -1 when a listing failed. */
  prefixFailed: number;
}

/**
 * Storage folders that only ever hold this clinic's objects. Swept after the
 * key-by-key delete so presigned uploads that never got a DB row (tab closed
 * before finalize) are gone as well (L-12 / J-5). Avatars live under
 * `avatars/<userId>` and are covered by `collectClinicStorageKeys`.
 */
export function clinicStoragePrefixes(clinicId: string): string[] {
  // klon/<clinicId>/: KI-Klon consent and opt-out documents (server/clone.ts).
  return [`${clinicId}/`, `pvs-csv-uploads/${clinicId}/`, `klon/${clinicId}/`];
}

/**
 * Hard delete all clinic-scoped data (Art. 17), then remove its files.
 *
 * DB part, one transaction:
 *  1. magic_links of the clinic's users (FK is SET NULL, the e-mail would
 *     survive otherwise).
 *  2. ONE statement that deletes every row with this clinic_id in every
 *     clinic-scoped table (data-modifying CTEs) plus the clinic row. FK
 *     checks without ON DELETE (feedback.submitted_by, checklist_*,
 *     client_uploads.uploaded_by, request_followups.created_by, …) run at the
 *     end of that statement, after all referencing rows are gone, so the
 *     order of tables no longer matters (G-03). Tables without an FK
 *     (pvs_event_log, email_send_log) are covered because the list comes from
 *     the catalog, not from FKs.
 *  3. Audit rows of the clinic keep action/entity/time as proof, but lose
 *     IP, user agent, diff and the e-mail of Praxis staff (G-16).
 *  4. The `dsgvo_erasure` audit row is inserted in the SAME transaction, so a
 *     rollback never leaves a "gelöscht" entry behind.
 *
 * Storage part, after commit: every collected key is removed. Failures do not
 * undo the erasure; they are returned and written to a second audit row.
 */
export async function eraseClinicData(
  clinicId: string,
  actor: { email: string; slug: string; displayName: string }
): Promise<ErasureResult> {
  const storageKeys = await collectClinicStorageKeys(clinicId);
  const tables = (await clinicScopedTables()).filter((t) => t !== "audit_log");
  // Queue rows reference requests by id only; collect them before the delete.
  const requestIds = (
    await db
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.clinicId, clinicId))
  ).map((r) => r.id);

  await db.transaction(async (tx) => {
    const users = await tx
      .select({ id: schema.clinicUsers.id, email: schema.clinicUsers.email })
      .from(schema.clinicUsers)
      .where(eq(schema.clinicUsers.clinicId, clinicId));
    const userIds = users.map((u) => u.id);
    const userEmails = users.map((u) => u.email.toLowerCase());

    if (userIds.length) {
      await tx.delete(schema.magicLinks).where(inArray(schema.magicLinks.userId, userIds));
    }

    const ctes = tables.map(
      (t, i) => `d${i} AS (DELETE FROM ${ident(t)} WHERE clinic_id = '${clinicId}')`
    );
    await tx.execute(
      sql.raw(
        `${ctes.length ? `WITH ${ctes.join(", ")} ` : ""}DELETE FROM clinics WHERE id = '${clinicId}'`
      )
    );

    await tx
      .update(schema.auditLog)
      .set({ ipAddress: null, userAgent: null, diff: null })
      .where(eq(schema.auditLog.clinicId, clinicId));
    if (userEmails.length) {
      await tx.execute(sql`
        UPDATE audit_log SET actor_email = NULL
        WHERE clinic_id = ${clinicId}
          AND actor_email IS NOT NULL
          AND lower(actor_email) = ANY(${sql.raw(
            `ARRAY[${userEmails.map((e) => `'${e.replace(/'/g, "''")}'`).join(",")}]::text[]`
          )})
      `);
    }

    await tx.insert(schema.auditLog).values({
      clinicId,
      actorEmail: actor.email,
      action: "delete",
      entityKind: "dsgvo_erasure",
      entityId: clinicId,
      diff: {
        slug: actor.slug,
        displayName: actor.displayName,
        users: userIds.length,
        tables: tables.length,
        storageKeys: storageKeys.length,
      },
    });
  });

  const storage = getStorage();
  const storageFailed: string[] = [];
  for (const key of storageKeys) {
    try {
      await storage.remove(key);
    } catch (err) {
      console.error(
        `[dsgvo] storage remove failed clinic=${clinicId}:`,
        JSON.stringify(describeErrorForLog(err))
      );
      storageFailed.push(key);
    }
  }

  // Folder sweep: everything else under the clinic's own prefixes.
  let prefixRemoved = 0;
  let prefixFailed = 0;
  for (const prefix of clinicStoragePrefixes(clinicId)) {
    try {
      const r = await storage.removePrefix(prefix);
      prefixRemoved += r.removed;
      prefixFailed += r.failed;
    } catch (err) {
      console.error(
        `[dsgvo] storage prefix sweep failed clinic=${clinicId}:`,
        JSON.stringify(describeErrorForLog(err))
      );
      prefixFailed = -1;
    }
  }

  // Pending pg-boss jobs carry only ids, but they should not outlive the
  // Praxis either. The pgboss schema exists only once a job was queued.
  let queueRowsRemoved = 0;
  try {
    const [reg] = (await db.execute(
      sql`SELECT to_regclass('pgboss.job') IS NOT NULL AS present`
    )) as unknown as Array<{ present: boolean }>;
    if (reg?.present) {
      const res = await db.execute(sql`
        DELETE FROM pgboss.job
        WHERE data->>'clinicId' = ${clinicId}
           OR (data->>'requestId') = ANY(${sql.raw(
             `ARRAY[${requestIds.map((id) => `'${id}'`).join(",")}]::text[]`
           )})
      `);
      queueRowsRemoved = (res as unknown as { count?: number }).count ?? 0;
    }
  } catch (err) {
    console.error(
      `[dsgvo] queue cleanup failed clinic=${clinicId}:`,
      JSON.stringify(describeErrorForLog(err))
    );
  }

  const incomplete = storageFailed.length > 0 || prefixFailed !== 0;
  await db.insert(schema.auditLog).values({
    clinicId,
    actorEmail: actor.email,
    action: incomplete ? "dsgvo_storage_incomplete" : "dsgvo_storage_removed",
    entityKind: "dsgvo_erasure",
    entityId: clinicId,
    diff: {
      removed: storageKeys.length - storageFailed.length,
      failedKeys: storageFailed,
      prefixRemoved,
      prefixFailed,
      queueRowsRemoved,
    },
  });

  return { storageKeys: storageKeys.length, storageFailed, prefixRemoved, prefixFailed };
}
