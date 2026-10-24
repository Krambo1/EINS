import { Suspense } from "react";
import { requireSession } from "@/auth/guards";
import {
  currentGoals,
  dashboardLiveDays,
  noShowForWindow,
  openQueueDaily,
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
import { getClinicRelationshipStart } from "@/server/queries/clinic";
import {
  DASHBOARD_RANGE_KEYS,
  berlinDay,
  berlinHour,
  dashboardRangeWindow,
  parseDashboardRange,
  priorDashboardWindow,
} from "@/lib/dashboard-range";
import { DISPLAY_TIME_ZONE } from "@/lib/formatting";
import { DashboardTopMetricsEnhanced } from "./_components/DashboardTopMetricsEnhanced";
import { DashboardDetailBundle } from "./_components/DashboardDetailBundle";
import { DetailBundleSkeleton } from "./_components/DetailBundleSkeleton";
import {
  DashboardRangeSwitch,
  DashboardRangeSwitchSkeleton,
} from "./_components/DashboardRangeSwitch";
import { ForecastStrip } from "./_components/ForecastStrip";
import {
  AnomalyAlertsWidget,
  AnomalyAlertsSkeleton,
} from "./_components/AnomalyAlertsWidget";

export const metadata = { title: "Übersicht" };

/**
 * Tageszeit-gerechte Begrüßung. Vier Fenster:
 *   05–09 → "Guten Morgen"
 *   10–16 → "Guten Tag"
 *   17–21 → "Guten Abend"
 *   22–04 → "Gute Nacht"
 *
 * Inhaber:innen, die nach Mitternacht den Posteingang prüfen, bekommen so
 * eine Begrüßung, die den realen Tageszeitpunkt trifft, ohne den 22:00-Uhr-
 * Patient:in nach Feierabend mit einer Schlafwunsch-Begrüßung zu konfrontieren.
 */
function germanGreeting(d: Date): string {
  // Berlin wall clock: the server runs in UTC.
  const h = berlinHour(d);
  if (h >= 5 && h < 10) return "Guten Morgen";
  if (h >= 10 && h < 17) return "Guten Tag";
  if (h >= 17 && h < 22) return "Guten Abend";
  return "Gute Nacht";
}

export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // The page shell renders SYNCHRONOUSLY — it does not await session or
  // searchParams. Every async dependency lives inside one of the Suspense
  // boundaries below. This is load-bearing for the page-level DashboardRangeSwitch:
  // the switch flips the `?r...=` values, which re-renders this dynamic segment.
  // If the page component itself awaited (session/searchParams) at its root,
  // that suspension would bubble to the segment's `loading.tsx` boundary and
  // repaint the ENTIRE content area as a skeleton on every toggle — which on
  // mobile tears out the card you scrolled to and snaps the viewport back to
  // the top. Keeping the shell synchronous means a toggle only re-renders the
  // single inner boundary whose query window changed; React's startTransition
  // (in DashboardRangeSwitch) then keeps the already-revealed content in place
  // instead of flashing a skeleton. `loading.tsx` only ever shows on a genuine
  // first load, never on a toggle.
  return (
    <div className="space-y-10">
      <Suspense fallback={<GreetingSkeleton />}>
        <DashboardGreeting />
      </Suspense>

      {/* One range switch for every card (writes all per-card params at once,
          so loaders and the single live query path stay unchanged). Client
          component reading searchParams itself; no server await here. */}
      <Suspense fallback={<DashboardRangeSwitchSkeleton />}>
        <DashboardRangeSwitch />
      </Suspense>

      {/* Top metrics — four MetricTile cards; ranges come from the switch above.
          Data fetching happens INSIDE this Suspense boundary's child so the
          shell paints immediately and TTFB is no longer held hostage by the
          parallel range-window queries. */}
      <Suspense fallback={<TopMetricsSkeleton />}>
        <DashboardTopMetricsLoader searchParams={searchParams} />
      </Suspense>

      {/* Forecast strip — three numbers (Pipeline-Wert, 30d, 90d).
          Hidden during cold-start (sample < MIN_SAMPLE_WON). Suspense so
          the snapshot read doesn't block the shell. */}
      <Suspense fallback={null}>
        <ForecastLoader />
      </Suspense>

      {/* Anomaly alerts: rule-based detection with optional KI-sauce on the
          rare extreme/multi-signal cases. Own Suspense so a slow alerts
          read never blocks the deep-dive bundle and vice versa. */}
      <Suspense fallback={<AnomalyAlertsSkeleton />}>
        <AnomalyAlertsLoader />
      </Suspense>

      {/* Deep dive — streamed inside Suspense so the shell paints before its
          8 parallel queries finish. */}
      <Suspense fallback={<DetailBundleSkeleton />}>
        <DashboardDetailLoader searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * Greeting header — its own Suspense boundary because it awaits the session
 * for the user's name. It does NOT read searchParams, so a range toggle never
 * changes its output; during the toggle transition React keeps the rendered
 * greeting in place rather than re-showing GreetingSkeleton.
 */
async function DashboardGreeting() {
  const session = await requireSession();
  const now = new Date();
  const greeting = germanGreeting(now);
  return (
    <div
      data-tour="dashboard-header"
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div>
        <p className="text-base text-fg-primary">{greeting},</p>
        <h1 className="text-3xl font-semibold md:text-4xl">
          {session.fullName ?? session.email.split("@")[0]}.
        </h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          So läuft es aktuell in Ihrer Praxis.
        </p>
      </div>
      <div className="text-base font-medium text-fg-primary md:text-lg">
        {now.toLocaleDateString("de-DE", {
          weekday: "long",
          day: "2-digit",
          month: "long",
          year: "numeric",
          timeZone: DISPLAY_TIME_ZONE,
        })}
      </div>
    </div>
  );
}

/** Forecast strip wrapped so it sources the session itself (cached). */
async function ForecastLoader() {
  const session = await requireSession();
  return (
    <ForecastStrip
      clinicId={session.clinicId}
      userId={session.userId}
      currency={session.currency}
    />
  );
}

/** Anomaly alerts wrapped so it sources the session itself (cached). */
async function AnomalyAlertsLoader() {
  const session = await requireSession();
  return (
    <AnomalyAlertsWidget clinicId={session.clinicId} userId={session.userId} />
  );
}

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
  return earliest;
}

/**
 * True when every card shows the window picked on the page-level switch. Then
 * the cards stay silent about the period; only a deep link with differing
 * per-card params makes each card name its own.
 */
function cardsShowOwnRange(sp: Record<string, string | undefined>): boolean {
  // Same eight params the switch writes (no `total`, it has no card here).
  const { total: _total, ...cardKeys } = DASHBOARD_RANGE_KEYS;
  const ranges = Object.values(cardKeys).map((k) => parseDashboardRange(sp[k]));
  return !ranges.every((r) => r === ranges[0]);
}

async function DashboardTopMetricsLoader({
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
  const openRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.open]);
  const sourcesRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.sources]);

  const leadsWindow = dashboardRangeWindow(leadsRange);
  const revenueWindow = dashboardRangeWindow(revenueRange);
  const openWindow = dashboardRangeWindow(openRange);
  const sourcesWindow = dashboardRangeWindow(sourcesRange);
  const leadsPrior = priorDashboardWindow(leadsWindow);
  const revenuePrior = priorDashboardWindow(revenueWindow);
  const openPrior = priorDashboardWindow(openWindow);

  // ONE parallel wave for every top tile. The Anfragen and Umsatz numbers
  // (headline, comparison, sparklines) all come from one live read of the
  // per-day rows (`dashboardLiveDays`), not from `kpi_daily`, so they are
  // correct even when no worker job ran.
  const [
    liveDays,
    sourceBreakdown,
    goals,
    statusCounts,
    slaBreaches,
    relationshipStartedAt,
    openLeads,
    openQueue,
    openPriorQueue,
    ltvMap,
  ] = await Promise.all([
    dashboardLiveDays(clinicId, userId, earliestDashboardDay(sp), berlinDay()),
    bySource(clinicId, userId, sourcesWindow.from, sourcesWindow.to),
    currentGoals(clinicId, userId),
    requestStatusCounts(clinicId, userId),
    slaBreachedCount(clinicId, userId),
    getClinicRelationshipStart(clinicId),
    // Top-N open Anfragen for the footer of the Offene-Anfragen tile.
    // Same source-of-truth as the headline count (status='neu'), sorted by
    // SLA-überfällig → oldest. Capped at 3; OpenLeadsList renders a "+N
    // weitere" hint when the headline count exceeds the listed rows.
    openLeadsForDashboard(clinicId, userId, 3),
    openQueueDaily(clinicId, userId, openWindow.from, openWindow.to),
    openQueueDaily(clinicId, userId, openPrior.from, openPrior.to),
    // Lifetime value per source: not window-scoped, shown in each source row.
    ltvBySource(clinicId, userId),
  ]);

  const leadsSummary = summaryForWindow(liveDays, leadsWindow);
  const leadsPriorSummary = summaryForWindow(liveDays, leadsPrior);
  const leadsBreakdown = {
    leads: leadsSummary.leads,
    won: leadsSummary.casesWon,
    priorLeads: leadsPriorSummary.leads,
    leadsDeltaPct:
      leadsPriorSummary.leads > 0
        ? Number(
            ((leadsSummary.leads - leadsPriorSummary.leads) / leadsPriorSummary.leads).toFixed(4)
          )
        : leadsSummary.leads > 0
          ? null
          : 0,
  };
  const revenueSummary = summaryForWindow(liveDays, revenueWindow);

  const leadsGoal = goals.find((g) => g.metric === "leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");
  const openRequests = statusCounts.neu ?? 0;

  // Empty-window hint: the selected Anfragen window has zero leads, yet the
  // Praxis has Anfragen all-time (statusCounts is clinic-wide, not windowed).
  // That's the stale-window case a fresh boot hits ("30 Tage" empty because the
  // newest data is older than 30 days). A brand-new Praxis (no Anfragen at all)
  // is excluded so its day-one empty state is untouched, and we don't offer the
  // link when already on "Max". The link widens every card to Max (same as
  // picking "Max" in the page-level switch).
  const totalRequestsAllTime = Object.values(statusCounts).reduce(
    (sum, n) => sum + n,
    0
  );
  const showEmptyWindowHint =
    leadsBreakdown.leads === 0 &&
    totalRequestsAllTime > 0 &&
    leadsRange !== "max";
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
      leadsBreakdown={leadsBreakdown}
      revenueSummary={revenueSummary}
      sourceBreakdown={sourceBreakdown}
      slaBreaches={slaBreaches}
      openRequests={openRequests}
      leadsGoal={leadsGoal}
      revenueGoal={revenueGoal}
      showRangeLabels={cardsShowOwnRange(sp)}
      leadsRange={leadsRange}
      revenueRange={revenueRange}
      openRange={openRange}
      sourcesRange={sourcesRange}
      relationshipStartedAt={relationshipStartedAt}
      openLeads={openLeads}
      emptyWindowHint={emptyWindowHint}
      hasAnyRequest={totalRequestsAllTime > 0}
      leadsSpark={sparklinesForWindow(liveDays, leadsWindow)}
      leadsPriorSpark={sparklinesForWindow(liveDays, leadsPrior)}
      revenueSpark={sparklinesForWindow(liveDays, revenueWindow)}
      revenuePriorSpark={sparklinesForWindow(liveDays, revenuePrior)}
      openQueue={openQueue}
      openPriorQueue={openPriorQueue}
      ltvMap={ltvMap}
    />
  );
}

async function DashboardDetailLoader({
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
      showRangeLabels={cardsShowOwnRange(sp)}
      funnelRange={funnelRange}
      locationsRange={locationsRange}
      treatmentsRange={treatmentsRange}
      noShowRange={noShowRange}
    />
  );
}

/** Greeting fallback — mirrors loading.tsx's header block so the first paint
 *  and the streamed greeting occupy the same space (no layout shift). */
function GreetingSkeleton() {
  return (
    <div
      aria-busy="true"
      className="flex flex-wrap items-end justify-between gap-4"
    >
      <div className="space-y-2">
        <div className="h-4 w-24 rounded bg-bg-secondary" />
        <div className="h-9 w-48 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-72 rounded bg-bg-secondary" />
      </div>
      <div className="h-5 w-48 rounded bg-bg-secondary" />
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
          className="h-44 animate-pulse rounded-2xl border border-border"
          style={{
            backgroundColor: "var(--bg-card)",
            boxShadow: "var(--shadow-card)",
          }}
        />
      ))}
    </section>
  );
}
