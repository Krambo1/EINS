import Link from "next/link";
import { formatRelative } from "@/lib/formatting";
import type { FailedJobs } from "@/server/queries/admin";
import { QueueShell } from "./QueueShell";

/** E-10: background jobs that failed after all retries (last 14 days). */
export function FailedJobsQueue({ data }: { data: FailedJobs }) {
  return (
    <QueueShell
      id="fehlgeschlagene-jobs"
      title="Fehlgeschlagene Hintergrund-Aufgaben"
      description={
        data.available
          ? "Aufgaben des Workers (E-Mails, Abgleiche, Auswertungen), die auch nach allen Wiederholungen gescheitert sind. Letzte 14 Tage."
          : "Keine Job-Tabelle gefunden: Der Worker ist in dieser Umgebung nie gestartet."
      }
      count={data.rows.length}
      tone="bad"
      emptyMessage={data.available ? "Keine fehlgeschlagenen Aufgaben in den letzten 14 Tagen." : undefined}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs font-medium text-fg-secondary">
            <tr>
              <th className="py-2">Aufgabe</th>
              <th className="py-2">Praxis</th>
              <th className="py-2 text-right">Gescheitert</th>
              <th className="py-2 text-right">Versuche</th>
              <th className="py-2">Fehler</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="py-2 font-mono text-xs">{r.queue}</td>
                <td className="py-2">
                  {r.clinicId ? (
                    <Link href={`/admin/clinics/${r.clinicId}`} className="hover:text-accent">
                      {r.clinicName ?? "–"}
                    </Link>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="py-2 text-right text-xs text-fg-secondary">
                  {formatRelative(r.failedAt ?? r.createdAt)}
                </td>
                <td className="py-2 text-right text-xs tabular-nums">{r.retryCount + 1}</td>
                <td className="py-2 text-xs text-tone-bad">{r.error ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueueShell>
  );
}
