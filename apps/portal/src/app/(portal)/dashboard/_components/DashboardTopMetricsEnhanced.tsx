import "server-only";
import { MetricTile } from "@eins/ui";
import {
  kpiSummaryWithComparison,
  kpiDailySeriesWithSparkline,
  currentGoals,
} from "@/server/queries/kpis";
import {
  formatEuro,
  formatNumber,
  formatRoasSentence,
  toneForGoalRatio,
  deltaTone,
} from "@/lib/formatting";
import type { KpiSummary } from "@/server/queries/kpis";

type Goal = Awaited<ReturnType<typeof currentGoals>>[number];

/**
 * Detail-mode top-metrics tile grid: enriches the base SimpleMetric grid
 * with delta vs prior month + 30-day sparklines. Wrapped in <Suspense>
 * with the SimpleMetric grid as fallback so the page paints before this
 * component's two queries finish (kpi comparison + sparkline series).
 */
export async function DashboardTopMetricsEnhanced({
  clinicId,
  userId,
  summary,
  slaBreaches,
  openRequests,
  leadsGoal,
  revenueGoal,
}: {
  clinicId: string;
  userId: string;
  summary: KpiSummary;
  slaBreaches: number;
  openRequests: number;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
}) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const sparkFrom = new Date();
  sparkFrom.setDate(sparkFrom.getDate() - 30);

  const [comparison, sparkData] = await Promise.all([
    kpiSummaryWithComparison(clinicId, userId, monthStart, monthEnd),
    kpiDailySeriesWithSparkline(clinicId, userId, sparkFrom, now),
  ]);

  const spark = sparkData.sparklines;

  return (
    <section aria-label="Monatszahlen" className="grid gap-4 md:grid-cols-3">
      <MetricTile
        label="Qualifizierte Anfragen"
        value={formatNumber(summary.qualifiedLeads)}
        sublabel={
          leadsGoal
            ? `Monatsziel: ${Number(leadsGoal.targetValue)} · ${summary.casesWon} gewonnen`
            : `${summary.casesWon} bisher gewonnen`
        }
        tone={
          leadsGoal
            ? toneForGoalRatio(summary.qualifiedLeads / Number(leadsGoal.targetValue))
            : "accent"
        }
        delta={
          comparison.delta.qualifiedLeadsPct != null
            ? {
                value: (comparison.delta.qualifiedLeadsPct ?? 0) * 100,
                tone: deltaTone(comparison.delta.qualifiedLeadsPct),
              }
            : undefined
        }
        sparkline={spark.qualifiedLeads}
        hint="vs. Vormonat"
      />
      <MetricTile
        label="Umsatz in diesem Monat"
        value={formatEuro(summary.revenueEur)}
        sublabel={
          revenueGoal
            ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}`
            : formatRoasSentence(summary.roas)
        }
        tone={
          revenueGoal
            ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
            : "accent"
        }
        delta={
          comparison.delta.revenuePct != null
            ? {
                value: (comparison.delta.revenuePct ?? 0) * 100,
                tone: deltaTone(comparison.delta.revenuePct),
              }
            : undefined
        }
        sparkline={spark.revenueEur}
        hint="vs. Vormonat"
      />
      <MetricTile
        label="Offene Anfragen"
        value={formatNumber(openRequests)}
        tone={slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good"}
        sublabel={
          slaBreaches > 0
            ? `${slaBreaches} davon überfällig`
            : openRequests > 0
            ? "warten auf erste Reaktion"
            : "alles auf aktuellem Stand"
        }
        sparkline={spark.qualifiedLeads}
      />
    </section>
  );
}
