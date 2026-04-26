import { Suspense } from "react";
import Link from "next/link";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@eins/ui";
import {
  kpiDailySeries,
  kpiSummary,
  currentGoals,
} from "@/server/queries/kpis";
import {
  formatEuro,
  formatNumber,
  formatDate,
  formatPercent,
} from "@/lib/formatting";
import { BarChart3 } from "lucide-react";
import { AuswertungTopMetricsSimple } from "./_components/AuswertungTopMetricsSimple";
import { AuswertungTopMetricsEnhanced } from "./_components/AuswertungTopMetricsEnhanced";
import { AuswertungDetailBundle } from "./_components/AuswertungDetailBundle";
import { AuswertungDetailBundleSkeleton } from "./_components/AuswertungDetailBundleSkeleton";

export const metadata = { title: "Auswertung" };

type Search = { period?: string };

const PERIODS = {
  "30": { days: 30, label: "Letzte 30 Tage" },
  "month": { label: "Dieser Monat" },
  "quarter": { label: "Dieses Quartal" },
  "year": { label: "Dieses Jahr" },
} as const;

type PeriodKey = keyof typeof PERIODS;

function computeRange(key: PeriodKey): { from: Date; to: Date; label: string } {
  const now = new Date();
  switch (key) {
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from, to, label: PERIODS.month.label };
    }
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      const from = new Date(now.getFullYear(), q * 3, 1);
      const to = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { from, to, label: PERIODS.quarter.label };
    }
    case "year": {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear(), 11, 31);
      return { from, to, label: PERIODS.year.label };
    }
    case "30":
    default: {
      const to = new Date();
      const from = new Date();
      from.setDate(to.getDate() - 30);
      return { from, to, label: PERIODS["30"].label };
    }
  }
}

export default async function AuswertungPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requirePermissionOrRedirect("reports.view");
  const params = await searchParams;
  const periodKey = (
    params.period && params.period in PERIODS ? params.period : "30"
  ) as PeriodKey;
  const { from, to, label } = computeRange(periodKey);
  const isDetail = session.uiMode === "detail";

  // Base bundle — always 3 cheap queries. The 18-query detail bundle is
  // streamed inside <Suspense> so the header + period nav + base metrics
  // paint before the deep-dive queries finish.
  const [summary, series, goals] = await Promise.all([
    kpiSummary(session.clinicId, session.userId, from, to),
    kpiDailySeries(session.clinicId, session.userId, from, to),
    currentGoals(session.clinicId, session.userId),
  ]);

  const leadsGoal = goals.find((g) => g.metric === "qualified_leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Auswertung.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Werbung in Zahlen. Ehrlich, einfach und ohne Fachjargon.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {(Object.keys(PERIODS) as PeriodKey[]).map((key) => {
          const isActive = key === periodKey;
          return (
            <Link
              key={key}
              href={`/auswertung?period=${key}`}
              className={`rounded-full border px-4 py-2 text-sm transition ${
                isActive
                  ? "border-accent bg-accent/15 text-fg-primary"
                  : "border-border text-fg-secondary hover:bg-bg-secondary"
              }`}
            >
              {PERIODS[key].label}
            </Link>
          );
        })}
      </nav>

      <div className="text-sm text-fg-secondary">
        Zeitraum: {formatDate(from)} bis {formatDate(to)}
      </div>

      {/* Primary 3 metrics — Detail streams MetricTile + delta + sparkline. */}
      {isDetail ? (
        <Suspense
          fallback={
            <AuswertungTopMetricsSimple
              summary={summary}
              periodKey={periodKey}
              leadsGoal={leadsGoal}
              revenueGoal={revenueGoal}
            />
          }
        >
          <AuswertungTopMetricsEnhanced
            clinicId={session.clinicId}
            userId={session.userId}
            summary={summary}
            from={from}
            to={to}
            periodKey={periodKey}
            leadsGoal={leadsGoal}
            revenueGoal={revenueGoal}
          />
        </Suspense>
      ) : (
        <AuswertungTopMetricsSimple
          summary={summary}
          periodKey={periodKey}
          leadsGoal={leadsGoal}
          revenueGoal={revenueGoal}
        />
      )}

      {/* Secondary funnel metrics (Einfach + Detail) */}
      <section aria-label="Trichter" className="grid gap-4 md:grid-cols-4">
        <FunnelStat label="Termine vereinbart" value={formatNumber(summary.appointments)} />
        <FunnelStat label="Beratungen gehalten" value={formatNumber(summary.consultationsHeld)} />
        <FunnelStat label="Behandlungen gewonnen" value={formatNumber(summary.casesWon)} />
        <FunnelStat
          label="Kosten je Anfrage"
          value={
            summary.costPerQualifiedLead !== null
              ? formatEuro(summary.costPerQualifiedLead)
              : "–"
          }
        />
      </section>

      {/* Einfach mode renders the simple table card here. Detail mode renders
          its richer daily-chart card inside the streamed bundle below. */}
      {!isDetail && (
        <Card>
          <CardHeader>
            <CardTitle>Tagesverlauf</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {series.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<BarChart3 className="h-8 w-8" />}
                  title="Noch keine Tageswerte"
                  description={`Für ${label} liegen noch keine Daten vor.`}
                />
              </div>
            ) : (
              <SeriesTable series={series} summary={summary} />
            )}
          </CardContent>
        </Card>
      )}

      {/* Trichter-Quoten — einfach version (no delta hints). Detail version
          with delta hints renders inside the streamed bundle. */}
      {!isDetail && summary.qualifiedLeads > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Trichter-Quoten</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <FunnelStat
              label="Anfrage → Termin"
              value={formatPercent(summary.appointments / summary.qualifiedLeads)}
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
            />
          </CardContent>
        </Card>
      )}

      {/* DETAIL-ONLY DEEP DIVE — streamed inside Suspense */}
      {isDetail && (
        <Suspense fallback={<AuswertungDetailBundleSkeleton />}>
          <AuswertungDetailBundle
            clinicId={session.clinicId}
            userId={session.userId}
            from={from}
            to={to}
            label={label}
            summary={summary}
            series={series}
          />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- helpers ----

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
