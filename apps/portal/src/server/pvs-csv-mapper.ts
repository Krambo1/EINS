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
  /** Optional payment-status column. When mapped, only paid rows count as
   *  revenue. When NOT mapped, every row is counted as paid (the wizard
   *  makes the user confirm that explicitly). */
  statusColumn: ColumnRef.optional(),
});

export const CsvMappingSchema = z.discriminatedUnion("stream", [
  z.object({
    stream: z.literal("patients"),
    columns: PatientsColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY"])
      .default("DD.MM.YYYY"),
  }),
  z.object({
    stream: z.literal("appointments"),
    columns: AppointmentsColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("DD.MM.YYYY"),
  }),
  z.object({
    stream: z.literal("encounters"),
    columns: EncountersColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("DD.MM.YYYY"),
  }),
  z.object({
    stream: z.literal("invoices"),
    columns: InvoicesColumnsSchema,
    dateFormat: z
      .enum(["YYYY-MM-DD", "DD.MM.YYYY", "MM/DD/YYYY", "ISO_DATETIME"])
      .default("DD.MM.YYYY"),
    amountUnit: z.enum(["cents", "eur"]).default("eur"),
    /** "auto": the last of "," / "." in the value is the decimal separator. */
    decimalSeparator: z.enum(["auto", ".", ","]).default("auto"),
    /** Required true when no statusColumn is mapped (all rows = paid). */
    allRowsPaidConfirmed: z.boolean().default(false),
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
  | { ok: true; events: PvsEvent[]; skipped?: InvoiceSkipReason }
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

export type InvoiceSkipReason = "unpaid" | "storniert";

type InvoiceMapping = Extract<CsvMapping, { stream: "invoices" }>;

type InvoiceRow =
  | { ok: false; reason: string }
  | { ok: true; skip: InvoiceSkipReason }
  | {
      ok: true;
      skip?: undefined;
      invoiceId: string;
      patientId: string;
      appointmentId?: string;
      encounterId?: string;
      signedCents: number;
      atMs: number;
      /** A positive line marked storniert: contributes 0 to the invoice. */
      stornoLine?: boolean;
    };

const MAX_CENTS = 100_000_000;
const MAX_INVOICE_ID_LEN = 150;

type StatusClass = "paid" | "storno" | "refund" | "other";

function classifyInvoiceStatus(input: string | null): StatusClass {
  if (!input) return "other";
  const v = input.trim().toLowerCase();
  if (/storn/.test(v)) return "storno";
  if (/^(gutschrift|erstattet|rückerstattung|rueckerstattung|erstattung)/.test(v))
    return "refund";
  if (
    /^(bezahlt|beglichen|ausgeglichen|erledigt)(\s|\(|$)/.test(v) ||
    v === "bar"
  )
    return "paid";
  return "other";
}

function classifyInvoiceRow(
  row: Record<string, string>,
  m: InvoiceMapping
): InvoiceRow {
  const v = pluckColumns(row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsInvoiceId) return { ok: false, reason: "missing pvsInvoiceId" };
  if (v.pvsInvoiceId.length > MAX_INVOICE_ID_LEN)
    return { ok: false, reason: "pvsInvoiceId too long" };
  const paidAt = parseDateTime(v.paidAt, m.dateFormat);
  if (!paidAt) return { ok: false, reason: `invalid paidAt: ${v.paidAt}` };
  if (!v.amount) return { ok: false, reason: "missing amount" };
  const cents = parseAmountToCents(v.amount, m.amountUnit, m.decimalSeparator);
  if (cents === null) return { ok: false, reason: `invalid amount: ${v.amount}` };
  if (Math.abs(cents) > MAX_CENTS)
    return { ok: false, reason: `amount out of range: ${v.amount}` };

  let signed = cents;
  let stornoLine = false;
  if (m.columns.statusColumn) {
    const cls = classifyInvoiceStatus(v.statusColumn);
    if (cls === "other") return { ok: true, skip: "unpaid" };
    // Pass 2: a storniert line still names its invoice. It adds nothing, but
    // an invoice made only of storniert lines is emitted as 0 €, so the
    // amount an earlier upload delivered for it stops counting.
    if (cls === "storno" && cents > 0) {
      signed = 0;
      stornoLine = true;
    }
    if (cls === "refund" && cents > 0) signed = -cents;
  }
  return {
    ok: true,
    stornoLine,
    invoiceId: v.pvsInvoiceId,
    patientId: v.pvsPatientId,
    appointmentId: v.pvsAppointmentId ?? undefined,
    encounterId: v.pvsEncounterId ?? undefined,
    signedCents: signed,
    atMs: Date.parse(paidAt),
  };
}

function buildInvoiceEvent(
  clinicId: string,
  a: {
    invoiceId: string;
    patientId: string;
    appointmentId?: string;
    encounterId?: string;
    totalCents: number;
    atMs: number;
  }
): PvsEvent {
  // Dedup key is not upload-scoped: re-uploading the same export collapses.
  // It includes the signed total so a corrected re-upload with a new total
  // is not silently dropped by ON CONFLICT DO NOTHING.
  const at = new Date(a.atMs).toISOString();
  const id = `csv:invoice:${a.invoiceId}:${a.totalCents}`;
  if (a.totalCents < 0) {
    return {
      kind: "InvoiceRefunded",
      clinicId,
      bridgeSource: "csv_upload",
      pvsExternalEventId: id,
      occurredAt: at,
      pvsPatientId: a.patientId,
      pvsInvoiceId: a.invoiceId,
      pvsAppointmentId: a.appointmentId,
      refundedAmountCents: Math.abs(a.totalCents),
      currency: "EUR",
      refundedAt: at,
      reason: "csv_upload",
    };
  }
  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "csv_upload",
    pvsExternalEventId: id,
    occurredAt: at,
    pvsPatientId: a.patientId,
    pvsInvoiceId: a.invoiceId,
    pvsAppointmentId: a.appointmentId,
    pvsEncounterId: a.encounterId,
    amountCents: a.totalCents,
    currency: "EUR",
    paidAt: at,
  };
}

function mapInvoiceRow(
  ctx: MapRowContext,
  m: InvoiceMapping
): MapRowResult {
  const r = classifyInvoiceRow(ctx.row, m);
  if (!r.ok) return r;
  if (r.skip) return { ok: true, events: [], skipped: r.skip };
  if (r.stornoLine) return { ok: true, events: [], skipped: "storniert" };
  if (r.signedCents === 0) return { ok: true, events: [] };
  return {
    ok: true,
    events: [
      buildInvoiceEvent(ctx.clinicId, {
        invoiceId: r.invoiceId,
        patientId: r.patientId,
        appointmentId: r.appointmentId,
        encounterId: r.encounterId,
        totalCents: r.signedCents,
        atMs: r.atMs,
      }),
    ],
  };
}

// ---------------------------------------------------------------
// Whole-file planning (pure): map every row, aggregate invoices
// ---------------------------------------------------------------

export interface CsvPlanEntry {
  event: PvsEvent;
  /** 1-based data row (first row of the invoice for aggregates). */
  row: number;
}

export interface CsvPlan {
  entries: CsvPlanEntry[];
  errors: Array<{ row: number; reason: string }>;
  skipped: { unpaid: number; storniert: number; nettoNull: number };
  /** Set when the mapping itself is unusable; nothing may be applied. */
  fatal?: string;
}

export function planCsvRows(input: {
  clinicId: string;
  uploadId: string;
  rows: Record<string, string>[];
  mapping: CsvMapping;
}): CsvPlan {
  const { clinicId, uploadId, rows, mapping } = input;
  const plan: CsvPlan = {
    entries: [],
    errors: [],
    skipped: { unpaid: 0, storniert: 0, nettoNull: 0 },
  };

  if (mapping.stream !== "invoices") {
    rows.forEach((row, i) => {
      const r = mapCsvRow({ clinicId, uploadId, rowIndex: i, row, mapping });
      if (!r.ok) plan.errors.push({ row: i + 1, reason: r.reason });
      else for (const event of r.events) plan.entries.push({ event, row: i + 1 });
    });
    return plan;
  }

  if (!mapping.columns.statusColumn && !mapping.allRowsPaidConfirmed) {
    plan.fatal = "status_unmapped_without_confirmation";
    return plan;
  }

  const agg = new Map<
    string,
    {
      invoiceId: string;
      patientId: string;
      appointmentId?: string;
      encounterId?: string;
      totalCents: number;
      atMs: number;
      row: number;
    }
  >();
  rows.forEach((row, i) => {
    const r = classifyInvoiceRow(row, mapping);
    if (!r.ok) {
      plan.errors.push({ row: i + 1, reason: r.reason });
      return;
    }
    if (r.skip) {
      plan.skipped[r.skip]++;
      return;
    }
    if (r.stornoLine) plan.skipped.storniert++;
    const cur = agg.get(r.invoiceId);
    if (!cur) {
      agg.set(r.invoiceId, {
        invoiceId: r.invoiceId,
        patientId: r.patientId,
        appointmentId: r.appointmentId,
        encounterId: r.encounterId,
        totalCents: r.signedCents,
        atMs: r.atMs,
        row: i + 1,
      });
    } else {
      cur.totalCents += r.signedCents;
      cur.atMs = Math.max(cur.atMs, r.atMs);
      cur.appointmentId ??= r.appointmentId;
      cur.encounterId ??= r.encounterId;
    }
  });
  for (const a of agg.values()) {
    // Pass 2: a zero balance (credit lines cancel the invoice, or only
    // storniert lines) is emitted as an InvoicePaid of 0 €, the newest state
    // of the invoice. Skipping it left an earlier upload's amount counting.
    // nettoNull now counts these, it no longer means "skipped".
    if (a.totalCents === 0) plan.skipped.nettoNull++;
    if (Math.abs(a.totalCents) > MAX_CENTS) {
      plan.errors.push({ row: a.row, reason: `amount out of range for invoice ${a.invoiceId}` });
      continue;
    }
    plan.entries.push({ event: buildInvoiceEvent(clinicId, a), row: a.row });
  }
  return plan;
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

const DE_DATE_RE =
  /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i;
const US_DATE_RE =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

interface DateParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  /** Offset in minutes when the input carried Z / +hh:mm, else null. */
  offsetMin: number | null;
}

function fullYear(yy: string, maxYear: number): number {
  if (yy.length === 4) return Number(yy);
  let y = 2000 + Number(yy);
  if (y > maxYear) y -= 100;
  return y;
}

function extractDateParts(
  input: string,
  format: string,
  maxYear: number
): DateParts | null {
  const t = input.trim();
  let m: RegExpMatchArray | null;
  if ((m = t.match(ISO_DATE_RE))) {
    let off: number | null = null;
    const z = m[7];
    if (z) {
      if (z.toUpperCase() === "Z") off = 0;
      else {
        const digits = z.slice(1).replace(":", "");
        const mins =
          Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0");
        off = z[0] === "-" ? -mins : mins;
      }
    }
    return finishParts(Number(m[1]), Number(m[2]), Number(m[3]), [m[4], m[5], m[6]], off);
  }
  if ((m = t.match(DE_DATE_RE))) {
    return finishParts(
      fullYear(m[3]!, maxYear),
      Number(m[2]),
      Number(m[1]),
      [m[4], m[5], m[6]],
      null
    );
  }
  if (format === "MM/DD/YYYY" && (m = t.match(US_DATE_RE))) {
    return finishParts(Number(m[3]), Number(m[1]), Number(m[2]), [m[4], m[5], m[6]], null);
  }
  return null;
}

function finishParts(
  y: number,
  mo: number,
  d: number,
  rest: (string | undefined)[],
  offsetMin: number | null
): DateParts | null {
  const hasTime = rest[0] !== undefined;
  const h = hasTime ? Number(rest[0]) : 12;
  const mi = hasTime ? Number(rest[1]) : 0;
  const s = rest[2] !== undefined ? Number(rest[2]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2200) return null;
  return { y, mo, d, h, mi, s, offsetMin };
}

let berlinFmt: Intl.DateTimeFormat | null = null;
function berlinOffsetMs(utcMs: number): number {
  berlinFmt ??= new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const p: Record<string, number> = {};
  for (const part of berlinFmt.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Europe/Berlin wall-clock to UTC epoch ms. */
export function berlinWallToUtcMs(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = berlinOffsetMs(guess);
  let t = guess - off;
  const off2 = berlinOffsetMs(t);
  if (off2 !== off) t = guess - off2;
  return t;
}

/** Returns YYYY-MM-DD (calendar date, no timezone involved) or null. */
function parseDate(input: string | null, format: string): string | null {
  if (input === null) return null;
  const p = extractDateParts(input, format, new Date().getUTCFullYear());
  if (!p) return null;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

/**
 * Explicit parse (never `new Date(string)`). Values without offset are
 * Europe/Berlin wall-clock; date-only values become 12:00 Berlin so the
 * calendar day stays right in UTC. Returns ISO-8601 UTC or null.
 */
export function parseCsvDateTime(
  input: string | null,
  format: string
): string | null {
  if (input === null) return null;
  const p = extractDateParts(input, format, new Date().getUTCFullYear() + 1);
  if (!p) return null;
  const ms =
    p.offsetMin !== null
      ? Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - p.offsetMin * 60_000
      : berlinWallToUtcMs(p.y, p.mo, p.d, p.h, p.mi, p.s);
  return new Date(ms).toISOString();
}

function parseDateTime(input: string | null, format: string): string | null {
  return parseCsvDateTime(input, format);
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

/**
 * Parse a money value to SIGNED integer cents (or null when unparseable).
 * "auto": the last of "," / "." is the decimal separator; a lone separator
 * followed by exactly 3 digits is a thousands group. Accepts EUR / euro
 * sign, trailing minus, parentheses and Unicode minus.
 */
export function parseAmountToCents(
  input: string,
  unit: "cents" | "eur" = "eur",
  decimalSeparator: "auto" | "." | "," = "auto"
): number | null {
  let s = input.replace(/[−‒–—]/g, "-").trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/EUR|€/gi, "").replace(/[\s '’]/g, "");
  if (s.startsWith("-")) {
    neg = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  let intPart: string;
  let frac = "";
  const lastIdx = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));

  if (lastIdx < 0) {
    intPart = s;
  } else if (decimalSeparator !== "auto") {
    const other = decimalSeparator === "," ? "." : ",";
    const di = s.lastIndexOf(decimalSeparator);
    if (di < 0) {
      intPart = s.split(other).join("");
    } else {
      intPart = s.slice(0, di).split(other).join("");
      frac = s.slice(di + 1);
      if (intPart.includes(decimalSeparator) || frac.includes(other)) return null;
    }
  } else {
    const sepChar = s[lastIdx]!;
    const otherChar = sepChar === "," ? "." : ",";
    const occurrences = s.split(sepChar).length - 1;
    const before = s.slice(0, lastIdx);
    const after = s.slice(lastIdx + 1);
    if (before.includes(otherChar)) {
      // both kinds present: the last one is the decimal separator
      if (occurrences > 1) return null;
      intPart = before.split(otherChar).join("");
      frac = after;
    } else if (occurrences > 1) {
      // one kind, repeated: must be thousands groups
      if (!/^\d{1,3}([.,]\d{3})+$/.test(s)) return null;
      intPart = s.replace(/[.,]/g, "");
    } else if (after.length === 3 && before !== "0" && before !== "") {
      intPart = before + after; // lone separator + exactly 3 digits = thousands
    } else {
      intPart = before;
      frac = after;
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(frac)) return null;
  if (intPart === "" && frac === "") return null;
  if (intPart.length > 12) return null;
  const i = intPart === "" ? 0 : Number(intPart);
  let cents: number;
  if (unit === "cents") {
    cents = i + (frac && Number(frac[0]) >= 5 ? 1 : 0);
  } else {
    const f2 = Number((frac.slice(0, 2) || "0").padEnd(2, "0"));
    const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0;
    cents = i * 100 + f2 + roundUp;
  }
  return neg ? -cents : cents;
}

