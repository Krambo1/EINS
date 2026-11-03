import { cn } from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { listRecentCsvUploads } from "@/server/actions/pvs-csv-upload";
import { formatDateTime } from "@/lib/formatting";
import { ANBINDUNG_WAEHLEN, EINSTELLUNGEN, PRAXIS_SOFTWARE, SettingsHead } from "../../../_components/SettingsHead";
import { CardBody, SettingsCard, Status } from "../../../_components/settings-ui";
import { COLUMNS, LIST, LIST_ROW, ONE_LINE, STACK, slots } from "../../../_lib/sizes";
import { CsvUploadWizard } from "./_wizard";
import { uploadStatus } from "./_copy";

export const metadata = { title: "CSV-Datei laden" };

const STREAM_LABELS: Record<string, string> = {
  patients: "Patienten",
  appointments: "Termine",
  encounters: "Behandlungen",
  invoices: "Rechnungen",
};

// A10: the pvs-csv-upload server action inherits this page's time limit.
export const maxDuration = 300;

export default async function CsvSetupPage() {
  // B-18: CSV imports change revenue data; Inhaber only (settings.integrations).
  await requirePermissionOrRedirect("settings.integrations");
  const recent = await listRecentCsvUploads(10);

  return (
    <div className={STACK}>
      <SettingsHead title="CSV-Datei laden" trail={[EINSTELLUNGEN, PRAXIS_SOFTWARE, ANBINDUNG_WAEHLEN]} />
      <div className={COLUMNS}>
        <div className={STACK}>
          <CsvUploadWizard />

          {recent.length > 0 && (
            <SettingsCard id="bisherige" title="Bisherige Dateien">
              <CardBody className="pt-2">
                {/* One row per file like the Protokoll: the name, one meta
                    line, the status at the end. */}
                <ul className={LIST} style={slots(5)}>
                  {recent.map((r) => {
                    const st = uploadStatus(r.status);
                    return (
                      <li key={r.id} className={LIST_ROW}>
                        <div className="min-w-0 flex-1">
                          <p className={cn(ONE_LINE, "text-[15px] font-medium leading-6 text-fg-primary")}>
                            {r.originalFilename}
                          </p>
                          <p className={cn(ONE_LINE, "text-sm leading-5 text-fg-secondary")}>
                            {STREAM_LABELS[r.stream] ?? r.stream} · {r.processedRows}
                            {r.totalRows ? ` / ${r.totalRows}` : ""} Zeilen
                            {r.errorCount > 0 && <span className="text-tone-bad"> · {r.errorCount} Fehler</span>} ·{" "}
                            {formatDateTime(r.createdAt)}
                          </p>
                        </div>
                        <Status tone={st.tone} className="shrink-0">
                          {st.label}
                        </Status>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
}
