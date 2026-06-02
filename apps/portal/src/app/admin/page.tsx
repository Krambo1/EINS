import { requireAdmin } from "@/auth/admin-guards";
import {
  aiScoreDistribution,
  clinicLeaderboard,
  pendingOperationCounts,
  pipelineFunnel,
  platformMix,
  platformOverviewMetrics,
  responseTimeRanking,
  slaBreachLeaderboard,
  spendRevenueSeries,
} from "@/server/queries/admin";
import {
  ADMIN_RANGE_KEYS,
  dashboardRangeDays,
  parseDashboardRange,
} from "@/lib/dashboard-range";
import { AdminPageHeader } from "./_components/AdminPageHeader";
import { MetricStrip } from "./_components/MetricStrip";
import { PerformanceSection } from "./_components/PerformanceSection";
import { PipelineSection } from "./_components/PipelineSection";
import { AiScoreSection } from "./_components/AiScoreSection";
import { ClinicLeaderboard } from "./_components/ClinicLeaderboard";
import { OperationsSection } from "./_components/OperationsSection";

export const metadata = { title: "Plattform-Übersicht" };

// Leaderboard + folded-in response-time stay month-anchored (30 days), matching
// the MetricStrip; only the chart cards get per-card switchers.
const LEADERBOARD_DAYS = 30;

/**
 * Admin command-center home, styled to mirror the clinic dashboard: a KPI strip
 * plus four flat clinic-styled cards (Werbeleistung, Lead-Pipeline,
 * Praxis-Leaderboard, Operations) with no duplicated data and no nested card
 * chrome. The chart cards each own their own time window via a per-card
 * switcher (rPerf / rPipeline / rAi); every section renders an empty state if
 * its data is not yet present, so the page is safe before ingestion has run.
 */
export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const perfRange = parseDashboardRange(sp[ADMIN_RANGE_KEYS.perf]);
  const pipelineRange = parseDashboardRange(sp[ADMIN_RANGE_KEYS.pipeline]);
  const aiRange = parseDashboardRange(sp[ADMIN_RANGE_KEYS.ai]);

  const perfDays = dashboardRangeDays(perfRange);

  const [
    overview,
    daily,
    mix,
    funnel,
    ai,
    sla,
    response,
    leaderboard,
    operations,
  ] = await Promise.all([
    platformOverviewMetrics(),
    spendRevenueSeries(perfDays),
    platformMix(perfDays),
    pipelineFunnel(dashboardRangeDays(pipelineRange)),
    aiScoreDistribution(dashboardRangeDays(aiRange)),
    slaBreachLeaderboard(5),
    // Generous limit so every leaderboard clinic can receive its median; the
    // query already filters to clinics with requests in the window.
    responseTimeRanking(LEADERBOARD_DAYS, 1000),
    clinicLeaderboard({ periodDays: LEADERBOARD_DAYS }),
    pendingOperationCounts(),
  ]);

  // Fold the response-time median into each leaderboard row by clinicId so the
  // Antwortzeit lives as a column instead of its own table.
  const medianByClinic = new Map(
    response.map((r) => [r.clinicId, r.medianFirstContactMin] as const)
  );
  const leaderboardRows = leaderboard.map((r) => ({
    ...r,
    medianFirstContactMin: medianByClinic.get(r.clinicId) ?? null,
  }));

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Plattform-Übersicht"
        subtitle="Intelligence-Layer für alle Praxen. Daten aktualisieren sich mit jedem Sync."
      />

      <MetricStrip data={overview} />

      <PerformanceSection daily={daily} mix={mix} range={perfRange} />

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PipelineSection funnel={funnel} funnelRange={pipelineRange} />
        </div>
        <div className="lg:col-span-1">
          <AiScoreSection ai={ai} aiRange={aiRange} />
        </div>
      </div>

      <ClinicLeaderboard rows={leaderboardRows} />

      <OperationsSection sla={sla} operations={operations} />
    </div>
  );
}
