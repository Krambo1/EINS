import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listRecentCsvUploads } from "@/server/actions/pvs-csv-upload";
import { CsvUploadWizard } from "./_wizard";
import { formatDateTime } from "@/lib/formatting";

export const metadata = { title: "CSV-Upload" };

const STREAM_LABELS: Record<string, string> = {
  patients: "Patienten",
  appointments: "Termine",
  encounters: "Behandlungen",
  invoices: "Rechnungen",
};

const UPLOAD_STATUS_LABELS: Record<string, string> = {
  pending: "Wartet",
  processing: "Läuft",
  completed: "Fertig",
  failed: "Fehlgeschlagen",
  cancelled: "Abgebrochen",
};

// A10: the pvs-csv-upload server action inherits this page's time limit.
export const maxDuration = 300;

export default async function CsvSetupPage() {
  // B-18: CSV imports change revenue data; Inhaber only (settings.integrations).
  await requirePermissionOrRedirect("settings.integrations");
  const recent = await listRecentCsvUploads(10);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen/setup"
            className="inline-flex min-h-11 items-center font-medium text-fg-primary hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">CSV-Upload</h1>
        <p className="mt-1 text-base text-fg-primary">
          Exportieren Sie Ihre Praxis-Daten (Patienten, Termine, Behandlungen,
          Rechnungen) aus Ihrer Praxis-Software (PVS) und laden Sie sie hier
          hoch. Funktioniert mit jeder Praxis-Software, die Tabellen als CSV
          ausgeben kann. Pro Datenart eine Datei.
        </p>
      </header>

      <CsvUploadWizard />

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bisherige Uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-sm font-medium text-fg-primary">
                <tr>
                  <th className="pb-2">Datei</th>
                  <th className="hidden pb-2 sm:table-cell">Datenart</th>
                  <th className="pb-2">Status</th>
                  <th className="hidden pb-2 sm:table-cell">Zeilen</th>
                  <th className="pb-2">Fehler</th>
                  <th className="hidden pb-2 sm:table-cell">Zeitpunkt</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="break-all py-2 pr-2">{r.originalFilename}</td>
                    <td className="hidden py-2 sm:table-cell">{STREAM_LABELS[r.stream] ?? r.stream}</td>
                    <td className="py-2">{UPLOAD_STATUS_LABELS[r.status] ?? r.status}</td>
                    <td className="hidden py-2 sm:table-cell">
                      {r.processedRows}
                      {r.totalRows ? ` / ${r.totalRows}` : ""}
                    </td>
                    <td className="py-2">
                      {r.errorCount > 0 ? (
                        <span className="text-tone-bad">{r.errorCount}</span>
                      ) : (
                        "–"
                      )}
                    </td>
                    <td className="hidden py-2 text-fg-secondary sm:table-cell">
                      {formatDateTime(r.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
