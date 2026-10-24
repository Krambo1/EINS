/**
 * Read-only smoke test of the live admin KPI queries against a REAL local
 * Postgres (G-06/G-07/G-13). Opt-in:
 *   ADMIN_DB_TEST=1 npx vitest run src/server/queries/admin.db.test.ts
 */
import { describe, expect, it } from "vitest";

const enabled = process.env.ADMIN_DB_TEST === "1";

describe.skipIf(!enabled)("admin live queries (local DB)", () => {
  it("run and agree with the request table", async () => {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    const q = await import("./admin");

    const overview = await q.platformOverviewMetrics();
    expect(overview.sparklines.dates).toHaveLength(30);

    const board = await q.clinicLeaderboard({ periodDays: 90 });
    const real = await q.clinicLeaderboard({ periodDays: 90, realOnly: true });
    expect(real.every((r) => r.slug !== q.DEMO_CLINIC_SLUG && !r.archivedAt)).toBe(true);
    expect(board.length).toBeGreaterThanOrEqual(real.length);

    // Live lead count per clinic = non-spam requests in the last 90 Berlin days.
    for (const row of board) {
      const [ref] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM requests
        WHERE clinic_id = ${row.clinicId} AND status <> 'spam'
          AND (created_at AT TIME ZONE 'Europe/Berlin')::date
              >= (now() AT TIME ZONE 'Europe/Berlin')::date - 89
      `)) as unknown as Array<{ n: number }>;
      expect({ clinic: row.slug, leads: row.leads }).toEqual({ clinic: row.slug, leads: ref!.n });
      const perf = await q.clinicPerformance(row.clinicId, 90);
      expect(perf.summary.leads).toBe(ref!.n);
      expect(perf.daily).toHaveLength(90);
    }

    const series = await q.spendRevenueSeries(30);
    expect(series).toHaveLength(30);

    const leads = await q.globalLeads({ search: "50%" }, { limit: 5 });
    expect(leads.total).toBe(leads.aggregates.total);

    const ops = await q.pendingOperationCounts();
    expect(ops.slaBreaches).toBeGreaterThanOrEqual(0);

    // G-12 / H-13 / E-10 / G-14
    const att = await q.adminAttentionCounts();
    expect(att.garantie).toBeGreaterThanOrEqual(0);
    expect(att.newRequestsSinceYesterday).toBeGreaterThanOrEqual(0);
    const mess = await q.adminMesswegHealth();
    expect(mess.every((r) => r.clinicId && r.note.length > 0)).toBe(true);
    const jobs = await q.failedJobList();
    expect(Array.isArray(jobs.rows)).toBe(true);
    const integ = await q.adminIntegrationHealth();
    expect(integ.some((r) => r.provider === "intake")).toBe(false);

    expect(q.escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
  }, 60_000);
});
