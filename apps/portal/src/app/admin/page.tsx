import { requireAdmin } from "@/auth/admin-guards";
import {
  DEMO_CLINIC_SLUG,
  adminAttentionCounts,
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
import { AttentionCard } from "./_components/AttentionCard";
import { HomeGuaranteeSection } from "./_components/HomeGuaranteeSection";
import { listGuaranteeOverview, loadInvoiceDates } from "@/server/guarantee-clock";
import { listRueckrufLage } from "@/server/response-enforcement";
import { listCloneDeletionTasks, listStopTasks } from "@/server/clone";
import { berlinDate } from "@/lib/guarantee-clock";
import { HomeKlonTasks } from "./_components/HomeKlonTasks";

export const metadata = { title: "Übersicht · Admin" };

// Leaderboard + folded-in response-time stay month-anchored (30 days), matching
// the MetricStrip; only the chart cards get per-card switchers.
const LEADERBOARD_DAYS = 30;

/** A failing guarantee/Rückruf read must not take the whole home page down. */
async function soft<T>(label: string, p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error(`[admin-home] ${label} failed:`, err);
    return fallback;
  }
}

/**
 * Admin home (DS5): built around the guarantee situation of the organic start.
 * Top: "Heute wichtig", then per Praxis the Garantie-Uhr (Tag X von 90, open
 * candidates, Verzug) and the Rückruf-Lage, read from the same functions as
 * /admin/garantie and /admin/rueckruf. Below: Anfragen and, only once ad data
 * exists, the paid-ads numbers (no tiles full of dashes before that).
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
    attention,
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
    clinicLeaderboard({ periodDays: LEADERBOARD_DAYS, realOnly: true }),
    pendingOperationCounts(),
    adminAttentionCounts().catch(() => null),
  ]);

  const [guaranteeAll, rueckruf, stopTasksAll, deletionTasksAll] = await Promise.all([
    soft("garantie", listGuaranteeOverview(), []),
    soft("rueckruf", listRueckrufLage(), []),
    soft("klon-stoppen", listStopTasks(), []),
    soft("klon-loeschen", listCloneDeletionTasks(), []),
  ]);
  // One clinic filter for every count and list on this page: the demo/template
  // Praxis (`_template`) is left out of both "Heute wichtig" and the cards.
  const demoIds = new Set(
    guaranteeAll.filter((g) => g.clinicSlug === DEMO_CLINIC_SLUG).map((g) => g.clinicId)
  );
  const guarantee = guaranteeAll.filter((g) => !demoIds.has(g.clinicId));
  const rueckrufReal = rueckruf.filter((r) => !demoIds.has(r.clinicId));
  const stopTasks = stopTasksAll.filter((t) => !demoIds.has(t.clinicId));
  const deletionTasks = deletionTasksAll.filter((t) => !demoIds.has(t.clinicId));
  // Invoice dates only matter once the clock stopped on a confirmed inquiry;
  // one small read per such Praxis (loadInvoiceDates is the Garantie-Uhr's own).
  const invoiceDue = guarantee.filter((g) => g.state.status === "rechnung_faellig");
  const invoiceDates = await Promise.all(
    invoiceDue.map(async (g) => ({ id: g.clinicId, dates: await loadInvoiceDates(g.clinicId) }))
  );
  const invoiceUnsent = new Set(invoiceDates.filter((d) => !d.dates.sentOn).map((d) => d.id));


  // Paid ads are optional (organic start): show their numbers only once any
  // Werbebudget has been recorded.
  const hasAdData =
    overview.monthSpend > 0 ||
    daily.some((d) => d.spendEur > 0) ||
    mix.some((m) => m.spendEur > 0) ||
    leaderboard.some((r) => r.spendEur > 0);

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
        title="Übersicht"
        subtitle="Garantie-Uhr und Rückruf-Lage aller Praxen, darunter Anfragen und Werbezahlen."
      />

      <AttentionCard data={attention} />

      <HomeKlonTasks stopTasks={stopTasks} deletionTasks={deletionTasks} today={berlinDate(new Date())} />

      <HomeGuaranteeSection guarantee={guarantee} invoiceUnsent={invoiceUnsent} rueckruf={rueckrufReal} />

      <h2 className="pt-4 text-2xl font-semibold">{hasAdData ? "Anfragen und Werbung" : "Anfragen"}</h2>

      <MetricStrip data={overview} showAds={hasAdData} />

      {hasAdData && <PerformanceSection daily={daily} mix={mix} range={perfRange} />}

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <PipelineSection funnel={funnel} funnelRange={pipelineRange} />
        </div>
        <div className="min-w-0 lg:col-span-1">
          <AiScoreSection ai={ai} aiRange={aiRange} />
        </div>
      </div>

      <ClinicLeaderboard rows={leaderboardRows} showAds={hasAdData} />

      <OperationsSection sla={sla} operations={operations} />
    </div>
  );
}
