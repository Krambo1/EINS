import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Rebuild kpi_daily rows for a clinic over [from, to].
 *
 * Logic: for each day in the range, aggregate from campaign_snapshots (spend)
 * and requests (qualified leads, appointments, etc.), then upsert.
 *
 * Called by:
 *  - cron (nightly full rebuild of yesterday)
 *  - explicit rebuild after CSV import or manual request entries
 */

export interface KpiRebuildJob {
  clinicId: string;
  from: string; // YYYY-MM-DD
  to: string;
}

export async function processKpiRebuild(job: KpiRebuildJob): Promise<void> {
  const { clinicId, from, to } = job;

  const spendRows = await db
    .select({
      date: schema.campaignSnapshots.snapshotDate,
      totalSpendEur: sql<string>`coalesce(sum(${schema.campaignSnapshots.spendEur}), 0)::text`,
    })
    .from(schema.campaignSnapshots)
    .where(
      and(
        eq(schema.campaignSnapshots.clinicId, clinicId),
        gte(schema.campaignSnapshots.snapshotDate, from),
        lte(schema.campaignSnapshots.snapshotDate, to)
      )
    )
    .groupBy(schema.campaignSnapshots.snapshotDate);

  const reqRows = await db
    .select({
      date: sql<string>`to_char(${schema.requests.createdAt}::date, 'YYYY-MM-DD')`,
      qualifiedLeads: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
      appointments: sql<number>`count(*) filter (where ${schema.requests.status} in ('termin_vereinbart','beratung_erschienen','gewonnen'))::int`,
      consultationsHeld: sql<number>`count(*) filter (where ${schema.requests.status} in ('beratung_erschienen','gewonnen'))::int`,
      casesWon: sql<number>`count(*) filter (where ${schema.requests.status} = 'gewonnen')::int`,
      revenueAttributedEur: sql<string>`coalesce(sum(${schema.requests.convertedRevenueEur}) filter (where ${schema.requests.status} = 'gewonnen'), 0)::text`,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        gte(sql`${schema.requests.createdAt}::date`, from),
        lte(sql`${schema.requests.createdAt}::date`, to)
      )
    )
    .groupBy(sql`${schema.requests.createdAt}::date`);

  // Merge by date.
  const byDate = new Map<
    string,
    {
      totalSpendEur: number;
      qualifiedLeads: number;
      appointments: number;
      consultationsHeld: number;
      casesWon: number;
      revenueAttributedEur: number;
    }
  >();
  for (const r of spendRows) {
    const d = typeof r.date === "string" ? r.date : (r.date as unknown as Date).toISOString().slice(0, 10);
    const ex = byDate.get(d) ?? emptyDay();
    ex.totalSpendEur = Number(r.totalSpendEur);
    byDate.set(d, ex);
  }
  for (const r of reqRows) {
    const ex = byDate.get(r.date) ?? emptyDay();
    ex.qualifiedLeads = Number(r.qualifiedLeads);
    ex.appointments = Number(r.appointments);
    ex.consultationsHeld = Number(r.consultationsHeld);
    ex.casesWon = Number(r.casesWon);
    ex.revenueAttributedEur = Number(r.revenueAttributedEur);
    byDate.set(r.date, ex);
  }

  // Upsert each day.
  for (const [date, m] of byDate) {
    const cpql = m.qualifiedLeads > 0 ? (m.totalSpendEur / m.qualifiedLeads).toFixed(2) : null;
    const roas =
      m.totalSpendEur > 0 ? (m.revenueAttributedEur / m.totalSpendEur).toFixed(2) : null;
    await db
      .insert(schema.kpiDaily)
      .values({
        clinicId,
        date,
        qualifiedLeads: m.qualifiedLeads,
        appointments: m.appointments,
        consultationsHeld: m.consultationsHeld,
        casesWon: m.casesWon,
        totalSpendEur: m.totalSpendEur.toFixed(2),
        revenueAttributedEur: m.revenueAttributedEur.toFixed(2),
        costPerQualifiedLead: cpql,
        roas,
      })
      .onConflictDoUpdate({
        target: [schema.kpiDaily.clinicId, schema.kpiDaily.date],
        set: {
          qualifiedLeads: m.qualifiedLeads,
          appointments: m.appointments,
          consultationsHeld: m.consultationsHeld,
          casesWon: m.casesWon,
          totalSpendEur: m.totalSpendEur.toFixed(2),
          revenueAttributedEur: m.revenueAttributedEur.toFixed(2),
          costPerQualifiedLead: cpql,
          roas,
          updatedAt: new Date(),
        },
      });
  }
}

function emptyDay() {
  return {
    totalSpendEur: 0,
    qualifiedLeads: 0,
    appointments: 0,
    consultationsHeld: 0,
    casesWon: 0,
    revenueAttributedEur: 0,
  };
}
