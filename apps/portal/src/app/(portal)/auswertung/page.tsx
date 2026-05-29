import { Suspense } from "react";
import Link from "next/link";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  kpiDailySeries,
  kpiSummary,
  currentGoals,
} from "@/server/queries/kpis";
import { formatEuro, formatNumber, formatDate } from "@/lib/formatting";
import { AuswertungTopMetricsEnhanced } from "./_components/AuswertungTopMetricsEnhanced";
import { AuswertungDetailBundle } from "./_components/AuswertungDetailBundle";
import { AuswertungDetailBundleSkeleton } from "./_components/AuswertungDetailBundleSkeleton";
import { AuswertungTabs } from "./_components/AuswertungTabs";

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

  // Base bundle — always 3 cheap queries. The 18-query detail bundle is
  // streamed inside <Suspense> so the header + period nav + base metrics
  // paint before the deep-dive queries finish.
  const [summary, series, goals] = await Promise.all([
    kpiSummary(session.clinicId, session.userId, from, to),
    kpiDailySeries(session.clinicId, session.userId, from, to),
    currentGoals(session.clinicId, session.userId),
  ]);

  const leadsGoal = goals.find((g) => g.metric === "leads");
  const revenueGoal = goals.find((g) => g.metric === "revenue");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Auswertung.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Werbung in Zahlen. Ehrlich, einfach und ohne Fachjargon.
        </p>
      </header>

      <AuswertungTabs active="overview" />

      <nav className="flex flex-wrap gap-2" aria-label="Zeitraum">
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

      {/* Primary 3 metrics — MetricTile + delta + sparkline, streamed inside
          Suspense so the header + period nav paint while the comparison
          queries are in flight. */}
      <Suspense fallback={<TopMetricsSkeleton />}>
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

      <section aria-label="Trichter" className="grid gap-4 md:grid-cols-4">
        <FunnelStat label="Termine vereinbart" value={formatNumber(summary.appointments)} />
        <FunnelStat label="Beratungen gehalten" value={formatNumber(summary.consultationsHeld)} />
        <FunnelStat label="Behandlungen gewonnen" value={formatNumber(summary.casesWon)} />
        <FunnelStat
          label="Kosten je Anfrage"
          value={
            summary.costPerLead !== null
              ? formatEuro(summary.costPerLead)
              : "–"
          }
        />
      </section>

      {/* Deep dive — daily-chart card, Trichter-Quoten with deltas, attribution
          breakdowns, etc. Streamed inside Suspense. */}
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
    </div>
  );
}

function TopMetricsSkeleton() {
  return (
    <section
      aria-label="Kennzahlen werden geladen"
      aria-busy="true"
      className="grid gap-6 md:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-2xl border border-border bg-bg-secondary/40"
        />
      ))}
    </section>
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

