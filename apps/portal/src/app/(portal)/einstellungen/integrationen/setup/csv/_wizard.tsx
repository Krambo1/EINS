"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Badge,
} from "@eins/ui";
import {
  uploadCsv,
  confirmCsvMapping,
  getCsvUploadStatus,
  type UploadResult,
} from "@/server/actions/pvs-csv-upload";
import type { CsvMapping, CsvStream } from "@/server/pvs-csv-mapper";
import { autoMatchHeader } from "@/server/pvs-csv-aliases";
import { CheckCircle2, Loader2, UploadCloud, AlertTriangle } from "lucide-react";

/**
 * 3-step CSV upload wizard for the integrations page.
 *
 *   Step 1: pick stream + upload file → uploadCsv()
 *   Step 2: map columns → confirmCsvMapping()
 *   Step 3: poll progress every 2s until status is terminal
 */

type Step = "pick" | "map" | "progress";

interface PickState {
  stream: CsvStream;
  file: File | null;
  busy: boolean;
  error: string | null;
}

interface MapState {
  uploadId: string;
  stream: CsvStream;
  headers: string[];
  previewRows: Record<string, string>[];
  totalRows: number;
  columns: Record<string, string | undefined>;
  dateFormat: string;
  amountUnit: "cents" | "eur";
  decimalSeparator: "auto" | "." | ",";
  allRowsPaidConfirmed: boolean;
  detection: string;
  busy: boolean;
  error: string | null;
}

interface ProgressState {
  uploadId: string;
  status: string;
  totalRows: number | null;
  processedRows: number;
  errorCount: number;
  errorSummary: unknown;
  /** Still "processing" after 15 min: processing is paused or behind (B-21). */
  stalled?: boolean;
}

/**
 * German text for the error codes of the CSV upload actions (B-21). Raw
 * codes or parser messages never reach the screen.
 */
function csvErrorMessage(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  if (code === "forbidden") {
    return "Daten importieren kann nur die Inhaberin oder der Inhaber der Praxis.";
  }
  if (code === "no_file") return "Bitte eine CSV-Datei auswählen.";
  if (code === "file_too_large") {
    return "Die Datei ist größer als 4 MB. Bitte exportieren Sie einen kürzeren Zeitraum oder teilen Sie die Datei auf.";
  }
  if (code === "invalid_stream") return "Bitte wählen Sie, welche Daten die Datei enthält.";
  if (code === "csv_empty") return "Die Datei enthält keine Datenzeilen.";
  if (code === "invalid_upload_group" || code === "upload_not_found") {
    return "Dieser Upload wurde nicht gefunden. Bitte laden Sie die Datei erneut hoch.";
  }
  if (code.startsWith("upload_already_")) return "Dieser Upload wird bereits verarbeitet.";
  if (code === "stream_mismatch") {
    return "Die Zuordnung passt nicht zur gewählten Datenart. Bitte laden Sie die Datei erneut hoch.";
  }
  if (code === "status_confirmation_required") {
    return "Bitte wählen Sie eine Status-Spalte oder bestätigen Sie, dass alle Rechnungen bezahlt sind.";
  }
  if (code === "invalid_mapping") {
    return "Die Spalten-Zuordnung ist unvollständig. Bitte prüfen Sie die Pflichtfelder.";
  }
  if (code.startsWith("csv_parse_error")) {
    return "Die Datei konnte nicht gelesen werden. Bitte prüfen Sie, ob es ein CSV-Export aus Ihrer PVS ist.";
  }
  return fallback;
}

const REQUIRED_FIELDS: Record<CsvStream, string[]> = {
  patients: ["pvsPatientId"],
  appointments: ["pvsPatientId", "pvsAppointmentId", "scheduledAt"],
  encounters: ["pvsPatientId", "pvsEncounterId", "completedAt"],
  invoices: ["pvsPatientId", "pvsInvoiceId", "amount", "paidAt"],
};

