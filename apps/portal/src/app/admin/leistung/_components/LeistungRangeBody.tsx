import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import { formatEuro, formatMoney, formatNumber } from "@/lib/formatting";
import { reportingChannelLabel } from "@/lib/sources";
import { platformMix, topCampaigns } from "@/server/queries/admin";
import { dashboardRangeDays, type DashboardRange } from "@/lib/dashboard-range";
import { Brand, withBrandLogos } from "@/app/_components/Brand";

type LeistungRangeData = {
  mix: Awaited<ReturnType<typeof platformMix>>;
  top: Awaited<ReturnType<typeof topCampaigns>>;
  bottom: Awaited<ReturnType<typeof topCampaigns>>;
};

/** The reads behind the period-dependent part of /admin/leistung. */
export async function loadLeistungRange(range: DashboardRange): Promise<LeistungRangeData> {
  const days = dashboardRangeDays(range);
  const [mix, top, bottom] = await Promise.all([
    platformMix(days),
    topCampaigns({ periodDays: days, limit: 10 }),
    topCampaigns({ periodDays: days, limit: 10, ascending: true }),
  ]);
  return { mix, top, bottom };
}

/**
 * The period-dependent part of /admin/leistung: the platform cards and the
 * top and bottom campaigns. Rendered by the page for the period in the URL
 * and by `loadAdminLeistung` (range-actions.tsx) for the others.
 */
export function LeistungRangeBody({ mix, top, bottom }: LeistungRangeData) {
  return (
    <>
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
                  <Stat label="Kosten je Anfrage" value={cpl == null ? "–" : formatEuro(cpl)} />
                </div>
                <div className="text-xs text-fg-secondary">
                  Anteil am gesamten Werbebudget:{" "}
                  <span className="tabular-nums">
                    {(m?.sharePct ?? 0).toFixed(1).replace(".", ",")} %
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
            Kampagnen mit den meisten Anfragen
          </h2>
          <CampaignTable rows={top} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-xl font-medium md:text-2xl">
            Kampagnen mit den wenigsten Anfragen
          </h2>
          <p className="text-sm text-fg-secondary">
            Kandidaten zum Pausieren oder Optimieren. Nur bezahlte Anzeigen:
            organische Beiträge sind keine Kampagnen. Budget und Werbeertrag
            gibt es je Plattform, in den Karten oben.
          </p>
          <CampaignTable rows={bottom} />
        </CardContent>
      </Card>
    </>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${r.clinicId}-${r.channel}-${r.campaignId ?? i}`}
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
              <td className="py-2">{withBrandLogos(reportingChannelLabel(r.channel))}</td>
              <td className="py-2 font-mono text-xs text-fg-secondary">
                {r.campaignId ?? "–"}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatNumber(r.leads)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatMoney(r.revenueEur, r.currency)}
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
      <div className="text-sm font-medium text-fg-primary">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
