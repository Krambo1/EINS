import "server-only";
import { eq } from "drizzle-orm";
import { type TrendChartPoint } from "@eins/ui";
import { ExplainerPopover } from "@/app/(portal)/_components/ExplainerPopover";
import { campaignLiveSummaryTx } from "@/server/queries/kpis";
import {
  adInquiriesByDayTx,
  type AdInquiryDay,
  berlinLastDays,
  campaignDailyByPlatformTx,
  campaignsForPeriodTx,
} from "@/server/queries/campaigns";
import { costPerQualified } from "@/server/queries/_qualified";
import { db, schema, withClinicContext } from "@/db/client";
import type { ResolvedSession } from "@/auth/session";
import { can } from "@/lib/roles";
import { rangeSeries, rangeTickFormat } from "@/lib/chart-data";
import { addIsoDays, dashboardRangeDays, type DashboardRange } from "@/lib/dashboard-range";
import { formatEuro, formatNumber } from "@/lib/formatting";
import { META_PAGE_ERRORS, metaPageErrorText } from "@/server/meta-pages";
import { KpiGrid, KpiTile } from "../../dashboard/_components/KpiTiles";
import { RANGE_SENTENCE_START } from "../../dashboard/_components/range-text";
import {
  AdFunnelCell,
  CampaignsCard,
  FigureCell,
  PlatformsCard,
  type CampaignView,
  type Platform,
  type PlatformView,
} from "./WerbebudgetParts";

/*
 * The part of Werbebudget that changes with the period: Kennzahlen,
 * Plattformen and Kampagnen. The page renders it for the period in the
 * address; the server action in ../range-actions.tsx renders the others, so
 * the switch swaps kept views without a navigation (DESIGN.md section 10,
 * "A view switch is instant").
 */

/** North-star wording for the organic start (no numbers, no promises). */
const ORGANIC_START_NOTE =
  "Ihre Beiträge laufen zuerst organisch. Sobald sichtbar ist, welche Beiträge Anfragen bringen, schlägt EINS Ihnen vor, wie viel Werbebudget dahinter gehen soll. Diese Seite füllt sich, sobald bezahlte Anzeigen laufen.";

const PLATFORMS: Platform[] = ["meta", "google"];

export interface WerbebudgetPeriodData {
  range: DashboardRange;
  /** Meta or Google is connected; without, the page is the organic start. */
  connected: boolean;
  totalSpend: number;
  totalLeads: number;
  /** Of the Anfragen über Werbung, the qualifizierte (server/queries/_qualified.ts). */
  totalQualified: number;
  /** Of the Anfragen über Werbung, those with a Termin and the gewonnenen (_ad-inquiries.ts). */
  totalAppointments: number;
  totalWon: number;
  /** Werbebudget ÷ qualifizierte Anfragen, as on the Übersicht. */
  avgCpl: number | null;
  series: { spend: TrendChartPoint[]; leads: TrendChartPoint[]; cpl: TrendChartPoint[] };
  platforms: PlatformView[];
  campaigns: CampaignView[];
}

/**
 * Everything the period's cards show. Credentials first (one statement): a
 * Praxis without Meta/Google (the organic start) runs none of the campaign
 * queries. With integrations, all campaign reads run in ONE transaction.
 */
export async function loadWerbebudgetPeriod(
  session: Pick<ResolvedSession, "clinicId" | "userId" | "role">,
  range: DashboardRange
): Promise<WerbebudgetPeriodData> {
  const canConnect = can(session.role, "settings.integrations");
  const creds = await db
    .select({
      platform: schema.platformCredentials.platform,
      lastSyncedAt: schema.platformCredentials.lastSyncedAt,
      lastSyncError: schema.platformCredentials.lastSyncError,
    })
    .from(schema.platformCredentials)
    .where(eq(schema.platformCredentials.clinicId, session.clinicId));
  const adCreds = creds.filter((c) => c.platform === "meta" || c.platform === "google");
  const connected = adCreds.length > 0;
  const data = connected ? await fetchWerbebudget(session.clinicId, session.userId, dashboardRangeDays(range)) : null;

  const live = data?.live ?? [];
  const totalSpend = live.reduce((sum, r) => sum + r.spendEur, 0);
  const totalLeads = live.reduce((sum, r) => sum + r.leads, 0);
  const totalQualified = live.reduce((sum, r) => sum + r.qualified, 0);
  const totalAppointments = live.reduce((sum, r) => sum + r.appointments, 0);
  const totalWon = live.reduce((sum, r) => sum + r.won, 0);

  const platforms: PlatformView[] = PLATFORMS.map((platform) => {
    const cred = adCreds.find((c) => c.platform === platform);
    const totals = live.find((l) => l.platform === platform);
    return {
      platform,
      state: !cred
        ? "missing"
        : cred.lastSyncError
          ? isPageSelectionPending(cred.lastSyncError)
            ? "page"
            : "error"
          : "ok",
      lastSyncedAt: cred?.lastSyncedAt ?? null,
      error: cred?.lastSyncError ?? null,
      spendEur: totals?.spendEur ?? 0,
      leads: totals?.leads ?? 0,
      cplEur: totals?.cplEur ?? null,
      canConnect,
    };
  });

  return {
    range,
    connected,
    totalSpend,
    totalLeads,
    totalQualified,
    totalAppointments,
    totalWon,
    avgCpl: costPerQualified(totalSpend, totalQualified),
    series: buildSeries(range, data),
    platforms,
    campaigns: (data?.campaigns ?? []).map((c) => ({
      key: `${c.platform}-${c.campaignId}`,
      name: c.campaignName,
      platform: c.platform,
      spendEur: c.spendEur,
      leads: c.leads,
      cplEur: c.cplEur,
    })),
  };
}