const OPTIONAL_FIELDS: Record<CsvStream, string[]> = {
  patients: ["email", "phone", "fullName", "dob", "gender", "bemerkung", "externalId"],
  appointments: [
    "treatmentCode",
    "treatmentLabel",
    "locationCode",
    "locationLabel",
    "bemerkung",
    "statusColumn",
  ],
  encounters: [
    "pvsAppointmentId",
    "treatmentCode",
    "treatmentLabel",
    "practitionerLabel",
  ],
  invoices: ["statusColumn", "pvsAppointmentId", "pvsEncounterId"],
};

const FIELD_LABELS: Record<string, string> = {
  pvsPatientId: "PVS Patienten-ID",
  pvsAppointmentId: "PVS Termin-ID",
  pvsEncounterId: "PVS Behandlungs-ID",
  pvsInvoiceId: "PVS Rechnungs-ID",
  email: "E-Mail",
  phone: "Telefon",
  fullName: "Vollständiger Name",
  dob: "Geburtsdatum",
  gender: "Geschlecht",
  bemerkung: "Bemerkung",
  externalId: "Externe ID",
  scheduledAt: "Termin-Zeitpunkt",
  treatmentCode: "Behandlungs-Code",
  treatmentLabel: "Behandlungs-Bezeichnung",
  locationCode: "Standort-Code",
  locationLabel: "Standort-Bezeichnung",
  statusColumn: "Status-Spalte (bezahlt, offen, storniert)",
  practitionerLabel: "Behandler",
  completedAt: "Abgeschlossen-Zeitpunkt",
  amount: "Betrag",
  paidAt: "Bezahlt-Zeitpunkt",
};

// Shown inside the select triggers. Radix only fills <SelectValue> once the
// items have mounted, so the trigger stayed empty on first paint; the explicit
// text avoids that, and "Bitte wählen" covers an unset value.
const STREAM_LABELS: Record<CsvStream, string> = {
  patients: "Patienten (Stammdaten)",
  appointments: "Termine (geplant, mit Status)",
  encounters: "Behandlungen (abgeschlossen)",
  invoices: "Rechnungen (bezahlt)",
};

const DATE_FORMAT_LABELS: Record<string, string> = {
  "DD.MM.YYYY": "TT.MM.JJJJ (18.05.2026)",
  "YYYY-MM-DD": "JJJJ-MM-TT (2026-05-18)",
  ISO_DATETIME: "ISO 8601 (2026-05-18T14:30:00)",
  "MM/DD/YYYY": "MM/DD/YYYY (05/18/2026)",
};

const AMOUNT_UNIT_LABELS: Record<"cents" | "eur", string> = {
  eur: "Euro (1.234,56)",
  cents: "Cent (123456)",
};

const DECIMAL_LABELS: Record<"auto" | "." | ",", string> = {
  auto: "Automatisch erkennen",
  ",": "Komma (1.234,56)",
  ".": "Punkt (1,234.56)",
};

