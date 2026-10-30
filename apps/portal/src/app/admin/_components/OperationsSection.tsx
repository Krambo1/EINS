import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@eins/ui";
import type { PendingOperations, SlaBreachRow } from "@/server/queries/admin";
import { Panel, PanelLink, ROW_CLASS } from "./Panel";

/**
 * Pending-ops counts, one linked row each while open. SLA-Verstöße is
 * deliberately NOT here: it gets its own dedicated list below, so the breach
 * count appears exactly once on the Übersicht (the nav badge aside).
 */
const PENDING_ITEMS: {
  href: string;
  label: string;
  key: keyof PendingOperations;
  tone: "bad" | "warn";
}[] = [
  {
    href: "/admin/operations#animationen",
    label: "Animationen offen",
    key: "animationsRequested",
    tone: "warn",
  },
  {
    href: "/admin/operations#sync-fehler",
    label: "Sync-Fehler",
    key: "syncErrors",
    tone: "bad",
  },
  {
    href: "/admin/operations#stagnierte",
    label: "Stagnierte Anfragen",
    key: "stalledRequests",
    tone: "warn",
  },
];

/** "5 h" under two days, then whole days ("345 Tage" instead of "8279h"). */
function ageLabel(hours: number): string {
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} Tage`;
}

/**
 * Operations: the open pending-ops counts and the SLA-breach top list in one
 * panel. Only what is open is shown (a 0 is no task); nothing open, no panel.
 * The response-time median lives in the leaderboard.
 */
export function OperationsSection({
  sla,
  operations,
}: {
  sla: SlaBreachRow[];
  operations: PendingOperations;
}) {
  const totalBreaches = sla.reduce((s, r) => s + r.breachCount, 0);
  const pending = PENDING_ITEMS.filter((item) => operations[item.key] > 0);
  if (pending.length === 0 && sla.length === 0) return null;

  return (
    <Panel
      title="Aufgaben"
      action={<PanelLink href="/admin/operations">Alle Aufgaben</PanelLink>}
      bodyClassName="space-y-4 px-4 pb-3 pt-1"
    >
      {pending.length > 0 && (
        <ul className="divide-y divide-border">
          {pending.map((item) => (
            <li key={item.href}>
              <Link href={item.href} data-row className={ROW_CLASS}>
                <span className="min-w-0 flex-1 text-fg-primary">{item.label}</span>
                <span
                  className={cn(
                    "shrink-0 font-medium tabular-nums",
                    item.tone === "bad" ? "text-tone-bad" : "text-tone-warn"
                  )}
                >
                  {operations[item.key]}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {sla.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between gap-2 pb-1">
            <span className="text-sm font-medium text-fg-primary">Internes Antwortziel überschritten</span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-tone-bad">
              {totalBreaches} offen
            </span>
          </div>
          <div className="flex items-center gap-3 border-b border-border py-1.5 text-sm text-fg-secondary">
            <span className="flex-1">Praxis</span>
            <span>Offen</span>
            <span className="w-20 text-right">Älteste</span>
            <span className="w-4" aria-hidden />
          </div>
          <ul className="divide-y divide-border">
            {sla.map((r) => (
              <li key={r.clinicId}>
                <Link
                  href={`/admin/clinics/${r.clinicId}?tab=leads`}
                  data-row
                  className={ROW_CLASS}
                >
                  <span className="min-w-0 flex-1 truncate text-fg-primary">{r.clinicName}</span>
                  <span className="shrink-0 font-medium tabular-nums text-tone-bad">
                    {r.breachCount}
                  </span>
                  <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-fg-secondary">
                    {ageLabel(r.oldestBreachHours)}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
