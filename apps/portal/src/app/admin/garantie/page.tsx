import Link from "next/link";
import { Badge, Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatIsoDate } from "@/lib/guarantee-clock";
import { listGuaranteeOverview, type GuaranteeOverviewRow } from "@/server/guarantee-clock";
import { demoClinicIds } from "@/server/queries/admin";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { HowCalculated } from "../_components/HowCalculated";
import { ClockStatusBadge } from "./_components/ClockStatusBadge";
import { GuaranteeOpenBadges } from "./_components/GuaranteeOpenBadges";

export const metadata = { title: "Garantie-Uhr · Admin" };

export default async function AdminGuaranteePage() {
  await requireAdmin();
  const [all, demo] = await Promise.all([
    listGuaranteeOverview(),
    demoClinicIds().catch(() => new Set<string>()),
  ]);
  // The demo Praxis stays visible (for trying things out) but last and
  // marked: it counts in no badge and no "Heute wichtig" line.
  const rows = [...all.filter((r) => !demo.has(r.clinicId)), ...all.filter((r) => demo.has(r.clinicId))];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Garantie-Uhr"
        subtitle="90 Tage bis zur ersten qualifizierten Anfrage über EINS, je Praxis."
      />

      <HowCalculated>
        <p>
          Keine Anfrage, keine Rechnung: Die Frist beträgt 90 Tage ab Unterschrift plus Verzugstage, bis die erste
          qualifizierte Anfrage über EINS bestätigt ist.
        </p>
        <p>Verzug zählt erst, wenn er der Praxis mitgeteilt ist. Diese Seite ist nur im Admin sichtbar, nicht für die Praxis.</p>
      </HowCalculated>

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-lg font-semibold">Alle Praxen, dringendste zuerst</h2>
          {rows.length === 0 ? (
            <p className="text-base text-fg-primary">Noch keine Praxis angelegt.</p>
          ) : (
            <div className="overflow-x-auto">
              {/* Below md only Praxis (with status and open points) and Resttage (with Tag X), so nothing scrolls sideways. */}
              <table className="w-full text-left text-sm md:min-w-[820px]">
                <thead className="border-b border-border text-fg-primary">
                  <tr>
                    <th className="py-2 pr-2 font-medium md:pr-4">Praxis</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Status</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Unterschrift</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Tag</th>
                    <th className="py-2 text-right font-medium md:pr-4">Resttage</th>
                    <th className="hidden py-2 pr-4 font-medium md:table-cell">Frist</th>
                    <th className="hidden py-2 font-medium md:table-cell">Offen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <OverviewRow key={r.clinicId} r={r} isDemo={demo.has(r.clinicId)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OverviewRow({ r, isDemo }: { r: GuaranteeOverviewRow; isDemo: boolean }) {
  const s = r.state;
  const hasClock = s.status !== "ohne_startdatum";
  const running = s.status === "laeuft";
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-3 pr-2 md:pr-4">
        <Link href={`/admin/garantie/${r.clinicId}`} className="font-medium break-words hover:underline">
          {r.clinicName}
        </Link>
        {isDemo && (
          <div className="mt-1">
            <Badge>Demo, zählt nicht mit</Badge>
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5 md:hidden">
          <ClockStatusBadge status={s.status} />
          <GuaranteeOpenBadges r={r} />
        </div>
      </td>
      <td className="hidden py-3 pr-4 md:table-cell">
        <ClockStatusBadge status={s.status} />
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap md:table-cell">{formatIsoDate(r.signedOn)}</td>
      <td className="hidden py-3 pr-4 whitespace-nowrap tabular-nums md:table-cell">
        {hasClock ? `${s.dayNumber} von ${s.totalDays}` : "–"}
      </td>
      <td className="py-3 text-right tabular-nums md:pr-4">
        {running ? (
          <span className={s.daysLeft <= 14 ? "font-semibold text-tone-bad" : undefined}>
            {s.daysLeft}
          </span>
        ) : (
          "–"
        )}
        {hasClock && (
          <div className="mt-1 whitespace-nowrap md:hidden">
            Tag {s.dayNumber} von {s.totalDays}
          </div>
        )}
      </td>
      <td className="hidden py-3 pr-4 whitespace-nowrap md:table-cell">{formatIsoDate(s.deadline)}</td>
      <td className="hidden py-3 md:table-cell">
        <div className="flex flex-wrap gap-2">
          <GuaranteeOpenBadges r={r} />
        </div>
      </td>
    </tr>
  );
}
