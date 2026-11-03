import "server-only";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight } from "lucide-react";

import type { KpiSparklines } from "@/server/queries/kpis";
import type {
  OpenLeadForDashboard,
} from "@/server/queries/requests";
import type { bySource } from "@/server/queries/attribution";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatDate,
  formatRelative,
  type CurrencyCode,
} from "@/lib/formatting";
import { rangeRatioSeries, rangeSeries, rangeTickFormat } from "@/lib/chart-data";
import { SLA_HOURS } from "@/lib/constants";
import type { KpiSummary } from "@/server/queries/kpis";
import type { DashboardRange } from "@/lib/dashboard-range";
import { SourceBreakdown } from "./SourceBreakdown";
import { FIRST_INQUIRY_NOTE, RANGE_SENTENCE_START } from "./range-text";
import type { BreakdownTone } from "./detail-helpers";
import { reportingChannelLabel } from "@/lib/sources";
import { DashCard, DeltaText, RollingNumber, WASH_ROW, pctChange } from "./dash-ui";
import { KpiGrid, KpiTile } from "./KpiTiles";
import type { RetreatmentCall } from "@/server/queries/retreatments";
import { tagText } from "../../anfragen/_lib/retreatment-text";
import { RetreatmentFitTag } from "./RetreatmentFitTag";

type SourceBreakdown = Awaited<ReturnType<typeof bySource>>;

/** Due Wiederbehandlungen for the Offene-Anfragen card. */
export interface DueRetreatments {
  /** Berlin's today, for the tag's hover text. */
  today: string;
  /** The first due patient without an open Anfrage: a row of their own. */
  ownRow: RetreatmentCall | null;
  /** Listed open Anfragen whose patient is due, by Anfrage id. */
  byRequest: Map<string, RetreatmentCall>;
}

/**
 * Top of the Übersicht: the Kennzahlen panel (Anfragen as the primary number
 * with its chart, then Termine, gewonnene Behandlungen, Umsatz and
 * Werbeertrag once ads run), each with the change against the period before,
 * then the open Anfragen (count, how many overdue, who to call back) and the
 * Quellen card. Pure render: every number is
 * fetched by the page loader in one parallel wave.
 */