/**
 * Three cards in every state, at one size each:
 *   1. Kennzahlen (KpiGrid): Werbebudget with its line, Anfragen über
 *      Werbung, Kosten pro qualifizierter Anfrage, and what became of those
 *      Anfragen (Termine, Gewonnen) with the Werbebudget per step.
 *   2. Plattformen: Meta and Google Ads as two rows with their status and
 *      their own action (connect, choose the Facebook page, connect again).
 *   3. Kampagnen: the period's campaigns in a list of fixed height.
 * The organic start (no ad account) is the same cards with nothing spent yet:
 * the note sits in the chart, both platforms offer to connect.
 */
export function WerbebudgetPeriodBody(p: WerbebudgetPeriodData) {
  const chartText = !p.connected
    ? ORGANIC_START_NOTE
    : p.totalSpend === 0
      ? `${RANGE_SENTENCE_START[p.range]} lief keine bezahlte Anzeige.`
      : null;
  // The note sits in the plot area over its dashed middle line; the card's
  // own colour behind each line of text keeps the line from running through
  // the words (the organic note has several lines). KpiTile keeps every span
  // in its plot area on one line (date ticks), so this one breaks explicitly.
  const chartNote = chartText && (
    <span className="bg-[var(--surface-tile)] px-1 !whitespace-normal [box-decoration-break:clone]">{chartText}</span>
  );

  return (
    <>
      <KpiGrid
        primary={
          <KpiTile
            primary
            label="Werbebudget"
            labelExtra={
              <ExplainerPopover term="Werbebudget">
                <p>
                  Die Zahlen werden täglich aus Meta und Google abgerufen.
                  Kleine Abweichungen zu den dortigen Auswertungen sind
                  normal, weil sich die Werbe-Zuordnung 24 bis 48 Stunden
                  rückwirkend ändert.
                </p>
              </ExplainerPopover>
            }
            value={formatEuro(p.totalSpend)}
            series={p.series.spend}
            tickFormat={rangeTickFormat(p.range)}
            valueFormat="euro"
            emptyNote={chartNote}
          />
        }
      >
        <FigureCell
          label="Anfragen über Werbung"
          shortLabel="Anfragen"
          labelExtra={
            <ExplainerPopover term="Anfragen über Werbung">
              <p>
                Anfragen über eine Meta- oder Google-Anzeige, die in Ihrem
                Portal angekommen sind, gezählt wie auf der Übersicht. Meta
                und Google zeigen in ihren eigenen Auswertungen oft eine
                andere Zahl.
              </p>
            </ExplainerPopover>
          }
          value={formatNumber(p.totalLeads)}
          series={p.series.leads}
        />
        <FigureCell
          label="Pro qualifizierte Anfrage"
          narrowLabel="Pro qualif. Anfrage"
          labelExtra={
            <ExplainerPopover term="Kosten pro qualifizierter Anfrage">
              <p>
                Werbebudget geteilt durch die qualifizierten Anfragen über
                Werbung. Qualifiziert heißt: über einen EINS-Messweg, mit
                Telefon oder E-Mail, kein Spam. Dieselbe Zahl wie auf der
                Übersicht.
              </p>
            </ExplainerPopover>
          }
          value={p.avgCpl != null ? formatEuro(p.avgCpl) : null}
          missing={p.totalQualified === 0 ? "Keine qualifizierte Anfrage" : "Kein Werbebudget"}
          series={p.series.cpl}
          valueFormat="euro"
        />
        <AdFunnelCell
          leads={p.totalLeads}
          qualified={p.totalQualified}
          appointments={p.totalAppointments}
          won={p.totalWon}
          spend={p.totalSpend}
        />
      </KpiGrid>

      <PlatformsCard rows={p.platforms} />

      <CampaignsCard
        rows={p.campaigns}
        emptyText={
          p.connected
            ? `${RANGE_SENTENCE_START[p.range]} lief keine Kampagne.`
            : "Ihre Kampagnen erscheinen hier, sobald bezahlte Anzeigen laufen."
        }
      />
    </>
  );
}

