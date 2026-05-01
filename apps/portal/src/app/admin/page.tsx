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
import { AdminPageHeader } from "./_components/AdminPageHeader";
import { MetricStrip } from "./_components/MetricStrip";
import { PerformanceSection } from "./_components/PerformanceSection";
import { PipelineSection } from "./_components/PipelineSection";
import { SlaAndResponseSection } from "./_components/SlaAndResponseSection";
import { ClinicLeaderboard } from "./_components/ClinicLeaderboard";
import { OperationsQuickAccess } from "./_components/OperationsQuickAccess";

export const metadata = { title: "Plattform-Übersicht" };

/**
 * Admin command-center home. All sections fetch in parallel; each renders
 * an empty state if the underlying data is not yet present so the page is
 * safe before ingestion has run.
 */
export default async function AdminHome() {
  await requireAdmin();

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
    spendRevenueSeries(90),
    platformMix(30),
    pipelineFunnel(30),
    aiScoreDistribution(30),
    slaBreachLeaderboard(5),
    responseTimeRanking(30, 8),
    clinicLeaderboard({ periodDays: 30 }),
    pendingOperationCounts(),
  ]);

  return (
    <div className="space-y-10">
      <AdminPageHeader
        title="Plattform-Übersicht"
        subtitle="Intelligence-Layer für alle Kliniken. Daten aktualisieren sich mit jedem Sync."
      />

      <MetricStrip data={overview} />

      <PerformanceSection
        daily={daily}
        mix={mix}
        monthSpend={overview.monthSpend}
        monthRevenue={overview.monthRevenue}
        monthLeads={overview.monthLeads}
        monthCasesWon={overview.monthCasesWon}
      />

      <PipelineSection funnel={funnel} ai={ai} />

      <SlaAndResponseSection sla={sla} response={response} />

      <ClinicLeaderboard rows={leaderboard} />

      <OperationsQuickAccess data={operations} />
    </div>
  );
}
