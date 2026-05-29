import "server-only";
import { MetricTile, TrendChart } from "@eins/ui";
import {
  kpiSummaryWithComparison,
  kpiDailySeriesWithSparkline,
  type KpiSummary,
  currentGoals,
} from "@/server/queries/kpis";
import {
  formatEuro,
  formatNumber,
  formatRoasSentence,
  toneForGoalRatio,
  deltaTone,
} from "@/lib/formatting";
import { zipSeries } from "@/lib/chart-data";

type Goal = Awaited<ReturnType<typeof currentGoals>>[number];

/**
 * Detail-mode top-metrics tile grid for /auswertung. Same pattern as the
 * dashboard: enriches the base SimpleMetric grid with delta + sparkline.
 * Wrapped in <Suspense> with a SimpleMetric grid as the fallback so the
 * page header + period nav paint immediately.
 */
export async function AuswertungTopMetricsEnhanced({
  clinicId,
  userId,
  summary,
  from,
  to,
  periodKey,
  leadsGoal,
  revenueGoal,
}: {
  clinicId: string;
  userId: string;
  summary: KpiSummary;
  from: Date;
  to: Date;
  periodKey: string;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
}) {
  const [comparison, sparkData] = await Promise.all([
    kpiSummaryWithComparison(clinicId, userId, from, to),
    kpiDailySeriesWithSparkline(clinicId, userId, from, to),
  ]);

  const sparklines = sparkData.sparklines;

  return (
    <section aria-label="Kernzahlen" className="grid gap-6 md:grid-cols-3">
      <MetricTile
        label="Anfragen"
        value={formatNumber(summary.leads)}
        sublabel={
          leadsGoal && periodKey === "month"
            ? `Monatsziel: ${Number(leadsGoal.targetValue)}`
            : "Ernstgemeinte Anfragen im Zeitraum."
        }
        tone={
          leadsGoal && periodKey === "month"
            ? toneForGoalRatio(summary.leads / Number(leadsGoal.targetValue))
            : "accent"
        }
        delta={
          comparison.delta.leadsPct != null
            ? {
                value: (comparison.delta.leadsPct ?? 0) * 100,
                tone: deltaTone(comparison.delta.leadsPct),
              }
            : undefined
        }
        chartSlot={
          <TrendChart
            data={zipSeries(sparklines.dates, sparklines.leads)}
            tone="accent"
            label="Anfragen"
            valueFormat="number"
          />
        }
        hint="vs. Vorperiode"
      />
      <MetricTile
        label="Umsatz"
        value={formatEuro(summary.revenueEur)}
        tone={
          revenueGoal && periodKey === "month"
            ? toneForGoalRatio(summary.revenueEur / Number(revenueGoal.targetValue))
            : "accent"
        }
        sublabel={
          revenueGoal && periodKey === "month"
            ? `Monatsziel: ${formatEuro(Number(revenueGoal.targetValue))}`
            : formatRoasSentence(summary.roas)
        }
        delta={
          comparison.delta.revenuePct != null
            ? {
                value: (comparison.delta.revenuePct ?? 0) * 100,
                tone: deltaTone(comparison.delta.revenuePct),
              }
            : undefined
        }
        chartSlot={
          <TrendChart
            data={zipSeries(sparklines.dates, sparklines.revenueEur)}
            tone="accent"
            label="Umsatz"
            valueFormat="euro"
          />
        }
        hint="vs. Vorperiode"
      />
      <MetricTile
        label="Werbebudget"
        value={formatEuro(summary.spendEur)}
        sublabel={formatRoasSentence(summary.roas)}
        delta={
          comparison.delta.spendPct != null
            ? {
                value: (comparison.delta.spendPct ?? 0) * 100,
                tone: deltaTone(comparison.delta.spendPct, true),
              }
            : undefined
        }
        chartSlot={
          <TrendChart
            data={zipSeries(sparklines.dates, sparklines.spendEur)}
            tone="neutral"
            label="Werbebudget"
            valueFormat="euro"
          />
        }
        hint="vs. Vorperiode"
      />
    </section>
  );
}
