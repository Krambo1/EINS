import Link from "next/link";
import { Badge } from "@eins/ui";
import {
  formatEuro,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatRoas,
} from "@/lib/formatting";
import type { ClinicLeaderboardRow } from "@/server/queries/admin";
import { KPI_THRESHOLDS, toneForLowerBetter } from "@/server/constants/admin";
import { Panel, PanelLink } from "./Panel";

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

/** Every missing value looks the same, whatever the column. */
const DASH = <span className="text-fg-tertiary">–</span>;

/** Zeros recede so the Praxen with activity stand out (as in the clinic tables). */
function numTone(value: number): string {
  return value === 0 ? "text-fg-tertiary" : "";
}

const OPEN_BUTTON_CLASS =
  "rounded border border-border px-2 py-1 text-[13px] font-medium text-fg-primary transition-colors hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Opens the clinic portal as this Praxis (as Inhaber) in a new tab. */
function OpenAsClinic({ row }: { row: LeaderboardRow }) {
  if (row.archivedAt) return DASH;
  return (
    <form
      action="/admin/start-impersonation"
      method="POST"
      target="_blank"
      rel="noopener noreferrer"
      className="flex justify-end"
    >
      <input type="hidden" name="clinicId" value={row.clinicId} />
      <button
        type="submit"
        className={OPEN_BUTTON_CLASS}
        title={`Portal als ${row.name} öffnen (als Inhaber)`}
      >
        Öffnen
      </button>
    </form>
  );
}

function Health({ tone }: { tone: ClinicLeaderboardRow["healthTone"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] text-fg-primary">
      <span className={`inline-block h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      {TONE_LABEL[tone]}
    </span>
  );
}

/**
 * Sorted by Anfragen, the number every Praxis has from day one (organisch
 * zuerst; Werbeertrag only exists once ads run). `showAds=false` (no ad data
 * yet) hides the Budget and Werbeertrag columns. Phone: one block per Praxis
 * (name, Zustand, the key numbers, Öffnen) instead of the wide table.
 */
export function ClinicLeaderboard({
  rows,
  showAds = true,
}: {
  rows: LeaderboardRow[];
  showAds?: boolean;
}) {
  const sorted = [...rows].sort((a, b) => b.leads - a.leads);

  return (
    <Panel
      title="Praxen im Vergleich"
      count={sorted.length}
      action={<PanelLink href="/admin/clinics">Alle Praxen</PanelLink>}
      bodyClassName="px-0 pb-1 pt-2"
    >
      {sorted.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-fg-secondary">Noch keine Praxis angelegt.</p>
      )}

      {/* Phone */}
      {sorted.length > 0 && (
        <ul className="divide-y divide-border border-t border-border md:hidden">
          {sorted.map((r) => (
            <li key={r.clinicId} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={`/admin/clinics/${r.clinicId}`}
                    className="font-medium text-fg-primary hover:text-accent"
                  >
                    {r.name}
                  </Link>
                  {r.archivedAt && <Badge tone="bad">Archiviert</Badge>}
                </div>
                <div className="mt-1">
                  <Health tone={r.healthTone} />
                </div>
                <div className="mt-1 text-[13px] tabular-nums text-fg-secondary">
                  {formatMoney(r.revenueEur, r.currency)} · {formatNumber(r.leads)} Anfragen ·{" "}
                  {formatNumber(r.casesWon)} Abschlüsse
                  {showAds && r.roas != null && <> · {formatRoas(r.roas)} Werbeertrag</>}
                </div>
              </div>
              <OpenAsClinic row={r} />
            </li>
          ))}
        </ul>
      )}

      {sorted.length > 0 && (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="border-y border-border text-left text-sm text-fg-secondary">
              <tr>
                <th className="px-4 py-2 font-normal">Praxis</th>
                {showAds && <th className="px-3 py-2 text-right font-normal">Budget</th>}
                <th className="px-3 py-2 text-right font-normal">Umsatz</th>
                {showAds && <th className="px-3 py-2 text-right font-normal">Werbeertrag</th>}
                <th className="px-3 py-2 text-right font-normal">Anfragen</th>
                <th className="px-3 py-2 text-right font-normal">Abschlüsse</th>
                <th className="px-3 py-2 text-right font-normal">Nicht erschienen</th>
                <th className="px-3 py-2 text-right font-normal">Median Antwort</th>
                <th className="px-3 py-2 text-right font-normal">Aktivität</th>
                <th className="px-3 py-2 font-normal">Zustand</th>
                <th className="px-4 py-2 text-right font-normal">
                  <span className="sr-only">Aktion</span>
                </th>
              </tr>
            </thead>
            <tbody>
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
                    className="h-10 border-b border-border last:border-b-0 hover:bg-bg-secondary"
                  >
                    <td className="px-4 py-1.5">
                      <Link
                        href={`/admin/clinics/${r.clinicId}`}
                        data-row
                        className="rounded font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {r.name}
                      </Link>
                      {r.archivedAt && (
                        <span className="ml-2 align-middle">
                          <Badge tone="bad">Archiviert</Badge>
                        </span>
                      )}
                    </td>
                    {showAds && (
                      <td className={`px-3 py-1.5 text-right tabular-nums ${numTone(r.spendEur)}`}>
                        {formatEuro(r.spendEur)}
                      </td>
                    )}
                    <td className={`px-3 py-1.5 text-right tabular-nums ${numTone(r.revenueEur)}`}>
                      {formatMoney(r.revenueEur, r.currency)}
                    </td>
                    {showAds && (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {r.roas == null ? DASH : formatRoas(r.roas)}
                      </td>
                    )}
                    <td className={`px-3 py-1.5 text-right tabular-nums ${numTone(r.leads)}`}>
                      {formatNumber(r.leads)}
                    </td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${numTone(r.casesWon)}`}>
                      {formatNumber(r.casesWon)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.noShowRate == null ? DASH : formatPercent(r.noShowRate)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.medianFirstContactMin == null ? (
                        DASH
                      ) : (
                        <span className={RESPONSE_TONE_CLASS[responseTone]}>
                          {formatNumber(r.medianFirstContactMin)} min
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-fg-secondary">
                      {r.lastActivityAt ? formatRelative(r.lastActivityAt) : DASH}
                    </td>
                    <td className="px-3 py-1.5">
                      <Health tone={r.healthTone} />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <OpenAsClinic row={r} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