export function DashboardTopMetricsEnhanced({
  currency,
  leadsSummary,
  leadsPriorSummary,
  revenueSummary,
  revenuePriorSummary,
  sourceBreakdown,
  slaBreaches,
  openRequests,
  sourcesRange,
  leadsRange,
  revenueRange,
  openLeads,
  retreatments,
  emptyWindowHint,
  hasAnyRequest,
  leadsSpark,
  leadsPriorSpark,
  revenueSpark,
  ltvMap,
  adsRun,
}: {
  /** Billing currency of this (single) Praxis; formats own-revenue figures. */
  currency: CurrencyCode;
  /** Anfragen window (rLeads) and the window before it. */
  leadsSummary: KpiSummary;
  leadsPriorSummary: KpiSummary;
  /** Umsatz window (rRevenue) and the window before it. */
  revenueSummary: KpiSummary;
  revenuePriorSummary: KpiSummary;
  sourceBreakdown: SourceBreakdown;
  slaBreaches: number;
  openRequests: number;
  sourcesRange: DashboardRange;
  /** Periods of the Anfragen and Umsatz windows; set how the lines group days. */
  leadsRange: DashboardRange;
  revenueRange: DashboardRange;
  /**
   * Top-N open Anfragen (status='neu'), prioritised SLA-überfällig first,
   * listed in the Offene-Anfragen card. Capped at 5; a "N weitere" hint
   * derived from the headline `openRequests` signals the rest of the queue.
   */
  openLeads: OpenLeadForDashboard[];
  /** Due Wiederbehandlungen, shown as tags in the Offene-Anfragen card. */
  retreatments: DueRetreatments;
  /**
   * Set only when the Anfragen window is empty *but* the Praxis has Anfragen
   * outside it (a stale window, not a brand-new Praxis). Drives a light
   * inline hint above the tiles with a link that widens every card to "Max".
   */
  emptyWindowHint?: { href: string };
  /** Whether the Praxis has any Anfrage at all (clinic-wide, all time). */
  hasAnyRequest: boolean;
  /** Dense Berlin-day series for the current / prior Anfragen window. */
  leadsSpark: KpiSparklines;
  leadsPriorSpark: KpiSparklines;
  /** Dense Berlin-day series for the Umsatz window. */
  revenueSpark: KpiSparklines;
  /** Lifetime value per source (not window-scoped). */
  ltvMap: Map<string, number>;
  /**
   * Whether ads ever ran (any Werbebudget in the loaded history). Decided over
   * the whole history, not the period: the Werbeertrag tile must not come and
   * go when the period changes. Falls back to the period's own spend.
   */
  adsRun?: boolean;
}) {
  // Werbeertrag only means something once ads run (organic start: no budget).
  const showRoas =
    adsRun ?? (revenueSummary.spendEur > 0 || revenuePriorSummary.spendEur > 0);

  // The Anfragen chart without a curve keeps its frame; this is what it says.
  // The note replaces the banner and the line that used to appear above and
  // below the Kennzahlen (they pushed every card down).
  const emptyPeriod = (range: DashboardRange) =>
    range === "heute"
      ? "Heute ist noch keine Anfrage eingegangen."
      : `${RANGE_SENTENCE_START[range]} ist keine Anfrage eingegangen.`;
  const anfragenNote: ReactNode = !hasAnyRequest
    ? FIRST_INQUIRY_NOTE
    : leadsSummary.leads === 0
      ? emptyWindowHint
        ? (
            <>
              Im gewählten Zeitraum gab es keine neuen Anfragen. Ihre Praxis hat aber Anfragen außerhalb dieses Zeitraums.
              <Link
                href={emptyWindowHint.href}
                scroll={false}
                className="rounded-[var(--r-small)] font-medium text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary"
              >
                Gesamten Verlauf ansehen
              </Link>
            </>
          )
        : emptyPeriod(leadsRange)
      : undefined;

  // Every source of the period, organic ones included: the rows scroll inside
  // the card's fixed height, so a seventh source no longer drops out and
  // Gesamt equals the Anfragen tile.
  const sourceRows = sourceBreakdown;
  const sourceTotals = sourceRows.reduce(
    (acc, r) => {
      acc.leads += r.leads;
      acc.casesWon += r.casesWon;
      if (r.spendEur != null) acc.spend += r.spendEur;
      return acc;
    },
    { leads: 0, casesWon: 0, spend: 0 },
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <KpiGrid
        primary={
        <KpiTile
          primary
          label="Anfragen"
          labelExtra={
            <ExplainerPopover term="Anfragen">
              <p>
                Alle ernsthaften Anfragen im gewählten Zeitraum, also alles,
                was nicht als Spam markiert wurde. Was im Portal landet, ist
                durch das Formular der Zielseite bereits vorqualifiziert.
              </p>
            </ExplainerPopover>
          }
          value={formatNumber(leadsSummary.leads)}
          delta={<DeltaText pct={pctChange(leadsSummary.leads, leadsPriorSummary.leads)} />}
          series={rangeSeries(leadsSpark.dates, leadsSpark.leads, leadsRange)}
          comparison={rangeSeries(leadsPriorSpark.dates, leadsPriorSpark.leads, leadsRange)}
          tickFormat={rangeTickFormat(leadsRange)}
          href="/anfragen"
          emptyNote={anfragenNote}
        />
        }
      >
        <KpiTile
          label="Termine"
          value={formatNumber(leadsSummary.appointments)}
          delta={
            <DeltaText
              pct={pctChange(leadsSummary.appointments, leadsPriorSummary.appointments)}
            />
          }
          series={rangeSeries(leadsSpark.dates, leadsSpark.appointments, leadsRange)}
          href="/anfragen?status=termin_vereinbart"
        />
        <KpiTile
          label="Behandlungen gewonnen"
          shortLabel="Gewonnen"
          value={formatNumber(leadsSummary.casesWon)}
          delta={
            <DeltaText pct={pctChange(leadsSummary.casesWon, leadsPriorSummary.casesWon)} />
          }
          series={rangeSeries(leadsSpark.dates, leadsSpark.casesWon, leadsRange)}
          chartLabel="Gewonnen"
          href="/anfragen?status=gewonnen"
        />
        <KpiTile
          label="Umsatz"
          labelExtra={
            <ExplainerPopover term="Umsatz">
              <p>
                Bestätigter Umsatz aus gewonnenen Anfragen im gewählten Zeitraum, der konkret über EINS generiert wurde.
              </p>
              <p className="mt-2">
                <strong>Werbeertrag</strong> sagt: für jeden 1 €
                Werbebudget kommen X € Umsatz aus Anfragen über Anzeigen zurück.
              </p>
            </ExplainerPopover>
          }
          value={formatMoney(revenueSummary.revenueEur, currency)}
          delta={
            <DeltaText
              pct={pctChange(revenueSummary.revenueEur, revenuePriorSummary.revenueEur)}
            />
          }
          series={rangeSeries(revenueSpark.dates, revenueSpark.revenueEur, revenueRange)}
          valueFormat={currency === "CHF" ? "chf" : "euro"}
          wide={!showRoas}
          href="/anfragen?status=gewonnen"
        />
        {showRoas && (
          <KpiTile
            label="Werbeertrag"
            labelExtra={
              <ExplainerPopover term="Werbeertrag">
                <p>
                  Werbeertrag: wie viel Umsatz je 1 € Werbebudget zurückkommt.
                  6,7× bedeutet 6,70 € Umsatz pro 1 € Werbebudget.
                </p>
                <p className="mt-2">
                  Es zählt nur der Umsatz aus Anfragen über Anzeigen. Umsatz
                  aus Beiträgen, Profil-Link und Empfehlungen kostet kein
                  Werbebudget und steht hier nicht drin.
                </p>
              </ExplainerPopover>
            }
            value={
              revenueSummary.roas != null
                ? `${revenueSummary.roas.toFixed(1).replace(".", ",")}×`
                : "–"
            }
            delta={
              <DeltaText
                pct={
                  revenueSummary.roas != null && revenuePriorSummary.roas != null
                    ? pctChange(revenueSummary.roas, revenuePriorSummary.roas)
                    : null
                }
              />
            }
            series={rangeRatioSeries(
              revenueSpark.dates,
              revenueSpark.adRevenueEur,
              revenueSpark.spendEur,
              revenueRange
            )}
            valueFormat="roas"
            href="/anfragen?status=gewonnen&source=meta_anzeige,google_anzeige"
          />
        )}
      </KpiGrid>

      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-2">
        <OpenLeadsCard
          leads={openLeads}
          totalOpen={openRequests}
          slaBreaches={slaBreaches}
          retreatments={retreatments}
        />
        <DashCard
          title="Quellen"
          href="/anfragen"
          // One height per breakpoint, whatever the period brings: the Gesamt
          // row is fixed, the rows above it scroll.
          className="flex h-[36.5rem] flex-col sm:h-[35rem] [--delay:90ms]"
          bodyClassName="flex min-h-0 flex-1 flex-col"
          titleExtra={
            <ExplainerPopover term="Quellen-Aufschlüsselung">
              <p>
                Woher Ihre Anfragen im gewählten Zeitraum kommen: aus Ihren
                Beiträgen, über den Profil-Link, aus Direktnachrichten, über
                Anzeigen oder vom Empfang eingetragen. Jede Zeile ist eine
                Quelle.
              </p>
              <p className="mt-2">
                Tippen Sie eine Zeile an für den Wert pro Patient. Bei Anzeigen
                stehen dort auch Kosten pro qualifizierter Anfrage, Kosten pro
                gewonnenem Patienten und der Werbeertrag.
              </p>
            </ExplainerPopover>
          }
        >
          <SourceBreakdown
            emptyText={
              hasAnyRequest
                ? emptyPeriod(sourcesRange)
                : "Füllt sich, sobald die erste Anfrage eingeht. Dann sehen Sie hier, woher sie kam."
            }
            totals={{
              label: "Gesamt",
              budget: sourceTotals.spend > 0 ? formatEuro(sourceTotals.spend) : null,
              anfragen: formatNumber(sourceTotals.leads),
              gewonnen: formatNumber(sourceTotals.casesWon),
            }}
            rows={sourceRows.map((c) => {
              const labelStr = reportingChannelLabel(c.source);
              const ltv = ltvMap.get(c.source) ?? null;
              return {
                key: c.source,
                labelText: labelStr,
                value: c.leads,
                unknown: c.source === "unbekannt",
                anfragen: formatNumber(c.leads),
                gewonnen: formatNumber(c.casesWon),
                budget: c.spendEur != null ? formatEuro(c.spendEur) : null,
                cpl: c.costPerQualifiedEur != null ? formatEuro(c.costPerQualifiedEur) : null,
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
        </DashCard>
      </div>
    </div>
  );
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
 * Offene Anfragen in one card: the count and how many of them are überfällig,
 * then the Anfragen to call back with their age (red once überfällig),
 * sorted überfällig first then oldest, so the row order matches the order
 * the front desk should work through. Same source of truth as the count
 * (status='neu').
 *
 * `leads` is already capped at 5; `totalOpen` drives the "N weitere" link
 * when more open Anfragen exist than are listed.
 *
 * A due Wiederbehandlung is a call too (Karam, 2026-10-30: mix it into the
 * open Anfragen like on Anfragen, no card or line of its own). Its tag is an
 * addition, never in place of anything: it leads the second line, before
 * the Behandlung, and every row keeps its date. An open Anfrage whose patient
 * is due gets the tag on its own row. A due patient without an open Anfrage
 * gets a row of their own, dated by when it fell due; it takes the third row,
 * the last one on the phone, so new Anfragen cannot push it out of sight.
 * The header count stays the open Anfragen.
 */
const PHONE_LEAD_ROWS = 3;
const SLOTS = 5;

interface CallRow {
  key: string;
  href: string;
  name: string;
  sub: string | null;
  /** The Wiederbehandlung tag in front of `sub`, while one is due. */
  retreatment: ReactNode;
  /** Right side: since when the row waits. */
  date: ReactNode;
  isAnfrage: boolean;
}

function OpenLeadsCard({
  leads,
  totalOpen,
  slaBreaches,
  retreatments,
}: {
  leads: OpenLeadForDashboard[];
  totalOpen: number;
  slaBreaches: number;
  retreatments: DueRetreatments;
}) {
  // The Anfragen tag's amber dot after the Behandlung, in the second line's
  // own grey; the word is cut short only where it does not fit.
  const tag = (call: RetreatmentCall) => (
    <RetreatmentFitTag text={tagText("faellig", call, retreatments.today)} />
  );
  const own = retreatments.ownRow;
  const shown = leads.slice(0, own ? SLOTS - 1 : SLOTS);
  const rows: CallRow[] = shown.map((r) => {
    const due = retreatments.byRequest.get(r.id);
    return {
      key: r.id,
      href: `/anfragen/${r.id}`,
      name: r.contactName ?? "Unbekannt",
      sub: r.treatmentLabel ?? null,
      retreatment: due ? tag(due) : null,
      // Age of the Anfrage; red once it is overdue (the header says how
      // many are).
      date: (
        <span
          className={
            "text-sm tabular-nums " +
            (r.slaBreached ? "font-medium text-tone-bad" : "text-fg-secondary")
          }
        >
          {formatRelative(r.createdAt)}
        </span>
      ),
      isAnfrage: true,
    };
  });
  if (own) {
    const call = own;
    rows.splice(Math.min(PHONE_LEAD_ROWS - 1, rows.length), 0, {
      key: `wb-${call.id}`,
      href: call.requestId ? `/anfragen/${call.requestId}` : "/anfragen",
      name: call.patientName ?? "Unbekannt",
      sub: call.treatmentName,
      retreatment: tag(call),
      // When it fell due, styled like the overdue rows around it: a due
      // patient is overdue by definition.
      date: (
        <span className="text-sm font-medium tabular-nums text-tone-bad">
          {formatDate(call.dueOn)}
        </span>
      ),
      isAnfrage: false,
    });
  }
  // Desktop lists up to 5 rows so the card matches the Quellen card beside
  // it; the phone keeps the first 3. The "weitere" count follows each.
  const restPhone =
    totalOpen - rows.slice(0, PHONE_LEAD_ROWS).filter((r) => r.isAnfrage).length;
  const restDesktop = totalOpen - shown.length;
  return (
    <DashCard
      title="Offene Anfragen"
      href="/anfragen?status=neu"
      className="flex h-[25.75rem] flex-col lg:h-auto [--delay:60ms]"
      titleExtra={
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
      }
      bodyClassName="flex flex-1 flex-col px-2 pb-3 pt-1 md:px-3 md:pb-4"
    >
      <div className="flex h-12 flex-wrap items-baseline gap-x-3 gap-y-1 px-3 pb-4">
        <RollingNumber
          value={formatNumber(totalOpen)}
          className="font-display text-[2rem] font-semibold leading-none tracking-tight tabular-nums text-fg-primary"
        />
        {slaBreaches > 0 && (
          <span className="text-sm font-medium tabular-nums text-tone-bad">
            {slaBreaches >= totalOpen ? "alle" : formatNumber(slaBreaches)} überfällig
          </span>
        )}
      </div>
      {/* Fixed slots: 3 on the phone, 5 from lg. Fewer open Anfragen leave
          slots empty and none puts one sentence in the same space, so the
          card never shrinks. */}
      {/* A slot is 64 px of grey (12 px above and below the two lines, 12 px
          at the sides: the card body's 8/12 px plus px-3 keep the text in
          line with the title) and 4 px white above and below inside the
          hairlines (WASH_ROW): 3 x 72 + 2 hairlines + the top one = 219 px,
          5 x 72 + 4 + 1 = 365 px. */}
      <div className="relative h-[13.75rem] border-t border-border lg:h-[22.875rem]">
        {rows.length === 0 && (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-[15px] text-fg-secondary">
            Keine offene Anfrage.
          </p>
        )}
        <ul className="divide-y divide-border">
          {rows.map((r, i) => {
            return (
              <li key={r.key} className={i >= PHONE_LEAD_ROWS ? `${WASH_ROW} hidden lg:block` : WASH_ROW}>
                <Link
                  href={r.href}
                  className="group flex h-16 items-center justify-between gap-3 rounded-[var(--r-panel)] px-3 py-3 transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium leading-5 text-fg-primary">
                      {r.name}
                    </span>
                    {(r.retreatment || r.sub) && (
                      <span className="flex min-w-0 items-center gap-2 text-sm text-fg-secondary">
                        {r.sub && <span className="truncate">{r.sub}</span>}
                        {r.retreatment}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {r.date}
                    <ChevronRight
                      aria-hidden
                      className="h-4 w-4 text-fg-tertiary transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-fg-primary"
                    />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      {/* Pinned to the bottom of the card, on the same line as the Gesamt
          line of the Quellen card beside it: the extra pb-2 makes up for
          this card's smaller body padding (12/16 px against 20/24 px). The
          line has its own fixed row, so it appearing changes nothing. */}
      <div className="mt-auto h-9 px-3 pb-2 pt-2">
        {restPhone > 0 && (
          <Link
            href="/anfragen?status=neu"
            className={
              "inline-flex items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" +
              (restDesktop > 0 ? "" : " lg:hidden")
            }
          >
            <span className="lg:hidden">{formatNumber(restPhone)}</span>
            <span className="hidden lg:inline">{formatNumber(restDesktop)}</span> weitere offene Anfragen
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </DashCard>
  );
}
