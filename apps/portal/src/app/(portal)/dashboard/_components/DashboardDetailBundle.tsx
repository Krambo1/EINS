import "server-only";
import Link from "next/link";
import { ArrowDown, Minus, TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ExplainerPopover,
  TrendChart,
  cn,
} from "@eins/ui";
import { latestReviews, reviewTrend } from "@/server/queries/reviews";
import {
  byLocation,
  byTreatment,
  type LocationBreakdownRow,
  type TreatmentBreakdownRow,
} from "@/server/queries/attribution";
import { listLocations } from "@/server/queries/locations";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  type CurrencyCode,
} from "@/lib/formatting";
import { mapSeries } from "@/lib/chart-data";
import {
  noShowWindow,
  type KpiSummary,
  type NoShowWindow,
} from "@/server/queries/kpis";
import { platformLabelNode, type Platform } from "../../bewertungen/_lib/platforms";
import {
  DASHBOARD_RANGE_KEYS,
  dashboardRangeWindow,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { RatingStars } from "../../_components/RatingStars";
import { DataTable } from "./detail-helpers";

/**
 * Async server component rendered inside a <Suspense>. Fetches the deep-dive
 * detail bundle in parallel and renders the cards that show beyond the base
 * shell. The base shell paints immediately while these queries run.
 */
export async function DashboardDetailBundle({
  clinicId,
  userId,
  currency,
  summary,
  priorSummary,
  funnelRange,
  locationsRange,
  treatmentsRange,
  noShowRange,
}: {
  clinicId: string;
  userId: string;
  /** Billing currency of this (single) Praxis; formats own-revenue figures. */
  currency: CurrencyCode;
  summary: KpiSummary;
  priorSummary: KpiSummary;
  funnelRange: DashboardRange;
  locationsRange: DashboardRange;
  treatmentsRange: DashboardRange;
  noShowRange: DashboardRange;
}) {
  // Each breakdown owns its own time window via its own toggle param:
  // `locWin` = funnel (rFunnel), `locationsWin` = Standorte (rLocations),
  // `treatmentsWin` = Behandlungen (rTreatments).
  const locWin = dashboardRangeWindow(funnelRange);
  const locationsWin = dashboardRangeWindow(locationsRange);
  const treatmentsWin = dashboardRangeWindow(treatmentsRange);
  // No-Show-Quote card owns its own window (rNoShow). Prior window sits one
  // millisecond before `from` so the delta-vs-Vorperiode chip doesn't overlap
  // a day — same convention as the funnel's cost-per-lead comparison.
  const noShowWin = dashboardRangeWindow(noShowRange);
  const noShowPriorTo = new Date(noShowWin.from.getTime() - 1);
  const noShowPriorFrom = new Date(
    noShowPriorTo.getTime() - (noShowWin.to.getTime() - noShowWin.from.getTime())
  );
  // Baseline category list over the widest window, so the Behandlungen card
  // always shows the full set of Behandlungen regardless of the selected
  // range. A sparse window (e.g. "Heute") then renders "–" for categories with
  // no activity instead of dropping rows and looking near-empty. Stable within
  // a day → shared cache hit across range toggles.
  const treatmentsBaselineWin = dashboardRangeWindow("max");
  const [
    reviews,
    reviewsTrend,
    locationBreakdown,
    locations,
    treatmentBreakdown,
    treatmentBaseline,
    noShow,
    noShowPrior,
  ] = await Promise.all([
    latestReviews(clinicId, userId),
    // Previous rating per platform → trend arrow on the Reputation card.
    // 6-month window is plenty; snapshots are logged irregularly so we just
    // pick the second-most-recent per platform below.
    reviewTrend(clinicId, userId, 6),
    byLocation(clinicId, userId, locationsWin.from, locationsWin.to),
    listLocations(clinicId, userId),
    // Behandlungen card owns its own time window via the rTreatments toggle.
    byTreatment(clinicId, userId, treatmentsWin.from, treatmentsWin.to),
    byTreatment(
      clinicId,
      userId,
      treatmentsBaselineWin.from,
      treatmentsBaselineWin.to
    ),
    noShowWindow(clinicId, userId, noShowWin.from, noShowWin.to),
    noShowWindow(clinicId, userId, noShowPriorFrom, noShowPriorTo),
  ]);

  // Overlay the selected window's numbers onto the baseline categories;
  // categories with no rows in the window become "–" placeholders so the
  // list stays stable across ranges.
  const treatmentRows = mergeTreatmentRows(treatmentBaseline, treatmentBreakdown);

  // Whether to show the Standorte card is purely "is this a multi-location
  // Praxis?" — decided by listLocations, which is range-independent. It must
  // NOT depend on locationBreakdown (the time-windowed query): a sparse
  // window like "Heute" can legitimately return zero rows, and gating on it
  // would make the whole card vanish when the toggle is switched. The
  // empty-window case is handled inside the card by DataTable's `empty`
  // message instead. Single-location Praxen (the common case) show the
  // Standorte card not at all; multi-location Praxen get it full-width below
  // the Reputation/No-Show row.
  const showLocations = locations.length > 1;

  // Per-platform previous rating: most recent snapshot that isn't the current
  // one. Map keyed by platform so the JSX can look it up without re-scanning.
  const previousRatingByPlatform = new Map<string, number>();
  {
    const grouped = new Map<string, { rating: number; recordedAt: Date }[]>();
    for (const row of reviewsTrend) {
      const arr = grouped.get(row.platform) ?? [];
      arr.push({ rating: row.rating, recordedAt: row.recordedAt });
      grouped.set(row.platform, arr);
    }
    for (const [platform, rows] of grouped) {
      // reviewTrend orders ascending by recordedAt — newest is last. Skip the
      // newest (== current snapshot in `reviews`) and take whatever comes
      // before it. Fewer than 2 rows = no prior to compare against.
      if (rows.length < 2) continue;
      previousRatingByPlatform.set(platform, rows[rows.length - 2]!.rating);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FunnelOverviewCard
          summary={summary}
          priorSummary={priorSummary}
          range={funnelRange}
        />
        <TreatmentBreakdownCard
          rows={treatmentRows}
          range={treatmentsRange}
          currency={currency}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          className="print:break-inside-avoid"
          style={{
            backgroundColor: "var(--bg-card)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <CardHeader>
            <CardTitle className="!text-xl !font-medium md:!text-2xl">
              Reputation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reviews.length === 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-fg-secondary">
                  Noch keine Bewertungen erfasst.
                </p>
                <Link
                  href="/bewertungen"
                  className="self-start text-sm text-accent hover:underline"
                >
                  Erste Bewertung hinzufügen →
                </Link>
              </div>
            ) : (
              (() => {
                // Weighted average across platforms — a simple mean would
                // over-weight a low-volume platform (e.g. one Jameda rating
                // counting as much as 200 Google ratings).
                const totalCount = reviews.reduce((a, r) => a + r.totalCount, 0);
                const weightedAvg =
                  totalCount > 0
                    ? reviews.reduce((a, r) => a + r.rating * r.totalCount, 0) /
                      totalCount
                    : null;
                const latestRecordedAt = reviews.reduce<Date | null>(
                  (latest, r) =>
                    latest == null || r.recordedAt > latest ? r.recordedAt : latest,
                  null
                );
                return (
                  <div className="space-y-3">
                    {reviews.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center justify-between text-base"
                      >
                        <span className="text-fg-primary">
                          {platformLabelNode(r.platform as Platform)}
                        </span>
                        <span className="flex items-center gap-2 font-semibold tabular-nums">
                          <RatingDelta
                            current={r.rating}
                            previous={previousRatingByPlatform.get(r.platform) ?? null}
                          />
                          {r.rating.toFixed(1).replace(".", ",")}
                          <RatingStars rating={r.rating} size={14} />
                          <span className="ml-1 text-sm font-normal text-fg-secondary">
                            ({formatNumber(r.totalCount)})
                          </span>
                        </span>
                      </div>
                    ))}
                    {reviews.length > 1 && weightedAvg != null && (
                      <div className="flex items-center justify-between border-t border-border pt-3 text-base">
                        <span className="font-semibold text-fg-primary">
                          Gesamt
                        </span>
                        <span className="flex items-center gap-2 font-semibold tabular-nums">
                          {weightedAvg.toFixed(1).replace(".", ",")}
                          <RatingStars rating={weightedAvg} size={14} />
                          <span className="ml-1 text-sm font-normal text-fg-secondary">
                            ({formatNumber(totalCount)})
                          </span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-3 text-xs text-fg-tertiary">
                      <span>
                        {latestRecordedAt
                          ? `Aktualisiert ${formatRelative(latestRecordedAt)}`
                          : ""}
                      </span>
                      <Link
                        href="/bewertungen"
                        className="text-accent hover:underline"
                      >
                        Alle Bewertungen →
                      </Link>
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>

        <NoShowQuoteCard
          current={noShow}
          prior={noShowPrior}
          range={noShowRange}
        />
      </div>

      {showLocations && (
        <MultiLocationCard
          rows={locationBreakdown}
          range={locationsRange}
          currency={currency}
        />
      )}
    </>
  );
}

/**
 * No-Show-Quote — Anteil der vereinbarten Termine, zu denen Patient:innen
 * nicht erschienen sind, über das via rNoShow gewählte Fenster. Die Quote ist
 * nach Terminzahl gewichtet (nicht ein flacher Mittel der Tagesquoten), damit
 * ein einzelner Tag mit wenigen Terminen die Zahl nicht verzerrt — dieselbe
 * Logik wie die No-Show-Anomalieregel. Das Delta-Chip vergleicht mit der
 * gleich langen Vorperiode; eine fallende Quote ist gut (grün).
 */
function NoShowQuoteCard({
  current,
  prior,
  range,
}: {
  current: NoShowWindow;
  prior: NoShowWindow;
  range: DashboardRange;
}) {
  const hasData = current.appointments > 0;
  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-1.5">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            No-Show-Quote
          </CardTitle>
          <ExplainerPopover term="No-Show-Quote">
            <p>
              Anteil der vereinbarten Termine, zu denen Patient:innen nicht
              erschienen sind.
            </p>
            <p className="mt-2">
              Über den Zeitraum nach Terminzahl gewichtet, damit einzelne Tage
              mit wenigen Terminen die Quote nicht verzerren.
            </p>
          </ExplainerPopover>
        </div>
        {/* Below xl: lift onto its own line above the title, left-aligned
            (order-first + basis-full forces a full-width first line). At xl+
            the header's justify-between pins it inline-right. */}
        <div className="order-first basis-full xl:order-none xl:basis-auto">
          <TimeRangeToggle
            value={range}
            paramKey={DASHBOARD_RANGE_KEYS.noShow}
            ariaLabel="Zeitraum für No-Show-Quote"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasData ? (
          <p className="py-6 text-sm text-fg-secondary">
            Für diesen Zeitraum liegen noch keine No-Show-Daten vor. Diese
            entstehen automatisch, sobald Termine über die PVS-Anbindung
            erfasst sind.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl font-semibold leading-none tabular-nums text-fg-primary">
                {formatPercent(current.rate)}
              </span>
              <NoShowDelta current={current.rate} previous={prior.rate} />
            </div>
            <TrendChart
              data={mapSeries(current.series, (r) => r.rate * 100)}
              tone="bad"
              height={100}
              showAxes
              label="No-Show"
              valueFormat="percent1"
            />
            <p className="text-xs text-fg-tertiary">
              Etwa {formatNumber(current.noShows)} von{" "}
              {formatNumber(current.appointments)} vereinbarten Terminen nicht
              wahrgenommen.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Delta chip for the No-Show-Quote, in percentage points vs the prior window.
 * No-show is lower-is-better, so a falling quote reads green: arrow follows
 * the value direction (down = fewer no-shows), colour follows quality. A
 * 0,5-Pp. deadband keeps small daily wobble from flipping the chip.
 */
function NoShowDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  if (current == null || previous == null) return null;
  const diffPp = (current - previous) * 100;
  const abs = Math.abs(diffPp);
  if (abs < 0.5) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-tertiary">
        <Minus className="h-4 w-4" aria-hidden />
        unverändert
      </span>
    );
  }
  const improved = diffPp < 0;
  const Icon = improved ? TrendingDown : TrendingUp;
  const toneClass = improved ? "text-tone-good" : "text-tone-bad";
  const formatted = `${abs.toFixed(1).replace(".", ",")} Pp. ${
    improved ? "niedriger" : "höher"
  }`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums",
        toneClass
      )}
      aria-label={`No-Show-Quote ${formatted} vs. Vorperiode`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {formatted}
      <span className="font-normal text-fg-tertiary"> vs. Vorperiode</span>
    </span>
  );
}

/**
 * Compact per-Standort breakdown for multi-location Praxen, rendered
 * full-width below the Reputation/No-Show row: Anfragen, Termine, gewonnene
 * Behandlungen und Umsatz je Standort für dasselbe Zeitfenster wie der
 * Trichter (rFunnel). Rows arrive sorted by Anfragen desc from the query;
 * "Ohne Standort" rolls up Anfragen ohne zugeordneten Standort. Deep dive
 * lives on Auswertung's Standort-Vergleich.
 */
function MultiLocationCard({
  rows,
  range,
  currency,
}: {
  rows: LocationBreakdownRow[];
  range: DashboardRange;
  currency: CurrencyCode;
}) {
  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 md:justify-start md:gap-6">
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          Standorte
        </CardTitle>
        <div className="order-first basis-full xl:order-none xl:basis-auto">
          <TimeRangeToggle
            value={range}
            paramKey={DASHBOARD_RANGE_KEYS.locations}
            ariaLabel="Zeitraum für Standorte"
          />
        </div>
      </CardHeader>
      <CardContent>
        <DataTable
          rows={rows}
          empty="In diesem Zeitraum keine Standortdaten."
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
              render: (r) => formatMoney(r.revenueEur, currency),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Tiny trend chip next to a platform rating: up / down / flat arrow with the
 * signed delta tucked in. Uses a 0.05-star deadband so a 4.65 → 4.69 wobble
 * doesn't flag as "improved" — matches the deadband convention in `deltaTone`.
 * Returns `null` when there is no prior snapshot to compare against (first
 * time a platform appears) so the row just shows the current rating cleanly.
 */
function RatingDelta({
  current,
  previous,
}: {
  current: number;
  previous: number | null;
}) {
  if (previous == null) return null;
  const diff = current - previous;
  const abs = Math.abs(diff);
  const Icon = abs < 0.05 ? Minus : diff > 0 ? TrendingUp : TrendingDown;
  const toneClass =
    abs < 0.05
      ? "text-fg-tertiary"
      : diff > 0
        ? "text-tone-good"
        : "text-tone-bad";
  const formatted =
    abs < 0.05
      ? null
      : `${diff > 0 ? "+" : "−"}${abs.toFixed(1).replace(".", ",")}`;
  return (
    <span
      className={`mr-1 inline-flex items-center gap-0.5 text-xs font-medium ${toneClass}`}
      aria-label={
        abs < 0.05
          ? "Bewertung unverändert"
          : diff > 0
            ? `Bewertung um ${formatted} gestiegen`
            : `Bewertung um ${formatted} gefallen`
      }
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {formatted}
    </span>
  );
}

// ---------- Trichter-Übersicht ----------
//
// Vertical funnel: 4 stages (Anfragen → Termine → Beratungen → Behandlungen),
// each row is a label + count + horizontal bar whose width encodes the share
// of the top stage (Anfragen). The conversion % shown under each stage label
// is "of the previous stage" — the focal question at every step is "how many
// did I lose here?".
//
// Footer surfaces Kosten je Anfrage with a delta chip vs the prior window of
// equal length (rFunnel param drives both windows in page.tsx). Lower CPL is
// the desired direction, so the up-trend arrow + green tone fires when the
// current value sits below prior.
function FunnelOverviewCard({
  summary,
  priorSummary,
  range,
}: {
  summary: KpiSummary;
  priorSummary: KpiSummary;
  range: DashboardRange;
}) {
  const stages: FunnelStageData[] = [
    { label: "Anfragen", value: summary.leads, prevValue: null },
    {
      label: "Termine",
      value: summary.appointments,
      prevValue: summary.leads,
    },
    {
      label: "Beratungen gehalten",
      value: summary.consultationsHeld,
      prevValue: summary.appointments,
    },
    {
      label: "Behandlungen gewonnen",
      value: summary.casesWon,
      prevValue: summary.consultationsHeld,
    },
  ];
  const top = stages[0]!.value;
  const empty = top === 0;

  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            Trichter-Übersicht
          </CardTitle>
        </div>
        <div className="order-first basis-full xl:order-none xl:basis-auto">
          <TimeRangeToggle
            value={range}
            paramKey={DASHBOARD_RANGE_KEYS.funnel}
            ariaLabel="Zeitraum für Trichter-Übersicht"
          />
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="py-6 text-sm text-fg-secondary">
            Im gewählten Zeitraum sind noch keine Anfragen eingegangen.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {stages.map((s, i) => (
              <FunnelStageRow
                key={s.label}
                stage={s}
                top={top}
                stageIndex={i}
                isLast={i === stages.length - 1}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <div className="mt-4 flex flex-col gap-1.5 border-t border-border px-6 pb-5 pt-6">
        <span className="text-sm font-medium text-fg-tertiary">
          Kosten je Anfrage
        </span>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-3xl font-semibold leading-none tabular-nums text-fg-primary">
            {summary.costPerLead !== null ? formatEuro(summary.costPerLead) : "–"}
          </span>
          <CostPerLeadDelta
            current={summary.costPerLead}
            previous={priorSummary.costPerLead}
          />
        </div>
      </div>
    </Card>
  );
}

interface TreatmentDisplayRow {
  treatmentId: string | null;
  treatmentName: string;
  /** null → keine Aktivität im gewählten Fenster, wird als "–" gerendert. */
  leads: number | null;
  casesWon: number | null;
  revenueEur: number | null;
  avgCaseValueEur: number | null;
  /** Werbeertrag (ROAS) im Fenster; null wenn kein Budget zuzuordnen ist. */
  roas: number | null;
}

/**
 * Overlay a window's per-treatment numbers onto a baseline category list
 * (computed over the widest window). Categories missing from the window keep
 * their name but get null values, so the Behandlungen card shows a stable set
 * of Behandlungen across every range and renders "–" where a sparse window
 * (e.g. "Heute") has no data, instead of dropping rows.
 */
function mergeTreatmentRows(
  baseline: TreatmentBreakdownRow[],
  windowRows: TreatmentBreakdownRow[]
): TreatmentDisplayRow[] {
  const keyOf = (r: TreatmentBreakdownRow) => r.treatmentId ?? r.treatmentName;
  const inWindow = new Map(windowRows.map((r) => [keyOf(r), r] as const));
  return baseline.map((b) => {
    const w = inWindow.get(keyOf(b));
    return {
      treatmentId: b.treatmentId,
      treatmentName: b.treatmentName,
      leads: w ? w.leads : null,
      casesWon: w ? w.casesWon : null,
      revenueEur: w ? w.revenueEur : null,
      avgCaseValueEur: w ? w.avgCaseValueEur : null,
      roas: w ? w.roas : null,
    };
  });
}

/** Werbeertrag (ROAS) → Text-Ton für die Behandlungs-Tabelle, gleiche
 *  Break-even-Bänder wie die Quellen-Aufschlüsselung (≥2× gut, ≥1× neutral,
 *  <1× Warnung). null (kein zuordenbares Budget) bleibt gedämpft. */
function treatmentRoasToneClass(roas: number | null): string {
  if (roas == null) return "text-fg-tertiary";
  if (roas >= 2) return "text-tone-good";
  if (roas >= 1) return "text-fg-primary";
  return "text-tone-warn";
}

/**
 * Behandlungs-Aufschlüsselung — dashboard card beside der Trichter-Übersicht.
 * Per-Behandlung Anfragen, gewonnene Behandlungen, Umsatz und Ø Fallwert für
 * das via rTreatments gewählte Zeitfenster. Die Kategorie-Liste ist über das
 * breiteste Fenster fixiert (siehe mergeTreatmentRows), damit jede Bereichs-
 * Auswahl denselben Satz Behandlungen zeigt und ein leeres Fenster (z. B.
 * "Heute") "–" statt fehlender Zeilen rendert. "Sonstige" rollt Anfragen ohne
 * zugeordnete Behandlung zusammen.
 */
function TreatmentBreakdownCard({
  rows,
  range,
  currency,
}: {
  rows: TreatmentDisplayRow[];
  range: DashboardRange;
  currency: CurrencyCode;
}) {
  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* xl:flex-nowrap + xl:gap-2 keep der lange Titel und der Toggle in der
          xl-Zweispaltung (Karte nur ~555px breit) auf einer Zeile: ohne sie
          überläuft "Behandlungs-Aufschlüsselung" + Toggle die Kartenbreite um
          wenige Pixel und der Toggle bricht unter die Überschrift. min-w-0 am
          Titel + shrink-0 am Toggle lassen im Ernstfall den Titel umbrechen,
          statt den Toggle nach unten zu schieben. Unter xl bleibt es beim
          gestapelten Layout (Toggle in eigener Zeile über dem Titel). */}
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 xl:flex-nowrap xl:gap-2">
        <CardTitle className="min-w-0 !text-xl !font-medium md:!text-2xl">
          Behandlungs-Aufschlüsselung
        </CardTitle>
        <div className="order-first basis-full xl:order-none xl:basis-auto xl:shrink-0">
          <TimeRangeToggle
            value={range}
            paramKey={DASHBOARD_RANGE_KEYS.treatments}
            ariaLabel="Zeitraum für Behandlungs-Aufschlüsselung"
          />
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-fg-secondary">
            Noch keine Behandlungen erfasst.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                {/* Spaltentitel als eine schmale, lange Karte über den Zeilen:
                    border-y plus Endkappen border-l/-r und bg ergeben einen
                    abgerundeten Balken, vom Datenbereich durch den
                    Abstandshalter darunter abgesetzt. */}
                <tr className="text-xs font-medium text-fg-secondary [&>th]:border-y [&>th]:border-border [&>th]:bg-bg-secondary [&>th]:px-4 [&>th]:py-2.5">
                  <th scope="col" className="rounded-l-xl border-l text-left">
                    Behandlung
                  </th>
                  {/* Anfragen entfällt auf dem Handy, damit die schmale Karte
                      nicht überläuft; auf dem Desktop bleibt sie sichtbar. */}
                  <th scope="col" className="hidden text-right md:table-cell">
                    Anfragen
                  </th>
                  <th scope="col" className="text-right">
                    Gewonnen
                  </th>
                  <th scope="col" className="text-right">
                    Umsatz
                  </th>
                  {/* Rechte Endkappe der Kopf-Pille: auf dem Handy schließt Ø
                      Fall den Balken ab, auf dem Desktop übernimmt die
                      ROAS-Spalte. */}
                  <th
                    scope="col"
                    className="rounded-r-xl border-r text-right md:rounded-r-none md:border-r-0"
                  >
                    Ø Fall
                  </th>
                  <th
                    scope="col"
                    className="hidden text-right md:table-cell md:rounded-r-xl md:border-r"
                  >
                    <span className="inline-flex items-center gap-0.5">
                      ROAS
                      <ExplainerPopover term="ROAS">
                        <p>
                          ROAS (Werbeertrag): wie viel Umsatz je 1 € Werbebudget
                          bei dieser Behandlung zurückkommt. 3,0× heißt 3 €
                          Umsatz je 1 € Budget.
                        </p>
                        <p className="mt-2">
                          Das Werbebudget wird den Behandlungen nach ihrem
                          Anteil an den bezahlten Anfragen zugeordnet, da es
                          nicht je Behandlung erfasst wird.
                        </p>
                      </ExplainerPopover>
                    </span>
                  </th>
                </tr>
                <tr aria-hidden>
                  <td className="h-2" colSpan={6} />
                </tr>
              </thead>
              <tbody className="[&>tr>td]:border-border [&>tr:not(:last-child)>td]:border-b">
                {rows.map((r) => (
                  <tr
                    key={r.treatmentId ?? r.treatmentName}
                    className="hover:bg-bg-secondary"
                  >
                    <td className="px-4 py-2.5 text-fg-primary">
                      {r.treatmentName}
                    </td>
                    <td className="hidden px-4 py-2.5 text-right tabular-nums md:table-cell">
                      {r.leads != null ? formatNumber(r.leads) : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.casesWon != null ? formatNumber(r.casesWon) : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.revenueEur != null
                        ? formatMoney(r.revenueEur, currency)
                        : "–"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.avgCaseValueEur != null
                        ? formatMoney(r.avgCaseValueEur, currency)
                        : "–"}
                    </td>
                    <td
                      className={cn(
                        "hidden px-4 py-2.5 text-right tabular-nums md:table-cell",
                        treatmentRoasToneClass(r.roas)
                      )}
                    >
                      {r.roas != null
                        ? `${r.roas.toFixed(1).replace(".", ",")}×`
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface FunnelStageData {
  label: string;
  value: number;
  /** Previous stage's count for the "X % der vorherigen Stufe" conversion.
   *  null on the top stage (Anfragen has no upstream). */
  prevValue: number | null;
}

function FunnelStageRow({
  stage,
  top,
  stageIndex,
  isLast,
}: {
  stage: FunnelStageData;
  top: number;
  stageIndex: number;
  isLast: boolean;
}) {
  const widthPct = top > 0 ? (stage.value / top) * 100 : 0;
  const stepConv =
    stage.prevValue != null && stage.prevValue > 0
      ? stage.value / stage.prevValue
      : null;
  // Per-stage mint ramp: each row's gradient darkens slightly so the funnel
  // reads as deepening intensity from top to bottom. Final stage swaps to a
  // mint→teal gradient with a soft glow to mark the "won" outcome, and its
  // count flips to the good tone for at-a-glance celebration.
  const fillBackground = isLast
    ? "linear-gradient(90deg, var(--accent), #2f8e88)"
    : `linear-gradient(90deg, rgba(88,186,181,${0.50 + stageIndex * 0.08}), rgba(88,186,181,${0.68 + stageIndex * 0.06}))`;
  const fillShadow = isLast ? "0 4px 16px -4px rgba(88,186,181,0.45)" : undefined;
  // Step-conversion quality tone. Thresholds are intentionally generic across
  // stages (no domain rule says e.g. Termin→Beratung should be evaluated
  // differently from Anfrage→Termin yet). >=60 % good, 40–60 % warn, <40 % bad.
  const convTone: "good" | "warn" | "bad" | null =
    stepConv == null ? null : stepConv >= 0.6 ? "good" : stepConv >= 0.4 ? "warn" : "bad";
  const convToneClass =
    convTone === "good" ? "text-tone-good"
      : convTone === "warn" ? "text-tone-warn"
        : convTone === "bad" ? "text-tone-bad"
          : "text-fg-tertiary";
  return (
    <li className="flex flex-col gap-1.5">
      {stepConv != null && (
        // Mirrors the value/bar row layout so the chip sits in the same left
        // column as the count, with both centered → arrow+% reads as a
        // vertical "drop" from one count to the next. Coloured by quality so
        // leaks read at a glance: green good, yellow warn, red bad.
        // mt-5 pushes the chip down to the true midpoint between the count above
        // and below it: the next stage's label stacks below the chip, so
        // without this offset the chip hugs the upper count instead of centering.
        <div className="mt-5 flex items-center gap-3.5">
          <span
            aria-label={`Konversion von der vorherigen Stufe: ${formatPercent(stepConv)}`}
            className={cn(
              "inline-flex w-16 shrink-0 items-center justify-center gap-1.5 text-sm font-semibold tabular-nums",
              convToneClass,
            )}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
            {formatPercent(stepConv).replace(/\s/g, "")}
          </span>
          <div className="flex-1" aria-hidden />
        </div>
      )}
      {/* Label caps the bar's left edge: a spacer the width of the value column
          shifts it right, past the counts, so it sits over the bar and not over
          the numbers. */}
      <div className="flex items-center gap-3.5">
        <span className="w-16 shrink-0" aria-hidden />
        <span className="text-sm font-medium text-fg-secondary">{stage.label}</span>
      </div>
      <div className="flex items-center gap-3.5">
        <span
          className={cn(
            "w-16 shrink-0 text-center font-display text-2xl font-semibold leading-none tabular-nums",
            isLast ? "text-tone-good" : "text-fg-primary",
          )}
        >
          {formatNumber(stage.value)}
        </span>
        <div className="relative h-9 flex-1 overflow-hidden rounded bg-bg-secondary">
          <div
            className="absolute inset-y-0 left-0 rounded transition-[width] duration-500 ease-out"
            // 2 % floor keeps a non-zero stage visible as a tiny stub instead
            // of disappearing. A truly-zero stage stays at 0 and reads as
            // "empty".
            style={{
              width: stage.value > 0 ? `${Math.max(2, widthPct)}%` : "0%",
              background: fillBackground,
              boxShadow: fillShadow,
            }}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * Delta chip for Kosten je Anfrage. Direction-of-improvement coloring:
 *   current < prior  → "X € günstiger" + TrendingUp + green
 *   current > prior  → "X € teurer"    + TrendingDown + red
 *   |delta| < 0,50 € → flat (no chip, just stays silent)
 * If either value is null we have nothing to compare and render nothing.
 */
function CostPerLeadDelta({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  if (current == null || previous == null) return null;
  const diff = current - previous;
  const abs = Math.abs(diff);
  // Half-euro deadband — keeps small daily wobble from constantly toggling
  // the chip between green/red on a freshly-tracked clinic.
  if (abs < 0.5) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-tertiary">
        <Minus className="h-4 w-4" aria-hidden />
        unverändert
      </span>
    );
  }
  const improved = diff < 0;
  const Icon = improved ? TrendingUp : TrendingDown;
  const toneClass = improved ? "text-tone-good" : "text-tone-bad";
  const formatted = `${formatEuro(abs)} ${improved ? "günstiger" : "teurer"}`;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium tabular-nums",
        toneClass,
      )}
      aria-label={`Kosten je Anfrage ${formatted} vs. Vorperiode`}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {formatted}
      <span className="font-normal text-fg-tertiary"> vs. Vorperiode</span>
    </span>
  );
}
