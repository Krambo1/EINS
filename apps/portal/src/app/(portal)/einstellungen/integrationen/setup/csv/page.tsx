import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { listRecentCsvUploads } from "@/server/actions/pvs-csv-upload";
import { CsvUploadWizard } from "./_wizard";
import { formatDateTime } from "@/lib/formatting";

export const metadata = { title: "CSV-Upload" };

export default async function CsvSetupPage() {
  await requireSession();
  const recent = await listRecentCsvUploads(10);

  return (
    <div className="space-y-6">
      <header>
        <div className="mb-2 flex items-center gap-2 text-sm">
          <Link
            href="/einstellungen/integrationen/setup"
            className="text-muted-foreground hover:underline"
          >
            ← Anbieter wählen
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">CSV-Upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Exportieren Sie Ihre Praxis-Daten (Patienten, Termine, Behandlungen,
          Rechnungen) aus Ihrer PVS und laden Sie sie hier hoch. Funktioniert mit
          jeder PVS, die CSV-Export anbietet. Pro Stream eine Datei.
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
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2">Datei</th>
                  <th className="pb-2">Stream</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Zeilen</th>
                  <th className="pb-2">Fehler</th>
                  <th className="pb-2">Zeitpunkt</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.originalFilename}</td>
                    <td className="py-2">{r.stream}</td>
                    <td className="py-2">{r.status}</td>
                    <td className="py-2">
                      {r.processedRows}
                      {r.totalRows ? ` / ${r.totalRows}` : ""}
                    </td>
                    <td className="py-2">
                      {r.errorCount > 0 ? (
                        <span className="text-destructive">{r.errorCount}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
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
