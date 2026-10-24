import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import type { GuaranteeOverviewRow } from "@/server/guarantee-clock";
import type { RueckrufRow } from "@/server/response-enforcement";
import { ENFORCEMENT_THRESHOLD } from "@/lib/response-time";
import { ClockStatusBadge } from "../garantie/_components/ClockStatusBadge";
import { GuaranteeOpenBadges } from "../garantie/_components/GuaranteeOpenBadges";
import { RueckrufLageBadges } from "../rueckruf/_components/RueckrufLageBadges";

const CARD_STYLE = { backgroundColor: "var(--bg-card)", boxShadow: "var(--shadow-card)" };
const ROW_CLASS =
  "flex flex-col gap-2 rounded-lg px-3 py-3 transition-colors hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4";

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
 * open candidates, Verzug) and the Rückruf-Lage. Rows come straight from
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
    <div className="grid gap-8 xl:grid-cols-5">
      <Card className="min-w-0 xl:col-span-3" style={CARD_STYLE}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle className="!text-xl !font-medium md:!text-2xl">Garantie-Uhr</CardTitle>
            <p className="text-base text-fg-primary">
              90 Tage bis zur ersten qualifizierten Anfrage über EINS, dringendste zuerst.
            </p>
          </div>
          <Link href="/admin/garantie" className="shrink-0 text-base text-accent hover:underline">
            Alle ansehen
          </Link>
        </CardHeader>
        <CardContent>
          {guarantee.length === 0 ? (
            <p className="text-base text-fg-primary">Noch keine Praxis angelegt.</p>
          ) : (
            <ul className="-mx-3 divide-y divide-border">
              {guarantee.map((r) => {
                const s = r.state;
                const unsent = invoiceUnsent.has(r.clinicId);
                const step = nextStep(r, unsent);
                const hasClock = s.status !== "ohne_startdatum";
                return (
                  <li key={r.clinicId}>
                    <Link href={`/admin/garantie/${r.clinicId}`} className={ROW_CLASS}>
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-fg-primary">{r.clinicName}</span>
                          <ClockStatusBadge status={s.status} />
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <GuaranteeOpenBadges r={r} invoiceUnsent={unsent} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-base sm:flex-col sm:items-end sm:gap-1">
                        {hasClock && (
                          <span className="tabular-nums text-fg-primary">
                            Tag {s.dayNumber} von {s.totalDays}
                          </span>
                        )}
                        {s.status === "laeuft" && (
                          <span
                            className={`tabular-nums ${s.daysLeft <= 14 ? "font-semibold text-tone-bad" : "text-fg-primary"}`}
                          >
                            {s.daysLeft === 1 ? "1 Tag übrig" : `${s.daysLeft} Tage übrig`}
                          </span>
                        )}
                        {step && <span className="font-semibold text-accent">{step} →</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 xl:col-span-2" style={CARD_STYLE}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="flex flex-col gap-1">
            <CardTitle className="!text-xl !font-medium md:!text-2xl">Rückruf-Lage</CardTitle>
            <p className="text-base text-fg-primary">
              Anfragen länger als 48 Werkstunden ohne Kontaktversuch der Praxis.
            </p>
          </div>
          <Link href="/admin/rueckruf" className="shrink-0 text-base text-accent hover:underline">
            Alle ansehen
          </Link>
        </CardHeader>
        <CardContent>
          {rueckrufOpen.length === 0 ? (
            <p className="text-base text-fg-primary">
              Keine Praxis hat gerade eine Anfrage, die länger als 48 Werkstunden ohne Kontaktversuch liegt.
            </p>
          ) : (
            <ul className="-mx-3 divide-y divide-border">
              {rueckrufOpen.map((r) => {
                const count = r.state.overdueOpen.length;
                return (
                  <li key={r.clinicId}>
                    <Link href="/admin/rueckruf" className={ROW_CLASS}>
                      <div className="min-w-0 space-y-1.5">
                        <span className="font-medium text-fg-primary">{r.clinicName}</span>
                        <div className="flex flex-wrap gap-2">
                          <RueckrufLageBadges s={r.state} />
                          {r.state.paused && (
                            <span className="text-base text-fg-primary">Anzeigen pausiert</span>
                          )}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-base tabular-nums ${count >= ENFORCEMENT_THRESHOLD ? "font-semibold text-tone-bad" : "text-fg-primary"}`}
                      >
                        {count === 1 ? "1 Anfrage offen" : `${count} Anfragen offen`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
