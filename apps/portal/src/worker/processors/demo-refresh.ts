import postgres from "postgres";
import { refreshDemoPraxis } from "@/db/refresh-demo";
import { bossConnectionString } from "@/lib/env";

/**
 * Weekly: renews the demo Praxis's activity, so "Praxis Dr. Demo" does not
 * age into an empty dashboard again. Touches that one Praxis only; what it
 * replaces and keeps: db/refresh-demo.ts. Production runs it from
 * /api/cron/daily (the worker is off there); the worker schedule is for when
 * it is switched on. A second run on the same day does no harm.
 *
 * Own connection on the direct endpoint, not the shared client: that one
 * caps each statement at 15 s and is shared with every other job, and this
 * is one long transaction.
 */
export async function processDemoRefresh(): Promise<void> {
  const sql = postgres(bossConnectionString(), { max: 1, onnotice: () => void 0 });
  try {
    const result = await refreshDemoPraxis(sql);
    console.log(
      `[demo-refresh] renewed: ${result.requestCount} Anfragen, ${result.postCount} posts; removed ${result.removed}`
    );
  } finally {
    await sql.end();
  }
}