export function CsvUploadWizard() {
  const [step, setStep] = useState<Step>("pick");
  const [pickState, setPickState] = useState<PickState>({
    stream: "appointments",
    file: null,
    busy: false,
    error: null,
  });
  const [mapState, setMapState] = useState<MapState | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  // Poll progress every 2s while in progress step.
  useEffect(() => {
    if (step !== "progress" || !progress) return;
    if (progress.status === "completed" || progress.status === "failed") return;
    const t = setInterval(async () => {
      const r = await getCsvUploadStatus(progress.uploadId);
      if (r) {
        setProgress({
          uploadId: progress.uploadId,
          status: r.status ?? "pending",
          totalRows: r.totalRows ?? null,
          processedRows: r.processedRows ?? 0,
          errorCount: r.errorCount ?? 0,
          errorSummary: r.errorSummary,
          stalled: r.stalled ?? false,
        });
      }
    }, 2000);
    return () => clearInterval(t);
  }, [step, progress]);

  // ---------- Step 1: Pick ----------
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!pickState.file) {
      setPickState((s) => ({ ...s, error: "Bitte eine CSV-Datei auswählen." }));
      return;
    }
    setPickState((s) => ({ ...s, busy: true, error: null }));
    const fd = new FormData();
    fd.append("file", pickState.file);
    fd.append("stream", pickState.stream);
    const result = await uploadCsv(fd);
    if (!result.ok) {
      setPickState((s) => ({
        ...s,
        busy: false,
        error: csvErrorMessage(result.error, "Upload fehlgeschlagen."),
      }));
      return;
    }
    const initialColumns: Record<string, string | undefined> = {};
    const required = REQUIRED_FIELDS[pickState.stream];
    const optional = OPTIONAL_FIELDS[pickState.stream];
    for (const f of [...required, ...optional]) {
      // Auto-detect: field name or known German header alias.
      const found = autoMatchHeader(f, result.headers ?? []);
      initialColumns[f] = found;
    }
    setMapState({
      uploadId: result.uploadId!,
      stream: pickState.stream,
      headers: result.headers ?? [],
      previewRows: result.previewRows ?? [],
      totalRows: result.totalRows ?? 0,
      columns: initialColumns,
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: "auto",
      allRowsPaidConfirmed: false,
      detection: describeDetection(result),
      busy: false,
      error: null,
    });
    setStep("map");
  }

  // ---------- Step 2: Map ----------
  async function handleConfirmMapping() {
    if (!mapState) return;
    setMapState({ ...mapState, busy: true, error: null });

    const cols = mapState.columns;
    const required = REQUIRED_FIELDS[mapState.stream];
    const missing = required.filter((f) => !cols[f]);
    if (missing.length) {
      setMapState({
        ...mapState,
        busy: false,
        error: `Pflichtfelder fehlen: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`,
      });
      return;
    }

    if (
      mapState.stream === "invoices" &&
      !cols.statusColumn &&
      !mapState.allRowsPaidConfirmed
    ) {
      setMapState({
        ...mapState,
        busy: false,
        error:
          "Bitte ordnen Sie eine Status-Spalte zu oder bestätigen Sie, dass alle Zeilen bezahlte Rechnungen sind.",
      });
      return;
    }

    const mapping = {
      stream: mapState.stream,
      columns: Object.fromEntries(
        Object.entries(cols).filter(([, v]) => v && v.trim() !== "")
      ),
      dateFormat: mapState.dateFormat,
      ...(mapState.stream === "invoices"
        ? {
            amountUnit: mapState.amountUnit,
            decimalSeparator: mapState.decimalSeparator,
            allRowsPaidConfirmed: mapState.allRowsPaidConfirmed,
          }
        : {}),
    } as CsvMapping;

    const r = await confirmCsvMapping({
      uploadId: mapState.uploadId,
      mapping,
    });
    // "upload_already_*" (e.g. a second click, or another tab started it):
    // the upload is already running or done, so show its progress instead
    // of an error. The poll below picks up the real status.
    if (!r.ok && !r.error?.startsWith("upload_already_")) {
      setMapState({
        ...mapState,
        busy: false,
        error: csvErrorMessage(r.error, "Zuordnung fehlgeschlagen."),
      });
      return;
    }
    setProgress({
      uploadId: mapState.uploadId,
      status: "processing",
      totalRows: mapState.totalRows,
      processedRows: 0,
      errorCount: 0,
      errorSummary: null,
    });
    setStep("progress");
  }

  // ---------- Step 3: Progress ----------
  function handleStartOver() {
    setStep("pick");
    setPickState({ stream: "appointments", file: null, busy: false, error: null });
    setMapState(null);
    setProgress(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {step === "pick" && "Schritt 1 von 3: Datei wählen"}
          {step === "map" && "Schritt 2 von 3: Spalten zuordnen"}
          {step === "progress" && "Schritt 3 von 3: Verarbeitung"}
        </CardTitle>
        <CardDescription>
          {step === "pick" &&
            "Pro Datenart eine Datei. Haben Sie mehrere, laden Sie sie nacheinander hoch."}
          {step === "map" &&
            "Sagen Sie EINS, welche Spalte Ihrer Datei welchen Wert enthält. Wir ordnen automatisch vor, korrigieren Sie bei Bedarf."}
          {step === "progress" &&
            "EINS verarbeitet jede Zeile und leitet Termine, Status und Umsätze ab."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {step === "pick" && (
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv-stream">Welche Daten enthält Ihre CSV-Datei?</Label>
              <Select
                value={pickState.stream}
                onValueChange={(v) =>
                  setPickState((s) => ({ ...s, stream: v as CsvStream }))
                }
              >
                <SelectTrigger id="csv-stream">
                  <SelectValue placeholder="Bitte wählen">
                    {STREAM_LABELS[pickState.stream] ?? "Bitte wählen"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STREAM_LABELS) as CsvStream[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {STREAM_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="csv-file">CSV-Datei</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) =>
                  setPickState((s) => ({
                    ...s,
                    file: e.target.files?.[0] ?? null,
                  }))
                }
              />
              <p className="text-sm text-fg-secondary">
                Eine CSV-Datei ist eine einfache Tabelle, die fast jede
                Praxis-Software ausgeben kann. Höchstens 4 MB. Zeichensatz,
                Trennzeichen sowie Titel- und Summenzeilen erkennen wir
                automatisch.
              </p>
            </div>

            {pickState.error && (
              <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {pickState.error}
              </div>
            )}

            <Button
              type="submit"
              className="h-auto min-h-11 whitespace-normal py-2 text-left"
              disabled={pickState.busy || !pickState.file}
            >
              {pickState.busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <UploadCloud className="mr-2 h-4 w-4" />
              Hochladen und Vorschau zeigen
            </Button>
          </form>
        )}

        {step === "map" && mapState && (
          <div className="space-y-6">
            <div className="rounded-md border bg-bg-secondary p-3 text-sm">
              <strong>{mapState.totalRows.toLocaleString("de-DE")} Zeilen</strong> in
              der Datei. Vorschau zeigt die ersten 5.
            </div>

            {mapState.detection && (
              <div className="rounded-md border bg-bg-secondary p-3 text-sm text-fg-secondary">
                {mapState.detection}
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-sm font-medium">Spalten zuordnen</Label>
              {REQUIRED_FIELDS[mapState.stream].map((field) => (
                <FieldRow
                  key={field}
                  field={field}
                  required
                  headers={mapState.headers}
                  value={mapState.columns[field]}
                  onChange={(v) =>
                    setMapState({
                      ...mapState,
                      columns: { ...mapState.columns, [field]: v },
                    })
                  }
                />
              ))}
              <div className="border-t pt-3 text-sm font-medium text-fg-primary">
                Optional
              </div>
              {OPTIONAL_FIELDS[mapState.stream].map((field) => (
                <FieldRow
                  key={field}
                  field={field}
                  required={false}
                  headers={mapState.headers}
                  value={mapState.columns[field]}
                  onChange={(v) =>
                    setMapState({
                      ...mapState,
                      columns: { ...mapState.columns, [field]: v },
                    })
                  }
                />
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Datums-Format</Label>
                <Select
                  value={mapState.dateFormat}
                  onValueChange={(v) =>
                    setMapState({ ...mapState, dateFormat: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Bitte wählen">
                      {DATE_FORMAT_LABELS[mapState.dateFormat] ?? "Bitte wählen"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DD.MM.YYYY">TT.MM.JJJJ (18.05.2026)</SelectItem>
                    <SelectItem value="YYYY-MM-DD">JJJJ-MM-TT (2026-05-18)</SelectItem>
                    {mapState.stream !== "patients" && (
                      <SelectItem value="ISO_DATETIME">
                        ISO 8601 (2026-05-18T14:30:00)
                      </SelectItem>
                    )}
                    <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (05/18/2026)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {mapState.stream === "invoices" && (
                <>
                  <div className="space-y-2">
                    <Label>Betrag in</Label>
                    <Select
                      value={mapState.amountUnit}
                      onValueChange={(v) =>
                        setMapState({
                          ...mapState,
                          amountUnit: v as "cents" | "eur",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Bitte wählen">
                          {AMOUNT_UNIT_LABELS[mapState.amountUnit] ?? "Bitte wählen"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="eur">Euro (1.234,56)</SelectItem>
                        <SelectItem value="cents">Cent (123456)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Dezimal-Trennzeichen</Label>
                    <Select
                      value={mapState.decimalSeparator}
                      onValueChange={(v) =>
                        setMapState({
                          ...mapState,
                          decimalSeparator: v as "auto" | "." | ",",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Bitte wählen">
                          {DECIMAL_LABELS[mapState.decimalSeparator] ?? "Bitte wählen"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Automatisch erkennen</SelectItem>
                        <SelectItem value=",">Komma (1.234,56)</SelectItem>
                        <SelectItem value=".">Punkt (1,234.56)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {mapState.stream === "invoices" && !mapState.columns.statusColumn && (
              <div className="space-y-2 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm">
                <div className="text-tone-bad">
                  <AlertTriangle className="mr-2 inline h-4 w-4" />
                  Ohne Status-Spalte wird jede Zeile als bezahlter Umsatz
                  gezählt, auch offene oder stornierte Rechnungen. Das
                  verfälscht Ihren Umsatz.
                </div>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={mapState.allRowsPaidConfirmed}
                    onChange={(e) =>
                      setMapState({
                        ...mapState,
                        allRowsPaidConfirmed: e.target.checked,
                      })
                    }
                  />
                  <span>
                    Ich bestätige, dass alle Zeilen dieser Datei bezahlte
                    Rechnungen sind.
                  </span>
                </label>
              </div>
            )}

            {mapState.previewRows.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-bg-secondary text-left">
                    <tr>
                      {mapState.headers.slice(0, 8).map((h) => (
                        <th key={h} className="px-2 py-1 font-medium">
                          {h}
                        </th>
                      ))}
                      {mapState.headers.length > 8 && (
                        <th className="px-2 py-1 font-medium">…</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {mapState.previewRows.map((row, i) => (
                      <tr key={i} className="border-t">
                        {mapState.headers.slice(0, 8).map((h) => (
                          <td key={h} className="px-2 py-1">
                            {row[h] ?? ""}
                          </td>
                        ))}
                        {mapState.headers.length > 8 && (
                          <td className="px-2 py-1 text-fg-secondary">…</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mapState.error && (
              <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {mapState.error}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConfirmMapping} disabled={mapState.busy}>
                {mapState.busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verarbeitung starten
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("pick");
                  setMapState(null);
                }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        )}

        {step === "progress" && progress && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {progress.status === "completed" ? (
                <CheckCircle2 className="h-6 w-6 text-green-600" />
              ) : progress.status === "failed" ? (
                <AlertTriangle className="h-6 w-6 text-tone-bad" />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin" />
              )}
              <div>
                <div className="font-medium">
                  {progress.status === "completed" && "Fertig"}
                  {progress.status === "failed" && "Fehlgeschlagen"}
                  {progress.status === "processing" && "Wird verarbeitet…"}
                  {progress.status === "processing" && progress.stalled && (
                    <span className="block text-sm font-normal text-fg-secondary">
                      Die Verarbeitung wurde unterbrochen. Ihre Datei ist
                      gespeichert und wird spätestens am nächsten Morgen
                      automatisch verarbeitet. Sie können die Seite schließen.
                    </span>
                  )}
                  {progress.status === "pending" && "Wartet auf Verarbeitung…"}
                </div>
                <div className="text-sm text-fg-secondary">
                  {progress.processedRows.toLocaleString("de-DE")}{" "}
                  {progress.totalRows
                    ? `/ ${progress.totalRows.toLocaleString("de-DE")} `
                    : ""}
                  Zeilen verarbeitet
                  {progress.errorCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-tone-bad">
                        {progress.errorCount} Fehler
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {progress.totalRows && progress.totalRows > 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-secondary">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((progress.processedRows / progress.totalRows) * 100)
                    )}%`,
                  }}
                />
              </div>
            )}

            {progress.status === "completed" && (
              <CompletionSummary summary={progress.errorSummary} />
            )}

            {progress.status === "failed" && (
              <div className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad">
                {exhaustedMessage(progress.errorSummary) ?? (
                  <>
                    Es wurde nichts übernommen. Bitte korrigieren Sie die
                    aufgeführten Zeilen oder die Zuordnung und laden Sie die
                    Datei erneut hoch.
                  </>
                )}
              </div>
            )}

            {progress.status === "failed" && Boolean(progress.errorSummary) && (
              <details className="rounded-md border bg-bg-secondary p-3 text-sm">
                <summary className="cursor-pointer text-sm font-medium">
                  Fehler-Details anzeigen
                </summary>
                <pre className="mt-2 whitespace-pre-wrap">
                  {JSON.stringify(progress.errorSummary, null, 2)}
                </pre>
              </details>
            )}

            {(progress.status === "completed" || progress.status === "failed") && (
              <Button onClick={handleStartOver} variant="outline">
                Nächste Datei hochladen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Ingest gave up after its retry limit (errorSummary.reason
 * "attempts_exhausted"): earlier partial runs may already have applied rows,
 * so the server's own German message replaces "Es wurde nichts übernommen".
 */
function exhaustedMessage(summary: unknown): string | null {
  if (!summary || typeof summary !== "object") return null;
  const s = summary as { reason?: unknown; message?: unknown };
  if (s.reason !== "attempts_exhausted") return null;
  return typeof s.message === "string" && s.message.trim().length > 0
    ? s.message
    : null;
}

function describeDetection(r: UploadResult): string {
  const delim =
    r.delimiter === ";"
      ? "Semikolon"
      : r.delimiter === ","
        ? "Komma"
        : r.delimiter === "\t"
          ? "Tabulator"
          : r.delimiter === "|"
            ? "senkrechter Strich"
            : "unbekannt";
  const parts = [`Trennzeichen: ${delim}`, `Zeichensatz: ${r.encoding ?? "unbekannt"}`];
  if (r.skippedPreambleLines)
    parts.push(`${r.skippedPreambleLines} Titelzeile(n) vor den Spaltenüberschriften übersprungen`);
  if (r.skippedFooterLines)
    parts.push(`${r.skippedFooterLines} Summen- oder Wiederholungszeile(n) ignoriert`);
  return parts.join(" · ");
}

function CompletionSummary({ summary }: { summary: unknown }) {
  const s = (summary ?? {}) as {
    applied?: number;
    alreadyViaPvs?: number;
    skipped?: { unpaid?: number; storniert?: number; nettoNull?: number };
  };
  const lines: string[] = [];
  if (typeof s.applied === "number") lines.push(`${s.applied} Datensätze übernommen`);
  if (s.alreadyViaPvs)
    lines.push(`${s.alreadyViaPvs} bereits über die PVS-Anbindung erfasst (nicht doppelt gezählt)`);
  if (s.skipped?.unpaid) lines.push(`${s.skipped.unpaid} nicht bezahlte Zeilen übersprungen`);
  if (s.skipped?.storniert) lines.push(`${s.skipped.storniert} stornierte Zeilen nicht als Umsatz gezählt`);
  if (s.skipped?.nettoNull)
    lines.push(`${s.skipped.nettoNull} Rechnungen mit Saldo 0 € als storniert übernommen (zählen nicht mehr als Umsatz)`);
  if (lines.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-fg-secondary">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function FieldRow({
  field,
  required,
  headers,
  value,
  onChange,
}: {
  field: string;
  required: boolean;
  headers: string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const label = FIELD_LABELS[field] ?? field;
  return (
    <div className="grid gap-1 sm:grid-cols-12 sm:items-center sm:gap-2">
      <div className="text-sm font-medium text-fg-primary sm:col-span-4">
        {label}
        {required && <Badge tone="warn" className="ml-2">Pflicht</Badge>}
      </div>
      <div className="sm:col-span-8">
        <Select
          value={value ?? "__none__"}
          onValueChange={(v) => onChange(v === "__none__" ? undefined : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Nicht zuordnen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Nicht zuordnen</SelectItem>
            {headers.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
