import { Card, CardContent, MetricTile, TrendChart } from "@eins/ui";
import { formatNumber } from "@/lib/formatting";
import type { AuditOverview } from "@/server/queries/admin";
import { Heatmap } from "../../_charts/Heatmap";

export function AuditOverviewPanel({ data }: { data: AuditOverview }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Ereignisse (30 T)"
          value={formatNumber(data.totalEvents)}
        />
        <MetricTile
          label="Akteure (30 T)"
          value={formatNumber(data.uniqueActors)}
        />
        <MetricTile
          label="Häufigste Aktion"
          value={data.topAction?.action ?? "–"}
          sublabel={
            data.topAction
              ? `${formatNumber(data.topAction.count)} Ereignisse`
              : ""
          }
          tone="accent"
        />
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">
            Volumen · 30 Tage
          </h2>
          <div className="rounded-xl border border-border bg-bg-primary p-3">
            <TrendChart
              data={data.volumeTrend.map((v) => ({
                date: v.date,
                value: v.count,
              }))}
              tone="accent"
              height={220}
              showAxes
              showGrid
              valueFormat="number"
              label="Ereignisse"
              ariaLabel="Audit-Volumen, 30 Tage"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">
            Top-Praxen × Aktionen
          </h2>
          <p className="text-xs text-fg-secondary">
            Wer macht was? Mint-Skala: dunkler = mehr Ereignisse.
          </p>
          <Heatmap
            rows={data.heatmap.clinicNames.map((cn, i) => ({
              label: cn,
              cells: data.heatmap.matrix[i] ?? [],
            }))}
            columnLabels={data.heatmap.actions}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h2 className="text-xl font-medium md:text-2xl">Top-Akteure</h2>
          {data.topActors.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Keine Akteure im Zeitraum.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-medium text-fg-secondary">
                <tr>
                  <th className="py-2">E-Mail</th>
                  <th className="py-2 text-right">Ereignisse</th>
                </tr>
              </thead>
              <tbody>
                {data.topActors.map((a) => (
                  <tr key={a.actorEmail} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{a.actorEmail}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatNumber(a.count)}
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
