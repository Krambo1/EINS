import "../worker/shim-server-only";
import "../lib/load-env";
import { processAnomalyScan } from "../worker/processors/anomaly-scan";
import { db, schema } from "../db/client";
import { isNull } from "drizzle-orm";

/**
 * One-shot manual trigger for the anomaly-scan processor. Runs the full
 * sweep (every active praxis) in-process, then prints how many rows the
 * resulting upsert produced per clinic. Useful for verifying the widget
 * locally without waiting for the every-6h cron.
 *
 * Usage:
 *   pnpm tsx src/scripts/trigger-anomaly-scan.ts
 *   pnpm tsx src/scripts/trigger-anomaly-scan.ts <clinic-id>
 */

async function main() {
  const arg = process.argv[2];
  const started = Date.now();
  console.log(arg ? `[manual-scan] clinic=${arg}` : "[manual-scan] all clinics");

  await processAnomalyScan(arg ? { clinicId: arg } : {});

  const rows = await db
    .select({
      clinicId: schema.dashboardAlerts.clinicId,
      kind: schema.dashboardAlerts.kind,
      severity: schema.dashboardAlerts.severity,
      title: schema.dashboardAlerts.title,
    })
    .from(schema.dashboardAlerts)
    .where(isNull(schema.dashboardAlerts.dismissedAt));

  console.log(`[manual-scan] done in ${Date.now() - started}ms`);
  console.log(`[manual-scan] active alerts: ${rows.length}`);
  for (const r of rows) {
    console.log(`  · ${r.clinicId} [${r.severity}] ${r.kind}: ${r.title}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
