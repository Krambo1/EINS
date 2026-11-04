/**
 * Renews the demo Praxis's activity ("Praxis Dr. Demo", slug `_template`) so
 * its dashboard shows the last 30 days and the longer periods again. The live
 * demo was seeded once (2026-06-01) and its data only aged since; the portal
 * looked empty because nothing fell inside "30 Tage" any more.
 *
 * Used by the worker's monthly `demo-refresh` job and by
 * `scripts/refresh-demo-data.ts` for a run by hand.
 *
 * Prod-safe, unlike src/db/seed.ts:
 * - Touches the one demo Praxis only (fixed id AND slug `_template`), never
 *   another Praxis, never a TRUNCATE.
 * - Keeps its logins (clinic_users and their sessions), treatments,
 *   locations, documents, ad accounts and settings. Only the activity is
 *   replaced: Anfragen with their patients, KPI rollups, campaign snapshots,
 *   Bewertungen, Ziele, Fortschritt, posts with their Freigaben, feedback,
 *   alerts and notifications (demo-data.ts, the same rows the local seed
 *   writes).
 * - Plans no review e-mails (the worker would send them to made-up
 *   addresses).
 * - One transaction: it either renews everything or changes nothing.
 */
import type postgres from "postgres";
import { insertDemoActivity, type DemoActivityResult } from "./demo-data";

// The demo Praxis's fixed id (seed.ts → DEMO_CLINIC_ID).
const DEMO_CLINIC_ID = "c7d88b71-72da-4920-b939-5158b13d3449";
const DEMO_SLUG = "_template";

/**
 * The demo's activity, children before parents. Deleting a request takes
 * its activities, follow-ups and review rows along (ON DELETE CASCADE);
 * deleting a post takes its links, publications and Freigaben.
 */
const ACTIVITY_TABLES = [
  "content_items",
  "content_approval_batches",
  "hwg_checks",
  "requests",
  "review_email_schedule",
  "patients",
  "kpi_daily",
  "campaign_snapshots",
  "reviews",
  "goals",
  "clinic_timeline_entries",
  "notifications",
  "dashboard_alerts",
  "feedback",
] as const;

export interface DemoRefreshResult extends DemoActivityResult {
  /** Rows removed per table, for the log ("requests 80, ..."). */
  removed: string;
}

/**
 * Replaces the demo Praxis's activity. Throws when the demo Praxis is missing
 * or incomplete; the database is then unchanged.
 */
export async function refreshDemoPraxis(sql: postgres.Sql): Promise<DemoRefreshResult> {
  const [clinic] = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM clinics WHERE id = ${DEMO_CLINIC_ID}
  `;
  if (!clinic || clinic.slug !== DEMO_SLUG) {
    throw new Error(`no demo Praxis with id ${DEMO_CLINIC_ID} and slug ${DEMO_SLUG}`);
  }

  const users = await sql<{ id: string; role: string }[]>`
    SELECT id, role FROM clinic_users
    WHERE clinic_id = ${DEMO_CLINIC_ID}
    ORDER BY created_at
  `;
  const byRole = (role: string) => users.find((u) => u.role === role)?.id;
  const inhaberId = byRole("inhaber") ?? users[0]?.id;
  if (!inhaberId) throw new Error("the demo Praxis has no users");

  const treatments = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM treatments WHERE clinic_id = ${DEMO_CLINIC_ID}
  `;
  const locations = await sql<{ id: string; is_primary: boolean }[]>`
    SELECT id, is_primary FROM locations
    WHERE clinic_id = ${DEMO_CLINIC_ID}
    ORDER BY is_primary DESC, display_order
  `;
  const primaryLocationId = locations[0]?.id;
  if (!primaryLocationId) throw new Error("the demo Praxis has no Standort");

  return sql.begin(async (tx) => {
    const removed: string[] = [];
    for (const table of ACTIVITY_TABLES) {
      const rows = await tx`DELETE FROM ${tx(table)} WHERE clinic_id = ${DEMO_CLINIC_ID}`;
      removed.push(`${table} ${rows.count}`);
    }
    // TransactionSql has every query method insertDemoActivity uses.
    const result = await insertDemoActivity(tx as unknown as postgres.Sql, {
      clinicId: DEMO_CLINIC_ID,
      inhaberId,
      marketingId: byRole("marketing") ?? inhaberId,
      frontdeskId: byRole("frontdesk") ?? inhaberId,
      treatmentIdBySlug: Object.fromEntries(treatments.map((t) => [t.slug, t.id])),
      primaryLocationId,
      secondaryLocationId: locations[1]?.id ?? primaryLocationId,
      reviewSchedule: false,
    });
    return { ...result, removed: removed.join(", ") };
  }) as Promise<DemoRefreshResult>;
}
