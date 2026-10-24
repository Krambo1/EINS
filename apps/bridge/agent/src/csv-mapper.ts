/**
 * CSV row → canonical event (agent-local mirror of
 * apps/portal/src/server/pvs-csv-mapper.ts).
 *
 * Five streams supported:
 *
 *   - patients      → PatientUpserted    (weekly Stammdaten full-sync)
 *   - appointments  → AppointmentCreated (+ optional StatusChanged)
 *   - encounters    → EncounterCompleted (Behandlungs-Log full-sync)
 *   - recalls       → RecallScheduled    (Nachsorge-Termine)
 *   - invoices      → InvoicePaid        (Honorar / Abrechnungs-Export)
 *
 * Stream selection per file is auto-detected by header inspection. The
 * watcher passes each parsed file through `detectStreamAndMapping` which
 * picks the stream with the most-matched required fields. Files whose
 * headers don't fit any stream are logged and skipped — never guessed.
 *
 * Dedup keys are stream-stable (e.g. `csv-local:patient:{id}`, not
 * file-hash-scoped) so rolling N-day exports don't double-write.
 */

import { createHash } from "node:crypto";
import type { CanonicalEvent } from "./normalize.js";
import { berlinDateToUtcIso, berlinWallClockToUtcIso } from "./berlin-time.js";

export type CsvStream =
  | "patients"
  | "appointments"
  | "encounters"
  | "recalls"
  | "invoices";

type CommonOpts = {
  /** Date format of date / datetime columns. German PVS default: DD.MM.YYYY. */
  dateFormat: "YYYY-MM-DD" | "DD.MM.YYYY" | "MM/DD/YYYY" | "ISO_DATETIME";
};

type InvoiceOpts = CommonOpts & {
  amountUnit: "cents" | "eur";
  decimalSeparator: "." | ",";
};

export type CsvMapping =
  | {
      stream: "patients";
      columns: {
        pvsPatientId: string;
        email?: string;
        phone?: string;
        fullName?: string;
        firstName?: string;
        lastName?: string;
        dob?: string;
        gender?: string;
        bemerkung?: string;
        externalId?: string;
      };
      dateFormat: CommonOpts["dateFormat"];
    }
  | {
      stream: "appointments";
      columns: {
        pvsPatientId: string;
        pvsAppointmentId: string;
        scheduledAt: string;
        treatmentCode?: string;
        treatmentLabel?: string;
        locationCode?: string;
        locationLabel?: string;
        bemerkung?: string;
        statusColumn?: string;
      };
      dateFormat: CommonOpts["dateFormat"];
    }
  | {
      stream: "encounters";
      columns: {
        pvsPatientId: string;
        pvsEncounterId: string;
        pvsAppointmentId?: string;
        completedAt: string;
        treatmentCode?: string;
        treatmentLabel?: string;
        practitionerLabel?: string;
      };
      dateFormat: CommonOpts["dateFormat"];
    }
  | {
      stream: "recalls";
      columns: {
        pvsPatientId: string;
        pvsRecallId: string;
        recallAt: string;
        treatmentCode?: string;
        treatmentLabel?: string;
      };
      dateFormat: CommonOpts["dateFormat"];
    }
  | (InvoiceOpts & {
      stream: "invoices";
      /**
       * What the mapped amount column holds. "row" (default when absent): each
       * row carries its own payment / line amount and rows of one invoice are
       * summed. "invoice": the column is an invoice-level total (Rechnungsbetrag,
       * Gesamtbetrag, Endbetrag, Rechnungssumme) that is REPEATED on every
       * line-item / payment row of the invoice and must not be summed per row.
       * Set by detectMapping / autoDetectMapping.
       */
      amountScope?: "row" | "invoice";
      columns: {
        pvsPatientId: string;
        pvsInvoiceId: string;
        pvsAppointmentId?: string;
        pvsEncounterId?: string;
        amount: string;
        paidAt: string;
        /** Optional Zahlstatus column. When set, only rows whose value reads
         *  as paid emit InvoicePaid; offen / storniert rows are skipped so an
         *  "export all invoices" file cannot book every open invoice as
         *  revenue (H2). */
        statusColumn?: string;
      };
    });

export interface CsvMapRowContext {
  clinicId: string;
  /** Stable identifier for the source file. Used inside the dedup key
   *  only as a *fallback* when a row's natural key (pvsInvoiceId,
   *  pvsAppointmentId, ...) is missing. */
  fileHash: string;
  /**
   * ISO-8601 UTC modification time of the source CSV file, supplied by the
   * watcher. The patients stream carries no per-row business date (dob is the
   * birth date, not a record date), so PatientUpserted derives its occurredAt
   * from this stable file mtime instead of the wall clock; re-processing the
   * same export then produces byte-identical events and the portal dedups them
   * (H4). Optional for back-compat: when the watcher does not set it, the
   * previous wall-clock fallback applies. All other streams already key
   * occurredAt off a real row date (scheduledAt / completedAt / recallAt /
   * paidAt) and are unaffected.
   */
  fileModifiedAtIso?: string;
  rowIndex: number;
  row: Record<string, string>;
  mapping: CsvMapping;
}

export type CsvMapRowResult =
  | { ok: true; events: CanonicalEvent[] }
  | { ok: false; reason: string };

export function mapCsvRow(ctx: CsvMapRowContext): CsvMapRowResult {
  switch (ctx.mapping.stream) {
    case "patients":
      return mapPatientRow(ctx, ctx.mapping);
    case "appointments":
      return mapAppointmentRow(ctx, ctx.mapping);
    case "encounters":
      return mapEncounterRow(ctx, ctx.mapping);
    case "recalls":
      return mapRecallRow(ctx, ctx.mapping);
    case "invoices":
      return mapInvoiceRow(ctx, ctx.mapping);
  }
}

// ---------------------------------------------------------------
// Per-stream mappers
// ---------------------------------------------------------------

/**
 * Event id with a short deterministic revision of the row's business payload.
 * The outbox dedups on the event id, so an id keyed only on the PVS id would
 * swallow a changed e-mail / phone / rescheduled appointment. The hash covers
 * normalized payload fields only (never occurredAt or other volatile values),
 * so re-reading an unchanged export reproduces the identical id. The source id
 * is truncated if needed to keep the whole id <= 200 chars; the hash still
 * covers the full id, so truncation cannot cause a collision.
 */
function revisionedEventId(
  prefix: string,
  id: string,
  fields: ReadonlyArray<string | null | undefined>
): string {
  const rev = createHash("sha256")
    .update(JSON.stringify([id, ...fields.map((x) => x ?? null)]))
    .digest("hex")
    .slice(0, 12);
  const maxId = 200 - prefix.length - 1 - rev.length;
  return `${prefix}${id.length > maxId ? id.slice(0, maxId) : id}:${rev}`;
}

function mapPatientRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "patients" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };

  const dob = v.dob ? parseDate(v.dob, m.dateFormat, "dob") : null;
  if (v.dob && !dob) return { ok: false, reason: `invalid dob: ${v.dob}` };

  // M-P4: when the CSV carries a Vorname-like column AND a Name/Nachname-like
  // column, prefer recombining first + last over treating a bare "Name" column
  // as the full name. A bare "Name" header resolves to BOTH fullName and
  // lastName; the old `v.fullName ?? recombine` let the fullName alias win and
  // silently dropped the Vorname for the standard German "Vorname; Name" pair.
  // Recombination wins whenever both a first and a last name are present.
  const recombined =
    [v.firstName, v.lastName].filter(Boolean).join(" ") || null;
  const fullName =
    v.firstName && v.lastName ? recombined : v.fullName ?? recombined;

  const email = v.email && isEmail(v.email) ? v.email.toLowerCase() : undefined;

  const event: CanonicalEvent = {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: revisionedEventId("csv-local:patient:", v.pvsPatientId, [
      email,
      v.phone,
      fullName,
      dob,
      normaliseGender(v.gender),
      v.bemerkung,
      v.externalId,
    ]),
    // H4: deterministic occurredAt. The event id keys on the stable patient id,
    // so prefer the file mtime (stable across re-exports) over the wall clock;
    // the latter only survives as the back-compat fallback until the watcher
    // passes fileModifiedAtIso.
    occurredAt: ctx.fileModifiedAtIso ?? new Date().toISOString(),
    pvsPatientId: v.pvsPatientId,
    email,
    phone: v.phone ?? undefined,
    fullName: fullName ?? undefined,
    dob: dob ?? undefined,
    gender: normaliseGender(v.gender),
    bemerkung: v.bemerkung ?? undefined,
    externalId: v.externalId ?? undefined,
  };
  return { ok: true, events: [event] };
}

function mapAppointmentRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "appointments" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsAppointmentId)
    return { ok: false, reason: "missing pvsAppointmentId" };
  const scheduledAt = parseDateTime(v.scheduledAt, m.dateFormat);
  if (!scheduledAt)
    return { ok: false, reason: `invalid scheduledAt: ${v.scheduledAt}` };

  const created: CanonicalEvent = {
    kind: "AppointmentCreated",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: revisionedEventId(
      "csv-local:appointment:",
      v.pvsAppointmentId,
      [
        v.pvsPatientId,
        scheduledAt,
        v.treatmentCode,
        v.treatmentLabel,
        v.locationCode,
        v.locationLabel,
        v.bemerkung,
      ]
    ),
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
  const events: CanonicalEvent[] = [created];

  // Optional status column drives an additional StatusChanged event.
  // Cancellations get the dedicated AppointmentCancelled kind so the
  // portal can show "Patient hat abgesagt" separately.
  if (v.statusColumn) {
    const newStatus = normaliseAppointmentStatus(v.statusColumn);
    if (newStatus === "cancelled") {
      events.push({
        kind: "AppointmentCancelled",
        clinicId: ctx.clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `csv-local:appointment-cancel:${v.pvsAppointmentId}`,
        occurredAt: scheduledAt,
        pvsPatientId: v.pvsPatientId,
        pvsAppointmentId: v.pvsAppointmentId,
      });
    } else if (newStatus && newStatus !== "scheduled") {
      events.push({
        kind: "AppointmentStatusChanged",
        clinicId: ctx.clinicId,
        bridgeSource: "gdt_agent",
        pvsExternalEventId: `csv-local:appointment-status:${v.pvsAppointmentId}:${newStatus}`,
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
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "encounters" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsEncounterId)
    return { ok: false, reason: "missing pvsEncounterId" };
  const completedAt = parseDateTime(v.completedAt, m.dateFormat);
  if (!completedAt)
    return { ok: false, reason: `invalid completedAt: ${v.completedAt}` };

  const event: CanonicalEvent = {
    kind: "EncounterCompleted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: revisionedEventId(
      "csv-local:encounter:",
      v.pvsEncounterId,
      [
        v.pvsPatientId,
        v.pvsAppointmentId,
        completedAt,
        v.treatmentCode,
        v.treatmentLabel,
        v.practitionerLabel,
      ]
    ),
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

function mapRecallRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "recalls" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsRecallId) return { ok: false, reason: "missing pvsRecallId" };
  const recallAt = parseDateTime(v.recallAt, m.dateFormat);
  if (!recallAt)
    return { ok: false, reason: `invalid recallAt: ${v.recallAt}` };

  const event: CanonicalEvent = {
    kind: "RecallScheduled",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: revisionedEventId("csv-local:recall:", v.pvsRecallId, [
      v.pvsPatientId,
      recallAt,
      v.treatmentCode,
      v.treatmentLabel,
    ]),
    occurredAt: recallAt,
    pvsPatientId: v.pvsPatientId,
    pvsRecallId: v.pvsRecallId,
    recallAt,
    treatmentCode: v.treatmentCode ?? undefined,
    treatmentLabel: v.treatmentLabel ?? undefined,
  };
  return { ok: true, events: [event] };
}

/**
 * Words that start a footer / summary line of a printed or exported report
 * ("Summe", "Gesamt", "Übertrag" ...). Matched against the FIRST NON-EMPTY cell
 * of a row and the mapped invoice-id / patient-id cells (trimmed, case-insensitive): a treatment text such as "Total
 * Body Lifting" in a later cell must not turn a real invoice row into a footer. The negative lookahead keeps real names such
 * as "Summerfield" or "Totalis" out of the net.
 */
const FOOTER_CELL_RE =
  /^(summen?|gesamt(summe|betrag)?|endsumme|total|übertrag|uebertrag|zwischensumme)(?![a-zäöüß])/i;

function isFooterRow(
  row: Record<string, string>,
  columns?: { pvsInvoiceId?: string; pvsPatientId?: string }
): boolean {
  const isFooterCell = (cell: string | undefined): boolean => {
    const t = typeof cell === "string" ? cell.trim() : "";
    return t !== "" && FOOTER_CELL_RE.test(t);
  };
  // Also the mapped invoice-id / patient-id cells: a "Gesamtsumme" there is a
  // summary line even when it is not the row's first cell.
  if (columns) {
    if (columns.pvsInvoiceId && isFooterCell(row[columns.pvsInvoiceId])) return true;
    if (columns.pvsPatientId && isFooterCell(row[columns.pvsPatientId])) return true;
  }
  for (const cell of Object.values(row)) {
    const t = typeof cell === "string" ? cell.trim() : "";
    if (t) return isFooterCell(t);
  }
  return false;
}

/** Outcome category of a single invoice row that did not yield a signed amount. */
export type InvoiceSkipKind =
  | "footer" // summary line or empty invoice cell
  | "storno" // storniert/Storno status with a positive amount
  | "not_paid" // status column says offen / unknown
  | "invalid"; // missing field, bad date, bad amount

export type InvoiceRowParse =
  | {
      ok: true;
      patientId: string;
      invoiceId: string;
      /** SIGNED integer cents: refunds are negative. */
      cents: number;
      at: string;
      appointmentId: string | null;
      encounterId: string | null;
      /** Pass 2: a positive row marked storniert. cents is 0; the row still
       *  names its invoice so an all-storno invoice can be emitted as 0 €. */
      storno?: boolean;
    }
  | { ok: false; kind: InvoiceSkipKind; reason: string };

function parseInvoiceRow(
  row: Record<string, string>,
  m: Extract<CsvMapping, { stream: "invoices" }>
): InvoiceRowParse {
  const v = pluckColumns(row, m.columns);
  // Footer / summary lines ("Summe;ges;150,00;07.10.2026") and rows without an
  // invoice number are never invoices.
  if (isFooterRow(row, m.columns)) {
    return { ok: false, kind: "footer", reason: "summary/footer row; skipped" };
  }
  if (!v.pvsInvoiceId) {
    return { ok: false, kind: "footer", reason: "missing pvsInvoiceId" };
  }
  if (!v.pvsPatientId) {
    return { ok: false, kind: "invalid", reason: "missing pvsPatientId" };
  }
  if (!v.amount) return { ok: false, kind: "invalid", reason: "missing amount" };
  if (!v.paidAt) return { ok: false, kind: "invalid", reason: "missing paidAt" };

  const at = parseInvoiceInstant(v.paidAt, m.dateFormat);
  if (!at) return { ok: false, kind: "invalid", reason: "invalid paidAt" };

  const cents = parseAmountToCents(v.amount, m.amountUnit);
  if (cents === null) {
    return { ok: false, kind: "invalid", reason: "invalid amount" };
  }

  // H2: when a Zahlstatus column is mapped, a POSITIVE row only counts as
  // revenue if the status reads as paid. Negative amounts are real refunds
  // regardless of status (H1), so they bypass this gate. Storniert rows with a
  // positive amount are neither revenue nor refund; they are counted apart.
  if (cents >= 0 && m.columns.statusColumn) {
    if (isStornoInvoiceStatus(v.statusColumn)) {
      return {
        ok: true,
        patientId: v.pvsPatientId,
        invoiceId: v.pvsInvoiceId,
        cents: 0,
        at,
        appointmentId: v.pvsAppointmentId ?? null,
        encounterId: v.pvsEncounterId ?? null,
        storno: true,
      };
    }
    if (!isPaidInvoiceStatus(v.statusColumn)) {
      return {
        ok: false,
        kind: "not_paid",
        reason: `invoice not paid (status=${v.statusColumn ?? "<empty>"}); skipped`,
      };
    }
  }
  return {
    ok: true,
    patientId: v.pvsPatientId,
    invoiceId: v.pvsInvoiceId,
    cents,
    at,
    appointmentId: v.pvsAppointmentId ?? null,
    encounterId: v.pvsEncounterId ?? null,
  };
}

function invoiceEvent(
  clinicId: string,
  p: {
    patientId: string;
    invoiceId: string;
    totalCents: number;
    at: string;
    appointmentId: string | null;
    encounterId: string | null;
    /** Pass 2: producer revision (file mtime); decides before dates in derive. */
    sourceRevision?: number;
  }
): CanonicalEvent {
  const rev = p.sourceRevision !== undefined ? { sourceRevision: p.sourceRevision } : {};
  if (p.totalCents < 0) {
    const abs = Math.abs(p.totalCents);
    return {
      kind: "InvoiceRefunded",
      clinicId,
      bridgeSource: "gdt_agent",
      pvsExternalEventId: `csv-local:refund:${p.invoiceId}:${abs}`,
      occurredAt: p.at,
      pvsPatientId: p.patientId,
      pvsInvoiceId: p.invoiceId,
      pvsAppointmentId: p.appointmentId ?? undefined,
      refundedAmountCents: abs,
      currency: "EUR",
      refundedAt: p.at,
      ...rev,
    };
  }
  return {
    kind: "InvoicePaid",
    clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `csv-local:invoice:${p.invoiceId}:${p.totalCents}`,
    occurredAt: p.at,
    pvsPatientId: p.patientId,
    pvsInvoiceId: p.invoiceId,
    pvsAppointmentId: p.appointmentId ?? undefined,
    pvsEncounterId: p.encounterId ?? undefined,
    amountCents: p.totalCents,
    currency: "EUR",
    paidAt: p.at,
    ...rev,
  };
}

/**
 * Single-row mapping (kept for callers that map one row at a time). The
 * watcher does NOT use this for invoices: a row is not an invoice. A
 * line-item export (one row per GOÄ-Ziffer), Teilzahlungen and corrected
 * re-exports need per-invoice aggregation, see aggregateInvoiceRows.
 */
function mapInvoiceRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "invoices" }>
): CsvMapRowResult {
  const r = parseInvoiceRow(ctx.row, m);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.storno) return { ok: false, reason: "invoice storniert; skipped" };
  if (r.cents === 0) return { ok: false, reason: "zero amount; skipped" };
  return {
    ok: true,
    events: [
      invoiceEvent(ctx.clinicId, {
        patientId: r.patientId,
        invoiceId: r.invoiceId,
        totalCents: r.cents,
        at: r.at,
        appointmentId: r.appointmentId,
        encounterId: r.encounterId,
      }),
    ],
  };
}

