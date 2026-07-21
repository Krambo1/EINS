import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatRelative,
} from "@/lib/formatting";
import { platformMix, syncErrorList, topCampaigns } from "@/server/queries/admin";
import {
  ADMIN_RANGE_KEYS,
  dashboardRangeDays,
  parseDashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { Brand } from "@/app/_components/Brand";

export const metadata = { title: "Leistung · Admin" };

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * Werbeleistung im Detail. Die Plattform-KPIs und der Budget/Umsatz-Trend
 * leben auf der Admin-Übersicht (MetricStrip + Werbeleistung-Karte); diese
 * Seite ergänzt, was dort fehlt: Plattform-Split, Top/Bottom-Kampagnen und
 * Sync-Health. Der Zeitraum kommt aus dem geteilten TimeRangeToggle
 * (gleiche Fenster wie überall sonst im Portal).
 */
export default async function AdminLeistungPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const range = parseDashboardRange(sp[ADMIN_RANGE_KEYS.leistung]);
  const days = dashboardRangeDays(range);

  const [mix, syncs, top, bottom] = await Promise.all([
    platformMix(days),
    syncErrorList(),
    topCampaigns({ periodDays: days, limit: 10 }),
    topCampaigns({ periodDays: days, limit: 10, ascending: true }),
  ]);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Werbeleistung"
        subtitle="Plattform-Vergleich, Top- und Bottom-Kampagnen, Sync-Health."
        actions={
          <TimeRangeToggle
            value={range}
            paramKey={ADMIN_RANGE_KEYS.leistung}
            ariaLabel="Zeitraum für Werbeleistung"
          />
        }
      />

      <div className="grid gap-5 lg:grid-cols-2">
        {(["meta", "google"] as const).map((platform) => {
          const m = mix.find((x) => x.platform === platform);
          const cpl = m && m.leads > 0 ? m.spendEur / m.leads : null;
          return (
            <Card key={platform}>
              <CardContent className="space-y-4">
                <header className="flex items-center justify-between">
                  <h2 className="text-xl font-medium md:text-2xl">
                    {platform === "meta" ? (
                      <Brand brand="meta">Meta / Instagram</Brand>
                    ) : (
                      <Brand brand="google">Google Ads</Brand>
                    )}
                  </h2>
                  <Badge tone={m ? "good" : "neutral"}>
                    {m ? "Aktiv" : "Keine Daten"}
                  </Badge>
                </header>
                <div className="grid grid-cols-3 gap-4">
                  <Stat
                    label="Werbebudget"
                    value={formatEuro(m?.spendEur ?? 0)}
                  />
                  <Stat label="Anfragen" value={formatNumber(m?.leads ?? 0)} />
                  <Stat label="CPL" value={cpl == null ? "–" : formatEuro(cpl)} />
                </div>
                <div className="text-xs text-fg-secondary">
                  Anteil am gesamten Werbebudget:{" "}
                  <span className="tabular-nums">
                    {(m?.sharePct ?? 0).toFixed(1)} %
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-xl font-medium md:text-2xl">
            Top-Kampagnen (ROAS)
          </h2>
          <CampaignTable rows={top} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-xl font-medium md:text-2xl">Bottom-Kampagnen</h2>
          <p className="text-sm text-fg-secondary">
            Niedrigste ROAS: Kandidaten zum Pausieren oder Optimieren.
          </p>
          <CampaignTable rows={bottom} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-xl font-medium md:text-2xl">Sync-Health</h2>
          {syncs.length === 0 ? (
            <p className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-sm text-tone-good">
              Alle Plattform-Verbindungen synchronisieren ohne Fehler.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium text-fg-secondary">
                <tr>
                  <th className="py-2">Praxis</th>
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
                      {s.accountId ?? "–"}
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
        <thead className="text-left text-xs font-medium text-fg-secondary">
          <tr>
            <th className="py-2">Praxis</th>
            <th className="py-2">Quelle</th>
            <th className="py-2">Kampagne</th>
            <th className="py-2 text-right">Anfragen</th>
            <th className="py-2 text-right">Umsatz</th>
            <th className="py-2 text-right">Budget</th>
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
                {r.campaignId ?? "–"}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatNumber(r.leads)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatMoney(r.revenueEur, r.currency)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatEuro(r.spendEur)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {r.cpl == null ? "–" : formatEuro(r.cpl)}
              </td>
              <td className="py-2 text-right tabular-nums">
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
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