async function fetchWerbebudget(clinicId: string, userId: string, days: number) {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [live, metaDaily, googleDaily, campaigns, adInquiries] = await Promise.all([
        campaignLiveSummaryTx(tx, clinicId, days),
        campaignDailyByPlatformTx(tx, clinicId, "meta", days),
        campaignDailyByPlatformTx(tx, clinicId, "google", days),
        campaignsForPeriodTx(tx, clinicId, days),
        adInquiriesByDayTx(tx, clinicId, days),
      ]);
      return {
        live: withPortalInquiries(live, adInquiries),
        daily: [...metaDaily, ...googleDaily],
        adInquiries,
        campaigns,
      };
    },
    "werbebudget:bundle"
  );
}

/**
 * Swap the lead count the platforms report for the Anfragen that reached the
 * portal (adInquiriesByDayTx), and compute the cost per qualifizierte Anfrage
 * from them, the Übersicht's unit (server/queries/_qualified.ts).
 */
function withPortalInquiries<
  T extends { spendEur: number; leads: number; cplEur: number | null; platform: string },
>(
  rows: T[],
  inquiries: AdInquiryDay[]
): Array<T & { qualified: number; appointments: number; won: number }> {
  return rows.map((r) => {
    const mine = inquiries.filter((i) => i.platform === r.platform);
    const leads = mine.reduce((sum, i) => sum + i.inquiries, 0);
    const qualified = mine.reduce((sum, i) => sum + i.qualified, 0);
    const appointments = mine.reduce((sum, i) => sum + i.appointments, 0);
    const won = mine.reduce((sum, i) => sum + i.won, 0);
    return { ...r, leads, qualified, appointments, won, cplEur: costPerQualified(r.spendEur, qualified) };
  });
}

/** "29. Okt. 2026", the last day a point of the cost line counts. */
const stepRangeFormat = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * The lines of the Kennzahlen, stepped like the Übersicht's (rangeSeries): a
 * point per day up to 30 Tage, per week over 12 Monate, per month over 5
 * Jahre. Anfragen are counted for the platforms the totals count, so the line
 * adds up to the number above it. Kosten pro qualifizierter Anfrage is the
 * cost so far: everything spent up to a step over every qualifizierte Anfrage
 * up to it, from the first step with one. So the line keeps the period's time
 * axis next to the Anfragen line and ends at the number above it; points only
 * for steps with an Anfrage would squeeze a few days across the whole width.
 */
function buildSeries(
  range: DashboardRange,
  data: Awaited<ReturnType<typeof fetchWerbebudget>> | null
): { spend: TrendChartPoint[]; leads: TrendChartPoint[]; cpl: TrendChartPoint[] } {
  const days = dashboardRangeDays(range);
  const { fromDate, toDate } = berlinLastDays(days);
  const dates = Array.from({ length: days }, (_, i) => addIsoDays(fromDate, i));
  const index = new Map(dates.map((d, i) => [d, i]));
  const spendByDay = new Array<number>(days).fill(0);
  const leadsByDay = new Array<number>(days).fill(0);
  const qualifiedByDay = new Array<number>(days).fill(0);
  const counted = new Set((data?.live ?? []).map((l) => l.platform));
  for (const r of data?.daily ?? []) {
    const i = index.get(r.date);
    if (i != null) spendByDay[i] += r.spendEur;
  }
  for (const r of data?.adInquiries ?? []) {
    const i = index.get(r.date);
    if (i == null || !counted.has(r.platform)) continue;
    leadsByDay[i] += r.inquiries;
    qualifiedByDay[i] += r.qualified;
  }

  const spend = rangeSeries(dates, spendByDay, range).map((p) => ({ ...p, value: Number(p.value.toFixed(2)) }));
  const leads = rangeSeries(dates, leadsByDay, range);
  const qualified = rangeSeries(dates, qualifiedByDay, range);

  const cpl: TrendChartPoint[] = [];
  let spentSoFar = 0;
  let qualifiedSoFar = 0;
  spend.forEach((point, i) => {
    spentSoFar += point.value;
    qualifiedSoFar += qualified[i]!.value;
    const value = costPerQualified(spentSoFar, qualifiedSoFar);
    if (value == null) return;
    const lastDay = i + 1 < spend.length ? addIsoDays(spend[i + 1]!.date, -1) : toDate;
    cpl.push({ date: point.date, value, label: `bis ${stepRangeFormat.format(dayKeyToDate(lastDay))}` });
  });

  return { spend, leads, cpl };
}

/**
 * Meta is connected but several Facebook pages are administered and none is
 * chosen yet. last_sync_error then holds the German text from
 * `metaPageErrorText` (or, from older writes, the raw code).
 */
const PAGE_SELECTION_PENDING = new Set<string>([
  META_PAGE_ERRORS.multiplePages,
  metaPageErrorText(new Error(META_PAGE_ERRORS.multiplePages)),
]);

function isPageSelectionPending(lastSyncError: string): boolean {
  return PAGE_SELECTION_PENDING.has(lastSyncError.trim());
}
