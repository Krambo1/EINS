import Link from "next/link";
import { formatRelative } from "@/lib/formatting";
import type { SyncErrorRow } from "@/server/queries/admin";
import { QueueShell } from "./QueueShell";

export function SyncErrorsQueue({ rows }: { rows: SyncErrorRow[] }) {
  return (
    <QueueShell
      id="sync-fehler"
      title="Sync-Fehler"
      description="Plattform-Verbindungen mit aktivem Fehler. Reparatur erfolgt im Klinik-Reiter Integrationen."
      count={rows.length}
      tone="bad"
      emptyMessage="Alle Plattform-Verbindungen synchronisieren ohne Fehler."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-fg-secondary">
            <tr>
              <th className="py-2">Klinik</th>
              <th className="py-2">Plattform</th>
              <th className="py-2">Konto</th>
              <th className="py-2 text-right">Letzter Sync</th>
              <th className="py-2">Fehler</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.clinicId + r.platform}
                className="border-t border-border align-top"
              >
                <td className="py-2">
                  <Link
                    href={`/admin/clinics/${r.clinicId}?tab=integrationen`}
                    className="hover:text-accent"
                  >
                    {r.clinicName}
                  </Link>
                </td>
                <td className="py-2 capitalize">{r.platform}</td>
                <td className="py-2 font-mono text-xs">
                  {r.accountId ?? "—"}
                </td>
                <td className="py-2 text-right text-xs text-fg-secondary">
                  {r.lastSyncedAt ? formatRelative(r.lastSyncedAt) : "nie"}
                </td>
                <td className="py-2 text-xs text-tone-bad">
                  {r.lastSyncError}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueueShell>
  );
}
