import "server-only";
import { z } from "zod";
import type { PvsEvent } from "@/server/pvs-events";

/**
 * PVS Bridge — CSV column-mapping declaration + row-to-event translator.
 *
 * The wizard at /einstellungen/integrationen/setup/csv lets the inhaber
 * pick one of 4 streams (patients/appointments/encounters/invoices) and
 * map their CSV columns to canonical event fields. The mapping is
 * persisted as `pvs_csv_uploads.mapping_json` and re-used by:
 *
 *   • the pvs-csv-ingest worker (this module)
 *   • the apps/bridge n8n template (same schema, different driver)
 *
 * Shared shape so a CSV mapping can be exported and pasted into an n8n
 * Function-node without translation. See
 * apps/bridge/src/adapters/csv/mapper.ts for the bridge-side import.
 */

export const CsvStreamSchema = z.enum([
  "patients",
  "appointments",
  "encounters",
  "invoices",
]);
export type CsvStream = z.infer<typeof CsvStreamSchema>;

/** Every column reference is a string — the CSV header label. Optional
 *  fields mean "leave the canonical event field undefined when missing". */
const ColumnRef = z.string().min(1).max(200);

const PatientsColumnsSchema = z.object({
  pvsPatientId: ColumnRef,
  email: ColumnRef.optional(),
  phone: ColumnRef.optional(),
  fullName: ColumnRef.optional(),
  dob: ColumnRef.optional(),
  gender: ColumnRef.optional(),
  bemerkung: ColumnRef.optional(),
  externalId: ColumnRef.optional(),
});

const AppointmentsColumnsSchema = z.object({
  pvsPatientId: ColumnRef,
  pvsAppointmentId: ColumnRef,
  scheduledAt: ColumnRef,
  treatmentCode: ColumnRef.optional(),
  treatmentLabel: ColumnRef.optional(),
  locationCode: ColumnRef.optional(),
  locationLabel: ColumnRef.optional(),
  bemerkung: ColumnRef.optional(),
  /** When provided, the row's value (e.g. "no_show") drives an additional
   *  AppointmentStatusChanged event. Leave undefined for appointments-only
   *  exports. */
  statusColumn: ColumnRef.optional(),
});

const EncountersColumnsSchema = z.object({
  pvsPatientId: ColumnRef,
  pvsEncounterId: ColumnRef,
  pvsAppointmentId: ColumnRef.optional(),
  completedAt: ColumnRef,
  treatmentCode: ColumnRef.optional(),
  treatmentLabel: ColumnRef.optional(),
  practitionerLabel: ColumnRef.optional(),
});

const InvoicesColumnsSchema = z.object({
  pvsPatientId: ColumnRef,
  pvsInvoiceId: ColumnRef,
  pvsAppointmentId: ColumnRef.optional(),
  pvsEncounterId: ColumnRef.optional(),
  amount: ColumnRef,
  paidAt: ColumnRef,
});

export const CsvMappingSchema = z.discriminatedUnion("stream", [
  z.object({
    stream: z.literal("patients"),
    columns: PatientsColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"])
      .default("YYYY-MM-DD"),
  }),
  z.object({
    stream: z.literal("appointments"),
    columns: AppointmentsColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("ISO_DATETIME"),
  }),
  z.object({
    stream: z.literal("encounters"),
    columns: EncountersColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("ISO_DATETIME"),
  }),
  z.object({
    stream: z.literal("invoices"),
    columns: InvoicesColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("ISO_DATETIME"),
    amountUnit: z.enum(["cents", "eur"]).default("eur"),
    decimalSeparator: z.enum([".", ","]).default(","),
  }),
]);
export type CsvMapping = z.infer<typeof CsvMappingSchema>;

// ---------------------------------------------------------------
// Row → canonical event
// ---------------------------------------------------------------

export interface MapRowContext {
  clinicId: string;
  uploadId: string;
  rowIndex: number;
  row: Record<string, string>;
  mapping: CsvMapping;
}

export type MapRowResult =
  | { ok: true; events: PvsEvent[] }
  | { ok: false; reason: string };

export function mapCsvRow(ctx: MapRowContext): MapRowResult {
  switch (ctx.mapping.stream) {
    case "patients":
      return mapPatientRow(ctx, ctx.mapping);
    case "appointments":
      return mapAppointmentRow(ctx, ctx.mapping);
    case "encounters":
      return mapEncounterRow(ctx, ctx.mapping);
    case "invoices":
      return mapInvoiceRow(ctx, ctx.mapping);
  }
}

