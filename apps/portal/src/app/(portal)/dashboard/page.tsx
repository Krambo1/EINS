import { Suspense } from "react";
import { requireSession } from "@/auth/guards";
import {
  currentMonthSummary,
  currentGoals,
  kpiSummaryUncached,
} from "@/server/queries/kpis";
import {
  requestStatusCounts,
  slaBreachedCount,
  totalRequestsInRangeWithComparison,
  qualifiedLeadsInRangeWithComparison,
} from "@/server/queries/requests";
import { getClinicRelationshipStart } from "@/server/queries/clinic";
import {
  DASHBOARD_RANGE_KEYS,
  dashboardRangeWindow,
  parseDashboardRange,
} from "@/lib/dashboard-range";
import { DashboardTopMetricsEnhanced } from "./_components/DashboardTopMetricsEnhanced";
import { DashboardDetailBundle } from "./_components/DashboardDetailBundle";
import { DetailBundleSkeleton } from "./_components/DetailBundleSkeleton";

export const metadata = { title: "Übersicht" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  // Each of the four top cards owns its own range param so users can
  // compare different windows side-by-side (e.g. monthly leads vs. yearly
  // revenue).
  const leadsRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.leads]);
  const revenueRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.revenue]);
  const openRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.open]);
  const totalRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.total]);
  const staffRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.staff]);
  const sourcesRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.sources]);
  const leadsWindow = dashboardRangeWindow(leadsRange);
  const revenueWindow = dashboardRangeWindow(revenueRange);
  const openWindow = dashboardRangeWindow(openRange);
  const totalWindow = dashboardRangeWindow(totalRange);

  // Base bundle. The three `*Summary` calls are scoped to each card's
  // selected range; `monthlySummary` stays monthly for the goal bars and
  // ROAS traffic-light below. The detail bundle (7 more) is streamed
  // inside <Suspense> so the shell paints before the deep-dive queries
  // finish.
  const [
    monthlySummary,
    leadsBreakdown,
    revenueSummary,
    openSummary,
    totalSummary,
    goals,
    statusCounts,
    slaBreaches,
    relationshipStartedAt,
  ] = await Promise.all([
    currentMonthSummary(session.clinicId, session.userId),
    // Leads card pulls qualified/won counts from the live `requests` table
    // — same source as `totalSummary` — so qualified ≤ total is guaranteed
    // and the cards stay consistent even when kpi_daily is stale.
    qualifiedLeadsInRangeWithComparison(
      session.clinicId,
      session.userId,
      leadsWindow.from,
      leadsWindow.to
    ),
    kpiSummaryUncached(
      session.clinicId,
      session.userId,
      revenueWindow.from,
      revenueWindow.to
    ),
    kpiSummaryUncached(
      session.clinicId,
      session.userId,
      openWindow.from,
      openWindow.to
    ),
    totalRequestsInRangeWithComparison(
      session.clinicId,
      session.userId,
      totalWindow.from,
      totalWindow.to
    ),
    currentGoals(session.clinicId, session.userId),
    requestStatusCounts(session.clinicId, session.userId),
    slaBreachedCount(session.clinicId, session.userId),
    getClinicRelationshipStart(session.clinicId),
  ]);
  const summary = monthlySummary;

  const leadsGoal = goals.find((g) => g.metric === "qualified_leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");
  const totalGoal = goals.find((g) => g.metric === "total_requests");

  const openRequests =
    (statusCounts.neu ?? 0) + (statusCounts.qualifiziert ?? 0);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">Guten Tag,</p>
          <h2 className="text-3xl font-semibold md:text-4xl">
            {session.fullName ?? session.email.split("@")[0]}.
          </h2>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            So läuft es aktuell in Ihrer Praxis.
          </p>
        </div>
        <div className="text-sm text-fg-secondary">
          {new Date().toLocaleDateString("de-DE", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>

      {/* Top metrics — four MetricTile cards, each with its own range toggle.
          Streamed inside Suspense so the shell paints before the parallel
          range-window queries finish on initial load. We deliberately do
          NOT key the boundary by the active ranges: a key change unmounts
          the subtree and reverts to the skeleton on every toggle click,
          which both flashes the cards and destroys the TimeRangeToggle's
          sliding-pill animation. With no key, `startTransition` keeps the
          old cards visible while the new RSC payload streams in, the
          toggle stays mounted, and its pill animates to the new value. */}
      <Suspense fallback={<TopMetricsSkeleton />}>
        <DashboardTopMetricsEnhanced
          clinicId={session.clinicId}
          userId={session.userId}
          leadsBreakdown={leadsBreakdown}
          revenueSummary={revenueSummary}
          openSummary={openSummary}
          totalSummary={totalSummary}
          slaBreaches={slaBreaches}
          openRequests={openRequests}
          leadsGoal={leadsGoal}
          revenueGoal={revenueGoal}
          totalGoal={totalGoal}
          leadsRange={leadsRange}
          revenueRange={revenueRange}
          openRange={openRange}
          totalRange={totalRange}
          relationshipStartedAt={relationshipStartedAt}
        />
      </Suspense>

      {/* Deep dive — streamed inside Suspense so the shell paints before its
          8 parallel queries finish. */}
      <Suspense fallback={<DetailBundleSkeleton />}>
        <DashboardDetailBundle
          clinicId={session.clinicId}
          userId={session.userId}
          summary={summary}
          staffRange={staffRange}
          sourcesRange={sourcesRange}
        />
      </Suspense>
    </div>
  );
}

function TopMetricsSkeleton() {
  return (
    <section
      aria-label="Kennzahlen werden geladen"
      aria-busy="true"
      className="grid gap-5 md:grid-cols-2 md:gap-6"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="h-44 animate-pulse rounded-2xl border border-border bg-bg-secondary/40"
        />
      ))}
    </section>
  );
}
