import "server-only";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronRight } from "lucide-react";
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
import type {
  KpiSparklines,
  openQueueDaily,
} from "@/server/queries/kpis";
import type {
  OpenLeadForDashboard,
} from "@/server/queries/requests";
import type { bySource } from "@/server/queries/attribution";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatRelative,
  type CurrencyCode,
} from "@/lib/formatting";
import { zipSeries } from "@/lib/chart-data";
import { SLA_HOURS } from "@/lib/constants";
import type { KpiSummary } from "@/server/queries/kpis";
import type { DashboardRange } from "@/lib/dashboard-range";
import { BreakdownStackChart } from "./BreakdownStackChart";
import { CardEmptyNote } from "./card-notes";
import { FIRST_INQUIRY_NOTE, RANGE_SENTENCE_START } from "./range-text";
import type { BreakdownTone } from "./detail-helpers";
import { reportingChannelLabel } from "@/lib/sources";

type SourceBreakdown = Awaited<ReturnType<typeof bySource>>;
type OpenQueueSeries = Awaited<ReturnType<typeof openQueueDaily>>;

export interface LeadsBreakdownSummary {
  leads: number;
  won: number;
  priorLeads: number;
  leadsDeltaPct: number | null;
}

/**
 * Detail-mode top-metrics tile grid: delta vs prior period + per-card
 * sparklines over each card's independently selected `range`. Pure render:
 * every number is fetched by the page loader in one parallel wave (no second
 * query wave in here), so the tiles appear as soon as that wave lands.
 */