export interface InvoiceAggregateStats {
  /** Data rows seen. */
  rows: number;
  /** Distinct invoice numbers among the accepted rows. */
  invoices: number;
  paidInvoices: number;
  refundInvoices: number;
  /** Invoices whose rows net to exactly 0 (pass 2: emitted as InvoicePaid 0). */
  netZeroInvoices: number;
  /** Invoice numbers that appear with more than one patient id (ignored). */
  conflictingInvoices: number;
  skippedFooter: number;
  skippedNotPaid: number;
  skippedStorno: number;
  invalidRows: number;
  /** Category -> count for invalid rows; keys carry no cell values. */
  invalidReasons: Record<string, number>;
}

/**
 * Aggregate the rows of ONE file per invoice number and build one event per
 * invoice (defect "invoice identity = invoice number only"):
 *
 *   - signed cents of all accepted rows of an invoice are SUMMED (line items,
 *     Teilzahlungen, Stornobuchungen),
 *   - paidAt is the LATEST row date,
 *   - net > 0  -> InvoicePaid   id csv-local:invoice:<inv>:<totalCents>
 *   - net < 0  -> InvoiceRefunded id csv-local:refund:<inv>:<absCents>
 *   - net 0    -> InvoicePaid 0 (pass 2). Credit lines that cancel the
 *     invoice, or only storniert rows: the newest state of an invoice an
 *     earlier export may have sent with its full amount. Skipping it left
 *     that amount counting forever; derive treats the drop as a refund.
 *   - amountScope "invoice" (Rechnungsbetrag & co., repeated on every row):
 *     NOT summed; resolved by invoiceScopeTotal (re-issue, storno, credits).
 *   - sourceRevision (the file mtime, from the watcher) is put on every
 *     event, so in derive a later export wins even when its dates are older.
 * The total is part of the id, so a corrected re-export (new total) re-emits
 * while the identical total re-exported in an overlapping file dedups in the
 * outbox. pvsInvoiceId stays the plain invoice number. An invoice number that
 * carries two different patient ids inside one file is ambiguous and is
 * ignored (counted in conflictingInvoices).
 */
/**
 * Pass 2 (verifier): net total of an invoice whose amount column repeats the
 * INVOICE total on every row (Rechnungsbetrag & co., amountScope "invoice").
 * Rows in date order (file order on equal dates):
 *   - positive p equal to an open credit: that credit is reversed;
 *   - other positive p: the invoice total is now p; a new amount is a
 *     re-issue, so credits against the old version are dropped;
 *   - negative n with |n| = current total: storno of the current version (0);
 *   - negative n with |n| = an earlier total: storno of a version that was
 *     already replaced (listed after the re-issue, or repeated on a line);
 *   - any other negative: a credit note, counted once per distinct amount
 *     (two genuine credit notes of the same amount on one invoice count once).
 * The old rule (latest positive + every distinct negative) turned "+1000,
 * -1000, +800" into a 200 € refund and lost the 800 €.
 */
