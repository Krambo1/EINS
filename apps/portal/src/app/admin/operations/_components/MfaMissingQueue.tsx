import Link from "next/link";
import { Badge } from "@eins/ui";
import { formatRelative } from "@/lib/formatting";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import type { MfaMissingRow } from "@/server/queries/admin";
import { QueueShell } from "./QueueShell";

export function MfaMissingQueue({ rows }: { rows: MfaMissingRow[] }) {
  return (
    <QueueShell
      id="mfa"
      title="MFA fehlt"
      description="Aktive Klinik-Mitglieder ohne aktivierten zweiten Faktor."
      count={rows.length}
      tone="warn"
      emptyMessage="Alle aktiven Mitglieder haben MFA aktiviert."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-secondary">
            <tr>
              <th className="py-2">Klinik</th>
              <th className="py-2">E-Mail</th>
              <th className="py-2">Rolle</th>
              <th className="py-2 text-right">Letzter Login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="py-2">
                  <Link
                    href={`/admin/clinics/${r.clinicId}?tab=team`}
                    className="hover:text-accent"
                  >
                    {r.clinicName}
                  </Link>
                </td>
                <td className="py-2 font-mono text-xs">{r.email}</td>
                <td className="py-2">
                  <Badge tone="neutral">
                    {ROLE_LABELS[r.role as Role] ?? r.role}
                  </Badge>
                </td>
                <td className="py-2 text-right text-xs text-fg-secondary">
                  {r.lastLoginAt ? formatRelative(r.lastLoginAt) : "nie"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueueShell>
  );
}
