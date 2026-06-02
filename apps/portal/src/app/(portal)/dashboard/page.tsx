import { Suspense } from "react";
import { requireSession } from "@/auth/guards";
import type { CurrencyCode } from "@/lib/formatting";
import {
  currentGoals,
  kpiSummary,
  kpiSummaryUncached,
} from "@/server/queries/kpis";
import {
  requestStatusCounts,
  slaBreachedCount,
  leadsInRangeWithComparison,
  openLeadsForDashboard,
} from "@/server/queries/requests";
import { bySource } from "@/server/queries/attribution";
import { getClinicRelationshipStart } from "@/server/queries/clinic";
import {
  DASHBOARD_RANGE_KEYS,
  dashboardRangeWindow,
  parseDashboardRange,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { DashboardTopMetricsEnhanced } from "./_components/DashboardTopMetricsEnhanced";
import { DashboardDetailBundle } from "./_components/DashboardDetailBundle";
import { DetailBundleSkeleton } from "./_components/DetailBundleSkeleton";
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
  const h = d.getHours();
  if (h >= 5 && h < 10) return "Guten Morgen";
  if (h >= 10 && h < 17) return "Guten Tag";
  if (h >= 17 && h < 22) return "Guten Abend";
  return "Gute Nacht";
}

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
  const sourcesRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.sources]);
  const funnelRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.funnel]);
  const locationsRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.locations]);
  const treatmentsRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.treatments]);
  const noShowRange = parseDashboardRange(sp[DASHBOARD_RANGE_KEYS.noShow]);

  const now = new Date();
  const greeting = germanGreeting(now);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">{greeting},</p>
          <h1 className="text-3xl font-semibold md:text-4xl">
            {session.fullName ?? session.email.split("@")[0]}.
          </h1>
          <p className="mt-2 text-base text-fg-primary md:text-lg">
            So läuft es aktuell in Ihrer Praxis.
          </p>
        </div>
        <div className="text-sm text-fg-secondary">
          {now.toLocaleDateString("de-DE", {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>

      {/* Top metrics — four MetricTile cards, each with its own range toggle.
          Data fetching happens INSIDE this Suspense boundary's child so the
          shell (greeting + date) paints immediately and TTFB is no longer
          held hostage by the parallel range-window queries. */}
      <Suspense fallback={<TopMetricsSkeleton />}>
        <DashboardTopMetricsLoader
          clinicId={session.clinicId}
          userId={session.userId}
          currency={session.currency}
          leadsRange={leadsRange}
          revenueRange={revenueRange}
          openRange={openRange}
          sourcesRange={sourcesRange}
        />
      </Suspense>

      {/* Forecast strip — three numbers (Pipeline-Wert, 30d, 90d).
          Hidden during cold-start (sample < MIN_SAMPLE_WON). Suspense so
          the snapshot read doesn't block the shell. */}
      <Suspense fallback={null}>
        <ForecastStrip
          clinicId={session.clinicId}
          userId={session.userId}
          currency={session.currency}
        />
      </Suspense>

      {/* Anomaly alerts: rule-based detection with optional KI-sauce on the
          rare extreme/multi-signal cases. Own Suspense so a slow alerts
          read never blocks the deep-dive bundle and vice versa. */}
      <Suspense fallback={<AnomalyAlertsSkeleton />}>
        <AnomalyAlertsWidget
          clinicId={session.clinicId}
          userId={session.userId}
        />
      </Suspense>

      {/* Deep dive — streamed inside Suspense so the shell paints before its
          8 parallel queries finish. */}
      <Suspense fallback={<DetailBundleSkeleton />}>
        <DashboardDetailLoader
          clinicId={session.clinicId}
          userId={session.userId}
          currency={session.currency}
          funnelRange={funnelRange}
          locationsRange={locationsRange}
          treatmentsRange={treatmentsRange}
          noShowRange={noShowRange}
        />
      </Suspense>
    </div>
  );
}

async function DashboardTopMetricsLoader({
  clinicId,
  userId,
  currency,
  leadsRange,
  revenueRange,
  openRange,
  sourcesRange,
}: {
  clinicId: string;
  userId: string;
  currency: CurrencyCode;
  leadsRange: DashboardRange;
  revenueRange: DashboardRange;
  openRange: DashboardRange;
  sourcesRange: DashboardRange;
}) {
  const leadsWindow = dashboardRangeWindow(leadsRange);
  const revenueWindow = dashboardRangeWindow(revenueRange);
  const openWindow = dashboardRangeWindow(openRange);
  const sourcesWindow = dashboardRangeWindow(sourcesRange);

  const [
    leadsBreakdown,
    revenueSummary,
    openSummary,
    sourceBreakdown,
    goals,
    statusCounts,
    slaBreaches,
    relationshipStartedAt,
    openLeads,
  ] = await Promise.all([
    leadsInRangeWithComparison(
      clinicId,
      userId,
      leadsWindow.from,
      leadsWindow.to
    ),
    // Cached version (60 s default cap + worker `revalidateTag('kpi:<id>')`
    // on rebuilds keeps freshness). The brief intra-day staleness is the
    // explicit tradeoff for cutting two ~340 ms calls per dashboard render.
    kpiSummary(clinicId, userId, revenueWindow.from, revenueWindow.to),
    kpiSummary(clinicId, userId, openWindow.from, openWindow.to),
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
  ]);

  const leadsGoal = goals.find((g) => g.metric === "leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");
  const openRequests = statusCounts.neu ?? 0;

  return (
    <DashboardTopMetricsEnhanced
      clinicId={clinicId}
      userId={userId}
      currency={currency}
      leadsBreakdown={leadsBreakdown}
      revenueSummary={revenueSummary}
      openSummary={openSummary}
      sourceBreakdown={sourceBreakdown}
      slaBreaches={slaBreaches}
      openRequests={openRequests}
      leadsGoal={leadsGoal}
      revenueGoal={revenueGoal}
      leadsRange={leadsRange}
      revenueRange={revenueRange}
      openRange={openRange}
      sourcesRange={sourcesRange}
      relationshipStartedAt={relationshipStartedAt}
      openLeads={openLeads}
    />
  );
}

async function DashboardDetailLoader({
  clinicId,
  userId,
  currency,
  funnelRange,
  locationsRange,
  treatmentsRange,
  noShowRange,
}: {
  clinicId: string;
  userId: string;
  currency: CurrencyCode;
  funnelRange: DashboardRange;
  locationsRange: DashboardRange;
  treatmentsRange: DashboardRange;
  noShowRange: DashboardRange;
}) {
  // Funnel card now owns its own time window via the rFunnel param. The
  // dashboard's freshness contract is "today's numbers within seconds", so
  // we go through kpiSummaryUncached for both current and prior — the prior
  // is needed for the cost-per-lead delta chip on the funnel footer.
  const win = dashboardRangeWindow(funnelRange);
  const lengthMs = win.to.getTime() - win.from.getTime();
  const priorTo = new Date(win.from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - lengthMs);
  const [summary, priorSummary] = await Promise.all([
    kpiSummaryUncached(clinicId, userId, win.from, win.to),
    kpiSummaryUncached(clinicId, userId, priorFrom, priorTo),
  ]);
  return (
    <DashboardDetailBundle
      clinicId={clinicId}
      userId={userId}
      currency={currency}
      summary={summary}
      priorSummary={priorSummary}
      funnelRange={funnelRange}
      locationsRange={locationsRange}
      treatmentsRange={treatmentsRange}
      noShowRange={noShowRange}
    />
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
