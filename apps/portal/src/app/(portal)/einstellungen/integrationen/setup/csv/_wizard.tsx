"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, cn } from "@eins/ui";
import {
  uploadCsv,
  confirmCsvMapping,
  getCsvUploadStatus,
  type UploadResult,
} from "@/server/actions/pvs-csv-upload";
import type { CsvMapping, CsvStream } from "@/server/pvs-csv-mapper";
import { autoMatchHeader } from "@/server/pvs-csv-aliases";
import { showActionFlash } from "@/app/(portal)/_components/flash-event";
import { DashCard, QUIET_CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import {
  CardBody,
  CardFoot,
  Dot,
  FIELD_GRID,
  Field,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  Select,
  Status,
  SubHead,
} from "../../../_components/settings-ui";
import { CHECKBOX } from "../../../_lib/sizes";
import { FILE_FIELD, FILE_HINT, FILE_INPUT, STREAM_FIELD, STREAM_HINT, uploadStatus } from "./_copy";

/** A refusal of a step, in the toast, so the card keeps its height. */
function failed(title: string, description: string) {
  showActionFlash({ tone: "bad", title, description });
}

/**
 * 3-step CSV upload wizard for the integrations page.
 *
 *   Step 1: pick stream + upload file → uploadCsv()
 *   Step 2: map columns → confirmCsvMapping()
 *   Step 3: poll progress every 2s until status is terminal
 *
 * One card whose title names the step. Every refusal goes to the toast
 * (`failed`); the steps, the checks and the mapping sent to the server are
 * the same as before.
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
  if (code === "upload_not_found") {
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

// The words of the choices (native selects, so they show on first paint).
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
      failed("Nicht hochgeladen", "Bitte eine CSV-Datei auswählen.");
      return;
    }
    setPickState((s) => ({ ...s, busy: true, error: null }));
    const fd = new FormData();
    fd.append("file", pickState.file);
    fd.append("stream", pickState.stream);
    const result = await uploadCsv(fd);
    if (!result.ok) {
      const error = csvErrorMessage(result.error, "Upload fehlgeschlagen.");
      setPickState((s) => ({
        ...s,
        busy: false,
        error,
      }));
      failed("Nicht hochgeladen", error);
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
      const error = `Pflichtfelder fehlen: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`;
      setMapState({
        ...mapState,
        busy: false,
        error,
      });
      failed("Verarbeitung nicht gestartet", error);
      return;
    }

    if (
      mapState.stream === "invoices" &&
      !cols.statusColumn &&
      !mapState.allRowsPaidConfirmed
    ) {
      const error =
        "Bitte ordnen Sie eine Status-Spalte zu oder bestätigen Sie, dass alle Zeilen bezahlte Rechnungen sind.";
      setMapState({
        ...mapState,
        busy: false,
        error,
      });
      failed("Verarbeitung nicht gestartet", error);
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
      const error = csvErrorMessage(r.error, "Zuordnung fehlgeschlagen.");
      setMapState({
        ...mapState,
        busy: false,
        error,
      });
      failed("Verarbeitung nicht gestartet", error);
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

  const title = step === "pick" ? "Datei wählen" : step === "map" ? "Spalten zuordnen" : "Verarbeitung";
  const stepNo = step === "pick" ? 1 : step === "map" ? 2 : 3;

  return (
    <DashCard
      id="csv"
      title={title}
      action={<span className="text-sm text-fg-secondary">Schritt {stepNo} von 3</span>}
      bodyClassName="p-0 md:p-0"
    >
      {step === "pick" && (
        <form onSubmit={handleUpload}>
          <CardBody>
            <div className={cn(FIELD_GRID, "items-start")}>
              <Field label={STREAM_FIELD} htmlFor="csv-stream">
                <Select
                  id="csv-stream"
                  value={pickState.stream}
                  onChange={(e) => {
                    const v = e.target.value;
                    setPickState((s) => ({ ...s, stream: v as CsvStream }));
                  }}
                  aria-describedby="csv-stream-hint"
                >
                  {(Object.keys(STREAM_LABELS) as CsvStream[]).map((k) => (
                    <option key={k} value={k}>
                      {STREAM_LABELS[k]}
                    </option>
                  ))}
                </Select>
                <Hint id="csv-stream-hint">{STREAM_HINT}</Hint>
              </Field>
              <Field label={FILE_FIELD} htmlFor="csv-file">
                <input
                  id="csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  aria-describedby="csv-file-hint"
                  className={FILE_INPUT}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setPickState((s) => ({
                      ...s,
                      file,
                    }));
                  }}
                />
                <Hint id="csv-file-hint">{FILE_HINT}</Hint>
              </Field>
            </div>
          </CardBody>
          <CardFoot>
            <Button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={pickState.busy || !pickState.file}
              aria-busy={pickState.busy}
            >
              Hochladen und Vorschau zeigen
            </Button>
          </CardFoot>
        </form>
      )}

      {step === "map" && mapState && (
        <>
          <CardBody className="space-y-5">
            <div className="space-y-1">
              <p className="text-[15px] leading-6 text-fg-primary">
                <span className="font-semibold tabular-nums">{mapState.totalRows.toLocaleString("de-DE")} Zeilen</span>{" "}
                in der Datei. Wir haben die Spalten vorgeordnet, korrigieren Sie bei Bedarf.
              </p>
              {mapState.detection && (
                <p className="break-words text-sm leading-5 text-fg-secondary">{mapState.detection}</p>
              )}
            </div>

            <div className="space-y-3">
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
            </div>

            <SubHead title="Optional" />
            <div className="space-y-3">
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

            <SubHead title="Format" />
            <div className={cn(FIELD_GRID, mapState.stream === "invoices" && "xl:grid-cols-3")}>
              <Field label="Datums-Format" htmlFor="csv-date">
                <Select
                  id="csv-date"
                  value={mapState.dateFormat}
                  onChange={(e) => setMapState({ ...mapState, dateFormat: e.target.value })}
                >
                  <option value="DD.MM.YYYY">{DATE_FORMAT_LABELS["DD.MM.YYYY"]}</option>
                  <option value="YYYY-MM-DD">{DATE_FORMAT_LABELS["YYYY-MM-DD"]}</option>
                  {mapState.stream !== "patients" && <option value="ISO_DATETIME">{DATE_FORMAT_LABELS.ISO_DATETIME}</option>}
                  <option value="MM/DD/YYYY">{DATE_FORMAT_LABELS["MM/DD/YYYY"]}</option>
                </Select>
              </Field>

              {mapState.stream === "invoices" && (
                <>
                  <Field label="Betrag in" htmlFor="csv-amount">
                    <Select
                      id="csv-amount"
                      value={mapState.amountUnit}
                      onChange={(e) =>
                        setMapState({
                          ...mapState,
                          amountUnit: e.target.value as "cents" | "eur",
                        })
                      }
                    >
                      <option value="eur">{AMOUNT_UNIT_LABELS.eur}</option>
                      <option value="cents">{AMOUNT_UNIT_LABELS.cents}</option>
                    </Select>
                  </Field>
                  <Field label="Dezimal-Trennzeichen" htmlFor="csv-decimal">
                    <Select
                      id="csv-decimal"
                      value={mapState.decimalSeparator}
                      onChange={(e) =>
                        setMapState({
                          ...mapState,
                          decimalSeparator: e.target.value as "auto" | "." | ",",
                        })
                      }
                    >
                      <option value="auto">{DECIMAL_LABELS.auto}</option>
                      <option value=",">{DECIMAL_LABELS[","]}</option>
                      <option value=".">{DECIMAL_LABELS["."]}</option>
                    </Select>
                  </Field>
                </>
              )}
            </div>

            {mapState.stream === "invoices" && !mapState.columns.statusColumn && (
              // Without a status column every row counts as paid revenue:
              // said in full, and the box to tick right under it.
              <div className="space-y-3">
                <p className="flex items-start gap-2 text-sm leading-5 text-fg-primary">
                  <span className="mt-1.5 shrink-0">
                    <Dot tone="bad" />
                  </span>
                  <span>
                    Ohne Status-Spalte wird jede Zeile als bezahlter Umsatz gezählt, auch offene oder stornierte
                    Rechnungen. Das verfälscht Ihren Umsatz.
                  </span>
                </p>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className={CHECKBOX}
                    checked={mapState.allRowsPaidConfirmed}
                    onChange={(e) =>
                      setMapState({
                        ...mapState,
                        allRowsPaidConfirmed: e.target.checked,
                      })
                    }
                  />
                  <span className="text-[15px] font-medium leading-6 text-fg-primary">
                    Ich bestätige, dass alle Zeilen dieser Datei bezahlte Rechnungen sind.
                  </span>
                </label>
              </div>
            )}

            {mapState.previewRows.length > 0 && (
              <>
                <SubHead title="Vorschau (erste 5 Zeilen)" />
                {/* Long values stay on their line; the table scrolls
                    sideways inside its well, with edge shadows. */}
                <div className="elev-inset scroll-shadows-x rounded-[var(--r-control)] bg-[var(--well)] [--scroll-bg:var(--well)]">
                  <table className="w-full whitespace-nowrap text-sm">
                    <thead className="text-left text-fg-secondary">
                      <tr>
                        {mapState.headers.slice(0, 8).map((h) => (
                          <th key={h} className="px-3 py-2 font-medium">
                            {h}
                          </th>
                        ))}
                        {mapState.headers.length > 8 && <th className="px-3 py-2 font-medium">…</th>}
                      </tr>
                    </thead>
                    <tbody className="text-fg-primary">
                      {mapState.previewRows.map((row, i) => (
                        <tr key={i} className="border-t border-border">
                          {mapState.headers.slice(0, 8).map((h) => (
                            <td key={h} className="px-3 py-2">
                              {row[h] ?? ""}
                            </td>
                          ))}
                          {mapState.headers.length > 8 && <td className="px-3 py-2 text-fg-secondary">…</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardBody>
          <CardFoot
            start={
              <button
                type="button"
                className={cn(QUIET_CONTROL, "-ml-2.5")}
                onClick={() => {
                  setStep("pick");
                  setMapState(null);
                }}
              >
                Abbrechen
              </button>
            }
          >
            <Button
              className={PRIMARY_BUTTON}
              onClick={handleConfirmMapping}
              disabled={mapState.busy}
              aria-busy={mapState.busy}
            >
              Verarbeitung starten
            </Button>
          </CardFoot>
        </>
      )}

      {step === "progress" && progress && (
        <>
          <CardBody className="space-y-4">
            <div className="space-y-1">
              <Status tone={uploadStatus(progress.status).tone} className="font-medium">
                {uploadStatus(progress.status).label}
              </Status>
              <p className="text-sm leading-5 text-fg-secondary">
                <span className="tabular-nums">
                  {progress.processedRows.toLocaleString("de-DE")}{" "}
                  {progress.totalRows ? `/ ${progress.totalRows.toLocaleString("de-DE")} ` : ""}
                </span>
                Zeilen verarbeitet
                {progress.errorCount > 0 && (
                  <>
                    {" · "}
                    <span className="text-tone-bad">{progress.errorCount} Fehler</span>
                  </>
                )}
              </p>
            </div>

            {progress.totalRows && progress.totalRows > 0 && (
              <div
                role="progressbar"
                aria-label="Verarbeitet"
                aria-valuemin={0}
                aria-valuemax={progress.totalRows}
                aria-valuenow={progress.processedRows}
                className="h-2 w-full overflow-hidden rounded-full bg-[var(--well)]"
              >
                <div
                  className="h-full rounded-full bg-fg-primary transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((progress.processedRows / progress.totalRows) * 100)
                    )}%`,
                  }}
                />
              </div>
            )}

            {progress.status === "processing" && progress.stalled && (
              <p className="text-[15px] leading-6 text-fg-primary">
                Die Verarbeitung wurde unterbrochen. Ihre Datei ist gespeichert und wird spätestens am nächsten
                Morgen automatisch verarbeitet. Sie können die Seite schließen.
              </p>
            )}

            {progress.status === "completed" && <CompletionSummary summary={progress.errorSummary} />}

            {progress.status === "failed" && (
              <p className="text-[15px] leading-6 text-fg-primary">
                {exhaustedMessage(progress.errorSummary) ?? (
                  <>
                    Es wurde nichts übernommen. Bitte korrigieren Sie die aufgeführten Zeilen oder die Zuordnung und
                    laden Sie die Datei erneut hoch.
                  </>
                )}
              </p>
            )}

            {progress.status === "failed" && Boolean(progress.errorSummary) && (
              <details className="text-sm">
                <summary className={cn(QUIET_CONTROL, "-ml-2.5 cursor-pointer")}>Fehler-Details anzeigen</summary>
                <pre className="elev-inset scroll-shadows-x mt-2 rounded-[var(--r-control)] bg-[var(--well)] p-3 font-mono text-sm text-fg-primary [--scroll-bg:var(--well)]">
                  {JSON.stringify(progress.errorSummary, null, 2)}
                </pre>
              </details>
            )}
          </CardBody>
          {(progress.status === "completed" || progress.status === "failed") && (
            <CardFoot>
              <Button onClick={handleStartOver} variant="outline" className={SECONDARY_BUTTON}>
                Nächste Datei hochladen
              </Button>
            </CardFoot>
          )}
        </>
      )}
    </DashCard>
  );
}

/** The one line under a field. */
function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm leading-5 text-fg-secondary">
      {children}
    </p>
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
    <ul className="border-b border-border text-[15px] leading-6 text-fg-primary [&>li]:border-t [&>li]:border-border">
      {lines.map((l) => (
        <li key={l} className="py-2">
          {l}
        </li>
      ))}
    </ul>
  );
}

/**
 * One column to map: the field's name (and "Pflicht" for the ones the
 * import needs) beside a choice of the file's headers.
 */
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
  const id = `csv-map-${field}`;
  return (
    <div className="grid gap-1.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-4">
      <label htmlFor={id} className="text-sm font-medium leading-5 text-fg-primary">
        {label}
        {required && <span className="font-normal text-fg-secondary"> · Pflicht</span>}
      </label>
      <Select
        id={id}
        value={value ?? "__none__"}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "__none__" ? undefined : v);
        }}
      >
        <option value="__none__">Nicht zuordnen</option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </Select>
    </div>
  );
}
