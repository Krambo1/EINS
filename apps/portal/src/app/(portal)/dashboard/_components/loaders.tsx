import "server-only";
import { requireSession } from "@/auth/guards";
import {
  dashboardLiveDays,
  noShowForWindow,
  sparklinesForWindow,
  summaryForWindow,
} from "@/server/queries/kpis";
import {
  requestStatusCounts,
  slaBreachedCount,
  openLeadsForDashboard,
} from "@/server/queries/requests";
import { bySource } from "@/server/queries/attribution";
import { ltvBySource } from "@/server/queries/patients";
import {
  retreatmentCallQueue,
  retreatmentTagsForRequests,
  type RetreatmentCall,
} from "@/server/queries/retreatments";
import {
  DASHBOARD_RANGE_KEYS,
  berlinDay,
  dashboardRangeWindow,
  parseDashboardRange,
  priorDashboardWindow,
} from "@/lib/dashboard-range";
import { DashboardTopMetricsEnhanced } from "./DashboardTopMetricsEnhanced";
import { DashboardDetailBundle } from "./DashboardDetailBundle";

/*
 * The two period-dependent parts of the Übersicht. The page renders them for
 * the period in the URL; `loadDashboardRange` (../range-actions.tsx) renders
 * them for any other period, for the client cache behind the range switch.
 */

/**
 * Earliest Berlin day any dashboard card needs (its window or the comparison
 * window before it). Both loaders compute the same value from the same
 * searchParams, so `dashboardLiveDays` is read once per render (React cache).
 */
function earliestDashboardDay(sp: Record<string, string | undefined>): string {
  let earliest = berlinDay();
  for (const key of Object.values(DASHBOARD_RANGE_KEYS)) {
    const prior = priorDashboardWindow(dashboardRangeWindow(parseDashboardRange(sp[key])));
    if (prior.fromDate < earliest) earliest = prior.fromDate;
  }
  // Always the whole history ("5 Jahre" and the window before it), whatever
  // period is shown: "did ads ever run" decides whether the Werbeertrag tile
  // exists, and that must not change with the period (cards keep their size).
  const widest = priorDashboardWindow(dashboardRangeWindow("max")).fromDate;
  return widest < earliest ? widest : earliest;
}

