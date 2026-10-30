import Link from "next/link";
import type { DeletionTaskRow, StopTaskRow } from "@/server/clone";
import { cloneDeletionDueOn, cloneDeletionOverdue } from "@/lib/content-gate";
import { postCountLabel } from "@/lib/clone-record";
import { formatDate } from "@/lib/formatting";
import { Panel, ROW_CLASS } from "./Panel";

/**
 * Admin home, open KI-Klon tasks: posts flagged "zu stoppen" after a
 * revocation (per Praxis, links to its Beiträge tab) and clone models whose
 * deletion is owed after the contract end (red once due, links to the
 * KI-Klon tab; due right after a revocation, otherwise 30 days after the
 * contract end). Nothing open, nothing shown. Stacked full width: a half
 * split would break the page's thirds grid.
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
    <div className="grid gap-4">
      {stopTasks.length > 0 && (
        <Panel
          title="Beiträge zu stoppen"
          count={stopTasks.length}
          bodyClassName="px-4 pb-2 pt-1"
        >
          <ul className="divide-y divide-border">
            {stopTasks.map((t) => (
              <li key={t.clinicId}>
                <Link
                  href={`/admin/clinics/${t.clinicId}?tab=beitraege`}
                  data-row
                  className={`${ROW_CLASS} justify-between`}
                >
                  <span className="min-w-0 truncate font-medium text-fg-primary">{t.clinicName}</span>
                  <span className="shrink-0 font-medium text-tone-bad">{postCountLabel(t.count)} zu stoppen</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {deletionTasks.length > 0 && (
        <Panel
          title="KI-Klon löschen"
          count={deletionTasks.length}
          bodyClassName="px-4 pb-2 pt-1"
        >
          <ul className="divide-y divide-border">
            {deletionTasks.map((t) => {
              const due = cloneDeletionDueOn(t.contractEndOn, t.revokedOn);
              const overdue = cloneDeletionOverdue(t.contractEndOn, null, today, t.revokedOn);
              return (
                <li key={t.id}>
                  <Link
                    href={`/admin/clinics/${t.clinicId}?tab=klon`}
                    data-row
                    className={`${ROW_CLASS} justify-between`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-fg-primary">{t.clinicName}</span>
                      <span className="block truncate text-[13px] text-fg-secondary">
                        {t.personName}, {t.tool}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${overdue ? "font-medium text-tone-bad" : "text-fg-secondary"}`}
                    >
                      {overdue ? "Fällig seit " : "Fällig am "}
                      {formatDate(due)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </div>
  );
}
