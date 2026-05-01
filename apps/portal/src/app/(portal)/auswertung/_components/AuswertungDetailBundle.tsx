import "server-only";
import { Star } from "lucide-react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Sparkline,
} from "@eins/ui";
import { BarChart3 } from "lucide-react";
import {
  kpiSummaryWithComparison,
  kpiDailySeriesWithSparkline,
  kpiSummary,
  kpiDailySeries,
} from "@/server/queries/kpis";
import {
  bySource,
  byChannel,
  byCampaign,
  byTreatment,
  byLocation,
} from "@/server/queries/attribution";
import {
  responseTimeStats,
  responseTimeSeries,
  aiScoreDistribution,
  weekdayHeatmap,
  hourlyHeatmap,
  cohortRetention,
  staffPerformance,
} from "@/server/queries/lifecycle";
import {
  topPatientsByLtv,
  ltvByChannel,
} from "@/server/queries/patients";
import { latestReviews, reviewTrend } from "@/server/queries/reviews";
import { listLocations } from "@/server/queries/locations";
import {
  formatEuro,
  formatNumber,
  formatDate,
  formatPercent,
  formatMinutes,
  formatDeltaPct,
} from "@/lib/formatting";
import {
  SOURCE_LABELS,
  type RequestSource,
} from "@/lib/constants";
import {
  BreakdownBars,
  FunnelVisualization,
  WeekdayHeatmap,
  HourlyHeatmap,
  ScoreDistribution,
  DataTable,
} from "./detail-helpers";
import type { KpiSummary } from "@/server/queries/kpis";

/**
 * Heavy detail bundle for /auswertung — 18 parallel queries fetched here so
 * the page header, period nav, and base SimpleMetric grid can paint before
 * any of these resolve. Wrapped in <Suspense> at the page level.
 */
