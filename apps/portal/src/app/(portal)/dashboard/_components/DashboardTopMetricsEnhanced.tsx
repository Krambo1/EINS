import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ExplainerPopover,
  MetricStatusBadge,
  MetricTile,
  TrendChart,
  metricStatusFromTone,
  type MetricTileTone,
} from "@eins/ui";
import {
  kpiSummaryWithComparisonUncached,
  kpiDailySeriesWithSparklineUncached,
  currentGoals,
} from "@/server/queries/kpis";
import {
  totalRequestsDailyInRange,
  openQueueDailyInRangeWithComparison,
  qualifiedLeadsDailyInRange,
} from "@/server/queries/requests";
import {
  formatEuro,
  formatNumber,
  toneForGoalRatio,
  deltaTone,
} from "@/lib/formatting";
import { zipSeries } from "@/lib/chart-data";
import type { KpiSummary } from "@/server/queries/kpis";
import {
  DASHBOARD_RANGE_KEYS,
  dashboardRangeWindow,
  effectiveScalingDays,
  formatRelationshipDurationDe,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "./TimeRangeToggle";

type Goal = Awaited<ReturnType<typeof currentGoals>>[number];

export interface TotalRequestsSummary {
  current: number;
  qualified: number;
  prior: number;
  deltaPct: number | null;
}

export interface LeadsBreakdownSummary {
  qualified: number;
  won: number;
  qualifiedPrior: number;
  qualifiedDeltaPct: number | null;
}

/**
 * Detail-mode top-metrics tile grid: enriches the base SimpleMetric grid
 * with delta vs prior period + per-card sparklines over each card's
 * independently selected `range`. Wrapped in <Suspense> with the
 * SimpleMetric grid as fallback so the page paints before this component's
 * parallel queries finish.
 */
export async function DashboardTopMetricsEnhanced({
  clinicId,
  userId,
  leadsBreakdown,
  revenueSummary,
  openSummary,
  totalSummary,
  slaBreaches,
  openRequests,
  leadsGoal,
  revenueGoal,
  totalGoal,
  leadsRange,
  revenueRange,
  openRange,
  totalRange,
  relationshipStartedAt,
}: {
  clinicId: string;
  userId: string;
  leadsBreakdown: LeadsBreakdownSummary;
  revenueSummary: KpiSummary;
  openSummary: KpiSummary;
  totalSummary: TotalRequestsSummary;
  slaBreaches: number;
  openRequests: number;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
  totalGoal: Goal | undefined;
  leadsRange: DashboardRange;
  revenueRange: DashboardRange;
  openRange: DashboardRange;
  totalRange: DashboardRange;
  /**
   * Earliest evidence the Praxis has been working with EINS — used to cap
   * monthly-goal scaling so a clinic that's only been live 3 months on a
   * Jahr window isn't compared against a full year's target. Sourced from
   * the minimum of (clinic.createdAt, earliest request, earliest kpi_daily
   * row) so demo / backfilled data is honoured.
   */
  relationshipStartedAt: Date | null;
}) {
  const leadsWin = dashboardRangeWindow(leadsRange);
  const revenueWin = dashboardRangeWindow(revenueRange);
  const openWin = dashboardRangeWindow(openRange);
  const totalWin = dashboardRangeWindow(totalRange);

  // Prior windows — same length, sitting immediately before the current
  // window. Used by each card's grey comparison line ("Vorperiode"). The
  // single-millisecond gap matches the convention in
  // `kpiSummaryWithComparisonUncached` so the periods don't overlap by a day.
  const leadsPriorWin = priorWindow(leadsWin);
  const revenuePriorWin = priorWindow(revenueWin);
  const openPriorWin = priorWindow(openWin);
  const totalPriorWin = priorWindow(totalWin);

  // Uncached path — the dashboard's freshness contract (same reason
  // `currentMonthSummary` is uncached). When the user picks a range, they
  // expect "right now" numbers, not last-worker-rebuild numbers.
  const [
    leadsDaily,
    leadsPriorDaily,
    revenueComparison,
    openQueue,
    revenueSpark,
    totalSpark,
    revenuePriorSpark,
    openPriorQueue,
    totalPriorSpark,
  ] = await Promise.all([
    // Leads card's headline counts come from `leadsBreakdown` (passed in from
    // page.tsx, computed against the live `requests` table — same source as
    // `totalSummary` so qualified ≤ total is mathematically guaranteed).
    // Here we only fetch the daily series for the sparkline + comparison line.
    qualifiedLeadsDailyInRange(
      clinicId,
      userId,
      leadsWin.from,
      leadsWin.to
    ),
    qualifiedLeadsDailyInRange(
      clinicId,
      userId,
      leadsPriorWin.from,
      leadsPriorWin.to
    ),
    kpiSummaryWithComparisonUncached(
      clinicId,
      userId,
      revenueWin.from,
      revenueWin.to
    ),
    openQueueDailyInRangeWithComparison(
      clinicId,
      userId,
      openWin.from,
      openWin.to
    ),
    kpiDailySeriesWithSparklineUncached(
      clinicId,
      userId,
      revenueWin.from,
      revenueWin.to
    ),
    totalRequestsDailyInRange(
      clinicId,
      userId,
      totalWin.from,
      totalWin.to
    ),
    kpiDailySeriesWithSparklineUncached(
      clinicId,
      userId,
      revenuePriorWin.from,
      revenuePriorWin.to
    ),
    openQueueDailyInRangeWithComparison(
      clinicId,
      userId,
      openPriorWin.from,
      openPriorWin.to
    ),
    totalRequestsDailyInRange(
      clinicId,
      userId,
      totalPriorWin.from,
      totalPriorWin.to
    ),
  ]);

  // Goals are stored monthly. Scale them linearly to whatever window the
  // user picked: 30 leads/month → 7 leads/week, 90 leads/quarter, etc.
  // For Praxen that joined EINS partway through the window, cap the
  // effective scaling at the relationship length — otherwise a 3-month-old
  // Praxis viewing "Jahr" gets compared against a full year's target and
  // is unfairly flagged "Redebedarf".
  const leadsScaling = effectiveScalingDays(leadsWin, relationshipStartedAt);
  const revenueScaling = effectiveScalingDays(revenueWin, relationshipStartedAt);
  const totalScaling = effectiveScalingDays(totalWin, relationshipStartedAt);
  const leadsScaledTarget = leadsGoal
    ? (Number(leadsGoal.targetValue) * leadsScaling.days) / 30
    : null;
  const revenueScaledTarget = revenueGoal
    ? (Number(revenueGoal.targetValue) * revenueScaling.days) / 30
    : null;
  const totalScaledTarget = totalGoal
    ? (Number(totalGoal.targetValue) * totalScaling.days) / 30
    : null;
  const leadsCappedLabel = leadsScaling.capped
    ? formatRelationshipDurationDe(leadsScaling.days)
    : null;
  const revenueCappedLabel = revenueScaling.capped
    ? formatRelationshipDurationDe(revenueScaling.days)
    : null;
  const totalCappedLabel = totalScaling.capped
    ? formatRelationshipDurationDe(totalScaling.days)
    : null;
  const leadsTone: MetricTileTone =
    leadsScaledTarget != null && leadsScaledTarget > 0
      ? toneForGoalRatio(leadsBreakdown.qualified / leadsScaledTarget)
      : "accent";
  const revenueTone: MetricTileTone =
    revenueScaledTarget != null && revenueScaledTarget > 0
      ? toneForGoalRatio(revenueSummary.revenueEur / revenueScaledTarget)
      : "accent";

  // "Anfragen gesamt" prefers the goal-ratio tone (matches the leads/revenue
  // cards) when an active total_requests target exists; otherwise falls back
  // to the period-over-period delta.
  const totalTone: MetricTileTone =
    totalScaledTarget != null && totalScaledTarget > 0
      ? toneForGoalRatio(totalSummary.current / totalScaledTarget)
      : deltaTone(totalSummary.deltaPct);

  // "Offene Anfragen" status mirrors the headline tone: any SLA breach is bad,
  // any open queue is a soft warn, otherwise the queue is clean.
  const openTone: MetricTileTone =
    slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good";

  return (
    <section
      aria-label="Kennzahlen"
      className="grid gap-5 md:grid-cols-2 md:gap-6"
    >
      <MetricTile
        size="large"
        label="Qualifizierte Anfragen"
        labelExtra={
          <ExplainerPopover term="Qualifizierte Anfragen">
            <p>
              Anfragen, die zu deinem Wunschpatienten passen — Budget,
              Behandlung und Standort stimmen.
            </p>
            <p className="mt-2">
              Das Monatsziel pflegst du in den Einstellungen — der
              Fortschrittsbalken skaliert automatisch auf den gewählten
              Zeitraum.
            </p>
          </ExplainerPopover>
        }
        value={formatNumber(leadsBreakdown.qualified)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(leadsTone)} />
        }
        tone={leadsTone}
        progress={
          leadsScaledTarget != null && leadsScaledTarget > 0
            ? {
                current: leadsBreakdown.qualified,
                target: leadsScaledTarget,
              }
            : undefined
        }
        hint={
          leadsCappedLabel ? (
            <span className="text-fg-tertiary">
              Ziel auf Laufzeit der Praxis angepasst ({leadsCappedLabel})
            </span>
          ) : undefined
        }
        controls={
          <TimeRangeToggle
            value={leadsRange}
            paramKey={DASHBOARD_RANGE_KEYS.leads}
            ariaLabel="Zeitraum für Qualifizierte Anfragen"
          />
        }
        chartSlot={
          <TrendChart
            data={zipSeries(leadsDaily.dates, leadsDaily.counts)}
            comparisonData={zipSeries(leadsPriorDaily.dates, leadsPriorDaily.counts)}
            tone="accent"
            label="Anfragen"
            valueFormat="number"
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
        }
        linkSlot={
          <TileLink href="/anfragen" ariaLabel="Zu allen Anfragen" />
        }
      />
      <MetricTile
        size="large"
        label="Umsatz"
        labelExtra={
          <ExplainerPopover term="Umsatz">
            <p>
              Bestätigter Umsatz aus gewonnenen Anfragen im gewählten Zeitraum.
            </p>
            <p className="mt-2">
              <strong>ROAS</strong> (Return on Ad Spend) sagt: für jeden 1 €
              Werbeausgabe kommen X € Umsatz zurück.
            </p>
            <p className="mt-2">
              Das Monatsziel pflegst du in den Einstellungen — der
              Fortschrittsbalken skaliert automatisch auf den gewählten
              Zeitraum.
            </p>
          </ExplainerPopover>
        }
        value={formatEuro(revenueSummary.revenueEur)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(revenueTone)} />
        }
        tone={revenueTone}
        progress={
          revenueScaledTarget != null && revenueScaledTarget > 0
            ? {
                current: revenueSummary.revenueEur,
                target: revenueScaledTarget,
                formatTarget: formatEuro,
              }
            : undefined
        }
        hint={
          revenueCappedLabel ? (
            <span className="text-fg-tertiary">
              Ziel auf Laufzeit der Praxis angepasst ({revenueCappedLabel})
            </span>
          ) : undefined
        }
        controls={
          <TimeRangeToggle
            value={revenueRange}
            paramKey={DASHBOARD_RANGE_KEYS.revenue}
            ariaLabel="Zeitraum für Umsatz"
          />
        }
        chartSlot={
          <TrendChart
            data={zipSeries(revenueSpark.sparklines.dates, revenueSpark.sparklines.revenueEur)}
            comparisonData={zipSeries(
              revenuePriorSpark.sparklines.dates,
              revenuePriorSpark.sparklines.revenueEur
            )}
            tone="accent"
            label="Umsatz"
            valueFormat="euro"
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
        }
        linkSlot={<TileLink href="/auswertung" ariaLabel="Zur Auswertung" />}
      />
      <MetricTile
        size="large"
        label="Offene Anfragen"
        labelExtra={
          <ExplainerPopover term="Offene Anfragen">
            <p>
              Anfragen mit Status <strong>Neu</strong> oder{" "}
              <strong>Qualifiziert</strong> — also alles, was noch nicht zu
              Termin, Gewonnen oder Verloren weitergezogen ist.
            </p>
            <p className="mt-2">
              <strong>Überfällig</strong> heißt: noch kein erster Kontakt
              versucht, obwohl die Anfrage älter als 3 Stunden ist.
            </p>
            <p className="mt-2">
              Zum Abarbeiten: Anfrage öffnen → Anruf protokollieren → Status auf{" "}
              <em>Termin vereinbart</em>, <em>Verloren</em> oder <em>Spam</em>{" "}
              ändern.
            </p>
          </ExplainerPopover>
        }
        value={formatNumber(openRequests)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(openTone)} />
        }
        tone={openTone}
        controls={
          <TimeRangeToggle
            value={openRange}
            paramKey={DASHBOARD_RANGE_KEYS.open}
            ariaLabel="Zeitraum für Offene Anfragen"
          />
        }
        chartSlot={
          <TrendChart
            data={zipSeries(openQueue.dates, openQueue.counts)}
            comparisonData={zipSeries(openPriorQueue.dates, openPriorQueue.counts)}
            tone={openTone}
            label="Offen am Tagesende"
            valueFormat="number"
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
        }
        linkSlot={
          <TileLink
            href="/anfragen?status=neu,qualifiziert"
            ariaLabel="Zu offenen Anfragen"
          />
        }
      />
      <MetricTile
        size="large"
        label="Anfragen gesamt"
        labelExtra={
          <ExplainerPopover term="Anfragen gesamt">
            <p>
              Alle Anfragen, die im gewählten Zeitraum reingekommen sind —
              egal ob Spam, Termin oder verloren.
            </p>
            <p className="mt-2">
              <strong>Qualifizierungsquote</strong> = qualifizierte Anfragen ÷
              alle Anfragen. Zeigt, wie sauber dein Funnel filtert.
            </p>
            <p className="mt-2">
              Niedrige Quote? → Targeting prüfen oder
              Vorqualifizierungsfragen nachschärfen.
            </p>
          </ExplainerPopover>
        }
        value={formatNumber(totalSummary.current)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(totalTone)} />
        }
        tone={totalScaledTarget != null && totalScaledTarget > 0 ? totalTone : "neutral"}
        progress={
          totalScaledTarget != null && totalScaledTarget > 0
            ? {
                current: totalSummary.current,
                target: totalScaledTarget,
              }
            : undefined
        }
        hint={
          totalCappedLabel ? (
            <span className="text-fg-tertiary">
              Ziel auf Laufzeit der Praxis angepasst ({totalCappedLabel})
            </span>
          ) : undefined
        }
        controls={
          <TimeRangeToggle
            value={totalRange}
            paramKey={DASHBOARD_RANGE_KEYS.total}
            ariaLabel="Zeitraum für Anfragen gesamt"
          />
        }
        chartSlot={
          <TrendChart
            data={zipSeries(totalSpark.dates, totalSpark.counts)}
            comparisonData={zipSeries(totalPriorSpark.dates, totalPriorSpark.counts)}
            tone="accent"
            label="Anfragen"
            valueFormat="number"
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
        }
        linkSlot={
          <TileLink href="/anfragen" ariaLabel="Zu allen Anfragen" />
        }
      />
    </section>
  );
}

/**
 * Equivalent prior window — same number of days, ending one millisecond
 * before `win.from` so the two ranges don't overlap by a day. Mirrors the
 * convention in `kpiSummaryWithComparisonUncached`.
 */
function priorWindow(win: { from: Date; to: Date; days: number }): {
  from: Date;
  to: Date;
  days: number;
} {
  const lengthMs = win.to.getTime() - win.from.getTime();
  const priorTo = new Date(win.from.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - lengthMs);
  return { from: priorFrom, to: priorTo, days: win.days };
}

/**
 * Inner anchor used as `linkSlot` for MetricTile. MetricTile takes care of
 * positioning the link layer over the card's upper region; this just
 * supplies the actual Next-Link node with the focus-ring styles.
 */
function TileLink({
  href,
  ariaLabel,
}: {
  href: string;
  ariaLabel: string;
}): ReactNode {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
    />
  );
}

