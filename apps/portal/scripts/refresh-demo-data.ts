/**
 * Renews the demo Praxis's activity by hand. The worker does this every month
 * (`demo-refresh`); what it touches and keeps: src/db/refresh-demo.ts.
 *
 * Any database other than localhost needs DEMO_REFRESH_ALLOW_PROD=1.
 *
 * Usage (live, DATABASE_URL from the eins-portal production env):
 *   DEMO_REFRESH_ALLOW_PROD=1 pnpm --filter portal exec tsx scripts/refresh-demo-data.ts
 * Local: pnpm --filter portal exec tsx scripts/refresh-demo-data.ts
 */
import "../src/lib/load-env";
import postgres from "postgres";
import { refreshDemoPraxis } from "../src/db/refresh-demo";

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
    console.log(`→ renewing the demo Praxis's activity on ${host} ...`);
    const result = await refreshDemoPraxis(sql);
    console.log(`  removed: ${result.removed}`);
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
