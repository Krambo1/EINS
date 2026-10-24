import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import type { DeletionTaskRow, StopTaskRow } from "@/server/clone";
import { cloneDeletionDueOn, cloneDeletionOverdue } from "@/lib/content-gate";
import { postCountLabel } from "@/lib/clone-record";
import { formatDate } from "@/lib/formatting";

const CARD_STYLE = { backgroundColor: "var(--bg-card)", boxShadow: "var(--shadow-card)" };
const ROW_CLASS =
  "flex flex-col gap-1 rounded-lg px-3 py-3 transition-colors hover:bg-bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4";

/**
 * Admin home, open KI-Klon tasks: posts flagged "zu stoppen" after a
 * revocation (per Praxis, links to its Beiträge tab) and clone models whose
 * deletion is owed after the contract end (red once due, links to the
 * KI-Klon tab). Nothing open, nothing shown.
 */
export function HomeKlonTasks({
  stopTasks,
  deletionTasks,
  today,
}: {
  stopTasks: StopTaskRow[];
  deletionTasks: DeletionTaskRow[];
  today: string;
}) {
  if (stopTasks.length === 0 && deletionTasks.length === 0) return null;

  return (
    <div className="grid gap-8 xl:grid-cols-2">
      {stopTasks.length > 0 && (
        <Card className="min-w-0" style={CARD_STYLE}>
          <CardHeader>
            <CardTitle className="!text-xl !font-medium md:!text-2xl">Beiträge zu stoppen</CardTitle>
            <p className="text-base text-fg-primary">
              Nach einem Widerruf des KI-Klons markiert. Bitte sofort stoppen.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="-mx-3 divide-y divide-border">
              {stopTasks.map((t) => (
                <li key={t.clinicId}>
                  <Link href={`/admin/clinics/${t.clinicId}?tab=beitraege`} className={ROW_CLASS}>
                    <span className="font-medium text-fg-primary">{t.clinicName}</span>
                    <span className="font-semibold text-tone-bad">{postCountLabel(t.count)} zu stoppen</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {deletionTasks.length > 0 && (
        <Card className="min-w-0" style={CARD_STYLE}>
          <CardHeader>
            <CardTitle className="!text-xl !font-medium md:!text-2xl">KI-Klon löschen</CardTitle>
            <p className="text-base text-fg-primary">Sofort nach einem Widerruf, sonst spätestens 30 Tage nach Vertragsende.</p>
          </CardHeader>
          <CardContent>
            <ul className="-mx-3 divide-y divide-border">
              {deletionTasks.map((t) => {
                const due = cloneDeletionDueOn(t.contractEndOn, t.revokedOn);
                const overdue = cloneDeletionOverdue(t.contractEndOn, null, today, t.revokedOn);
                return (
                  <li key={t.id}>
                    <Link href={`/admin/clinics/${t.clinicId}?tab=klon`} className={ROW_CLASS}>
                      <span className="min-w-0">
                        <span className="font-medium text-fg-primary">{t.clinicName}</span>
                        <span className="block text-sm text-fg-secondary">
                          {t.personName}, {t.tool}
                        </span>
                      </span>
                      <span className={overdue ? "font-semibold text-tone-bad" : "text-fg-primary"}>
                        {overdue ? "Fällig seit " : "Fällig am "}
                        {formatDate(due)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
