import Link from "next/link";
import { Card, CardContent, Badge, MetricTile } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import {
  formatEuro,
  formatNumber,
  formatRelative,
} from "@/lib/formatting";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import {
  platformOverviewMetrics,
  platformMix,
  spendRevenueSeries,
  syncErrorList,
  topCampaigns,
} from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { LineChart } from "../_charts/LineChart";

export const metadata = { title: "Leistung · Admin" };

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

interface PageProps {
  searchParams: { period?: string };
}

const PERIODS: Record<string, number> = {
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

export default async function AdminLeistungPage({ searchParams }: PageProps) {
  await requireAdmin();
  const periodKey = searchParams.period ?? "90d";
  const days = PERIODS[periodKey] ?? 90;

  const [
    overview,
    mix,
    daily,
    syncs,
    top,
    bottom,
  ] = await Promise.all([
    platformOverviewMetrics(),
    platformMix(days),
    spendRevenueSeries(days),
    syncErrorList(),
    topCampaigns({ periodDays: days, limit: 10 }),
    topCampaigns({ periodDays: days, limit: 10, ascending: true }),
  ]);

  const totalSpend = mix.reduce((acc, m) => acc + m.spendEur, 0);
  const totalLeads = mix.reduce((acc, m) => acc + m.leads, 0);

  const cplTone = toneForLowerBetter(overview.avgCpl, KPI_THRESHOLDS.cpl);
  const roasTone = toneForHigherBetter(overview.avgRoas, KPI_THRESHOLDS.roas);

  const lineData = daily.map((d) => ({
    date: d.date,
    spend: d.spendEur,
    revenue: d.revenueEur,
  }));

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Werbeleistung"
        subtitle="Plattform-Vergleich, Top- und Bottom-Kampagnen, Sync-Health."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
          Zeitraum
        </span>
        {Object.entries(PERIODS).map(([k, d]) => (
          <Link
            key={k}
            href={{ pathname: "/admin/leistung", query: { period: k } }}
            className={`rounded-full border px-3 py-1 text-xs ${
              k === periodKey
                ? "border-accent bg-accent text-white"
                : "border-border text-fg-secondary hover:border-accent hover:text-accent"
            }`}
          >
            {d} Tage
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          label="Spend"
          value={formatEuro(totalSpend)}
          delta={overview.deltas.spend}
        />
        <MetricTile
          label="Umsatz (Monat)"
          value={formatEuro(overview.monthRevenue)}
          delta={overview.deltas.revenue}
          tone="accent"
        />
        <MetricTile
          label="Leads"
          value={formatNumber(totalLeads)}
          delta={overview.deltas.leads}
        />
        <MetricTile
          label="Ø CPL"
          value={overview.avgCpl == null ? "–" : formatEuro(overview.avgCpl)}
          tone={cplTone}
          delta={overview.deltas.cpl}
        />
        <MetricTile
          label="Ø ROAS"
          value={
            overview.avgRoas == null
              ? "–"
              : `${overview.avgRoas.toFixed(2)}×`
          }
          tone={roasTone}
          delta={overview.deltas.roas}
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Trend · {days} Tage
          </h2>
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <LineChart
              data={lineData}
              series={[
                { key: "spend", name: "Werbebudget", color: "#94a3b8" },
                { key: "revenue", name: "Werbeumsatz", color: "var(--accent)" },
              ]}
              height={260}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {(["meta", "google"] as const).map((platform) => {
          const m = mix.find((x) => x.platform === platform);
          const cpl = m && m.leads > 0 ? m.spendEur / m.leads : null;
          return (
            <Card key={platform} className={GLOW_CARD}>
              <CardContent className="space-y-3 pt-6">
                <header className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold">
                    {platform === "meta" ? "Meta / Instagram" : "Google Ads"}
                  </h2>
                  <Badge tone={m ? "good" : "neutral"}>
                    {m ? "Aktiv" : "Keine Daten"}
                  </Badge>
                </header>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <Stat label="Spend" value={formatEuro(m?.spendEur ?? 0)} />
                  <Stat label="Leads" value={formatNumber(m?.leads ?? 0)} />
                  <Stat
                    label="CPL"
                    value={cpl == null ? "–" : formatEuro(cpl)}
                  />
                </div>
                <div className="text-xs text-fg-secondary">
                  Anteil an Gesamt-Spend:{" "}
                  <span className="font-mono">
                    {(m?.sharePct ?? 0).toFixed(1)} %
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Top-Kampagnen (ROAS, {days} Tage)
          </h2>
          <CampaignTable rows={top} />
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Bottom-Kampagnen
          </h2>
          <p className="text-xs text-fg-secondary">
            Niedrigste ROAS — Kandidaten zum Pausieren oder Optimieren.
          </p>
          <CampaignTable rows={bottom} />
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-display text-xl font-semibold">Sync-Health</h2>
          {syncs.length === 0 ? (
            <p className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-sm text-tone-good">
              Alle Plattform-Verbindungen synchronisieren ohne Fehler.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">Klinik</th>
                  <th className="py-2">Plattform</th>
                  <th className="py-2">Konto</th>
                  <th className="py-2 text-right">Letzter Sync</th>
                  <th className="py-2">Fehler</th>
                </tr>
              </thead>
              <tbody>
                {syncs.map((s) => (
                  <tr
                    key={s.clinicId + s.platform}
                    className="border-t border-border align-top"
                  >
                    <td className="py-2">
                      <Link
                        href={`/admin/clinics/${s.clinicId}?tab=integrationen`}
                        className="hover:text-accent"
                      >
                        {s.clinicName}
                      </Link>
                    </td>
                    <td className="py-2 capitalize">{s.platform}</td>
                    <td className="py-2 font-mono text-xs">
                      {s.accountId ?? "—"}
                    </td>
                    <td className="py-2 text-right text-xs text-fg-secondary">
                      {s.lastSyncedAt ? formatRelative(s.lastSyncedAt) : "nie"}
                    </td>
                    <td className="py-2 text-xs text-tone-bad">
                      {s.lastSyncError}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignTable({
  rows,
}: {
  rows: Awaited<ReturnType<typeof topCampaigns>>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-secondary">Keine Kampagnen im Zeitraum.</p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-fg-secondary">
          <tr>
            <th className="py-2">Klinik</th>
            <th className="py-2">Quelle</th>
            <th className="py-2">Kampagne</th>
            <th className="py-2 text-right">Leads</th>
            <th className="py-2 text-right">Umsatz</th>
            <th className="py-2 text-right">Spend</th>
            <th className="py-2 text-right">CPL</th>
            <th className="py-2 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.clinicId}-${r.source}-${r.campaignId ?? i}`}
              className="border-t border-border"
            >
              <td className="py-2">
                <Link
                  href={`/admin/clinics/${r.clinicId}?tab=leistung`}
                  className="hover:text-accent"
                >
                  {r.clinicName}
                </Link>
              </td>
              <td className="py-2 capitalize">{r.source}</td>
              <td className="py-2 font-mono text-xs text-fg-secondary">
                {r.campaignId ?? "—"}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {formatNumber(r.leads)}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {formatEuro(r.revenueEur)}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {formatEuro(r.spendEur)}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {r.cpl == null ? "–" : formatEuro(r.cpl)}
              </td>
              <td className="py-2 text-right font-mono tabular-nums">
                {r.roas == null ? "–" : `${r.roas.toFixed(2)}×`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-primary/40 p-2">
      <div className="font-mono text-[10px] uppercase tracking-wider text-fg-secondary">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-base tabular-nums">{value}</div>
    </div>
  );
}
