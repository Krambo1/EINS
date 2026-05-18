"use client";

import { useEffect, useState, useTransition } from "react";
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
  decimalSeparator: "." | ",";
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
  invoices: ["pvsAppointmentId", "pvsEncounterId"],
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
  statusColumn: "Status-Spalte",
  practitionerLabel: "Behandler",
  completedAt: "Abgeschlossen-Zeitpunkt",
  amount: "Betrag",
  paidAt: "Bezahlt-Zeitpunkt",
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
        error: result.error ?? "Upload fehlgeschlagen.",
      }));
      return;
    }
    const initialColumns: Record<string, string | undefined> = {};
    const required = REQUIRED_FIELDS[pickState.stream];
    const optional = OPTIONAL_FIELDS[pickState.stream];
    for (const f of [...required, ...optional]) {
      // Auto-detect: same-name header match (case-insensitive).
      const found = result.headers?.find(
        (h) => h.toLowerCase().replace(/[\s_-]/g, "") === f.toLowerCase()
      );
      initialColumns[f] = found;
    }
    setMapState({
      uploadId: result.uploadId!,
      stream: pickState.stream,
      headers: result.headers ?? [],
      previewRows: result.previewRows ?? [],
      totalRows: result.totalRows ?? 0,
      columns: initialColumns,
      dateFormat: pickState.stream === "patients" ? "YYYY-MM-DD" : "ISO_DATETIME",
      amountUnit: "eur",
      decimalSeparator: ",",
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
          }
        : {}),
    } as CsvMapping;

    const r = await confirmCsvMapping({
      uploadId: mapState.uploadId,
      mapping,
    });
    if (!r.ok) {
      setMapState({
        ...mapState,
        busy: false,
        error: r.error ?? "Mapping fehlgeschlagen.",
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
          {step === "pick" && "Schritt 1 / 3 — Datei wählen"}
          {step === "map" && "Schritt 2 / 3 — Spalten zuordnen"}
          {step === "progress" && "Schritt 3 / 3 — Verarbeitung"}
        </CardTitle>
        <CardDescription>
          {step === "pick" &&
            "Pro Stream eine Datei. Bei mehreren Streams: nacheinander hochladen."}
          {step === "map" &&
            "Sagen Sie EINS, welche CSV-Spalte welchen Wert enthält. Wir versuchen auto-zuzuordnen, korrigieren Sie wenn nötig."}
          {step === "progress" &&
            "EINS verarbeitet jede Zeile und leitet Termine, Statuse und Umsätze ab."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {step === "pick" && (
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="space-y-2">
              <Label>Welche Daten enthält Ihre CSV?</Label>
              <Select
                value={pickState.stream}
                onValueChange={(v) =>
                  setPickState((s) => ({ ...s, stream: v as CsvStream }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="patients">
                    Patienten (Stammdaten, Demografie)
                  </SelectItem>
                  <SelectItem value="appointments">
                    Termine (geplant + Status)
                  </SelectItem>
                  <SelectItem value="encounters">
                    Behandlungen (abgeschlossen)
                  </SelectItem>
                  <SelectItem value="invoices">
                    Rechnungen (bezahlt)
                  </SelectItem>
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
              <p className="text-xs text-muted-foreground">
                Max. 50 MB. UTF-8 oder UTF-8-BOM. Trennzeichen Komma oder
                Semikolon — wird automatisch erkannt.
              </p>
            </div>

            {pickState.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {pickState.error}
              </div>
            )}

            <Button type="submit" disabled={pickState.busy || !pickState.file}>
              {pickState.busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <UploadCloud className="mr-2 h-4 w-4" />
              Hochladen + Vorschau
            </Button>
          </form>
        )}

        {step === "map" && mapState && (
          <div className="space-y-6">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <strong>{mapState.totalRows.toLocaleString("de-DE")} Zeilen</strong> in
              der Datei. Vorschau zeigt die ersten 5.
            </div>

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
              <div className="border-t pt-3 text-xs uppercase tracking-wide text-muted-foreground">
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
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {mapState.stream !== "patients" && (
                      <SelectItem value="ISO_DATETIME">
                        ISO 8601 (2026-05-18T14:30:00)
                      </SelectItem>
                    )}
                    <SelectItem value="YYYY-MM-DD">YYYY-MM-DD (2026-05-18)</SelectItem>
                    <SelectItem value="DD.MM.YYYY">DD.MM.YYYY (18.05.2026)</SelectItem>
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
                        <SelectValue />
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
                          decimalSeparator: v as "." | ",",
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value=",">Komma (1.234,56)</SelectItem>
                        <SelectItem value=".">Punkt (1,234.56)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {mapState.previewRows.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-left">
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
                          <td className="px-2 py-1 text-muted-foreground">…</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {mapState.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {mapState.error}
              </div>
            )}

            <div className="flex gap-2">
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
                <AlertTriangle className="h-6 w-6 text-destructive" />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin" />
              )}
              <div>
                <div className="font-medium">
                  {progress.status === "completed" && "Fertig"}
                  {progress.status === "failed" && "Fehlgeschlagen"}
                  {progress.status === "processing" && "Wird verarbeitet…"}
                  {progress.status === "pending" && "Wartet auf Worker…"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {progress.processedRows.toLocaleString("de-DE")}{" "}
                  {progress.totalRows
                    ? `/ ${progress.totalRows.toLocaleString("de-DE")} `
                    : ""}
                  Zeilen verarbeitet
                  {progress.errorCount > 0 && (
                    <>
                      {" · "}
                      <span className="text-destructive">
                        {progress.errorCount} Fehler
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {progress.totalRows && progress.totalRows > 0 && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round((progress.processedRows / progress.totalRows) * 100)
                    )}%`,
                  }}
                />
              </div>
            )}

            {progress.status === "failed" && Boolean(progress.errorSummary) && (
              <details className="rounded-md border bg-muted/30 p-3 text-xs">
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
    <div className="grid grid-cols-12 items-center gap-2">
      <div className="col-span-4 text-sm">
        {label}
        {required && <Badge tone="warn" className="ml-2 text-[10px]">Pflicht</Badge>}
      </div>
      <div className="col-span-8">
        <Select
          value={value ?? "__none__"}
          onValueChange={(v) => onChange(v === "__none__" ? undefined : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="— nicht zuordnen —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">— nicht zuordnen —</SelectItem>
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
