import Link from "next/link";
import { Badge, Card, CardContent } from "@eins/ui";
import { requireAdmin } from "@/auth/admin-guards";
import { formatDate } from "@/lib/formatting";
import { CONTENT_STATUS_LABELS, isContentStatus } from "@/lib/content-status";
import { CONTENT_STATUS_TONES, groupByOverviewStatus } from "@/lib/content-items";
import { OVERVIEW_PER_CLINIC, listContentOverview } from "@/server/content";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata = { title: "Beiträge · Admin" };

/**
 * All posts across Praxen, grouped by status. At most the 50 newest per
 * Praxis (per-Praxis cap, never a global one); the full list is on the
 * Praxis tab "Beiträge".
 */
export default async function AdminBeitraegePage() {
  await requireAdmin();
  const rows = await listContentOverview();
  const groups = groupByOverviewStatus(rows);

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Beiträge"
        subtitle={`Alle Beiträge aller Praxen nach Status. Je Praxis die ${OVERVIEW_PER_CLINIC} zuletzt geänderten.`}
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-base text-fg-primary">
              Noch keine Beiträge. Angelegt werden sie in der Praxis unter dem Reiter „Beiträge“.
            </p>
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.key}>
            <CardContent className="space-y-3">
              <h2 className="text-lg font-semibold">
                {g.label} <span className="text-fg-secondary tabular-nums">({g.items.length})</span>
              </h2>
              {g.items.length === 0 ? (
                <p className="text-sm text-fg-secondary">Keine.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-fg-primary">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Beitrag</th>
                      <th className="hidden py-2 pr-4 font-medium md:table-cell">Praxis</th>
                      <th className="hidden py-2 pr-4 font-medium sm:table-cell">Code</th>
                      <th className="py-2 pr-4 font-medium">Status</th>
                      <th className="hidden py-2 font-medium md:table-cell">Geändert</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.items.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-4">
                          <Link
                            href={`/admin/clinics/${r.clinicId}?tab=beitraege`}
                            className="font-medium hover:text-accent"
                          >
                            {r.title}
                          </Link>
                          <span className="block text-xs text-fg-secondary md:hidden">
                            {r.clinicName} · <span className="font-mono">{r.code}</span>
                          </span>
                        </td>
                        <td className="hidden py-2 pr-4 md:table-cell">{r.clinicName}</td>
                        <td className="hidden py-2 pr-4 font-mono sm:table-cell">{r.code}</td>
                        <td className="py-2 pr-4">
                          {isContentStatus(r.status) ? (
                            <Badge tone={CONTENT_STATUS_TONES[r.status]}>{CONTENT_STATUS_LABELS[r.status]}</Badge>
                          ) : (
                            r.status
                          )}
                        </td>
                        <td className="hidden py-2 tabular-nums md:table-cell">{formatDate(r.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
