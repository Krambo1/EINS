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

import type { CanonicalEvent } from "./normalize.js";

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

function mapPatientRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "patients" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };

  const dob = v.dob ? parseDate(v.dob, m.dateFormat) : null;
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
    pvsExternalEventId: `csv-local:patient:${v.pvsPatientId}`,
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
    pvsExternalEventId: `csv-local:appointment:${v.pvsAppointmentId}`,
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
    pvsExternalEventId: `csv-local:encounter:${v.pvsEncounterId}`,
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
    pvsExternalEventId: `csv-local:recall:${v.pvsRecallId}`,
    occurredAt: recallAt,
    pvsPatientId: v.pvsPatientId,
    pvsRecallId: v.pvsRecallId,
    recallAt,
    treatmentCode: v.treatmentCode ?? undefined,
    treatmentLabel: v.treatmentLabel ?? undefined,
  };
  return { ok: true, events: [event] };
}

function mapInvoiceRow(
  ctx: CsvMapRowContext,
  m: Extract<CsvMapping, { stream: "invoices" }>
): CsvMapRowResult {
  const v = pluckColumns(ctx.row, m.columns);
  if (!v.pvsPatientId) return { ok: false, reason: "missing pvsPatientId" };
  if (!v.pvsInvoiceId) return { ok: false, reason: "missing pvsInvoiceId" };
  if (!v.amount) return { ok: false, reason: "missing amount" };
  if (!v.paidAt) return { ok: false, reason: "missing paidAt" };

  const paidAt = parseDateTime(v.paidAt, m.dateFormat);
  if (!paidAt) return { ok: false, reason: `invalid paidAt: ${v.paidAt}` };

  const amountCents = parseAmountToCents(v.amount, m.amountUnit);
  if (amountCents === null) {
    return { ok: false, reason: `invalid amount: ${v.amount}` };
  }

  // H1: negative amounts are Stornobuchungen. Map them to InvoiceRefunded with
  // the absolute magnitude and a dedicated id namespace (csv-local:invoice-
  // refund:) so a refund can never collide with the paid event of the same
  // invoice. This happens BEFORE the status gate: a storniert row with a
  // negative amount is still a real refund.
  if (amountCents < 0) {
    const refund: CanonicalEvent = {
      kind: "InvoiceRefunded",
      clinicId: ctx.clinicId,
      bridgeSource: "gdt_agent",
      pvsExternalEventId: `csv-local:invoice-refund:${v.pvsInvoiceId}`,
      occurredAt: paidAt,
      pvsPatientId: v.pvsPatientId,
      pvsInvoiceId: v.pvsInvoiceId,
      pvsAppointmentId: v.pvsAppointmentId ?? undefined,
      refundedAmountCents: Math.abs(amountCents),
      currency: "EUR",
      refundedAt: paidAt,
    };
    return { ok: true, events: [refund] };
  }

  // H2: when a Zahlstatus column is mapped, a positive row only counts as
  // revenue if the status reads as paid. Open / storniert / unknown rows are
  // skipped with a distinct, counted reason (the watcher tallies skips and
  // logs the first few). Without a status column, behavior is unchanged: the
  // row is booked as paid.
  if (m.columns.statusColumn) {
    if (!isPaidInvoiceStatus(v.statusColumn)) {
      return {
        ok: false,
        reason: `invoice not paid (status=${v.statusColumn ?? "<empty>"}); skipped`,
      };
    }
  }

  const event: CanonicalEvent = {
    kind: "InvoicePaid",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `csv-local:invoice:${v.pvsInvoiceId}`,
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
// Auto-detection across all five streams
// ---------------------------------------------------------------

/**
 * Aliases for canonical field names. Each list is checked against trimmed
 * headers; first match wins. Order = priority (more-specific first).
 */
const ALIASES: Record<string, RegExp[]> = {
  pvsPatientId: [
    /^pat(ient)?[\s\-_.]*nr\.?$/i,
    /^pat(ient)?ennummer$/i,
    /^patid$/i,
    /^patient$/i,
    /^kundennr\.?$/i,
  ],
  pvsInvoiceId: [
    /^rech(nung)?s?[\s\-_.]*nr\.?$/i,
    /^rechnungsnummer$/i,
    /^belegnummer$/i,
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
  amount: [
    /^endbetrag$/i,
    /^rechnungsbetrag$/i,
    /^gesamtbetrag$/i,
    /^betrag$/i,
    /^summe$/i,
    /^honorar$/i,
    /^gesamt$/i,
  ],
  paidAt: [
    // H2: `rechnungsdatum` (and other invoice-DATE aliases) are intentionally
    // NOT here. A PVS that exports offen + bezahlt invoices with only a
    // Rechnungsdatum would otherwise book every open invoice as paid revenue.
    // Rechnungsdatum may still serve as paidAt via an EXPLICIT operator column
    // mapping (mapping.columns.paidAt = "Rechnungsdatum"), which bypasses this
    // auto-detection table entirely.
    /^bezahl[t]?[\s\-_.]*(am|datum)?$/i,
    /^zahldatum$/i,
    /^zahlungsdatum$/i,
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

function resolveField(
  headers: string[],
  field: string
): string | undefined {
  const patterns = ALIASES[field];
  if (!patterns) return undefined;
  for (const header of headers) {
    const norm = header.trim();
    if (patterns.some((re) => re.test(norm))) return header;
  }
  return undefined;
}

/**
 * Resolve every alias-known field present in the headers. Used by the
 * stream-picker (which counts matched fields per stream) and by the
 * per-stream mapping builder.
 */
function resolveAllFields(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of Object.keys(ALIASES)) {
    const header = resolveField(headers, field);
    if (header) out[field] = header;
  }
  return out;
}

/**
 * Auto-detect the stream and produce a mapping from header inspection
 * alone. Picks the stream whose required fields are fully matched and
 * whose total matched-field count (required + optional) is the highest.
 * Returns null if no stream has all required fields.
 */
export function autoDetectMapping(headers: string[]): CsvMapping | null {
  const resolved = resolveAllFields(headers);

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

function parseDate(input: string, format: CommonOpts["dateFormat"]): string | null {
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
    const m = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
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

// Plausibility counter (H3). A single-invoice amount outside 0 < x <= 100_000
// EUR is logged with a running count but NOT dropped: the value could be a
// legitimate large procedure, and dropping it would silently understate
// revenue. The count lets the operator spot a systematic locale/parse defect.
let implausibleAmountCount = 0;

function guardPlausibleCents(cents: number, raw: string): number {
  const abs = Math.abs(cents);
  if (abs === 0 || abs > 100_000 * 100) {
    implausibleAmountCount++;
    console.warn(
      `[csv-mapper] implausible invoice amount ${JSON.stringify(raw)} -> ${cents} cents ` +
        `(expected 0 < x <= 100000 EUR); count=${implausibleAmountCount}`
    );
  }
  return cents;
}

/**
 * Parse a CSV amount cell into SIGNED integer cents.
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
  const cleaned = input.replace(/[€\s]/g, "").replace(/EUR/gi, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[-+]/, "");
  const normalised = normaliseDecimalString(unsigned);
  if (normalised === undefined) return null;
  const num = Number(normalised);
  if (!Number.isFinite(num)) return null;

  const magnitude = unit === "cents" ? Math.round(num) : Math.round(num * 100);
  const signed = negative ? -magnitude : magnitude;
  return guardPlausibleCents(signed, input);
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

/**
 * Is an invoice Zahlstatus value one that means "paid"? Case-insensitive.
 * Only a recognized paid token books revenue; empty, open, storniert, or an
 * unknown token is treated as not-paid so an "export all invoices" file
 * cannot inflate revenue (H2).
 */
function isPaidInvoiceStatus(input: string | null): boolean {
  if (!input) return false;
  const v = input.trim().toLowerCase();
  return [
    "bezahlt",
    "beglichen",
    "gezahlt",
    "paid",
    "settled",
    "ja",
    "yes",
    "1",
    "true",
    "wahr",
  ].includes(v);
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
