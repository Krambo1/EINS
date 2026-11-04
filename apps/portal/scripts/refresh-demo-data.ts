/**
 * Renews the demo Praxis's activity ("Praxis Dr. Demo", slug `_template`) so
 * its dashboard shows the last 30 days and the longer periods again. The live
 * demo was seeded once (2026-06-01) and its data only aged since; the portal
 * looked empty because nothing fell inside "30 Tage" any more.
 *
 * Prod-safe, unlike src/db/seed.ts:
 * - Touches the one demo Praxis only (fixed id AND slug `_template`), never
 *   another Praxis, never a TRUNCATE.
 * - Keeps its logins (clinic_users and their sessions), treatments,
 *   locations, documents, ad accounts and settings. Only the activity is
 *   replaced: Anfragen with their patients, KPI rollups, campaign snapshots,
 *   Bewertungen, Ziele, Fortschritt, posts with their Freigaben, feedback,
 *   alerts and notifications (src/db/demo-data.ts, the same rows the local
 *   seed writes).
 * - Plans no review e-mails (the worker would send them to made-up
 *   addresses).
 * - One transaction: it either renews everything or changes nothing.
 * - Any database other than localhost needs DEMO_REFRESH_ALLOW_PROD=1.
 *
 * Usage (live, DATABASE_URL from the eins-portal production env):
 *   DEMO_REFRESH_ALLOW_PROD=1 pnpm --filter portal exec tsx scripts/refresh-demo-data.ts
 * Local: pnpm --filter portal exec tsx scripts/refresh-demo-data.ts
 */
import "../src/lib/load-env";
import postgres from "postgres";
import { insertDemoActivity } from "../src/db/demo-data";

// The demo Praxis's fixed id (src/db/seed.ts → DEMO_CLINIC_ID).
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

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL is not set");
    process.exit(1);
  }
  const host = new URL(url).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && process.env.DEMO_REFRESH_ALLOW_PROD !== "1") {
    console.error(`✗ ${host} is not local. Set DEMO_REFRESH_ALLOW_PROD=1 to renew the live demo Praxis.`);
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => void 0 });
  try {
    const [clinic] = await sql<{ id: string; slug: string }[]>`
      SELECT id, slug FROM clinics WHERE id = ${DEMO_CLINIC_ID}
    `;
    if (!clinic || clinic.slug !== DEMO_SLUG) {
      console.error(`✗ no demo Praxis with id ${DEMO_CLINIC_ID} and slug ${DEMO_SLUG} on ${host}`);
      process.exit(1);
    }

    const users = await sql<{ id: string; role: string }[]>`
      SELECT id, role FROM clinic_users
      WHERE clinic_id = ${DEMO_CLINIC_ID}
      ORDER BY created_at
    `;
    const byRole = (role: string) => users.find((u) => u.role === role)?.id;
    const inhaberId = byRole("inhaber") ?? users[0]?.id;
    if (!inhaberId) {
      console.error("✗ the demo Praxis has no users; run the local seed or add-demo-login first");
      process.exit(1);
    }

    const treatments = await sql<{ id: string; slug: string }[]>`
      SELECT id, slug FROM treatments WHERE clinic_id = ${DEMO_CLINIC_ID}
    `;
    const locations = await sql<{ id: string; is_primary: boolean }[]>`
      SELECT id, is_primary FROM locations
      WHERE clinic_id = ${DEMO_CLINIC_ID}
      ORDER BY is_primary DESC, display_order
    `;
    const primaryLocationId = locations[0]?.id;
    if (!primaryLocationId) {
      console.error("✗ the demo Praxis has no Standort");
      process.exit(1);
    }

    console.log(`→ renewing the demo Praxis's activity on ${host} ...`);
    const result = await sql.begin(async (tx) => {
      const removed: string[] = [];
      for (const table of ACTIVITY_TABLES) {
        const rows = await tx`DELETE FROM ${tx(table)} WHERE clinic_id = ${DEMO_CLINIC_ID}`;
        removed.push(`${table} ${rows.count}`);
      }
      console.log(`  removed: ${removed.join(", ")}`);
      // TransactionSql has every query method insertDemoActivity uses.
      return insertDemoActivity(tx as unknown as postgres.Sql, {
        clinicId: DEMO_CLINIC_ID,
        inhaberId,
        marketingId: byRole("marketing") ?? inhaberId,
        frontdeskId: byRole("frontdesk") ?? inhaberId,
        treatmentIdBySlug: Object.fromEntries(treatments.map((t) => [t.slug, t.id])),
        primaryLocationId,
        secondaryLocationId: locations[1]?.id ?? primaryLocationId,
        reviewSchedule: false,
      });
    });

    console.log(`✓ demo Praxis renewed`);
    console.log(`  Anfragen: ${result.requestCount} (${result.newCount} neu, Schwerpunkt in den letzten 30 Tagen)`);
    console.log(`  KPI-Tage und Kampagnen: 365`);
    console.log(`  Beiträge: ${result.postCount}`);
    console.log(`  Logins, Behandlungen, Standorte, Dokumente und Werbekonten unverändert`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
