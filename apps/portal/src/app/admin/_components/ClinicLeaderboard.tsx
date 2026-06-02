import Link from "next/link";
import { Card, CardTitle, Badge, Button } from "@eins/ui";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import type { ClinicLeaderboardRow } from "@/server/queries/admin";
import { KPI_THRESHOLDS, toneForLowerBetter } from "@/server/constants/admin";

/** Leaderboard row enriched with the median first-contact time, folded in from
 *  `responseTimeRanking` by clinicId in admin/page.tsx so the Antwortzeit no
 *  longer needs its own table. */
export interface LeaderboardRow extends ClinicLeaderboardRow {
  medianFirstContactMin: number | null;
}

const TONE_DOT: Record<ClinicLeaderboardRow["healthTone"], string> = {
  good: "bg-tone-good",
  warn: "bg-tone-warn",
  bad: "bg-tone-bad",
  neutral: "bg-bg-tertiary",
};

const TONE_LABEL: Record<ClinicLeaderboardRow["healthTone"], string> = {
  good: "Gesund",
  warn: "Beobachten",
  bad: "Reagieren",
  neutral: "Keine Daten",
};

const RESPONSE_TONE_CLASS: Record<"good" | "warn" | "bad" | "neutral", string> = {
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
  neutral: "",
};

export function ClinicLeaderboard({ rows }: { rows: LeaderboardRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));

  return (
    <Card
      className="overflow-hidden !p-0 print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-6">
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          Praxis-Leaderboard
        </CardTitle>
        <Link
          href="/admin/clinics"
          className="text-sm text-accent hover:underline"
        >
          Alle Praxen →
        </Link>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-border bg-bg-secondary text-left text-xs text-fg-secondary">
            <tr>
              <th className="px-6 py-2">Praxis</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">Umsatz</th>
              <th className="px-3 py-2 text-right">ROAS</th>
              <th className="px-3 py-2 text-right">Leads</th>
              <th className="px-3 py-2 text-right">Cases</th>
              <th className="px-3 py-2 text-right">No-Show</th>
              <th className="px-3 py-2 text-right">Median Antwort</th>
              <th className="px-3 py-2 text-right">Aktivität</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2 pr-6 text-right">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={11}
                  className="px-6 py-10 text-center text-fg-secondary"
                >
                  Noch keine Praxis angelegt.
                </td>
              </tr>
            )}
            {sorted.map((r) => {
              const responseTone =
                r.medianFirstContactMin == null
                  ? "neutral"
                  : toneForLowerBetter(
                      r.medianFirstContactMin,
                      KPI_THRESHOLDS.responseTimeMin
                    );
              return (
                <tr
                  key={r.clinicId}
                  className="border-b border-border last:border-b-0 hover:bg-bg-secondary"
                >
                  <td className="px-6 py-2">
                    <Link
                      href={`/admin/clinics/${r.clinicId}`}
                      className="font-medium text-fg-primary hover:text-accent"
                    >
                      {r.name}
                    </Link>
                    {r.archivedAt && (
                      <span className="ml-2 align-middle">
                        <Badge tone="bad">Archiviert</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatEuro(r.spendEur)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatMoney(r.revenueEur, r.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.roas == null ? "–" : `${r.roas.toFixed(2)}×`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(r.leads)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatNumber(r.casesWon)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.noShowRate == null ? "–" : formatPercent(r.noShowRate)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.medianFirstContactMin == null ? (
                      <span className="text-fg-tertiary">–</span>
                    ) : (
                      <span className={RESPONSE_TONE_CLASS[responseTone]}>
                        {formatNumber(r.medianFirstContactMin)} min
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-fg-secondary">
                    {r.lastActivityAt
                      ? formatRelative(r.lastActivityAt)
                      : "–"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[r.healthTone]}`}
                        aria-hidden
                      />
                      {TONE_LABEL[r.healthTone]}
                    </span>
                  </td>
                  <td className="px-3 py-2 pr-6 text-right">
                    {r.archivedAt ? (
                      <span className="text-xs text-fg-secondary">–</span>
                    ) : (
                      <form
                        action="/admin/start-impersonation"
                        method="POST"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex justify-end"
                      >
                        <input type="hidden" name="clinicId" value={r.clinicId} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          title={`Portal als ${r.name} öffnen (als Inhaber)`}
                        >
                          Öffnen
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
