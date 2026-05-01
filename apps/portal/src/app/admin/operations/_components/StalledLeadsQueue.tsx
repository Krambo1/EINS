import Link from "next/link";
import { Badge } from "@eins/ui";
import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import { formatRelative } from "@/lib/formatting";
import type { StalledLeadRow } from "@/server/queries/admin";
import { QueueShell } from "./QueueShell";

export function StalledLeadsQueue({ rows }: { rows: StalledLeadRow[] }) {
  return (
    <QueueShell
      id="stagnierte"
      title="Stagnierte Leads"
      description="Anfragen, die länger als 7 Tage in einer offenen Status-Stufe stehen."
      count={rows.length}
      tone="warn"
      emptyMessage="Pipeline läuft sauber durch — keine Stagnationen."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-secondary">
            <tr>
              <th className="py-2">Klinik</th>
              <th className="py-2">Kontakt</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">Quelle</th>
              <th className="py-2 text-right">Erstellt</th>
              <th className="py-2 text-right">Tage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2">
                  <Link
                    href={`/admin/clinics/${r.clinicId}?tab=leads`}
                    className="hover:text-accent"
                  >
                    {r.clinicName}
                  </Link>
                </td>
                <td className="py-2">{r.contactName ?? "ohne Namen"}</td>
                <td className="py-2">
                  <Badge tone="warn">
                    {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                  </Badge>
                </td>
                <td className="py-2 text-right text-xs capitalize text-fg-secondary">
                  {r.source}
                </td>
                <td className="py-2 text-right text-xs text-fg-secondary">
                  {formatRelative(r.createdAt)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums">
                  {r.ageDays}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueueShell>
  );
}