export function invoiceScopeTotal(rows: ReadonlyArray<{ cents: number; at: string }>): number {
  const ordered = rows
    .map((r, i) => ({ cents: r.cents, at: r.at, i }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i));
  let current = 0;
  const seenTotals = new Set<number>();
  let credits = new Set<number>();
  for (const r of ordered) {
    if (r.cents > 0) {
      if (r.cents !== current && credits.has(-r.cents)) {
        credits.delete(-r.cents);
        continue;
      }
      if (r.cents !== current) credits = new Set();
      current = r.cents;
      seenTotals.add(r.cents);
    } else if (r.cents < 0) {
      const abs = -r.cents;
      if (current > 0 && abs === current) {
        current = 0;
      } else if (!seenTotals.has(abs)) {
        credits.add(r.cents);
      }
    }
  }
  let total = current;
  for (const c of credits) total += c;
  return total;
}

export function aggregateInvoiceRows(input: {
  clinicId: string;
  rows: ReadonlyArray<Record<string, string>>;
  mapping: Extract<CsvMapping, { stream: "invoices" }>;
  /** Pass 2: the file's revision (integer mtime ms); see invoiceEvent. */
  sourceRevision?: number;
}): { events: CanonicalEvent[]; stats: InvoiceAggregateStats } {
  const invoiceScope = input.mapping.amountScope === "invoice";
  const stats: InvoiceAggregateStats = {
    rows: input.rows.length,
    invoices: 0,
    paidInvoices: 0,
    refundInvoices: 0,
    netZeroInvoices: 0,
    conflictingInvoices: 0,
    skippedFooter: 0,
    skippedNotPaid: 0,
    skippedStorno: 0,
    invalidRows: 0,
    invalidReasons: {},
  };
  interface Acc {
    patients: Set<string>;
    patientId: string;
    /** Row scope: sum of signed cents. */
    total: number;
    /** Invoice scope: every row's total, resolved by invoiceScopeTotal. */
    scoped: Array<{ cents: number; at: string }>;
    at: string;
    appointmentId: string | null;
    encounterId: string | null;
  }
  const byInvoice = new Map<string, Acc>();
  for (const row of input.rows) {
    const r = parseInvoiceRow(row, input.mapping);
    if (r.ok && r.storno) stats.skippedStorno++;
    if (!r.ok) {
      if (r.kind === "footer") stats.skippedFooter++;
      else if (r.kind === "not_paid") stats.skippedNotPaid++;
      else if (r.kind === "storno") stats.skippedStorno++;
      else {
        stats.invalidRows++;
        stats.invalidReasons[r.reason] = (stats.invalidReasons[r.reason] ?? 0) + 1;
      }
      continue;
    }
    const acc = byInvoice.get(r.invoiceId);
    if (!acc) {
      const fresh: Acc = {
        patients: new Set([r.patientId]),
        patientId: r.patientId,
        total: r.cents,
        scoped: [{ cents: r.cents, at: r.at }],
        at: r.at,
        appointmentId: r.appointmentId,
        encounterId: r.encounterId,
      };
      byInvoice.set(r.invoiceId, fresh);
      continue;
    }
    acc.patients.add(r.patientId);
    acc.total += r.cents;
    acc.scoped.push({ cents: r.cents, at: r.at });
    if (r.at > acc.at) acc.at = r.at;
    acc.appointmentId ??= r.appointmentId;
    acc.encounterId ??= r.encounterId;
  }
  const events: CanonicalEvent[] = [];
  stats.invoices = byInvoice.size;
  for (const [invoiceId, acc] of byInvoice) {
    if (acc.patients.size > 1) {
      stats.conflictingInvoices++;
      continue;
    }
    const total = invoiceScope ? invoiceScopeTotal(acc.scoped) : acc.total;
    if (total === 0) stats.netZeroInvoices++;
    else if (total < 0) stats.refundInvoices++;
    else stats.paidInvoices++;
    events.push(
      invoiceEvent(input.clinicId, {
        patientId: acc.patientId,
        invoiceId,
        totalCents: total,
        at: acc.at,
        appointmentId: acc.appointmentId,
        encounterId: acc.encounterId,
        sourceRevision: input.sourceRevision,
      })
    );
  }
  return { events, stats };
}

// ---------------------------------------------------------------
// Auto-detection across all five streams
// ---------------------------------------------------------------

/**
 * Aliases for canonical field names. Each list is checked against trimmed
 * headers; first match wins. Order = priority (more-specific first).
 */
const ALIASES: Record<string, RegExp[]> = {
  pvsPatientId: [
    /^pat(ient)?(en)?[\s\-_.]*nr\.?$/i, // Patient-Nr., Patienten-Nr., Patientennr., Pat-Nr, PatNr
    /^pat(ient)?ennummer$/i,
    /^patid$/i,
    // NOT /^patient$/: a bare "Patient" column is the patient NAME
    // ("Müller, Anna"); mapping it to the id would ship the name as an id.
    /^kundennr\.?$/i,
  ],
  pvsInvoiceId: [
    /^rech(nung)?s?[\s\-_.]*nr\.?$/i, // Rechnungs-Nr., Rech-Nr.
    /^rechnungsnummer$/i,
    /^r[eg][\s\-_.]*nr\.?$/i, // Rg.-Nr., Rg-Nr, RgNr, Re-Nr., Re.-Nr.
    /^beleg[\s\-_.]*(nr\.?|nummer)$/i, // Belegnr, Belegnummer
    /^rechnung$/i,
    /^invoice[\s\-_.]*nr\.?$/i,
  ],
  pvsAppointmentId: [
    /^termin[\s\-_.]*nr\.?$/i,
    /^terminnummer$/i,
    /^appointment[\s\-_.]*id$/i,
  ],
  pvsEncounterId: [
    /^behandlungs?[\s\-_.]*nr\.?$/i,
    /^behandlungsnummer$/i,
    /^encounter[\s\-_.]*id$/i,
    /^leistungs?[\s\-_.]*nr\.?$/i,
  ],
  pvsRecallId: [
    /^recall[\s\-_.]*nr\.?$/i,
    /^recall[\s\-_.]*id$/i,
    /^nachsorge[\s\-_.]*nr\.?$/i,
    /^wiedervorlage[\s\-_.]*nr\.?$/i,
  ],
  paidAt: [
    // H2: `rechnungsdatum` (and other invoice-DATE aliases) are intentionally
    // NOT here. A PVS that exports offen + bezahlt invoices with only a
    // Rechnungsdatum would otherwise book every open invoice as paid revenue.
    // Rechnungsdatum may still serve as paidAt via an EXPLICIT operator column
    // mapping (mapping.columns.paidAt = "Rechnungsdatum"), which bypasses this
    // auto-detection table entirely.
    // A bare "Bezahlt" is a Zahlstatus (ja/nein), never a date: it lives in
    // invoiceStatus only, so one column can never serve both fields.
    /^bezahlt[\s\-_.]*am$/i,
    /^bezahl[\s\-_.]*datum$/i,
    /^zahl(ungs)?[\s\-_.]*datum$/i,
    /^zahlungs?[\s\-_.]*eingang$/i,
    /^eingang$/i,
    /^paid[\s\-_.]*at$/i,
  ],
  invoiceStatus: [
    /^zahlungs?status$/i,
    /^zahlstatus$/i,
    /^rechnungs?status$/i,
    /^status$/i,
    /^bezahlt$/i,
    /^paid$/i,
    /^payment[\s\-_.]*status$/i,
  ],
  scheduledAt: [
    /^termin[\s\-_.]*datum$/i,
    /^termindatum$/i,
    /^scheduled[\s\-_.]*at$/i,
  ],
  completedAt: [
    /^behandlungs?[\s\-_.]*datum$/i,
    /^behandlungsdatum$/i,
    /^completed[\s\-_.]*at$/i,
    /^abgeschlossen[\s\-_.]*am$/i,
  ],
  recallAt: [
    /^recall[\s\-_.]*datum$/i,
    /^nachsorge[\s\-_.]*datum$/i,
    /^wiedervorlage[\s\-_.]*datum$/i,
    /^recall[\s\-_.]*am$/i,
  ],
  email: [/^e[\-\s_.]?mail$/i, /^email$/i, /^mail$/i],
  phone: [
    /^mobil(funk)?$/i,
    /^mobile$/i,
    /^handy$/i,
    /^telefon$/i,
    /^tel\.?$/i,
    /^phone$/i,
  ],
  fullName: [/^name$/i, /^vollst[\.aä]ndiger[\s\-_.]*name$/i, /^patientenname$/i],
  firstName: [/^vorname$/i, /^first[\s\-_.]*name$/i, /^given[\s\-_.]*name$/i],
  lastName: [
    /^nachname$/i,
    /^last[\s\-_.]*name$/i,
    /^family[\s\-_.]*name$/i,
    /^name$/i, // intentional secondary; primary "name" hit goes to fullName above
  ],
  dob: [/^geburtsdatum$/i, /^geburtstag$/i, /^dob$/i, /^birth[\s\-_.]*date$/i],
  gender: [/^geschlecht$/i, /^gender$/i, /^sex$/i],
  bemerkung: [/^bemerkung$/i, /^notiz$/i, /^kommentar$/i, /^note$/i],
  treatmentCode: [
    /^leistungs?[\s\-_.]*ziffer$/i,
    /^go[äa]?[\s\-_.]*ziffer$/i,
    /^behandlungs?[\s\-_.]*code$/i,
    /^ziffer$/i,
  ],
  treatmentLabel: [
    /^leistungs?[\s\-_.]*bezeichnung$/i,
    /^behandlungs?[\s\-_.]*bezeichnung$/i,
    /^bezeichnung$/i,
  ],
  locationCode: [/^standort[\s\-_.]*code$/i, /^standort[\s\-_.]*id$/i],
  locationLabel: [/^standort$/i, /^praxis[\s\-_.]*standort$/i],
  practitionerLabel: [
    /^behandler$/i,
    /^arzt$/i,
    /^[äa]rztin?$/i,
    /^practitioner$/i,
  ],
  statusColumn: [/^status$/i, /^termin[\s\-_.]*status$/i],
};