function mapPatientRow(
  ctx: MapRowContext,
  m: Extract<CsvMapping, { stream: "patients" }>
): MapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) {
    return { ok: false, reason: "missing pvsPatientId" };
  }
  const dob = v.dob ? parseDate(v.dob, m.dateFormat) : null;
  if (v.dob && !dob) {
    return { ok: false, reason: `invalid dob: ${v.dob}` };
  }
  const event: PvsEvent = {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "csv_upload",
    pvsExternalEventId: `csv:${ctx.uploadId}:p:${ctx.rowIndex}`,
    occurredAt: new Date().toISOString(),
    pvsPatientId: v.pvsPatientId,
    email: v.email ?? undefined,
    phone: v.phone ?? undefined,
    fullName: v.fullName ?? undefined,
    dob: dob ?? undefined,
    gender: normaliseGender(v.gender),
    bemerkung: v.bemerkung ?? undefined,
    externalId: v.externalId ?? undefined,
  };
  return { ok: true, events: [event] };
}

function mapAppointmentRow(
  ctx: MapRowContext,
  m: Extract<CsvMapping, { stream: "appointments" }>
): MapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsAppointmentId)
    return { ok: false, reason: "missing pvsAppointmentId" };
  const scheduledAt = parseDateTime(v.scheduledAt, m.dateFormat);
  if (!scheduledAt) {
    return { ok: false, reason: `invalid scheduledAt: ${v.scheduledAt}` };
  }
  const created: PvsEvent = {
    kind: "AppointmentCreated",
    clinicId: ctx.clinicId,
    bridgeSource: "csv_upload",
    pvsExternalEventId: `csv:${ctx.uploadId}:a:${ctx.rowIndex}`,
    occurredAt: scheduledAt,
    pvsPatientId: v.pvsPatientId,
    pvsAppointmentId: v.pvsAppointmentId,
    scheduledAt,
    treatmentCode: v.treatmentCode ?? undefined,
    treatmentLabel: v.treatmentLabel ?? undefined,
    locationCode: v.locationCode ?? undefined,
    locationLabel: v.locationLabel ?? undefined,
    bemerkung: v.bemerkung ?? undefined,
  };
  const events: PvsEvent[] = [created];
  // Optional StatusChanged event when the CSV row carries a status column.
  if (v.statusColumn) {
    const newStatus = normaliseAppointmentStatus(v.statusColumn);
    if (newStatus && newStatus !== "scheduled") {
      events.push({
        kind: "AppointmentStatusChanged",
        clinicId: ctx.clinicId,
        bridgeSource: "csv_upload",
        pvsExternalEventId: `csv:${ctx.uploadId}:a:${ctx.rowIndex}:s`,
        occurredAt: scheduledAt,
        pvsPatientId: v.pvsPatientId,
        pvsAppointmentId: v.pvsAppointmentId,
        newStatus,
      });
    }
  }
  return { ok: true, events };
}

function mapEncounterRow(
  ctx: MapRowContext,
  m: Extract<CsvMapping, { stream: "encounters" }>
): MapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsEncounterId)
    return { ok: false, reason: "missing pvsEncounterId" };
  const completedAt = parseDateTime(v.completedAt, m.dateFormat);
  if (!completedAt)
    return { ok: false, reason: `invalid completedAt: ${v.completedAt}` };
  const event: PvsEvent = {
    kind: "EncounterCompleted",
    clinicId: ctx.clinicId,
    bridgeSource: "csv_upload",
    pvsExternalEventId: `csv:${ctx.uploadId}:e:${ctx.rowIndex}`,
    occurredAt: completedAt,
    pvsPatientId: v.pvsPatientId,
    pvsEncounterId: v.pvsEncounterId,
    pvsAppointmentId: v.pvsAppointmentId ?? undefined,
    treatmentCode: v.treatmentCode ?? undefined,
    treatmentLabel: v.treatmentLabel ?? undefined,
    completedAt,
    practitionerLabel: v.practitionerLabel ?? undefined,
  };
  return { ok: true, events: [event] };
}

