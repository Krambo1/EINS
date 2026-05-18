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
      };
    });

export interface CsvMapRowContext {
  clinicId: string;
  /** Stable identifier for the source file. Used inside the dedup key
   *  only as a *fallback* when a row's natural key (pvsInvoiceId,
   *  pvsAppointmentId, ...) is missing. */
  fileHash: string;
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

  // If the CSV splits name into first + last columns, recombine.
  const fullName =
    v.fullName ??
    ([v.firstName, v.lastName].filter(Boolean).join(" ") || null);

  const email = v.email && isEmail(v.email) ? v.email.toLowerCase() : undefined;

  const event: CanonicalEvent = {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `csv-local:patient:${v.pvsPatientId}`,
    occurredAt: new Date().toISOString(),
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

  const amountCents = parseAmountToCents(
    v.amount,
    m.amountUnit,
    m.decimalSeparator
  );
  if (amountCents === null) {
    return { ok: false, reason: `invalid amount: ${v.amount}` };
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
    /^bezahl[t]?[\s\-_.]*(am|datum)?$/i,
    /^zahldatum$/i,
    /^rechnungsdatum$/i,
    /^paid[\s\-_.]*at$/i,
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

function parseDateTime(
  input: string | null,
  format: CommonOpts["dateFormat"]
): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (format === "ISO_DATETIME") {
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  // Many PVS exports of "datetime" fields include the time as
  // "DD.MM.YYYY HH:MM" or "DD.MM.YYYY HH:MM:SS". Strip the time and
  // pin to UTC midnight; the portal worker only uses date semantics.
  const datePart = trimmed.split(/\s+/)[0];
  const date = parseDate(datePart, format);
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

function parseAmountToCents(
  input: string,
  unit: "cents" | "eur",
  decimalSeparator: "." | ","
): number | null {
  const cleaned = input
    .replace(/[€\s]/g, "")
    .replace(/EUR/gi, "")
    .replace(decimalSeparator === "," ? /\./g : /,/g, "");
  const num = Number(
    decimalSeparator === ","
      ? cleaned.replace(",", ".")
      : cleaned
  );
  if (!Number.isFinite(num) || num < 0) return null;
  if (unit === "cents") return Math.round(num);
  return Math.round(num * 100);
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
