import Link from "next/link";
import { Badge } from "@eins/ui";
import { formatRelative } from "@/lib/formatting";
import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import type { SlaQueueRow } from "@/server/queries/admin";
import { QueueShell } from "./QueueShell";

export function SlaQueue({ rows }: { rows: SlaQueueRow[] }) {
  return (
    <QueueShell
      id="sla"
      title="SLA-Verstöße"
      description="Anfragen ohne Erstkontakt, deren Plan-SLA bereits abgelaufen ist."
      count={rows.length}
      tone="bad"
      emptyMessage="Keine SLA-Verstöße. Reaktionszeit eingehalten."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-secondary">
            <tr>
              <th className="py-2">Klinik</th>
              <th className="py-2">Kontakt</th>
              <th className="py-2">Quelle</th>
              <th className="py-2">Status</th>
              <th className="py-2 text-right">SLA</th>
              <th className="py-2 text-right">Alter</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-2">
                  <Link
                    href={`/admin/clinics/${r.clinicId}?tab=leads`}
                    className="hover:text-accent"
                  >
                    {r.clinicName}
                  </Link>
                </td>
                <td className="py-2">
                  <div className="text-fg-primary">
                    {r.contactName ?? "ohne Namen"}
                  </div>
                  <div className="text-xs text-fg-secondary">
                    {r.contactEmail ?? "—"}
                  </div>
                </td>
                <td className="py-2 capitalize">{r.source}</td>
                <td className="py-2">
                  <Badge tone="warn">
                    {REQUEST_STATUS_LABELS[r.status] ?? r.status}
                  </Badge>
                </td>
                <td className="py-2 text-right text-xs text-fg-secondary">
                  {r.slaRespondBy ? formatRelative(r.slaRespondBy) : "–"}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-fg-secondary">
                  {r.ageHours}h
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueueShell>
  );
}