export async function AuswertungDetailBundle({
  clinicId,
  userId,
  from,
  to,
  label,
  summary,
  series,
}: {
  clinicId: string;
  userId: string;
  from: Date;
  to: Date;
  label: string;
  summary: KpiSummary;
  series: Awaited<ReturnType<typeof kpiDailySeries>>;
}) {
  const [
    comparison,
    sparklineData,
    sourceBreakdown,
    channelBreakdown,
    topCampaigns,
    treatmentBreakdown,
    locationBreakdown,
    locations,
    responseTime,
    responseTimeSeriesRows,
    aiBuckets,
    weekday,
    hourly,
    cohorts,
    staff,
    topPatients,
    ltvByChannelRows,
    reviews,
    reviewTrendRows,
  ] = await Promise.all([
    kpiSummaryWithComparison(clinicId, userId, from, to),
    kpiDailySeriesWithSparkline(clinicId, userId, from, to),
    bySource(clinicId, userId, from, to),
    byChannel(clinicId, userId, from, to),
    byCampaign(clinicId, userId, from, to, 10),
    byTreatment(clinicId, userId, from, to),
    byLocation(clinicId, userId, from, to),
    listLocations(clinicId, userId),
    responseTimeStats(clinicId, userId, from, to),
    responseTimeSeries(clinicId, userId, from, to),
    aiScoreDistribution(clinicId, userId, from, to),
    weekdayHeatmap(clinicId, userId, from, to),
    hourlyHeatmap(clinicId, userId, from, to),
    cohortRetention(clinicId, userId, 8),
    staffPerformance(clinicId, userId, from, to),
    topPatientsByLtv(clinicId, userId, 10),
    ltvByChannel(clinicId, userId),
    latestReviews(clinicId, userId),
    reviewTrend(clinicId, userId, 6),
  ]);

  const sparklines = sparklineData.sparklines;
  const noShowSeries = sparklineData.rows.map((r) => ({
    date: r.date,
    rate: r.noShowRate ? Number(r.noShowRate) : 0,
  }));

  return (
    <>
      {/* Daily mini charts replace the table-as-default. */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Tagesverlauf</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {series.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-8 w-8" />}
              title="Noch keine Tageswerte"
              description={`Für ${label} liegen noch keine Daten vor.`}
            />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <DailyMiniChart
                  label="Qualifizierte Anfragen"
                  values={sparklines.qualifiedLeads}
                  tone="accent"
                />
                <DailyMiniChart
                  label="Behandlungen gewonnen"
                  values={sparklines.casesWon}
                  tone="good"
                />
                <DailyMiniChart
                  label="Werbebudget pro Tag"
                  values={sparklines.spendEur}
                  tone="neutral"
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                  Werbeertrag (ROAS)
                </div>
                <Sparkline values={sparklines.roas} tone="accent" height={80} />
              </div>

              <Accordion type="single" collapsible>
                <AccordionItem value="table">
                  <AccordionTrigger>Daten als Tabelle anzeigen</AccordionTrigger>
                  <AccordionContent>
                    <SeriesTable series={series} summary={summary} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trichter-Quoten with delta */}
      {summary.qualifiedLeads > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Trichter-Quoten (mit Vergleich)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FunnelStat
              label="Anfrage → Termin"
              value={formatPercent(summary.appointments / summary.qualifiedLeads)}
              hint={deltaHint(comparison.delta.appointmentsPct)}
            />
            <FunnelStat
              label="Termin → Beratung"
              value={
                summary.appointments > 0
                  ? formatPercent(summary.consultationsHeld / summary.appointments)
                  : "–"
              }
            />
            <FunnelStat
              label="Beratung → Gewonnen"
              value={
                summary.consultationsHeld > 0
                  ? formatPercent(summary.casesWon / summary.consultationsHeld)
                  : "–"
              }
              hint={deltaHint(comparison.delta.casesWonPct)}
            />
          </CardContent>
        </Card>
      )}

      {/* Funnel visualization */}
      {summary.qualifiedLeads > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Trichter-Visualisierung</CardTitle>
          </CardHeader>
          <CardContent>
            <FunnelVisualization
              stages={[
                {
                  label: "Anfragen",
                  value: summary.qualifiedLeads,
                  hint: formatPercent(1),
                },
                {
                  label: "Termine",
                  value: summary.appointments,
                  hint: formatPercent(
                    summary.appointments / Math.max(1, summary.qualifiedLeads)
                  ),
                },
                {
                  label: "Beratungen",
                  value: summary.consultationsHeld,
                  hint: formatPercent(
                    summary.consultationsHeld / Math.max(1, summary.qualifiedLeads)
                  ),
                },
                {
                  label: "Gewonnen",
                  value: summary.casesWon,
                  hint: formatPercent(
                    summary.casesWon / Math.max(1, summary.qualifiedLeads)
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Source breakdown */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Quellen-Aufschlüsselung</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={[
              {
                key: "source",
                header: "Quelle",
                render: (r) => SOURCE_LABELS[r.source as RequestSource] ?? r.source,
              },
              {
                key: "leads",
                header: "Anfragen",
                align: "right",
                render: (r) => formatNumber(r.leads),
              },
              {
                key: "appointments",
                header: "Termine",
                align: "right",
                render: (r) => formatNumber(r.appointments),
              },
              {
                key: "casesWon",
                header: "Gewonnen",
                align: "right",
                render: (r) => formatNumber(r.casesWon),
              },
              {
                key: "spendEur",
                header: "Budget",
                align: "right",
                render: (r) => (r.spendEur != null ? formatEuro(r.spendEur) : "–"),
              },
              {
                key: "cpqlEur",
                header: "CPL",
                align: "right",
                render: (r) => (r.cpqlEur != null ? formatEuro(r.cpqlEur) : "–"),
              },
              {
                key: "cacEur",
                header: "CAC",
                align: "right",
                render: (r) => (r.cacEur != null ? formatEuro(r.cacEur) : "–"),
              },
              {
                key: "revenueEur",
                header: "Umsatz",
                align: "right",
                render: (r) => formatEuro(r.revenueEur),
              },
              {
                key: "roas",
                header: "ROAS",
                align: "right",
                render: (r) =>
                  r.roas != null
                    ? r.roas.toFixed(2).replace(".", ",") + "×"
                    : "–",
              },
            ]}
            rows={sourceBreakdown}
            empty="Keine Anfragen mit zugeordneten Quellen."
          />
        </CardContent>
      </Card>

      {/* Channel rollup */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Kanal-Zusammenfassung</CardTitle>
        </CardHeader>
        <CardContent>
          <BreakdownBars
            rows={channelBreakdown.map((c) => ({
              label: channelLabel(c.source),
              value: c.leads,
              hint: (
                <>
                  {formatNumber(c.leads)}
                  {c.spendEur != null && (
                    <span className="text-fg-tertiary">
                      {" "}
                      · {formatEuro(c.spendEur)}
                    </span>
                  )}
                </>
              ),
              tone:
                c.source === "meta"
                  ? "accent"
                  : c.source === "google"
                  ? "good"
                  : "neutral",
            }))}
          />
        </CardContent>
      </Card>

      {/* Top campaigns */}
      {topCampaigns.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Top Kampagnen</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={topCampaigns}
              columns={[
                {
                  key: "campaignName",
                  header: "Kampagne",
                  render: (r) => (
                    <span className="font-medium text-fg-primary">{r.campaignName}</span>
                  ),
                },
                {
                  key: "source",
                  header: "Quelle",
                  render: (r) => SOURCE_LABELS[r.source as RequestSource] ?? r.source,
                },
                {
                  key: "leads",
                  header: "Anfragen",
                  align: "right",
                  render: (r) => formatNumber(r.leads),
                },
                {
                  key: "casesWon",
                  header: "Gewonnen",
                  align: "right",
                  render: (r) => formatNumber(r.casesWon),
                },
                {
                  key: "revenueEur",
                  header: "Umsatz",
                  align: "right",
                  render: (r) => formatEuro(r.revenueEur),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Treatment breakdown */}
      {treatmentBreakdown.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Behandlungs-Aufschlüsselung</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={treatmentBreakdown}
              columns={[
                {
                  key: "treatmentName",
                  header: "Behandlung",
                  render: (r) => r.treatmentName,
                },
                {
                  key: "leads",
                  header: "Anfragen",
                  align: "right",
                  render: (r) => formatNumber(r.leads),
                },
                {
                  key: "casesWon",
                  header: "Gewonnen",
                  align: "right",
                  render: (r) => formatNumber(r.casesWon),
                },
                {
                  key: "revenueEur",
                  header: "Umsatz",
                  align: "right",
                  render: (r) => formatEuro(r.revenueEur),
                },
                {
                  key: "avgCaseValueEur",
                  header: "Ø Fall",
                  align: "right",
                  render: (r) =>
                    r.avgCaseValueEur != null ? formatEuro(r.avgCaseValueEur) : "–",
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Response-time analysis */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Reaktionszeit-Analyse</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            <FunnelStat
              label="Ø Reaktionszeit"
              value={formatMinutes(responseTime.avgMinutes)}
            />
            <FunnelStat
              label="Median"
              value={formatMinutes(responseTime.medianMinutes)}
            />
            <FunnelStat
              label="P90"
              value={formatMinutes(responseTime.p90Minutes)}
            />
            <FunnelStat
              label="SLA-Bruch"
              value={
                responseTime.slaBreachRate != null
                  ? formatPercent(responseTime.slaBreachRate)
                  : "–"
              }
            />
          </div>
          {responseTimeSeriesRows.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                Tagesverlauf (Ø Minuten)
              </div>
              <Sparkline
                values={responseTimeSeriesRows.map((r) => r.avgMinutes)}
                tone="warn"
                height={64}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* No-show rate */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>No-Show-Quote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="font-display text-3xl font-semibold tabular-nums">
            {noShowSeries.length > 0
              ? formatPercent(
                  noShowSeries.reduce((s, r) => s + r.rate, 0) / noShowSeries.length
                )
              : "–"}
          </div>
          <Sparkline
            values={noShowSeries.map((r) => r.rate * 100)}
            tone="bad"
            height={56}
          />
          <p className="text-xs text-fg-tertiary">
            Anteil der vereinbarten Termine, zu denen Patienten nicht erschienen sind.
          </p>
        </CardContent>
      </Card>

      {/* AI score distribution */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Verteilung KI-Score</CardTitle>
        </CardHeader>
        <CardContent>
          <ScoreDistribution buckets={aiBuckets} />
        </CardContent>
      </Card>

      {/* Heatmaps */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Wochentage</CardTitle>
          </CardHeader>
          <CardContent>
            <WeekdayHeatmap rows={weekday} />
          </CardContent>
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Tageszeiten</CardTitle>
          </CardHeader>
          <CardContent>
            <HourlyHeatmap rows={hourly} />
          </CardContent>
        </Card>
      </div>

      {/* Cohort retention */}
      {cohorts.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Kohorten — Gewonnen nach Wochen</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={cohorts}
              columns={[
                { key: "cohort", header: "Kohorte", render: (r) => r.cohort },
                {
                  key: "size",
                  header: "Anfragen",
                  align: "right",
                  render: (r) => formatNumber(r.size),
                },
                {
                  key: "wonW1",
                  header: "Woche 1",
                  align: "right",
                  render: (r) => formatNumber(r.wonW1),
                },
                {
                  key: "wonW2",
                  header: "Woche 2",
                  align: "right",
                  render: (r) => formatNumber(r.wonW2),
                },
                {
                  key: "wonW4",
                  header: "Woche 4",
                  align: "right",
                  render: (r) => formatNumber(r.wonW4),
                },
                {
                  key: "wonW8",
                  header: "Woche 8",
                  align: "right",
                  render: (r) => formatNumber(r.wonW8),
                },
                {
                  key: "wonRateW8",
                  header: "Quote (8W)",
                  align: "right",
                  render: (r) =>
                    r.wonRateW8 != null ? formatPercent(r.wonRateW8) : "–",
                },
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Staff performance */}
      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Mitarbeiter-Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={staff}
            columns={[
              {
                key: "fullName",
                header: "Mitarbeiter",
                render: (r) => (
                  <span>
                    <span className="font-medium text-fg-primary">
                      {r.fullName ?? r.email}
                    </span>
                    <span className="ml-2 text-xs text-fg-secondary">({r.role})</span>
                  </span>
                ),
              },
              {
                key: "assignedCount",
                header: "Zugewiesen",
                align: "right",
                render: (r) => formatNumber(r.assignedCount),
              },
              {
                key: "wonCount",
                header: "Gewonnen",
                align: "right",
                render: (r) => formatNumber(r.wonCount),
              },
              {
                key: "winRate",
                header: "Quote",
                align: "right",
                render: (r) => (r.winRate != null ? formatPercent(r.winRate) : "–"),
              },
              {
                key: "avgResponseMinutes",
                header: "Ø Reaktion",
                align: "right",
                render: (r) => formatMinutes(r.avgResponseMinutes),
              },
              {
                key: "avgCaseValueEur",
                header: "Ø Fall",
                align: "right",
                render: (r) =>
                  r.avgCaseValueEur != null ? formatEuro(r.avgCaseValueEur) : "–",
              },
            ]}
          />
        </CardContent>
      </Card>

      {/* LTV breakdowns */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>LTV nach Erst-Kanal</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={ltvByChannelRows}
              columns={[
                {
                  key: "channel",
                  header: "Kanal",
                  render: (r) => channelLabel(r.channel),
                },
                {
                  key: "patientCount",
                  header: "Patienten",
                  align: "right",
                  render: (r) => formatNumber(r.patientCount),
                },
                {
                  key: "totalRevenueEur",
                  header: "Gesamt",
                  align: "right",
                  render: (r) => formatEuro(r.totalRevenueEur),
                },
                {
                  key: "avgLtvEur",
                  header: "Ø LTV",
                  align: "right",
                  render: (r) => (r.avgLtvEur != null ? formatEuro(r.avgLtvEur) : "–"),
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Top Patienten nach LTV</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={topPatients}
              columns={[
                {
                  key: "fullName",
                  header: "Patient",
                  render: (r) => (
                    <span className="font-medium text-fg-primary">
                      {r.fullName ?? r.email ?? "—"}
                    </span>
                  ),
                },
                {
                  key: "wonCount",
                  header: "Behandlungen",
                  align: "right",
                  render: (r) => formatNumber(r.wonCount),
                },
                {
                  key: "lifetimeRevenueEur",
                  header: "LTV",
                  align: "right",
                  render: (r) => formatEuro(r.lifetimeRevenueEur),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      {/* Reputation */}
      {reviews.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Reputation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-border bg-bg-secondary/40 p-4"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
                    {platformLabel(r.platform)}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5 font-display text-3xl font-semibold tabular-nums">
                    {r.rating.toFixed(1).replace(".", ",")}
                    <Star className="h-5 w-5 text-tone-warn" />
                  </div>
                  <div className="mt-1 text-sm text-fg-secondary">
                    {formatNumber(r.totalCount)} Bewertungen
                  </div>
                </div>
              ))}
            </div>
            {reviewTrendRows.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-secondary">
                  6-Monats-Trend (Ø Bewertung)
                </div>
                <Sparkline
                  values={reviewTrendRows.map((r) => r.rating)}
                  tone="good"
                  height={48}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Multi-location */}
      {locations.length > 1 && locationBreakdown.length > 0 && (
        <Card className="print:break-inside-avoid">
          <CardHeader>
            <CardTitle>Standort-Vergleich</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={locationBreakdown}
              columns={[
                {
                  key: "locationName",
                  header: "Standort",
                  render: (r) => r.locationName,
                },
                {
                  key: "leads",
                  header: "Anfragen",
                  align: "right",
                  render: (r) => formatNumber(r.leads),
                },
                {
                  key: "appointments",
                  header: "Termine",
                  align: "right",
                  render: (r) => formatNumber(r.appointments),
                },
                {
                  key: "casesWon",
                  header: "Gewonnen",
                  align: "right",
                  render: (r) => formatNumber(r.casesWon),
                },
                {
                  key: "revenueEur",
                  header: "Umsatz",
                  align: "right",
                  render: (r) => formatEuro(r.revenueEur),
                },
              ]}
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}

function deltaHint(pct: number | null) {
  if (pct == null) return undefined;
  return (
    <span
      className={
        pct > 0.05
          ? "text-tone-good"
          : pct < -0.05
          ? "text-tone-bad"
          : "text-fg-tertiary"
      }
    >
      {formatDeltaPct(pct)} vs. Vorperiode
    </span>
  );
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "meta":
      return "Meta · Facebook & Instagram";
    case "google":
      return "Google Ads";
    case "direkt":
      return "Direkt / Formular";
    case "empfehlung":
      return "Empfehlung";
    default:
      return channel;
  }
}

function platformLabel(p: string): string {
  switch (p) {
    case "google":
      return "Google";
    case "jameda":
      return "Jameda";
    case "trustpilot":
      return "Trustpilot";
    case "manual":
      return "Eigene Aufnahme";
    default:
      return p;
  }
}

function FunnelStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs">{hint}</div>}
    </div>
  );
}

function DailyMiniChart({
  label,
  values,
  tone,
}: {
  label: string;
  values: number[];
  tone: "accent" | "good" | "warn" | "bad" | "neutral";
}) {
  const total = values.reduce((s, v) => s + v, 0);
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums">
        {formatNumber(total)}
      </div>
      <Sparkline values={values} tone={tone} height={56} />
    </div>
  );
}

function SeriesTable({
  series,
  summary,
}: {
  series: Awaited<ReturnType<typeof kpiDailySeries>>;
  summary: Awaited<ReturnType<typeof kpiSummary>>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/50 text-left text-fg-secondary">
          <tr>
            <Th>Datum</Th>
            <Th align="right">Anfragen</Th>
            <Th align="right">Termine</Th>
            <Th align="right">Gewonnen</Th>
            <Th align="right">Budget</Th>
            <Th align="right">Umsatz</Th>
            <Th align="right">Werbeertrag</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {series.map((row) => (
            <tr key={row.date} className="hover:bg-bg-secondary/40">
              <Td>{formatDate(row.date)}</Td>
              <Td align="right">{formatNumber(row.qualifiedLeads ?? 0)}</Td>
              <Td align="right">{formatNumber(row.appointments ?? 0)}</Td>
              <Td align="right">{formatNumber(row.casesWon ?? 0)}</Td>
              <Td align="right">
                {row.totalSpendEur ? formatEuro(Number(row.totalSpendEur)) : "–"}
              </Td>
              <Td align="right">
                {row.revenueAttributedEur
                  ? formatEuro(Number(row.revenueAttributedEur))
                  : "–"}
              </Td>
              <Td align="right">
                {row.roas ? Number(row.roas).toFixed(2) + "×" : "–"}
              </Td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-bg-secondary/40 font-semibold">
          <tr>
            <Td>Summe</Td>
            <Td align="right">{formatNumber(summary.qualifiedLeads)}</Td>
            <Td align="right">{formatNumber(summary.appointments)}</Td>
            <Td align="right">{formatNumber(summary.casesWon)}</Td>
            <Td align="right">{formatEuro(summary.spendEur)}</Td>
            <Td align="right">{formatEuro(summary.revenueEur)}</Td>
            <Td align="right">
              {summary.roas !== null ? summary.roas.toFixed(2) + "×" : "–"}
            </Td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 text-xs font-medium uppercase tracking-wide ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-4 py-3 tabular-nums ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}
