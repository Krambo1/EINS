import Link from "next/link";
import type { GuaranteeOverviewRow } from "@/server/guarantee-clock";
import type { RueckrufRow } from "@/server/response-enforcement";
import { ENFORCEMENT_THRESHOLD } from "@/lib/response-time";
import { ClockStatusBadge } from "../garantie/_components/ClockStatusBadge";
import { GuaranteeOpenBadges } from "../garantie/_components/GuaranteeOpenBadges";
import { RueckrufLageBadges } from "../rueckruf/_components/RueckrufLageBadges";
import { Panel, PanelLink, ROW_CLASS } from "./Panel";

/** What Karam does next for this Praxis. Reads only flags the clock already computed. */
function nextStep(r: GuaranteeOverviewRow, invoiceUnsent: boolean): string | null {
  const s = r.state;
  if (r.hasCandidate) return "Anfrage prüfen";
  if (invoiceUnsent) return "Erste Rechnung senden";
  if (r.unnotifiedDelayCount > 0) return "Verzug mitteilen";
  if (s.status === "ohne_startdatum") return "Unterschriftsdatum eintragen";
  if (s.status === "laeuft" && s.daysLeft <= 14) return "Frist endet bald";
  return null;
}

/**
 * Admin home, top section: the guarantee situation per Praxis (Tag X von 90,
 * open candidates, Verzug) and the Rückruf-Lage (Anfragen länger als 48
 * Werkstunden ohne Kontaktversuch), split two thirds to one third like the
 * rows below. Rows come straight from
 * `listGuaranteeOverview` and `listRueckrufLage`, the same data the Garantie-
 * Uhr and Rückruf-Lage pages render; each row links to its detail page.
 */
export function HomeGuaranteeSection({
  guarantee,
  invoiceUnsent,
  rueckruf,
}: {
  guarantee: GuaranteeOverviewRow[];
  /** Clinic ids whose first invoice is due and not yet marked as sent. */
  invoiceUnsent: Set<string>;
  rueckruf: RueckrufRow[];
}) {
  const rueckrufOpen = rueckruf.filter(
    (r) =>
      r.state.overdueOpen.length > 0 || r.state.paused || r.state.activeWarning !== null || r.state.resumeDue
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel
        className="lg:col-span-2"
        title="Garantie-Uhr"
        count={guarantee.length}
        action={<PanelLink href="/admin/garantie">Alle ansehen</PanelLink>}
        bodyClassName="px-4 pb-2 pt-1"
      >
        {guarantee.length === 0 ? (
          <p className="py-2 text-sm text-fg-secondary">Noch keine Praxis angelegt.</p>
        ) : (
          <ul className="divide-y divide-border">
            {guarantee.map((r) => {
              const s = r.state;
              const unsent = invoiceUnsent.has(r.clinicId);
              const step = nextStep(r, unsent);
              const hasClock = s.status !== "ohne_startdatum";
              return (
                <li key={r.clinicId}>
                  <Link
                    href={`/admin/garantie/${r.clinicId}`}
                    data-row
                    className={`${ROW_CLASS} flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:justify-between`}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-fg-primary">{r.clinicName}</span>
                      <ClockStatusBadge status={s.status} />
                      <GuaranteeOpenBadges r={r} invoiceUnsent={unsent} />
                    </div>
                    <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px] tabular-nums sm:justify-end">
                      {hasClock && (
                        <span className="text-fg-secondary">
                          Tag {s.dayNumber} von {s.totalDays}
                        </span>
                      )}
                      {s.status === "laeuft" && (
                        <span className={s.daysLeft <= 14 ? "font-medium text-tone-bad" : "text-fg-secondary"}>
                          {s.daysLeft === 1 ? "1 Tag übrig" : `${s.daysLeft} Tage übrig`}
                        </span>
                      )}
                      {step && <span className="font-medium text-fg-primary">{step} →</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel
        title="Rückruf-Lage"
        count={rueckrufOpen.length}
        action={<PanelLink href="/admin/rueckruf">Alle ansehen</PanelLink>}
        bodyClassName="px-4 pb-2 pt-1"
      >
        {rueckrufOpen.length === 0 ? (
          <p className="py-2 text-sm text-fg-secondary">Keine Anfrage überfällig.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rueckrufOpen.map((r) => {
              const count = r.state.overdueOpen.length;
              return (
                <li key={r.clinicId}>
                  <Link href="/admin/rueckruf" data-row className={`${ROW_CLASS} justify-between`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-fg-primary">{r.clinicName}</span>
                      <RueckrufLageBadges s={r.state} />
                      {r.state.paused && (
                        <span className="text-[13px] text-fg-secondary">Anzeigen pausiert</span>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-[13px] tabular-nums ${count >= ENFORCEMENT_THRESHOLD ? "font-medium text-tone-bad" : "text-fg-secondary"}`}
                    >
                      {count === 1 ? "1 Anfrage offen" : `${count} Anfragen offen`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