/**
 * Version of the auto-detection alias table + resolution rules. Part of the
 * ledger fingerprint of a file handled with auto-detected mapping: bumping it
 * makes every previously ignored file be re-read once.
 */
export const AUTO_MAPPING_VERSION = 4;

/**
 * Amount column priority tiers (best first). A column from a better tier
 * always beats a column from a worse tier, regardless of position in the file.
 * Two DIFFERENT columns inside the best matching tier are ambiguous (netto vs
 * brutto cannot be told apart) and the file is refused instead of guessed.
 *
 * Pass 2 (version 4): what was paid comes first; then the invoice-level
 * totals (Rechnungsbetrag, Gesamtbetrag, Endbetrag, Rechnungssumme), then the
 * row amounts. An invoice total is what the patient pays (Honorar + Auslagen
 * such as filler or toxin, + MwSt); Honorar or Netto alone undercount it.
 * Invoice totals are repeated on every line-item / payment row, so they carry
 * scope "invoice" and aggregateInvoiceRows counts them once per invoice
 * instead of summing them per row (version 3 ranked them last for that
 * reason, at the cost of picking Honorar over Rechnungsbetrag).
 */
const AMOUNT_TIERS: { scope: "row" | "invoice"; patterns: RegExp[] }[] = [
  {
    // What was actually paid on this row.
    scope: "row",
    patterns: [
      /^zahl(ungs)?[\s\-_.]*betrag$/i,
      /^gezahlt$/i,
      /^zahlung$/i,
      /^betrag[\s\-_.]*bezahlt$/i,
      /^einzahlung$/i,
    ],
  },
  // Invoice-level totals, counted once per invoice (scope "invoice").
  {
    scope: "invoice",
    patterns: [
      /^endbetrag$/i,
      /^rechnungsbetrag$/i,
      /^gesamtbetrag$/i,
      /^rechnungssumme$/i,
    ],
  },
  {
    scope: "row",
    patterns: [
      /^brutto$/i,
      /^brutto[\s\-_.]*betrag$/i,
      /^summe[\s\-_.]*brutto$/i,
    ],
  },
  {
    scope: "row",
    patterns: [
      /^betrag$/i,
      /^betrag[\s]*\((eur|euro|€)\)$/i,
      /^betrag[\s]+(in[\s]+)?(eur|euro|€)$/i,
      /^betrag[\s]*(€|eur)$/i,
    ],
  },
  { scope: "row", patterns: [/^summe$/i, /^gesamt$/i] },
  // Netto / Honorar: row-level fallback.
  {
    scope: "row",
    patterns: [
      /^honorar$/i,
      /^netto$/i,
      /^netto[\s\-_.]*betrag$/i,
      /^summe[\s\-_.]*netto$/i,
    ],
  },
];

type ResolveResult = {
  fields: Record<string, string>;
  /** Scope of the resolved amount column (see CsvMapping invoices.amountScope). */
  amountScope?: "row" | "invoice";
  /** Column names tied for the best amount tier (>= 2 means ambiguous). */
  ambiguousAmount?: string[];
};