export async function DashboardTopMetricsLoader({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const { clinicId, userId, currency } = session;
  const sp = await searchParams;
  // Each of the four top cards owns its own range param so users can compare
  // different windows side-by-side (e.g. monthly leads vs. yearly revenue).
  const leadsRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.leads]);
  const revenueRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.revenue]);
  const sourcesRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.sources]);

  const leadsWindow = dashboardRangeWindow(leadsRange);
  const revenueWindow = dashboardRangeWindow(revenueRange);
  const sourcesWindow = dashboardRangeWindow(sourcesRange);
  const leadsPrior = priorDashboardWindow(leadsWindow);
  const revenuePrior = priorDashboardWindow(revenueWindow);

  // ONE parallel wave for every top tile. The Anfragen and Umsatz numbers
  // (headline, comparison, sparklines) all come from one live read of the
  // per-day rows (`dashboardLiveDays`), not from `kpi_daily`, so they are
  // correct even when no worker job ran.
  const [
    liveDays,
    sourceBreakdown,
    statusCounts,
    slaBreaches,
    openLeads,
    ltvMap,
    retreatmentQueue,
  ] = await Promise.all([
    dashboardLiveDays(clinicId, userId, earliestDashboardDay(sp), berlinDay()),
    bySource(clinicId, userId, sourcesWindow.from, sourcesWindow.to),
    requestStatusCounts(clinicId, userId),
    slaBreachedCount(clinicId, userId),
    // Top-N open Anfragen for the Offene-Anfragen card.
    // Same source-of-truth as the headline count (status='neu'), sorted by
    // SLA-überfällig → oldest. Capped at 5 (the phone shows the first 3);
    // the card renders a "N weitere" hint when the headline count exceeds
    // the listed rows.
    openLeadsForDashboard(clinicId, userId, 5),
    // Lifetime value per source: not window-scoped, shown in each source row.
    ltvBySource(clinicId, userId),
    // The first due Wiederbehandlung of the call cards (a patient without an
    // open Anfrage): one row of the Offene-Anfragen card, not tied to the
    // period.
    retreatmentCallQueue(clinicId, userId, 1),
  ]);

  // Listed open Anfragen whose patient is due: their rows get the tag. Needs
  // the Anfrage ids, so it waits for the wave above.
  const leadTags = await retreatmentTagsForRequests(
    clinicId,
    userId,
    openLeads.map((l) => l.id),
    { includeWorking: true }
  );
  const dueByRequest = new Map<string, RetreatmentCall>();
  for (const [requestId, tag] of leadTags) {
    if (tag.state === "faellig") dueByRequest.set(requestId, tag.call);
  }

  const leadsSummary = summaryForWindow(liveDays, leadsWindow);
  const leadsPriorSummary = summaryForWindow(liveDays, leadsPrior);
  const revenueSummary = summaryForWindow(liveDays, revenueWindow);
  const revenuePriorSummary = summaryForWindow(liveDays, revenuePrior);

  const openRequests = statusCounts.neu ?? 0;

  // Empty-window hint: the selected Anfragen window has zero leads, yet the
  // Praxis has Anfragen all-time (statusCounts is clinic-wide, not windowed).
  // That's the stale-window case a fresh boot hits ("30 Tage" empty because the
  // newest data is older than 30 days). A brand-new Praxis (no Anfragen at all)
  // is excluded so its day-one empty state is untouched, and we don't offer the
  // link when already on "Max". The link widens every card to Max (same as
  // picking "Max" in the page-level switch). Not on "Heute" either: a day
  // without a new Anfrage is normal and needs no explanation.
  const totalRequestsAllTime = Object.values(statusCounts).reduce(
    (sum, n) => sum + n,
    0
  );
  const showEmptyWindowHint =
    leadsSummary.leads === 0 &&
    totalRequestsAllTime > 0 &&
    leadsRange !== "max" &&
    leadsRange !== "heute";
  let emptyWindowHint: { href: string } | undefined;
  if (showEmptyWindowHint) {
    const fullHistoryParams = new URLSearchParams();
    for (const [key, val] of Object.entries(sp)) {
      if (typeof val === "string") fullHistoryParams.set(key, val);
    }
    for (const key of [
      DASHBOARD_RANGE_KEYS.leads,
      DASHBOARD_RANGE_KEYS.revenue,
      DASHBOARD_RANGE_KEYS.open,
      DASHBOARD_RANGE_KEYS.sources,
      DASHBOARD_RANGE_KEYS.funnel,
      DASHBOARD_RANGE_KEYS.locations,
      DASHBOARD_RANGE_KEYS.treatments,
      DASHBOARD_RANGE_KEYS.noShow,
    ]) {
      fullHistoryParams.set(key, "max");
    }
    emptyWindowHint = { href: `/dashboard?${fullHistoryParams.toString()}` };
  }

  return (
    <DashboardTopMetricsEnhanced
      currency={currency}
      leadsSummary={leadsSummary}
      leadsPriorSummary={leadsPriorSummary}
      revenueSummary={revenueSummary}
      revenuePriorSummary={revenuePriorSummary}
      sourceBreakdown={sourceBreakdown}
      slaBreaches={slaBreaches}
      openRequests={openRequests}
      sourcesRange={sourcesRange}
      leadsRange={leadsRange}
      revenueRange={revenueRange}
      openLeads={openLeads}
      retreatments={{
        today: retreatmentQueue.today,
        ownRow: retreatmentQueue.calls[0] ?? null,
        byRequest: dueByRequest,
      }}
      emptyWindowHint={emptyWindowHint}
      hasAnyRequest={totalRequestsAllTime > 0}
      leadsSpark={sparklinesForWindow(liveDays, leadsWindow)}
      leadsPriorSpark={sparklinesForWindow(liveDays, leadsPrior)}
      revenueSpark={sparklinesForWindow(liveDays, revenueWindow)}
      ltvMap={ltvMap}
      adsRun={summaryForWindow(liveDays, dashboardRangeWindow("max")).spendEur > 0}
    />
  );
}

export async function DashboardDetailLoader({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const { clinicId, userId, currency } = session;
  const sp = await searchParams;
  const funnelRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.funnel]);
  const locationsRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.locations]);
  const treatmentsRange = parseDashboardRange(
    sp[DASHBOARD_RANGE_KEYS.treatments]
  );
  const noShowRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.noShow]);

  // Funnel (rFunnel) and No-Show (rNoShow) cards each own a window plus the
  // comparison window before it. All four are sliced out of the same live
  // per-day read the top tiles use (deduped per render by React cache).
  const win = dashboardRangeWindow(funnelRange);
  const noShowWin = dashboardRangeWindow(noShowRange);
  const liveDays = await dashboardLiveDays(
    clinicId,
    userId,
    earliestDashboardDay(sp),
    berlinDay()
  );
  return (
    <DashboardDetailBundle
      clinicId={clinicId}
      userId={userId}
      currency={currency}
      summary={summaryForWindow(liveDays, win)}
      priorSummary={summaryForWindow(liveDays, priorDashboardWindow(win))}
      noShow={noShowForWindow(liveDays, noShowWin)}
      noShowPrior={noShowForWindow(liveDays, priorDashboardWindow(noShowWin))}
      canManageReviews={session.role === "inhaber"}
      funnelRange={funnelRange}
      locationsRange={locationsRange}
      treatmentsRange={treatmentsRange}
      postsRange={parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.sources])}
      adsRun={summaryForWindow(liveDays, dashboardRangeWindow("max")).spendEur > 0}
    />
  );
}
