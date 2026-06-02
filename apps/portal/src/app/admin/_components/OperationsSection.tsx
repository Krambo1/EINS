import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@eins/ui";
import type { PendingOperations, SlaBreachRow } from "@/server/queries/admin";

/**
 * Pending-ops counts shown as a compact row of linked stats. SLA-Verstöße is
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
    label: "Stagnierte Leads",
    key: "stalledRequests",
    tone: "warn",
  },
];

/**
 * Operations — merges the SLA-breach top list and the pending-ops counts into a
 * single clinic-styled card, replacing the separate SlaAndResponseSection and
 * OperationsQuickAccess. The response-time median moved into the leaderboard.
 */
export function OperationsSection({
  sla,
  operations,
}: {
  sla: SlaBreachRow[];
  operations: PendingOperations;
}) {
  const totalBreaches = sla.reduce((s, r) => s + r.breachCount, 0);

  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          Operations
        </CardTitle>
        <Link
          href="/admin/operations"
          className="text-sm text-accent hover:underline"
        >
          Alle Aufgaben →
        </Link>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {PENDING_ITEMS.map((item) => {
            const count = operations[item.key];
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-3 text-sm font-medium text-fg-primary transition-colors hover:border-accent/60"
              >
                <span className="flex items-center gap-2">
                  {item.label}
                  {count > 0 && <Badge tone={item.tone}>{count}</Badge>}
                </span>
                <ArrowUpRight className="h-4 w-4 text-fg-tertiary transition-colors group-hover:text-accent" />
              </Link>
            );
          })}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-fg-secondary">
              SLA-Verstöße: Praxen mit offenen Verstößen
            </span>
            {totalBreaches > 0 && (
              <Badge tone="bad">{totalBreaches} offen</Badge>
            )}
          </div>
          {sla.length === 0 ? (
            <p className="rounded-md border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] px-4 py-3 text-sm text-tone-good">
              Keine SLA-Verstöße. Alles im grünen Bereich.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-fg-secondary">
                <tr>
                  <th className="py-2">Praxis</th>
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
        </div>
      </CardContent>
    </Card>
  );
}