/** Best-alias-wins: the alias list order is the priority, not the column order. */
function resolveField(
  headers: string[],
  field: string,
  used?: ReadonlySet<string>
): string | undefined {
  const patterns = ALIASES[field];
  if (!patterns) return undefined;
  for (const re of patterns) {
    const hit = headers.find((h) => !used?.has(h) && re.test(h.trim()));
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function resolveAmount(
  headers: string[],
  used: ReadonlySet<string>
): { column?: string; scope?: "row" | "invoice"; ambiguous?: string[] } {
  for (const tier of AMOUNT_TIERS) {
    const cols = [
      ...new Set(
        headers.filter(
          (h) => !used.has(h) && tier.patterns.some((re) => re.test(h.trim()))
        )
      ),
    ];
    if (cols.length === 1) return { column: cols[0], scope: tier.scope };
    if (cols.length > 1) return { ambiguous: cols };
  }
  return {};
}

/**
 * Resolve every alias-known field present in the headers. Used by the
 * stream-picker (which counts matched fields per stream) and by the
 * per-stream mapping builder. The invoice fields are resolved in a fixed order
 * with a used-column set so one column never serves two fields.
 */
function resolveAllFields(headers: string[]): ResolveResult {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const claim = (field: string, header: string | undefined): void => {
    if (header !== undefined) {
      out[field] = header;
      used.add(header);
    }
  };
  claim("pvsPatientId", resolveField(headers, "pvsPatientId", used));
  claim("pvsInvoiceId", resolveField(headers, "pvsInvoiceId", used));
  const amount = resolveAmount(headers, used);
  claim("amount", amount.column);
  claim("paidAt", resolveField(headers, "paidAt", used));
  claim("invoiceStatus", resolveField(headers, "invoiceStatus", used));
  const claimed = new Set(Object.keys(out));
  for (const field of Object.keys(ALIASES)) {
    if (claimed.has(field)) continue;
    // Fields outside the invoice group may legitimately share a column
    // (e.g. "Name" -> fullName AND lastName, "Status" -> invoice AND
    // appointment status); they belong to different streams.
    const header = resolveField(headers, field);
    if (header) out[field] = header;
  }
  return {
    fields: out,
    amountScope: amount.scope,
    ambiguousAmount: amount.ambiguous,
  };
}

export type MappingDetection =
  | { ok: true; mapping: CsvMapping }
  | {
      ok: false;
      /** `ambiguous_amount_columns` when two columns tie for the amount. */
      reason: "ambiguous_amount_columns" | "no_mapping";
      columns: string[];
    };

/**
 * Like autoDetectMapping but tells WHY nothing was detected, so the watcher
 * can record `ambiguous_amount_columns: <names>` as the ignore reason.
 */
export function detectMapping(headers: string[]): MappingDetection {
  const mapping = autoDetectMapping(headers);
  if (mapping) return { ok: true, mapping };
  const { fields, ambiguousAmount } = resolveAllFields(headers);
  if (
    ambiguousAmount &&
    fields.pvsPatientId &&
    fields.pvsInvoiceId &&
    fields.paidAt
  ) {
    return { ok: false, reason: "ambiguous_amount_columns", columns: ambiguousAmount };
  }
  return { ok: false, reason: "no_mapping", columns: [] };
}

/**
 * Auto-detect the stream and produce a mapping from header inspection
 * alone. Picks the stream whose required fields are fully matched and
 * whose total matched-field count (required + optional) is the highest.
 * Returns null if no stream has all required fields.
 */
export function autoDetectMapping(headers: string[]): CsvMapping | null {
  const { fields: resolved, amountScope } = resolveAllFields(headers);

  const candidates: { mapping: CsvMapping; score: number }[] = [];

  // Patients: pvsPatientId required; one of email/phone/name to be useful.
  if (
    resolved.pvsPatientId &&
    (resolved.email || resolved.phone || resolved.fullName || resolved.firstName || resolved.lastName) &&
    // Disambiguate against invoices / appointments etc by absence of those keys.
    !resolved.pvsInvoiceId &&
    !resolved.pvsAppointmentId &&
    !resolved.pvsEncounterId &&
    !resolved.pvsRecallId
  ) {
    const mapping: CsvMapping = {
      stream: "patients",
      columns: {
        pvsPatientId: resolved.pvsPatientId,
        email: resolved.email,
        phone: resolved.phone,
        fullName: resolved.fullName,
        firstName: resolved.firstName,
        lastName: resolved.lastName,
        dob: resolved.dob,
        gender: resolved.gender,
        bemerkung: resolved.bemerkung,
      },
      dateFormat: "DD.MM.YYYY",
    };
    candidates.push({ mapping, score: countMatched(mapping.columns) });
  }

  // Appointments: pvsPatientId + pvsAppointmentId + scheduledAt required.
  if (
    resolved.pvsPatientId &&
    resolved.pvsAppointmentId &&
    resolved.scheduledAt
  ) {
    const mapping: CsvMapping = {
      stream: "appointments",
      columns: {
        pvsPatientId: resolved.pvsPatientId,
        pvsAppointmentId: resolved.pvsAppointmentId,
        scheduledAt: resolved.scheduledAt,
        treatmentCode: resolved.treatmentCode,
        treatmentLabel: resolved.treatmentLabel,
        locationCode: resolved.locationCode,
        locationLabel: resolved.locationLabel,
        bemerkung: resolved.bemerkung,
        statusColumn: resolved.statusColumn,
      },
      dateFormat: "DD.MM.YYYY",
    };
    candidates.push({ mapping, score: countMatched(mapping.columns) });
  }

  // Encounters: pvsPatientId + pvsEncounterId + completedAt required.
  if (
    resolved.pvsPatientId &&
    resolved.pvsEncounterId &&
    resolved.completedAt
  ) {
    const mapping: CsvMapping = {
      stream: "encounters",
      columns: {
        pvsPatientId: resolved.pvsPatientId,
        pvsEncounterId: resolved.pvsEncounterId,
        pvsAppointmentId: resolved.pvsAppointmentId,
        completedAt: resolved.completedAt,
        treatmentCode: resolved.treatmentCode,
        treatmentLabel: resolved.treatmentLabel,
        practitionerLabel: resolved.practitionerLabel,
      },
      dateFormat: "DD.MM.YYYY",
    };
    candidates.push({ mapping, score: countMatched(mapping.columns) });
  }

  // Recalls: pvsPatientId + pvsRecallId + recallAt required.
  if (resolved.pvsPatientId && resolved.pvsRecallId && resolved.recallAt) {
    const mapping: CsvMapping = {
      stream: "recalls",
      columns: {
        pvsPatientId: resolved.pvsPatientId,
        pvsRecallId: resolved.pvsRecallId,
        recallAt: resolved.recallAt,
        treatmentCode: resolved.treatmentCode,
        treatmentLabel: resolved.treatmentLabel,
      },
      dateFormat: "DD.MM.YYYY",
    };
    candidates.push({ mapping, score: countMatched(mapping.columns) });
  }

  // Invoices: pvsPatientId + pvsInvoiceId + amount + paidAt required.
  if (
    resolved.pvsPatientId &&
    resolved.pvsInvoiceId &&
    resolved.amount &&
    resolved.paidAt
  ) {
    const mapping: CsvMapping = {
      stream: "invoices",
      columns: {
        pvsPatientId: resolved.pvsPatientId,
        pvsInvoiceId: resolved.pvsInvoiceId,
        pvsAppointmentId: resolved.pvsAppointmentId,
        pvsEncounterId: resolved.pvsEncounterId,
        amount: resolved.amount,
        paidAt: resolved.paidAt,
        statusColumn: resolved.invoiceStatus,
      },
      dateFormat: "DD.MM.YYYY",
      amountUnit: "eur",
      decimalSeparator: ",",
      amountScope: amountScope ?? "row",
    };
    candidates.push({ mapping, score: countMatched(mapping.columns) });
  }

  if (candidates.length === 0) return null;
  // Highest score wins. On a tie the earlier-pushed candidate wins, which
  // matches our intentional ordering: patients before appointments before
  // encounters before recalls before invoices (most-specific last so it
  // is preferred via the explicit-discriminator-column check above, not
  // here).
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].mapping;
}

function countMatched(columns: Record<string, string | undefined>): number {
  let n = 0;
  for (const v of Object.values(columns)) {
    if (v) n++;
  }
  return n;
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function pluckColumns<T extends Record<string, string | undefined>>(
  row: Record<string, string>,
  mapping: T
): Record<keyof T, string | null> {
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

function parseDate(
  input: string,
  format: CommonOpts["dateFormat"],
  kind: "dob" | "event" = "event"
): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // M-P5: each branch validates SHAPE, then real CALENDAR validity below. The
  // old code was shape-only, so "99.99.2026" produced "2026-99-99" and shipped
  // downstream to fail far from the source. Invalid calendar dates now return
  // null and are treated like any unparseable date (skip/null per the caller).
  let year: number;
  let month: number;
  let day: number;
  if (format === "YYYY-MM-DD") {
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if (format === "DD.MM.YYYY") {
    // D.M.YYYY, DD.MM.YY (-> 20YY) and YYYY-MM-DD are all accepted.
    const flex = parseFlexibleDateParts(trimmed, kind);
    if (!flex || flex.hour !== undefined) return null;
    day = flex.day;
    month = flex.month;
    year = flex.year;
  } else if (format === "MM/DD/YYYY") {
    const m = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    month = Number(m[1]);
    day = Number(m[2]);
    year = Number(m[3]);
  } else {
    return null;
  }
  if (!isValidCalendarDate(year, month, day)) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * M-P5: true when (year, month, day) is a real calendar date. Month 1-12 and
 * day within the month's length, accounting for leap years. Rejects the
 * shape-valid but impossible dates ("99.99.2026", "31.02.2026") that the
 * shape-only regex used to accept.
 */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [
    31,
    isLeap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function parseDateTime(
  input: string | null,
  format: CommonOpts["dateFormat"]
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (format === "ISO_DATETIME") {
    return parseIsoDateTime(trimmed);
  }
  // Many PVS exports of "datetime" fields include the time as
  // "DD.MM.YYYY HH:MM" or "DD.MM.YYYY HH:MM:SS". Strip the time and
  // pin to UTC midnight; the portal worker only uses date semantics.
  const datePart = trimmed.split(/\s+/)[0];
  const date = parseDate(datePart, format);
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

/** IANA zone the PVS-exported wall-clock datetimes are stamped in (L7). */
const PVS_WALL_TIME_ZONE = "Europe/Berlin";

/**
 * Parse an ISO_DATETIME cell into an ISO-8601 UTC instant with an EXPLICIT,
 * machine-TZ-independent interpretation (L7).
 *
 * The old code called `new Date(isoString).toISOString()`. For a string WITHOUT
 * an offset, the JS Date constructor interprets a date+time value in the host
 * machine's local zone but a date-only value in UTC, so the same export
 * produced different instants depending on the workstation's TZ setting. German
 * PVS export offset-less wall-clock time, which in practice is Europe/Berlin.
 * We therefore:
 *   - respect an explicit offset (Z or ±HH:MM) when present;
 *   - interpret an offset-less date+time as Europe/Berlin wall time;
 *   - pin an offset-less date-only value to UTC midnight (date semantics,
 *     matching the DD.MM.YYYY path).
 * Under Europe/Berlin the output equals the previous behaviour; the difference
 * is that it is now the SAME on every machine.
 */
function parseIsoDateTime(s: string): string | null {
  // Explicit offset present (trailing Z or ±HH:MM / ±HHMM): trust the instant.
  if (/(?:z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Offset-less date + time: interpret as Europe/Berlin wall time.
  const dt = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (dt) {
    const [, y, mo, d, h, mi, se] = dt;
    if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return null;
    return wallTimeToUtcIso(
      PVS_WALL_TIME_ZONE,
      Number(y),
      Number(mo),
      Number(d),
      Number(h),
      Number(mi),
      se ? Number(se) : 0
    );
  }
  // Offset-less date only: date semantics, pin to UTC midnight.
  const dOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dOnly) {
    const [, y, mo, d] = dOnly;
    if (!isValidCalendarDate(Number(y), Number(mo), Number(d))) return null;
    return `${y}-${mo}-${d}T00:00:00.000Z`;
  }
  // Anything else: last-resort parse, still explicit (no silent local-TZ
  // datetime interpretation reaches here because the date+time shape is handled
  // above).
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Convert a wall-clock date/time in an IANA zone to an ISO-8601 UTC instant,
 * DST-correct, without a date library. Computes the zone's UTC offset for the
 * given instant via Intl and subtracts it. Accurate outside the ~1h DST-gap
 * window, which does not matter for PVS appointment/invoice timestamps.
 */
function wallTimeToUtcIso(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): string {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMin = zoneOffsetMinutes(timeZone, naiveUtcMs);
  return new Date(naiveUtcMs - offsetMin * 60_000).toISOString();
}

/** UTC offset (minutes, east-positive) of `timeZone` at the given instant. */
function zoneOffsetMinutes(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string): number =>
    Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines render midnight as 24
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour,
    get("minute"),
    get("second")
  );
  return Math.round((asIfUtc - utcMs) / 60_000);
}

interface FlexDateParts {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  /** Explicit UTC offset in minutes (east-positive) when the input carried one. */
  offsetMinutes?: number;
}

/**
 * Parse the date notations German exports use:
 *   DD.MM.YYYY, D.M.YYYY, DD-MM-YYYY, DD/MM/YYYY, DD.MM.YY, YYYY-MM-DD,
 * each optionally followed by a time (separated by space, "T" or ", "):
 *   HH:MM, HH:MM:SS, HH:MM:SS.fff, optionally + "Uhr" or an explicit offset
 *   (Z, +02:00, +0200, +02).
 * Returns null for any other shape or an impossible calendar date (31.02.).
 *
 * Two-digit years: invoice / event dates are 20YY. For a date of birth
 * (kind "dob") a two-digit year greater than the current year's last two
 * digits is 19YY (15.03.65 -> 1965), otherwise 20YY.
 */
function parseFlexibleDateParts(
  input: string,
  kind: "dob" | "event" = "event"
): FlexDateParts | null {
  const t = input.trim();
  let year: number;
  let month: number;
  let day: number;
  let rest: string;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?=$|[\sT])(.*)$/.exec(t);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
    rest = m[4];
  } else {
    m = /^(\d{1,2})([.\-/])(\d{1,2})\2(\d{4}|\d{2})(?=$|[\s,T])(.*)$/.exec(t);
    if (!m) return null;
    day = Number(m[1]);
    month = Number(m[3]);
    if (m[4].length === 2) {
      const yy = Number(m[4]);
      const pivot = new Date().getFullYear() % 100;
      year = kind === "dob" && yy > pivot ? 1900 + yy : 2000 + yy;
    } else {
      year = Number(m[4]);
    }
    rest = m[5];
  }
  if (!isValidCalendarDate(year, month, day)) return null;
  rest = rest.replace(/^[\s,T]+/, "").trim();
  if (!rest) return { year, month, day };
  const tm =
    /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,]\d+)?)?\s*(?:uhr)?\s*(z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(
      rest
    );
  if (!tm) return null;
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const second = tm[3] ? Number(tm[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  let offsetMinutes: number | undefined;
  if (tm[4]) {
    if (tm[4].toLowerCase() === "z") {
      offsetMinutes = 0;
    } else {
      const om = /^([+-])(\d{2}):?(\d{2})?$/.exec(tm[4]);
      if (!om) return null;
      const oh = Number(om[2]);
      const omin = om[3] ? Number(om[3]) : 0;
      if (oh > 14 || omin > 59) return null;
      offsetMinutes = (om[1] === "-" ? -1 : 1) * (oh * 60 + omin);
    }
  }
  return { year, month, day, hour, minute, second, offsetMinutes };
}

/**
 * Invoice paidAt -> UTC ISO instant. A date WITHOUT time is anchored at 12:00
 * Berlin (berlinDateToUtcIso); a date WITH time is read as Berlin wall clock,
 * unless it carries an explicit offset / Z, in which case that instant is
 * used. Explicit ISO_DATETIME / MM/DD/YYYY mappings keep their dedicated
 * parsers. Excel serial day numbers are NOT accepted (a per-cell parser cannot
 * know that the whole column uses them).
 */
function parseInvoiceInstant(
  input: string,
  format: CommonOpts["dateFormat"]
): string | null {
  if (format === "ISO_DATETIME" || format === "MM/DD/YYYY") {
    const legacy = parseDateTime(input, format);
    return legacy;
  }
  const p = parseFlexibleDateParts(input);
  if (!p) return null;
  if (p.hour !== undefined && p.offsetMinutes !== undefined) {
    const ms =
      Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute ?? 0, p.second ?? 0) -
      p.offsetMinutes * 60_000;
    return new Date(ms).toISOString();
  }
  const iso =
    p.hour === undefined
      ? berlinDateToUtcIso(p.year, p.month, p.day)
      : berlinWallClockToUtcIso(
          p.year,
          p.month,
          p.day,
          p.hour,
          p.minute ?? 0,
          p.second ?? 0
        );
  return iso ?? null;
}

// Plausibility counter (H3). A single-invoice amount outside 0 < x <= 100_000
// EUR is logged with a running count but NOT dropped: the value could be a
// legitimate large procedure, and dropping it would silently understate
// revenue. The count lets the operator spot a systematic locale/parse defect.
let implausibleAmountCount = 0;

function guardPlausibleCents(cents: number): number {
  const abs = Math.abs(cents);
  if (abs === 0 || abs > 100_000 * 100) {
    implausibleAmountCount++;
    // Never log the cell value (patient-adjacent data): the running count is
    // what lets the operator spot a systematic locale/parse defect.
    console.warn(
      `[csv-mapper] implausible invoice amount (expected 0 < x <= 100000 EUR); count=${implausibleAmountCount}`
    );
  }
  return cents;
}

/**
 * Parse a CSV amount cell into SIGNED integer cents.
 *
 * Accepted notations (all common in German exports):
 *   120,00   -120,00   120,00-   (120,00)   −120,00 (U+2212)   120,00 EUR
 *   EUR 120,00   € 120,00   120,00 €   1 234,50 (NBSP / thin-space grouping)
 * A trailing minus or parentheses mean negative (Storno / Gutschrift).
 *
 * Locale rule (H3): last-separator-wins, replicated from db-adapters/
 * normalizer.ts's normaliseDecimalString. The old code trusted the configured
 * `decimalSeparator` blindly and mis-parsed dot-decimal input ("1,250.00" ->
 * 125 cents instead of 125000). We now decide the decimal separator from the
 * string itself. The configured separator is no longer consulted for the EUR
 * path; a lone separator + exactly three trailing digits is a thousands group.
 *
 * `unit === "cents"` still means the value is already integer cents (after
 * stripping grouping): "35000" -> 35000 cents.
 */
function parseAmountToCents(
  input: string,
  unit: "cents" | "eur"
): number | null {
  // JS \s covers NBSP (U+00A0), thin space (U+2009) and narrow NBSP (U+202F).
  let cleaned = input
    .replace(/[−‒–—]/g, "-")
    .replace(/[€\s]/g, "")
    .replace(/EUR/gi, "");
  let negative = false;
  const paren = /^\((.*)\)$/.exec(cleaned);
  if (paren) {
    negative = true;
    cleaned = paren[1];
  }
  if (cleaned.endsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(0, -1);
  }
  if (cleaned.startsWith("-")) {
    negative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }
  // Only digits and one kind of grouping/decimal separator may remain.
  if (!cleaned || !/^[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;

  const normalised = normaliseDecimalString(cleaned);
  if (normalised === undefined) return null;
  const num = Number(normalised);
  if (!Number.isFinite(num)) return null;

  const magnitude = unit === "cents" ? Math.round(num) : Math.round(num * 100);
  const signed = negative ? -magnitude : magnitude;
  return guardPlausibleCents(signed);
}

/**
 * Turn a localized money string (unsigned) into a plain JS-number string.
 * Replicated from apps/bridge/agent/src/db-adapters/normalizer.ts's
 * normaliseDecimalString (kept in sync by contract, not imported: the pkg-
 * bundled agent keeps these small modules self-contained).
 *
 *   "1.234"    -> "1234"     (lone separator + 3 digits -> thousands group)
 *   "1,250"    -> "1250"     (same rule -> 1250 EUR, not 1.25)
 *   "1.50"     -> "1.50"     (<=2 trailing digits -> decimal)
 *   "1234,5"   -> "1234.5"
 *   "1.234,56" -> "1234.56"  (two separator types -> the LAST is the decimal)
 *   "1,250.00" -> "1250.00"
 */
function normaliseDecimalString(s: string): string | undefined {
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  }

  const sep = hasComma ? "," : hasDot ? "." : "";
  if (sep === "") return s;

  const parts = s.split(sep);
  if (parts.length > 2) return parts.join("");
  const trailing = parts[1] ?? "";
  return trailing.length === 3 ? parts[0] + trailing : `${parts[0]}.${trailing}`;
}

export type InvoiceStatusClass = "paid" | "open" | "storno" | "unknown";

/** Lowercase, umlaut-folded (ä->ae, ö->oe, ü->ue, ß->ss), whitespace-collapsed. */
function foldStatus(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Classify a Zahlstatus cell of a German PVS export.
 *
 * Precedence: storno, then open (including the negation forms "nicht bezahlt",
 * "unbezahlt" which would otherwise match the paid token), then paid. Only a
 * recognized paid token books revenue; empty or unrecognized values are
 * "unknown" and treated as not paid by the caller (H2). Single letters match
 * only when they are the WHOLE token: B = bezahlt, O = offen, S = storno.
 * Teilzahlung / teilweise bezahlt classify as paid: each such row carries its
 * own paid amount and the per-invoice aggregation sums them.
 */
export function classifyInvoiceStatus(
  raw: string | null | undefined
): InvoiceStatusClass {
  if (!raw) return "unknown";
  const v = foldStatus(raw);
  if (!v) return "unknown";
  if (v === "s") return "storno";
  if (v === "b") return "paid";
  if (v === "o") return "open";
  if (/^(storn|gutschr|gutgeschr)/.test(v)) return "storno";
  // Negations first: they contain the paid tokens as a substring.
  if (
    /^(un(bezahlt|beglichen|gezahlt|ausgeglichen|erledigt)|(noch )?nicht\b|kein\b)/.test(
      v
    ) ||
    /\bnicht (bezahlt|beglichen|gezahlt|ausgeglichen|erledigt)/.test(v)
  ) {
    return "open";
  }
  if (
    /^(offen|ausstehend|faellig|ueberfaellig|uberfaellig|uberfallig|gemahnt|mahn|zahlung (offen|ausstehend|erwartet)|nein$|no$|false$|falsch$|0$)/.test(
      v
    )
  ) {
    return "open";
  }
  if (
    /^((komplett|voll|vollstaendig|teilweise|teil) ?)?(bezahlt|beglichen|gezahlt|ausgeglichen)(?![a-z])/.test(
      v
    ) ||
    /^(erledigt|teilzahlung|paid|settled|ja$|yes$|1$|true$|wahr$|zahlung eingegangen|zahlungseingang|eingegangen)/.test(
      v
    )
  ) {
    return "paid";
  }
  return "unknown";
}

function isPaidInvoiceStatus(input: string | null): boolean {
  return classifyInvoiceStatus(input) === "paid";
}

/** Storniert / Storno / Stornierung / Gutschrift status (not revenue, not a refund). */
function isStornoInvoiceStatus(input: string | null): boolean {
  return classifyInvoiceStatus(input) === "storno";
}

function isEmail(v: string): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (trimmed.length > 200) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function normaliseGender(
  input: string | null
): "f" | "m" | "d" | "x" | undefined {
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
  if (["scheduled", "geplant", "terminiert", "offen", "open"].includes(v))
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
    ["cancelled", "canceled", "storniert", "abgesagt", "stornierung"].includes(v)
  )
    return "cancelled";
  return null;
}