function mapInvoiceRow(
  ctx: MapRowContext,
  m: Extract<CsvMapping, { stream: "invoices" }>
): MapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsInvoiceId) return { ok: false, reason: "missing pvsInvoiceId" };
  const paidAt = parseDateTime(v.paidAt, m.dateFormat);
  if (!paidAt) return { ok: false, reason: `invalid paidAt: ${v.paidAt}` };
  if (!v.amount) return { ok: false, reason: "missing amount" };
  const amountCents = parseAmountToCents(
    v.amount,
    m.amountUnit,
    m.decimalSeparator
  );
  if (amountCents === null) {
    return { ok: false, reason: `invalid amount: ${v.amount}` };
  }
  // Dedup key is intentionally NOT upload-scoped for invoices: if a
  // Praxis re-uploads the same Honorar export (mistake, partial day,
  // rolling-window export), the same pvsInvoiceId across uploads must
  // collapse into a single event — otherwise revenue double-counts in
  // patients.lifetimeRevenueEur and requests.convertedRevenueEur. Other
  // streams already dedupe at their respective UNIQUE indexes
  // (pvs_patient_map, pvs_event_log on appointment/encounter ids).
  const event: PvsEvent = {
    kind: "InvoicePaid",
    clinicId: ctx.clinicId,
    bridgeSource: "csv_upload",
    pvsExternalEventId: `csv:invoice:${v.pvsInvoiceId}`,
    occurredAt: paidAt,
    pvsPatientId: v.pvsPatientId,
    pvsInvoiceId: v.pvsInvoiceId,
    pvsAppointmentId: v.pvsAppointmentId ?? undefined,
    pvsEncounterId: v.pvsEncounterId ?? undefined,
    amountCents,
    currency: "EUR",
    paidAt,
  };
  return { ok: true, events: [event] };
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function pluckColumns<T extends Record<string, string | undefined>>(
  row: Record<string, string>,
  mapping: T
): Record<keyof T, string | null> {
  // The mapped type strips the optional-? modifier from `T`'s keys: even if
  // `mapping.email` is `string | undefined` (i.e. the field is optional in
  // the mapping spec), the returned `v.email` is `string | null` — never
  // `undefined`. Callers can therefore branch on null without `?? null`.
  const out: Record<string, string | null> = {};
  for (const [k, header] of Object.entries(mapping)) {
    if (!header) {
      out[k] = null;
      continue;
    }
    const v = row[header];
    out[k] = v && v.trim() !== "" ? v.trim() : null;
  }
  return out as Record<keyof T, string | null>;
}

function parseDate(input: string | null, format: string): string | null {
  if (input === null) return null;
  // Returns YYYY-MM-DD or null.
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (format === "YYYY-MM-DD") {
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  if (format === "DD.MM.YYYY") {
    const m = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (format === "MM/DD/YYYY") {
    const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[1]}-${m[2]}`;
  }
  return null;
}

function parseDateTime(input: string | null, format: string): string | null {
  if (input === null) return null;
  // Returns ISO-8601 datetime or null. For pure-date formats we pin to
  // 00:00:00 in the clinic's local timezone — but we can't know the
  // timezone without a per-link config, so we use UTC midnight. For
  // appointments this is fine because the worker only uses date semantics.
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (format === "ISO_DATETIME") {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const date = parseDate(trimmed, format);
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

function normaliseGender(input: string | null): "f" | "m" | "d" | "x" | undefined {
  if (!input) return undefined;
  const v = input.trim().toLowerCase();
  if (["w", "weiblich", "f", "female", "frau"].includes(v)) return "f";
  if (["m", "männlich", "maennlich", "male", "mann"].includes(v)) return "m";
  if (["d", "divers"].includes(v)) return "d";
  if (["x", "unknown", "unbekannt", "k.a."].includes(v)) return "x";
  return undefined;
}

function normaliseAppointmentStatus(
  input: string | null
):
  | "scheduled"
  | "checked_in"
  | "completed"
  | "no_show"
  | "cancelled"
  | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (
    ["scheduled", "geplant", "terminiert", "offen", "open"].includes(v)
  )
    return "scheduled";
  if (
    [
      "checked_in",
      "checked-in",
      "anwesend",
      "erschienen",
      "arrived",
    ].includes(v)
  )
    return "checked_in";
  if (["completed", "abgeschlossen", "fertig", "done"].includes(v))
    return "completed";
  if (
    [
      "no_show",
      "no-show",
      "noshow",
      "nicht_erschienen",
      "nicht-erschienen",
      "ausgefallen",
    ].includes(v)
  )
    return "no_show";
  if (
    [
      "cancelled",
      "canceled",
      "storniert",
      "abgesagt",
      "stornierung",
    ].includes(v)
  )
    return "cancelled";
  return null;
}

function parseAmountToCents(
  input: string,
  unit: "cents" | "eur",
  decimalSeparator: "." | ","
): number | null {
  // Strip currency symbols & whitespace.
  const cleaned = input
    .replace(/[€\s]/g, "")
    .replace(decimalSeparator === "," ? /\./g : /,/g, ""); // strip thousands separator
  const num = Number(
    decimalSeparator === ","
      ? cleaned.replace(",", ".")
      : cleaned
  );
  if (!Number.isFinite(num) || num < 0) return null;
  if (unit === "cents") {
    return Math.round(num);
  }
  return Math.round(num * 100);
}