export function DashboardTopMetricsEnhanced({
  currency,
  leadsBreakdown,
  revenueSummary,
  sourceBreakdown,
  slaBreaches,
  openRequests,
  leadsRange,
  openRange,
  sourcesRange,
  openLeads,
  emptyWindowHint,
  hasAnyRequest,
  leadsSpark,
  leadsPriorSpark,
  revenueSpark,
  revenuePriorSpark,
  openQueue,
  openPriorQueue,
  ltvMap,
}: {
  /** Billing currency of this (single) Praxis; formats own-revenue figures. */
  currency: CurrencyCode;
  leadsBreakdown: LeadsBreakdownSummary;
  revenueSummary: KpiSummary;
  sourceBreakdown: SourceBreakdown;
  slaBreaches: number;
  openRequests: number;
  leadsRange: DashboardRange;
  openRange: DashboardRange;
  sourcesRange: DashboardRange;
  /**
   * Top-N open Anfragen (status='neu'), prioritised SLA-überfällig first.
   * Rendered inside the Offene-Anfragen tile, *below* the trend chart, as
   * a clickable call-list. Capped at 3; a "+N weitere" hint derived from
   * the headline `openRequests` signals the rest of the open queue.
   */
  openLeads: OpenLeadForDashboard[];
  /**
   * Set only when the Anfragen window is empty *but* the Praxis has Anfragen
   * outside it (i.e. a stale window, not a brand-new Praxis). Drives a light
   * inline hint above the tiles with a link that widens all four top cards to
   * the full history ("Max"). Undefined for both the populated case and the
   * genuinely-empty (day-one) Praxis, so their existing states stay untouched.
   */
  emptyWindowHint?: { href: string };
  /**
   * Whether the Praxis has any Anfrage at all (clinic-wide, all time). Picks
   * the empty-card sentence: day-one Praxis ("Füllt sich, sobald die erste
   * Anfrage eingeht.") vs. a quiet window in an active Praxis.
   */
  hasAnyRequest: boolean;
  /** Dense Berlin-day series for the current / prior Anfragen window. */
  leadsSpark: KpiSparklines;
  leadsPriorSpark: KpiSparklines;
  /** Dense Berlin-day series for the current / prior Umsatz window. */
  revenueSpark: KpiSparklines;
  revenuePriorSpark: KpiSparklines;
  /** Open-queue size at the end of each Berlin day (current / prior window). */
  openQueue: OpenQueueSeries;
  openPriorQueue: OpenQueueSeries;
  /** Lifetime value per source (not window-scoped). */
  ltvMap: Map<string, number>;
}) {
  // "Offene Anfragen" status mirrors the headline tone: any SLA breach is bad,
  // any open queue is a soft warn, otherwise the queue is clean.
  const openTone: MetricTileTone =
    slaBreaches > 0 ? "bad" : openRequests > 0 ? "warn" : "good";

  // Source-matrix totals: same row slice as the chart so the footer sums the
  // funnel the user actually sees (Anfragen → Termine → Gewonnen).
  const sourceRows = sourceBreakdown.slice(0, 6);
  const sourceTotals = sourceRows.reduce(
    (acc, r) => {
      acc.leads += r.leads;
      acc.appointments += r.appointments;
      acc.casesWon += r.casesWon;
      if (r.spendEur != null) acc.spend += r.spendEur;
      return acc;
    },
    { leads: 0, appointments: 0, casesWon: 0, spend: 0 },
  );

  return (
    <div className="space-y-5">
      {emptyWindowHint && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-border bg-bg-secondary px-4 py-3 text-sm">
          <span className="text-fg-primary">
            Im gewählten Zeitraum gab es keine neuen Anfragen. Ihre Praxis hat
            aber Anfragen außerhalb dieses Zeitraums.
          </span>
          <Link
            href={emptyWindowHint.href}
            scroll={false}
            className="rounded font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
          >
            Gesamten Verlauf ansehen
          </Link>
        </div>
      )}
      <section
        aria-label="Kennzahlen"
        className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6"
      >
      <MetricTile
        size="large"
        label="Anfragen"
        labelExtra={
          <>
            <ExplainerPopover term="Anfragen">
              <p>
                Alle ernsthaften Anfragen im gewählten Zeitraum, also alles,
                was nicht als Spam markiert wurde. Was im Portal landet, ist
                durch das Formular der Zielseite bereits vorqualifiziert.
              </p>
            </ExplainerPopover>
          </>
        }
        value={formatNumber(leadsBreakdown.leads)}
        tone="accent"
        chartSlot={
          leadsBreakdown.leads === 0 ? (
            <CardEmptyNote>
              {hasAnyRequest
                ? leadsRange === "heute"
                  ? "Heute ist noch keine Anfrage eingegangen."
                  : `${RANGE_SENTENCE_START[leadsRange]} ist keine Anfrage eingegangen.`
                : FIRST_INQUIRY_NOTE}
            </CardEmptyNote>
          ) : (
          <TrendChart
            data={zipSeries(leadsSpark.dates, leadsSpark.leads)}
            comparisonData={zipSeries(leadsPriorSpark.dates, leadsPriorSpark.leads)}
            tone="accent"
            label="Anfragen"
            valueFormat="number"
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
          )
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
                <strong>Werbeertrag</strong> sagt: für jeden 1 €
                Werbebudget kommen X € Umsatz zurück.
              </p>
            </ExplainerPopover>
          </>
        }
        value={formatMoney(revenueSummary.revenueEur, currency)}
        tone="accent"
        chartSlot={
          revenueSummary.revenueEur === 0 ? (
            <CardEmptyNote>
              {hasAnyRequest
                ? "Füllt sich, sobald eine Anfrage als gewonnen mit Umsatz eingetragen ist."
                : FIRST_INQUIRY_NOTE}
            </CardEmptyNote>
          ) : (
          <TrendChart
            data={zipSeries(revenueSpark.dates, revenueSpark.revenueEur)}
            comparisonData={zipSeries(
              revenuePriorSpark.dates,
              revenuePriorSpark.revenueEur
            )}
            tone="accent"
            label="Umsatz"
            valueFormat={currency === "CHF" ? "chf" : "euro"}
            height={120}
            showAxes
            showYAxis={false}
            showGrid
          />
          )
        }
      />
      <MetricTile
        size="large"
        label="Offene Anfragen"
        labelExtra={
          <>
            <ExplainerPopover term="Offene Anfragen">
              <p>
                Anfragen mit Status <strong>Neu</strong>, also alles, was noch
                nicht zu Termin, Gewonnen oder Verloren weitergezogen ist.
              </p>
              <p className="mt-2">
                <strong>Überfällig</strong> heißt: noch kein erster Kontakt
                versucht, obwohl die Anfrage älter als {SLA_HOURS} Stunden ist.
              </p>
              <p className="mt-2">
                Zum Abarbeiten: Anfrage öffnen → Anruf protokollieren → Status auf{" "}
                <em>Termin vereinbart</em>, <em>Verloren</em> oder <em>Spam</em>{" "}
                ändern.
              </p>
            </ExplainerPopover>
          </>
        }
        value={formatNumber(openRequests)}
        statusBadge={
          <MetricStatusBadge status={metricStatusFromTone(openTone)} />
        }
        tone={openTone}
        chartSlot={
          openQueue.counts.every((c) => c === 0) ? (
            <CardEmptyNote>
              {hasAnyRequest
                ? `${RANGE_SENTENCE_START[openRange]} war keine Anfrage offen.`
                : FIRST_INQUIRY_NOTE}
            </CardEmptyNote>
          ) : (
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
          )
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
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <div className="flex items-center gap-1.5">
            <CardTitle className="!text-xl !font-medium md:!text-2xl">
              Quellen
            </CardTitle>
            <ExplainerPopover term="Quellen-Aufschlüsselung">
              <p>
                Woher Ihre Anfragen im gewählten Zeitraum kommen. Der Balken
                zeigt den Anteil jeder Quelle.
              </p>
              <p className="mt-2">
                Tippen Sie eine Zeile an für die Wirtschaftlichkeit der Quelle:
                Werbebudget, Kosten pro Anfrage und pro gewonnenem Patienten,
                Lebenszeitwert und Werbeertrag.
              </p>
            </ExplainerPopover>
          </div>
        </CardHeader>
        <CardContent>
          {sourceRows.length === 0 ? (
            <CardEmptyNote minHeight={160}>
              {hasAnyRequest
                ? sourcesRange === "heute"
                  ? "Heute ist noch keine Anfrage eingegangen. Sobald eine eingeht, sehen Sie hier, woher sie kam."
                  : `${RANGE_SENTENCE_START[sourcesRange]} ist keine Anfrage eingegangen.`
                : "Füllt sich, sobald die erste Anfrage eingeht. Dann sehen Sie hier, woher sie kam."}
            </CardEmptyNote>
          ) : (
          <BreakdownStackChart
            centerLabel="Anfragen"
            emptyText="Keine Quellen-Daten."
            totals={{
              label: "Gesamt",
              budget:
                sourceTotals.spend > 0 ? formatEuro(sourceTotals.spend) : null,
              anfragen: formatNumber(sourceTotals.leads),
              termine: formatNumber(sourceTotals.appointments),
              gewonnen: formatNumber(sourceTotals.casesWon),
            }}
            rows={sourceRows.map((c) => {
              const labelStr = reportingChannelLabel(c.source);
              const ltv = ltvMap.get(c.source) ?? null;
              return {
                key: c.source,
                labelText: labelStr,
                value: c.leads,
                tone: sourceTone(c.source),
                anfragen: formatNumber(c.leads),
                termine: formatNumber(c.appointments),
                gewonnen: formatNumber(c.casesWon),
                budget: c.spendEur != null ? formatEuro(c.spendEur) : null,
                cpl: c.cplEur != null ? formatEuro(c.cplEur) : null,
                cac: c.cacEur != null ? formatEuro(c.cacEur) : null,
                ltv: ltv != null ? formatMoney(ltv, currency) : null,
                roas:
                  c.roas != null
                    ? `${c.roas.toFixed(1).replace(".", ",")}×`
                    : null,
                roasTone: roasToneFor(c.roas),
              };
            })}
          />
          )}
        </CardContent>
      </Card>
      </section>
    </div>
  );
}

// Distinct slice color per source so the donut never repeats hues.
function sourceTone(source: string): BreakdownTone {
  // Keys are reporting channels (lib/sources.ts); organic and paid get
  // different hues so the two never read as one slice.
  switch (source) {
    case "meta_anzeige":
      return "accent";
    case "google_anzeige":
      return "good";
    case "instagram_organisch":
    case "facebook_organisch":
    case "tiktok_organisch":
    case "profil_link":
    case "dm_link":
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
            <span className="inline-flex items-center gap-1 text-sm font-medium text-fg-primary">
              <AlertTriangle
                className="h-3.5 w-3.5 text-tone-bad"
                aria-hidden
              />
              Überfällig
            </span>
          ) : (
            <span className="tabular-nums text-sm text-fg-primary">
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
                      <span className="truncate text-sm text-fg-secondary">
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
      </ul>
      {totalOpen > leads.length && (
        <Link
          href="/anfragen?status=neu"
          className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-accent"
        >
          {formatNumber(totalOpen - leads.length)} weitere offene Anfragen
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
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
