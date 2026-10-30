import Link from "next/link";
import { Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatRelative } from "@/lib/formatting";
import { syncErrorList } from "@/server/queries/admin";
import {
  ADMIN_RANGE_KEYS,
  DASHBOARD_RANGES,
  DEFAULT_DASHBOARD_RANGE,
  parseDashboardRange,
} from "@/lib/dashboard-range";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { ParamViews, ParamViewsSlot } from "@/app/_components/instant-views";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { loadAdminLeistung } from "../range-actions";
import { LeistungRangeBody, loadLeistungRange } from "./_components/LeistungRangeBody";

export const metadata = { title: "Leistung · Admin" };

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * Werbeleistung im Detail. Die Plattform-KPIs und der Budget/Umsatz-Trend
 * leben auf der Admin-Übersicht (MetricStrip + Werbeleistung-Karte); diese
 * Seite ergänzt, was dort fehlt: Plattform-Split, Top/Bottom-Kampagnen und
 * Sync-Zustand. Der Zeitraum kommt aus dem geteilten TimeRangeToggle
 * (gleiche Fenster wie überall sonst im Portal).
 */
export default async function AdminLeistungPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const range = parseDashboardRange(sp[ADMIN_RANGE_KEYS.leistung]);

  const [data, syncs] = await Promise.all([loadLeistungRange(range), syncErrorList()]);

  return (
    <ParamViews
      param={ADMIN_RANGE_KEYS.leistung}
      values={DASHBOARD_RANGES}
      defaultValue={DEFAULT_DASHBOARD_RANGE}
      load={loadAdminLeistung}
    >
      <div className="space-y-8">
        <AdminPageHeader
          title="Werbeleistung"
          subtitle="Plattform-Vergleich, Top- und Bottom-Kampagnen, Sync-Zustand."
          actions={
            <TimeRangeToggle
              value={range}
              paramKey={ADMIN_RANGE_KEYS.leistung}
              ariaLabel="Zeitraum für Werbeleistung"
            />
          }
        />

        <ParamViewsSlot param={ADMIN_RANGE_KEYS.leistung} value={range} className="space-y-8">
          <LeistungRangeBody {...data} />
        </ParamViewsSlot>

        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-xl font-medium md:text-2xl">Sync-Zustand</h2>
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
    </ParamViews>
  );
}
