import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import { formatNumber } from "@/lib/formatting";
import type {
  ResponseTimeRow,
  SlaBreachRow,
} from "@/server/queries/admin";
import { KPI_THRESHOLDS, toneForLowerBetter } from "@/server/constants/admin";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function SlaAndResponseSection({
  sla,
  response,
}: {
  sla: SlaBreachRow[];
  response: ResponseTimeRow[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <header className="mb-4">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
              SLA-Verstöße
            </span>
            <h2 className="mt-1 font-display text-xl font-semibold">
              Top 5 Kliniken mit offenen Verstößen
            </h2>
          </header>
          {sla.length === 0 ? (
            <p className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-sm text-tone-good">
              Keine SLA-Verstöße. Alles im grünen Bereich.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">Klinik</th>
                  <th className="py-2 text-right">Offen</th>
                  <th className="py-2 text-right">Älteste</th>
                </tr>
              </thead>
              <tbody>
                {sla.map((r) => (
                  <tr key={r.clinicId} className="border-t border-border">
                    <td className="py-2">
                      <Link
                        href={`/admin/clinics/${r.clinicId}?tab=leads`}
                        className="hover:text-accent"
                      >
                        {r.clinicName}
                      </Link>
                    </td>
                    <td className="py-2 text-right">
                      <Badge tone="bad">{r.breachCount}</Badge>
                    </td>
                    <td className="py-2 text-right font-mono text-xs tabular-nums text-fg-secondary">
                      {r.oldestBreachHours}h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className={GLOW_CARD}>
        <CardContent className="pt-6">
          <header className="mb-4">
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
              Antwortzeit
            </span>
            <h2 className="mt-1 font-display text-xl font-semibold">
              Median bis Erstkontakt · 30 Tage
            </h2>
          </header>
          {response.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Noch keine Reaktions-Daten in diesem Zeitraum.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">Klinik</th>
                  <th className="py-2 text-right">Median</th>
                  <th className="py-2 text-right">Verstoß %</th>
                </tr>
              </thead>
              <tbody>
                {response.map((r) => {
                  const tone = toneForLowerBetter(
                    r.medianFirstContactMin,
                    KPI_THRESHOLDS.responseTimeMin
                  );
                  return (
                    <tr key={r.clinicId} className="border-t border-border">
                      <td className="py-2">
                        <Link
                          href={`/admin/clinics/${r.clinicId}`}
                          className="hover:text-accent"
                        >
                          {r.clinicName}
                        </Link>
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {r.medianFirstContactMin == null ? (
                          <span className="text-fg-tertiary">–</span>
                        ) : (
                          <span
                            className={
                              tone === "good"
                                ? "text-tone-good"
                                : tone === "warn"
                                  ? "text-tone-warn"
                                  : tone === "bad"
                                    ? "text-tone-bad"
                                    : ""
                            }
                          >
                            {formatNumber(r.medianFirstContactMin)} min
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums text-fg-secondary">
                        {r.breachRatePct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
