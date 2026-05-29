import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ExplainerPopover,
  MetricStatusBadge,
  MetricTile,
  TrendChart,
  metricStatusFromTone,
  type MetricTileTone,
} from "@eins/ui";
import {
  kpiDailySeriesWithSparklineUncached,
  currentGoals,
} from "@/server/queries/kpis";
import {
  openQueueDailyInRangeWithComparison,
  leadsDailyInRange,
} from "@/server/queries/requests";
import type {
  OpenLeadForDashboard,
} from "@/server/queries/requests";
import type { bySource } from "@/server/queries/attribution";
import {
  formatEuro,
  formatNumber,
  formatRelative,
  toneForGoalRatio,
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
import { BreakdownStackChart } from "../../auswertung/_components/BreakdownStackChart";
import type { BreakdownTone } from "../../auswertung/_components/detail-helpers";
import { SOURCE_LABELS, type RequestSource } from "@/lib/constants";

type Goal = Awaited<ReturnType<typeof currentGoals>>[number];
type SourceBreakdown = Awaited<ReturnType<typeof bySource>>;

export interface LeadsBreakdownSummary {
  leads: number;
  won: number;
  priorLeads: number;
  leadsDeltaPct: number | null;
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
  sourceBreakdown,
  slaBreaches,
  openRequests,
  leadsGoal,
  revenueGoal,
  leadsRange,
  revenueRange,
  openRange,
  sourcesRange,
  relationshipStartedAt,
  openLeads,
}: {
  clinicId: string;
  userId: string;
  leadsBreakdown: LeadsBreakdownSummary;
  revenueSummary: KpiSummary;
  openSummary: KpiSummary;
  sourceBreakdown: SourceBreakdown;
  slaBreaches: number;
  openRequests: number;
  leadsGoal: Goal | undefined;
  revenueGoal: Goal | undefined;
  leadsRange: DashboardRange;
  revenueRange: DashboardRange;
  openRange: DashboardRange;
  sourcesRange: DashboardRange;
  /**
   * Earliest evidence the Praxis has been working with EINS — used to cap
   * monthly-goal scaling so a clinic that's only been live 3 months on a
   * Jahr window isn't compared against a full year's target. Sourced from
   * the minimum of (clinic.createdAt, earliest request, earliest kpi_daily
   * row) so demo / backfilled data is honoured.
   */
  relationshipStartedAt: Date | null;
  /**
   * Top-N open Anfragen (status='neu'), prioritised SLA-überfällig first.
   * Rendered inside the Offene-Anfragen tile, *below* the trend chart, as
   * a clickable call-list. Capped at 3; a "+N weitere" hint derived from
   * the headline `openRequests` signals the rest of the open queue.
   */
  openLeads: OpenLeadForDashboard[];
}) {
  const leadsWin = dashboardRangeWindow(leadsRange);
  const revenueWin = dashboardRangeWindow(revenueRange);
  const openWin = dashboardRangeWindow(openRange);

  // Prior windows — same length, sitting immediately before the current
  // window. Used by each card's grey comparison line ("Vorperiode"). The
  // single-millisecond gap matches the convention in
  // `kpiSummaryWithComparisonUncached` so the periods don't overlap by a day.
  const leadsPriorWin = priorWindow(leadsWin);
  const revenuePriorWin = priorWindow(revenueWin);
  const openPriorWin = priorWindow(openWin);

  // Uncached path — the dashboard's freshness contract (same reason
  // `currentMonthSummary` is uncached). When the user picks a range, they
  // expect "right now" numbers, not last-worker-rebuild numbers.
  const [
    leadsDaily,
    leadsPriorDaily,
    openQueue,
    revenueSpark,
    revenuePriorSpark,
    openPriorQueue,
  ] = await Promise.all([
    // Leads card's headline counts come from `leadsBreakdown` (passed in from
    // page.tsx, computed against the live `requests` table).
    // Here we only fetch the daily series for the sparkline + comparison line.
    leadsDailyInRange(
      clinicId,
      userId,
      leadsWin.from,
      leadsWin.to
    ),
    leadsDailyInRange(
      clinicId,
      userId,
      leadsPriorWin.from,
      leadsPriorWin.to
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
  ]);


  // Goals are stored monthly. Scale them linearly to whatever window the
  // user picked: 30 leads/month → 7 leads/week, 90 leads/quarter, etc.
  // For Praxen that joined EINS partway through the window, cap the
  // effective scaling at the relationship length — otherwise a 3-month-old
  // Praxis viewing "Jahr" gets compared against a full year's target and
  // is unfairly flagged "Redebedarf".
  const leadsScaling = effectiveScalingDays(leadsWin, relationshipStartedAt);
  const revenueScaling = effectiveScalingDays(revenueWin, relationshipStartedAt);
  const leadsScaledTarget = leadsGoal
    ? (Number(leadsGoal.targetValue) * leadsScaling.days) / 30
    : null;
  const revenueScaledTarget = revenueGoal
    ? (Number(revenueGoal.targetValue) * revenueScaling.days) / 30
    : null;
  const leadsCappedLabel = leadsScaling.capped
    ? formatRelationshipDurationDe(leadsScaling.days)
    : null;
  const revenueCappedLabel = revenueScaling.capped
    ? formatRelationshipDurationDe(revenueScaling.days)
    : null;
  const leadsTone: MetricTileTone =
    leadsScaledTarget != null && leadsScaledTarget > 0
      ? toneForGoalRatio(leadsBreakdown.leads / leadsScaledTarget)
      : "accent";
  const revenueTone: MetricTileTone =
    revenueScaledTarget != null && revenueScaledTarget > 0
      ? toneForGoalRatio(revenueSummary.revenueEur / revenueScaledTarget)
      : "accent";

  // "Offene Anfragen" status mirrors the headline tone: any SLA breach is bad,
  // any open queue is a soft warn, otherwise the queue is clean.
  const openTone: MetricTileTone =
    slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good";

  // Source-matrix totals: same row slice as the chart so the footer sums what
  // the user actually sees. ROAS is spend-weighted (Σ revenue / Σ spend) — an
  // arithmetic mean of per-source ROAS over-weights low-spend channels.
  const sourceRows = sourceBreakdown.slice(0, 6);
  const sourceTotals = sourceRows.reduce(
    (acc, r) => {
      acc.leads += r.leads;
      if (r.spendEur != null) acc.spend += r.spendEur;
      acc.revenue += r.revenueEur ?? 0;
      return acc;
    },
    { leads: 0, spend: 0, revenue: 0 },
  );
  const sourceTotalRoas =
    sourceTotals.spend > 0 ? sourceTotals.revenue / sourceTotals.spend : null;
  const sourceTotalRoasTone: BreakdownTone | null = roasToneFor(sourceTotalRoas);
  const leadsToneBySource = rankTones(
    sourceRows.map((r) => ({ key: r.source, value: r.leads })),
    "asc"
  );
  const cplCandidates = sourceRows
    .filter((r) => r.spendEur != null && r.spendEur > 0 && r.leads > 0)
    .map((r) => ({ key: r.source, value: r.spendEur! / r.leads }));
  const budgetToneBySource = rankTones(cplCandidates, "desc");

  return (
    <section
      aria-label="Kennzahlen"
      className="grid gap-5 md:grid-cols-2 md:gap-6"
    >
      <MetricTile
        size="large"
        label="Anfragen"
        labelExtra={
          <>
            <ExplainerPopover term="Anfragen">
              <p>
                Alle ernsthaften Anfragen im gewählten Zeitraum — also alles,
                was nicht als Spam markiert wurde. Was im Portal landet, ist
                durch das Landingpage-Formular bereits vorqualifiziert.
              </p>
              <p className="mt-2">
                Das Monatsziel pflegst du in den Einstellungen — der
                Fortschrittsbalken skaliert automatisch auf den gewählten
                Zeitraum.
              </p>
            </ExplainerPopover>
            <div className="ml-auto">
              <TimeRangeToggle
                value={leadsRange}
                paramKey={DASHBOARD_RANGE_KEYS.leads}
                ariaLabel="Zeitraum für Anfragen"
              />
            </div>
          </>
        }
        value={formatNumber(leadsBreakdown.leads)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(leadsTone)} />
        }
        tone={leadsTone}
        progress={
          leadsScaledTarget != null && leadsScaledTarget > 0
            ? {
                current: leadsBreakdown.leads,
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
          <>
            <ExplainerPopover term="Umsatz">
              <p>
                Bestätigter Umsatz aus gewonnenen Anfragen im gewählten Zeitraum, der konkret über EINS generiert wurde.
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
            <div className="ml-auto">
              <TimeRangeToggle
                value={revenueRange}
                paramKey={DASHBOARD_RANGE_KEYS.revenue}
                ariaLabel="Zeitraum für Umsatz"
              />
            </div>
          </>
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
          <>
            <ExplainerPopover term="Offene Anfragen">
              <p>
                Anfragen mit Status <strong>Neu</strong> — also alles, was noch
                nicht zu Termin, Gewonnen oder Verloren weitergezogen ist.
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
            <div className="ml-auto">
              <TimeRangeToggle
                value={openRange}
                paramKey={DASHBOARD_RANGE_KEYS.open}
                ariaLabel="Zeitraum für Offene Anfragen"
              />
            </div>
          </>
        }
        value={formatNumber(openRequests)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(openTone)} />
        }
        tone={openTone}
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
        belowChartSlot={
          <OpenLeadsList leads={openLeads} totalOpen={openRequests} />
        }
        linkSlot={
          <TileLink
            href="/anfragen?status=neu"
            ariaLabel="Zu offenen Anfragen"
          />
        }
      />
      <Card
        className="print:break-inside-avoid"
        style={{
          backgroundColor: "var(--bg-card)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle>Quellen-Aufschlüsselung</CardTitle>
          <TimeRangeToggle
            value={sourcesRange}
            paramKey={DASHBOARD_RANGE_KEYS.sources}
            ariaLabel="Zeitraum für Quellen-Aufschlüsselung"
          />
        </CardHeader>
        <CardContent>
          <BreakdownStackChart
            centerLabel="Anfragen"
            emptyText="Keine Quellen-Daten."
            legendColumns={[
              { label: "Anfragen" },
              { label: "Budget" },
              { label: "ROAS" },
            ]}
            totalsRow={{
              label: "Gesamt",
              stats: [
                formatNumber(sourceTotals.leads),
                sourceTotals.spend > 0 ? formatEuro(sourceTotals.spend) : null,
                sourceTotalRoas != null
                  ? `${sourceTotalRoas.toFixed(1).replace(".", ",")}×`
                  : null,
              ],
              statTones: [null, null, sourceTotalRoasTone],
            }}
            slices={sourceRows.map((c) => {
              const labelStr =
                SOURCE_LABELS[c.source as RequestSource] ?? c.source;
              return {
                key: c.source,
                labelText: labelStr,
                value: c.leads,
                stats: [
                  formatNumber(c.leads),
                  c.spendEur != null ? formatEuro(c.spendEur) : null,
                  c.roas != null
                    ? `${c.roas.toFixed(1).replace(".", ",")}×`
                    : null,
                ],
                statTones: [
                  leadsToneBySource.get(c.source) ?? null,
                  budgetToneBySource.get(c.source) ?? null,
                  roasToneFor(c.roas),
                ],
                tone: sourceTone(c.source),
              };
            })}
          />
        </CardContent>
      </Card>
    </section>
  );
}

// Distinct slice color per source so the donut never repeats hues.
function sourceTone(source: string): BreakdownTone {
  switch (source) {
    case "meta":
      return "accent";
    case "google":
      return "good";
    case "formular":
      return "warn";
    case "whatsapp":
      return "bad";
    default:
      return "neutral";
  }
}

/** ROAS → tone, shared between per-row and totals row so a 1,2× cell looks the
 *  same regardless of where it appears. Break-even (1×) is the dividing line:
 *  above 2× is comfortably profitable, 1×–2× is fine but margin-thin, below 1×
 *  means the channel costs more than it returns. */
function roasToneFor(roas: number | null | undefined): BreakdownTone | null {
  if (roas == null) return null;
  if (roas >= 2) return "good";
  if (roas >= 1) return "neutral";
  return "warn";
}

/**
 * Rank an array of {key, value} entries and emit tones — top tertile = "good",
 * bottom tertile = "warn", middle stays null. `direction` controls whether
 * larger values are better (`"asc"` → big = good) or smaller (`"desc"` →
 * small = good, used for CPL).
 */
function rankTones(
  entries: { key: string; value: number }[],
  direction: "asc" | "desc",
): Map<string, BreakdownTone> {
  const out = new Map<string, BreakdownTone>();
  if (entries.length < 2) return out;
  const sorted = [...entries].sort((a, b) =>
    direction === "asc" ? b.value - a.value : a.value - b.value
  );
  const tertile = Math.max(1, Math.floor(sorted.length / 3));
  sorted.slice(0, tertile).forEach((e) => out.set(e.key, "good"));
  sorted.slice(sorted.length - tertile).forEach((e) => {
    if (!out.has(e.key)) out.set(e.key, "warn");
  });
  return out;
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
 * Open-Anfragen list rendered inside the Offene-Anfragen tile, below the
 * trend chart. Same source-of-truth as the headline number (status='neu')
 * sorted überfällig first then oldest, so the row order matches the
 * action priority the MFA should follow.
 *
 * `leads` is already capped at 3; `totalOpen` is the headline count and
 * drives the "+N weitere" hint when more open Anfragen exist than are
 * listed. Empty state returns null so the slot collapses cleanly.
 */
function OpenLeadsList({
  leads,
  totalOpen,
}: {
  leads: OpenLeadForDashboard[];
  totalOpen: number;
}) {
  if (leads.length === 0) return null;
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <ul className="space-y-1 text-sm">
        {leads.map((r) => {
          const name = r.contactName ?? "Unbekannt";
          const rightChip = r.slaBreached ? (
            <span className="text-xs font-medium text-tone-bad">
              Seit 3h+ überfällig
            </span>
          ) : (
            <span className="tabular-nums text-xs text-fg-secondary">
              {formatRelative(r.createdAt)}
            </span>
          );
          return (
            <li key={r.id}>
              <Link
                href={`/anfragen/${r.id}`}
                className="-mx-2 block rounded-md px-2 py-1.5 hover:bg-bg-tertiary"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium text-fg-primary">
                      {name}
                    </span>
                    {r.treatmentLabel && (
                      <span className="truncate text-xs text-fg-secondary">
                        {r.treatmentLabel}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {rightChip}
                    <ChevronRight
                      aria-hidden
                      className="h-3.5 w-3.5 text-fg-tertiary"
                    />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
        {totalOpen > leads.length && (
          <li>
            <Link
              href="/anfragen?status=neu"
              className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-fg-tertiary transition-colors hover:bg-bg-tertiary hover:text-fg-secondary"
            >
              <span>
                +{formatNumber(totalOpen - leads.length)} weitere offen
              </span>
              <MoreHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
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
