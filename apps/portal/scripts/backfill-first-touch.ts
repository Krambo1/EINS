/**
 * backfill-first-touch: fills patients.first_touch_channel (migration 0097)
 * from the first-touch Anfrage, with the UTM rules in lib/sources.ts. The
 * migration itself already fills first_touch_content_code; the channel needs
 * the TypeScript rules, so it runs here.
 *
 * Idempotent: only touches patients whose first_touch_channel is NULL and
 * whose first-touch source is an Anfrage (not "pvs"). Dry run by default.
 *
 * Usage: pnpm --filter portal backfill:first-touch [--apply]
 */

// MUST be first: neutralizes the `server-only` throw under plain tsx.
import "../src/worker/shim-server-only";
import "../src/lib/load-env";

import { sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { firstTouchFields } from "../src/lib/sources";

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = await db.execute<{ patient_id: string; source: string; utm: unknown }>(sql`
    SELECT DISTINCT ON (r.patient_id) r.patient_id, r.source, r.utm
    FROM requests r
    JOIN patients p ON p.id = r.patient_id
    WHERE p.first_touch_channel IS NULL
      AND p.first_touch_source IS NOT NULL
      AND p.first_touch_source <> 'pvs'
      AND r.source = p.first_touch_source
    ORDER BY r.patient_id, r.created_at ASC
  `);

  let updated = 0;
  for (const r of rows) {
    const f = firstTouchFields(r.source, r.utm);
    if (apply) {
      await db.execute(sql`
        UPDATE patients
        SET first_touch_channel = ${f.firstTouchChannel},
            first_touch_content_code = coalesce(first_touch_content_code, ${f.firstTouchContentCode})
        WHERE id = ${r.patient_id}::uuid AND first_touch_channel IS NULL
      `);
    }
    updated++;
  }
  console.log(
    `[backfill-first-touch] ${apply ? "updated" : "would update"} ${updated} patient(s)${apply ? "" : " (dry run, pass --apply)"}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-first-touch] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
