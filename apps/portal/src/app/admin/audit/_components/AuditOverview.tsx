import { Card, CardContent, MetricTile } from "@eins/ui";
import { formatNumber } from "@/lib/formatting";
import type { AuditOverview } from "@/server/queries/admin";
import { LineChart } from "../../_charts/LineChart";
import { Heatmap } from "../../_charts/Heatmap";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

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

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Volumen · 30 Tage
          </h2>
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <LineChart
              data={data.volumeTrend.map((v) => ({
                date: v.date,
                events: v.count,
              }))}
              series={[
                { key: "events", name: "Ereignisse", color: "var(--accent)" },
              ]}
              height={220}
            />
          </div>
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">
            Top-Kliniken × Aktionen
          </h2>
          <p className="text-xs text-fg-secondary">
            Wer macht was? Mint-Skala — dunkler = mehr Ereignisse.
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

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-3 pt-6">
          <h2 className="font-display text-xl font-semibold">Top-Akteure</h2>
          {data.topActors.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Keine Akteure im Zeitraum.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">E-Mail</th>
                  <th className="py-2 text-right">Ereignisse</th>
                </tr>
              </thead>
              <tbody>
                {data.topActors.map((a) => (
                  <tr key={a.actorEmail} className="border-t border-border">
                    <td className="py-2 font-mono text-xs">{a.actorEmail}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
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
