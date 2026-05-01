import Link from "next/link";
import { Card, CardContent, Badge } from "@eins/ui";
import {
  formatEuro,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/formatting";
import { PLAN_LABELS } from "@/lib/constants";
import type { ClinicLeaderboardRow } from "@/server/queries/admin";

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

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

export function ClinicLeaderboard({ rows }: { rows: ClinicLeaderboardRow[] }) {
  const sorted = [...rows].sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));

  return (
    <Card className={`${GLOW_CARD} !p-0 overflow-hidden`}>
      <CardContent className="p-0">
        <header className="flex flex-wrap items-end justify-between gap-2 px-6 pt-6">
          <div>
            <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
              Klinik-Leaderboard
            </span>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              Performance · 30 Tage
            </h2>
          </div>
          <Link
            href="/admin/clinics"
            className="text-sm text-accent hover:underline"
          >
            Alle Kliniken →
          </Link>
        </header>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-border bg-bg-secondary/40 text-left text-xs text-fg-secondary">
              <tr>
                <th className="px-6 py-2">Klinik</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Spend</th>
                <th className="px-3 py-2 text-right">Umsatz</th>
                <th className="px-3 py-2 text-right">ROAS</th>
                <th className="px-3 py-2 text-right">Leads</th>
                <th className="px-3 py-2 text-right">Cases</th>
                <th className="px-3 py-2 text-right">No-Show</th>
                <th className="px-3 py-2 text-right">Aktivität</th>
                <th className="px-3 py-2">Health</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-6 py-10 text-center text-fg-secondary"
                  >
                    Noch keine Klinik angelegt.
                  </td>
                </tr>
              )}
              {sorted.map((r) => (
                <tr
                  key={r.clinicId}
                  className="border-b border-border last:border-b-0 hover:bg-bg-secondary/30"
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
                  <td className="px-3 py-2">
                    <Badge tone={r.plan === "erweitert" ? "good" : "neutral"}>
                      {PLAN_LABELS[r.plan]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatEuro(r.spendEur)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {formatEuro(r.revenueEur)}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
