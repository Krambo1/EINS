import {
  pickFirst,
  pickAll,
  type GdtParseResult,
  type GdtRecord,
  type GdtSatz,
} from "./gdt-parser.js";

/**
 * GDT → canonical event translator. Translates PER SATZ (C2): a plain GDT
 * file carries one Satz; a BDT batch export carries one per patient, and
 * flattening them would merge every patient into patient #1 and sum every
 * Honorar line into a single invoice. Per Satz, returns 1..N events
 * depending on the Satzart:
 *
 *   6301 (Patient export):              → PatientUpserted
 *   6310 (New patient registration):    → PatientUpserted
 *   8316 (Treatment record incl. data): → PatientUpserted + EncounterCompleted
 *                                         (+ InvoicePaid if Honorar-FKs are present)
 *   6200 (Befund / treatment):          → EncounterCompleted
 *
 * Returns an empty array for Satzarten we don't translate (clinical lab
 * data, prescriptions, etc.).
 *
 * Contact-data and Honorar-FK extraction is opportunistic: GDT 2.x does
 * not standardise email / phone / billing fields; each PVS picks its own
 * subset. We extract the broadest common set (medatixx, Albis, T2Med,
 * DURIA, S3) and fall back gracefully when fields are absent.
 *
 * NOTE: canonical event types here are duplicated from apps/bridge/src/
 * canonical/types.ts to keep the agent buildable independently. Keep in
 * sync when the canonical schema evolves.
 */

export interface CanonicalEvent {
  kind:
    | "PatientUpserted"
    | "AppointmentCreated"
    | "AppointmentStatusChanged"
    | "AppointmentCancelled"
    | "EncounterCompleted"
    | "InvoicePaid"
    | "InvoiceRefunded"
    | "RecallScheduled";
  clinicId: string;
  bridgeSource: "gdt_agent";
  pvsExternalEventId: string;
  occurredAt: string;
  [k: string]: unknown;
}

export interface NormalizeContext {
  clinicId: string;
  contentHash: string;
  /**
   * ISO-8601 UTC modification time of the source GDT/BDT file, supplied by the
   * watcher. Used as the deterministic occurredAt fallback for records that
   * carry no business date (a plain 6301/6310 patient export has no treatment
   * or invoice date). The file mtime is stable across re-reads of the same
   * file, so re-processing after watcher-state loss produces byte-identical
   * events and the portal's unique index dedups them (H4).
   *
   * Optional for back-compat: older watcher wiring does not set it. When it is
   * absent, gdtToCanonical stamps a single wall-clock timestamp for the whole
   * file (see below) so events still carry a valid occurredAt, but that path
   * cannot dedup across re-reads. Wiring the watcher to pass the real mtime is
   * the one-line follow-up that closes the gap.
   */
  fileModifiedAtIso?: string;
}

// M-P6 / M-P7: rate-limited counters for records dropped rather than
// fabricated or wall-clock-stamped. We log the first few occurrences with the
// running count, then go quiet so a systematically malformed export cannot
// flood the Praxis-workstation log, while the counter keeps climbing for ops
// visibility.
let droppedNoPatientIdCount = 0;
let unparseableInvoiceDateCount = 0;
const RATE_LIMIT_LOG_UNTIL = 5;

function noteDroppedNoPatientId(satzart: string, contentHash: string): void {
  droppedNoPatientIdCount++;
  if (droppedNoPatientIdCount <= RATE_LIMIT_LOG_UNTIL) {
    console.warn(
      `[normalize] Satz (satzart=${satzart}) has no patient FK 3000; event(s) dropped ` +
        `instead of fabricating a phantom patient. count=${droppedNoPatientIdCount} ` +
        `hash=${contentHash.slice(0, 12)}`
    );
  }
}

function noteUnparseableInvoiceDate(raw: string, contentHash: string): void {
  unparseableInvoiceDateCount++;
  if (unparseableInvoiceDateCount <= RATE_LIMIT_LOG_UNTIL) {
    console.warn(
      `[normalize] invoice date ${JSON.stringify(raw)} is unparseable; invoice event ` +
        `skipped instead of falling back to the wall clock. ` +
        `count=${unparseableInvoiceDateCount} hash=${contentHash.slice(0, 12)}`
    );
  }
}

export function gdtToCanonical(
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent[] {
  const saetze = parsed.saetze;
  if (saetze.length === 0) return [];
  // Resolve the file-mtime fallback ONCE, at the translator entry, so no
  // per-event normalizer reaches for the wall clock (that is what re-opened
  // the H4 duplicate-ingestion gap). When the watcher passes fileModifiedAtIso
  // the result is fully deterministic; when it does not, every date-less
  // record in this file shares the single timestamp stamped here.
  const resolved: NormalizeContext = {
    ...ctx,
    fileModifiedAtIso: ctx.fileModifiedAtIso ?? new Date().toISOString(),
  };
  if (saetze.length === 1) {
    // Single-Satz file: keep the historical event ids (plain contentHash
    // suffix) so re-processing files already ingested before the multi-Satz
    // fix dedups instead of double-emitting.
    return satzToCanonical(saetze[0], resolved);
  }
  // Multi-Satz (BDT batch): scope the contentHash per Satz so two Sätze for
  // the same patient in one file cannot collide on the same event id.
  const events: CanonicalEvent[] = [];
  saetze.forEach((satz, i) => {
    events.push(
      ...satzToCanonical(satz, {
        clinicId: resolved.clinicId,
        contentHash: `${resolved.contentHash}:s${i}`,
        fileModifiedAtIso: resolved.fileModifiedAtIso,
      })
    );
  });
  return events;
}

function satzToCanonical(
  satz: GdtSatz,
  ctx: NormalizeContext
): CanonicalEvent[] {
  // Only these Satzarten translate to canonical events; everything else
  // (Praxis header Sätze, lab data, prescriptions, ...) yields nothing and is
  // NOT expected to carry a patient FK 3000, so it must not warn below.
  const TRANSLATED = ["6301", "6310", "8316", "6200"];
  if (!TRANSLATED.includes(satz.satzart)) return [];
  // M-P6: a translated Satz with no patient FK 3000 cannot produce a real
  // patient, encounter, or invoice. The old code fabricated a phantom patient
  // id (`unknown:<contentHash>`) that polluted the patient table with one ghost
  // per malformed file. Drop the whole Satz and count it instead.
  if (!pickFirst(satz.records, "3000")) {
    noteDroppedNoPatientId(satz.satzart, ctx.contentHash);
    return [];
  }
  switch (satz.satzart) {
    case "6301":
    case "6310":
      return [patientFromGdt(satz.records, ctx)];
    case "8316": {
      const events: CanonicalEvent[] = [
        patientFromGdt(satz.records, ctx),
        encounterFromGdt(satz.records, ctx),
      ];
      const invoice = invoiceFromGdt(satz.records, ctx);
      if (invoice) events.push(invoice);
      return events;
    }
    case "6200": {
      const events: CanonicalEvent[] = [encounterFromGdt(satz.records, ctx)];
      const invoice = invoiceFromGdt(satz.records, ctx);
      if (invoice) events.push(invoice);
      return events;
    }
    default:
      return [];
  }
}

function patientFromGdt(
  fks: GdtRecord[],
  ctx: NormalizeContext
): CanonicalEvent {
  // M-P6: FK 3000 presence is guaranteed by the satzToCanonical guard; no
  // phantom `unknown:<hash>` fallback here.
  const pvsPatientId = pickFirst(fks, "3000") as string;
  const lastName = pickFirst(fks, "3101");
  const firstName = pickFirst(fks, "3102");
  const dob = formatGdtDate(pickFirst(fks, "3103"));
  const gender = mapGender(pickFirst(fks, "3110"));
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
  const bemerkung = collectBemerkung(fks);
  const email = pickEmail(fks);
  const phone = pickPhone(fks);
  // occurredAt must be deterministic given the same file (H4). The patient
  // event id already keys on the stable contentHash, so the id never changes;
  // only occurredAt participates in the portal dedup index alongside it. Prefer
  // a business date carried by the Satz (an 8316 treatment record has one); a
  // plain 6301/6310 export has none, so fall back to the file mtime from ctx.
  const occurredAt =
    stableRecordDate(fks) ?? (ctx.fileModifiedAtIso as string);
  return {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `gdt:patient:${pvsPatientId}:${ctx.contentHash}`,
    occurredAt,
    pvsPatientId,
    fullName,
    dob,
    gender,
    email,
    phone,
    bemerkung,
  };
}

function encounterFromGdt(
  fks: GdtRecord[],
  ctx: NormalizeContext
): CanonicalEvent {
  const pvsPatientId = pickFirst(fks, "3000") as string; // M-P6: guarded upstream
  // 6200 = Befund: derive occurredAt from the record's own date (FK 6200 /
  // 8431). When the record carries no date, fall back to the deterministic file
  // mtime from ctx, never the wall clock: a wall-clock occurredAt makes the
  // event un-dedupable on re-processing after watcher-state loss (H4).
  const dateRaw =
    pickFirst(fks, "6200") ?? pickFirst(fks, "8431") ?? undefined;
  const occurredAt =
    formatGdtDateTime(dateRaw) ?? (ctx.fileModifiedAtIso as string);
  const encId = `gdt:enc:${pvsPatientId}:${ctx.contentHash}`;
  return {
    kind: "EncounterCompleted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: encId,
    occurredAt,
    pvsPatientId,
    pvsEncounterId: encId,
    completedAt: occurredAt,
    treatmentCode: pickFirst(fks, "8410"),
    treatmentLabel: pickFirst(fks, "8411"),
  };
}

/**
 * Emit an InvoicePaid event from an "extended GDT" record if Honorar-FKs
 * are present.
 *
 * GDT 2.x has no formally standardised Honorar block; the most common
 * convention (and the one medatixx-Abrechnungs-GDT follows when activated
 * by support) packs the billing data into the same 8316/6200 record:
 *
 *   FK 6225 — Rechnungs-Nr.
 *   FK 6228 — Rechnungsdatum / Zahldatum
 *   FK 8410 — Honorar-Position (Ziffer GOÄ/EBM/IGeL)
 *   FK 8411 — Bezeichnung
 *   FK 8420 — Endbetrag (vendor-specific format: "12,50", "1250", "EUR 12,50")
 *   FK 8421 — Faktor
 *   FK 8422 — Punkte
 *
 * If multiple FK 8420 lines appear within one Satz, we sum them (medatixx
 * exports each Honorar-Position as a separate line; the invoice total is
 * the sum). Summing is strictly per Satz: in a BDT batch file every
 * patient's Satz gets its own invoice (C2).
 *
 * Returns null when no billing fields are present, so the caller can skip
 * the event entirely (this is the common case for non-Honorar GDT files).
 */
function invoiceFromGdt(
  fks: GdtRecord[],
  ctx: NormalizeContext
): CanonicalEvent | null {
  const pvsPatientId = pickFirst(fks, "3000") as string; // M-P6: guarded upstream
  const amountStrings = pickAll(fks, "8420");
  if (amountStrings.length === 0) return null;

  // Signed net of all Honorar-Positionen in this Satz. A negative net means
  // the Satz is a Storno / Gutschrift (medatixx Honorar exports carry
  // Stornobuchungen as negative FK 8420 lines); it must not be dropped as
  // parse noise but mapped to a refund (H1).
  const netCents = sumAmountsAsCents(amountStrings);
  if (netCents === null) return null;

  const invoiceNumber = pickFirst(fks, "6225");
  const pvsInvoiceId =
    invoiceNumber ?? `gdt-honorar:${pvsPatientId}:${ctx.contentHash}`;
  // M-P8: FK 6228 is dual-purpose (Zahldatum OR free-text Bemerkung). Treat it
  // as the payment date ONLY when the whole value is a strict GDT date; a
  // non-date 6228 is Bemerkung (see collectBemerkung) and must never drive
  // paidAt. FK 8431 (Untersuchungsdatum) and FK 6200 (Befunddatum) are
  // date-only fields.
  //
  // M-P7: never fall back to the wall clock for an UNPARSEABLE date. When a
  // date-only field is present but does not parse, skip the invoice event with
  // a counter: revenue landing in the wrong reporting period, plus a wall-clock
  // value in the occurredAt dedup field, is worse than a counted skip. Only a
  // genuinely date-LESS Satz falls back to the deterministic file mtime (H4).
  const date6228 = asStrictGdtDateTime(pickFirst(fks, "6228"));
  const raw8431 = pickFirst(fks, "8431");
  const raw6200 = pickFirst(fks, "6200");
  let paidAt: string;
  if (date6228) {
    paidAt = date6228;
  } else if (raw8431 !== undefined) {
    const parsed = formatGdtDateTime(raw8431);
    if (!parsed) {
      noteUnparseableInvoiceDate(raw8431, ctx.contentHash);
      return null;
    }
    paidAt = parsed;
  } else if (raw6200 !== undefined) {
    const parsed = formatGdtDateTime(raw6200);
    if (!parsed) {
      noteUnparseableInvoiceDate(raw6200, ctx.contentHash);
      return null;
    }
    paidAt = parsed;
  } else {
    paidAt = ctx.fileModifiedAtIso as string;
  }

  if (netCents < 0) {
    // Refund events get their OWN id namespace (gdt:inv-refund:) so a refund
    // can never collide with the paid event of the same invoice number.
    const refundId = invoiceNumber
      ? `gdt:inv-refund:${invoiceNumber}`
      : `gdt:inv-refund:${pvsInvoiceId}`;
    return {
      kind: "InvoiceRefunded",
      clinicId: ctx.clinicId,
      bridgeSource: "gdt_agent",
      pvsExternalEventId: refundId,
      occurredAt: paidAt,
      pvsPatientId,
      pvsInvoiceId,
      refundedAmountCents: Math.abs(netCents),
      currency: "EUR",
      refundedAt: paidAt,
    };
  }

  // Tie the invoice to the same encounter the file generated. The portal
  // worker uses pvsAppointmentId/pvsEncounterId to attribute revenue to a
  // request — without this the invoice would sit at the patient level only.
  const encounterId = `gdt:enc:${pvsPatientId}:${ctx.contentHash}`;
  // Dedup key prefers the real invoice number when present (stable across
  // re-exports of the same data); falls back to the content-hash-scoped
  // synthetic id when the PVS did not write FK 6225.
  const dedupId = invoiceNumber
    ? `gdt:inv:${invoiceNumber}`
    : `gdt:inv:${pvsInvoiceId}`;
  return {
    kind: "InvoicePaid",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: dedupId,
    occurredAt: paidAt,
    pvsPatientId,
    pvsInvoiceId,
    pvsEncounterId: encounterId,
    amountCents: netCents,
    currency: "EUR",
    paidAt,
  };
}

/**
 * Collect free-text bemerkung fields from a GDT record set. Concatenates
 * the patient-context remark fields so the portal's Stage-2 token linker
 * (parseLeadTokenFromBemerkung) can recover `EINS-Lead-{8hex}` regardless
 * of which FK the PVS chose to write into.
 *
 * Field selection is intentionally narrow — only fields explicitly named
 * "Bemerkung" in the GDT 2.x spec — so we don't leak clinical text
 * (Anamnese, Befund) into the bemerkung payload.
 */
function collectBemerkung(
  records: { feldKennung: string; value: string }[]
): string | undefined {
  const BEMERKUNG_FKS = ["3622", "6228", "8470"];
  const parts: string[] = [];
  for (const fk of BEMERKUNG_FKS) {
    for (const v of pickAll(records, fk)) {
      const trimmed = v.trim();
      if (!trimmed) continue;
      // M-P8: a 6228 value that is a strict date is the Zahldatum, not a
      // remark. Never let the same value feed both paidAt and bemerkung.
      if (fk === "6228" && asStrictGdtDateTime(trimmed)) continue;
      parts.push(trimmed);
    }
  }
  if (parts.length === 0) return undefined;
  // Schema caps bemerkung at 4000 chars; truncate defensively.
  const joined = parts.join(" ");
  return joined.length > 4000 ? joined.slice(0, 4000) : joined;
}

/**
 * Email extraction. GDT has no single canonical email FK; the spec
 * mentions FK 3617 (e-mail) but most PVS pack it into a generic contact
 * field. We probe the documented FKs first, then fall back to scanning
 * any FK whose value contains "@" and looks like a plausible address.
 */
function pickEmail(
  records: { feldKennung: string; value: string }[]
): string | undefined {
  const CANDIDATES = ["3617", "3628", "3618", "3614"];
  for (const fk of CANDIDATES) {
    const v = pickFirst(records, fk);
    if (v && isEmail(v)) return v.trim().toLowerCase();
  }
  // M-P8: last-resort fan-out for non-conformant PVS exports, but ONLY across
  // the patient personal-data block (FK 3xxx). GDT packs Praxis / sender /
  // laboratory identification into the 0xxx and 8xxx ranges; scanning those
  // risks capturing the Praxis's OWN email as the patient's. Restricting to
  // 3xxx keeps the fan-out inside the patient section while still recovering an
  // email a non-conformant PVS wrote into an undocumented 3xxx contact field.
  for (const r of records) {
    if (!r.feldKennung.startsWith("3")) continue;
    if (isEmail(r.value)) return r.value.trim().toLowerCase();
  }
  return undefined;
}

/**
 * Phone extraction. Prefers mobile (3628) > work (3627) > private (3626).
 * Some PVS also use FK 3613/3614 — we probe those as a fallback.
 */
function pickPhone(
  records: { feldKennung: string; value: string }[]
): string | undefined {
  const CANDIDATES = ["3628", "3627", "3626", "3613", "3614"];
  for (const fk of CANDIDATES) {
    const v = pickFirst(records, fk);
    if (v && isPhone(v)) return normalisePhone(v);
  }
  return undefined;
}

function isEmail(v: string): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (trimmed.length > 200) return false;
  // RFC-loose check: one @, dot in domain, no whitespace.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isPhone(v: string): boolean {
  if (!v) return false;
  const trimmed = v.trim();
  if (trimmed.length < 4 || trimmed.length > 64) return false;
  // Accept digits + common separators; reject anything else.
  if (!/^[\d+()\-\s/.]+$/.test(trimmed)) return false;
  // Must contain at least 4 digits to be a plausible phone number.
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 4;
}

function normalisePhone(v: string): string {
  return v.trim().replace(/\s{2,}/g, " ").slice(0, 64);
}

/**
 * Sum a list of GDT-amount strings into SIGNED integer cents. Tolerates both
 * comma-decimal ("12,50") and dot-decimal ("12.50"), with or without a
 * EUR / € prefix, and thousands separators. Negative lines (Stornobuchungen)
 * are summed with their sign, so a Satz whose lines net negative surfaces as
 * a refund upstream. Returns null if any value is unparseable (so the caller
 * suppresses the event rather than report a wrong total) or if the net is
 * exactly zero (a fully cancelled Satz carries no revenue signal).
 */
function sumAmountsAsCents(values: string[]): number | null {
  let total = 0;
  for (const raw of values) {
    const cents = parseAmountToCents(raw);
    if (cents === null) return null;
    total += cents;
  }
  return total === 0 ? null : total;
}

/**
 * Parse a single GDT-amount string into SIGNED integer cents.
 *
 * Locale rule (H3): last-separator-wins. Whichever of "," / "." occurs LAST
 * is the decimal separator; the other is a grouping separator to strip. A
 * lone separator followed by exactly three digits is a thousands group, not a
 * fraction (currency never has three decimals).
 *
 * No magnitude heuristic (H3.1): a value WITH a decimal separator is EUR, an
 * integer value is EUR. "1000" is 1000,00 EUR, never 10,00 EUR; "999" is
 * 999,00 EUR. The old "integer >= 1000 is cents" branch corrupted every whole-
 * euro amount at or above 1000 and is gone.
 */
function parseAmountToCents(raw: string): number | null {
  const cleaned = raw
    .replace(/EUR/gi, "")
    .replace(/€/g, "")
    .replace(/\s/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/^[-+]/, "");
  const normalised = normaliseDecimalString(unsigned);
  if (normalised === undefined) return null;
  const num = Number(normalised);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

/**
 * Turn a localized money string (unsigned) into a plain JS-number string.
 * Replicated from apps/bridge/agent/src/db-adapters/normalizer.ts's
 * normaliseDecimalString (kept in sync by contract, not imported, to keep the
 * pkg-bundled agent modules independent). See that file for the rule table.
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
  if (parts.length > 2) {
    // Repeated single separator -> grouping only.
    return parts.join("");
  }
  const trailing = parts[1] ?? "";
  // Exactly three trailing digits -> thousands separator (currency has <=2
  // decimals). Otherwise it is the decimal separator.
  return trailing.length === 3 ? parts[0] + trailing : `${parts[0]}.${trailing}`;
}

/**
 * Best stable business date carried by a Satz, as an ISO-8601 UTC datetime, or
 * undefined when the Satz carries none. Probes the Befund/Untersuchungsdatum
 * (FK 6200 / 8431) and the Rechnungsdatum (FK 6228). Used to give the
 * PatientUpserted event a deterministic occurredAt when the Satz has one (an
 * 8316 treatment record); a plain patient export falls back to the file mtime.
 */
function stableRecordDate(fks: GdtRecord[]): string | undefined {
  // FK 6200 / 8431 are date-only fields; a lenient parse of their leading 8
  // digits is fine. FK 6228 is dual-purpose (M-P8) so it only counts as a date
  // when the WHOLE value is a strict GDT date, otherwise a Bemerkung that
  // merely begins with 8 digits would be misread as the record date.
  const date6200 = formatGdtDateTime(pickFirst(fks, "6200"));
  if (date6200) return date6200;
  const date8431 = formatGdtDateTime(pickFirst(fks, "8431"));
  if (date8431) return date8431;
  return asStrictGdtDateTime(pickFirst(fks, "6228"));
}

/**
 * M-P8: parse a GDT date/datetime value ONLY when the entire value is a strict
 * date, i.e. exactly DDMMYYYY (8 digits) or DDMMYYYYHHMMSS (14 digits). Used to
 * disambiguate FK 6228 (Zahldatum vs free-text Bemerkung): a value that is not
 * strictly a date is a remark and never a payment date. Returns the ISO-8601
 * UTC datetime, or undefined when the value is not a strict, calendar-valid date.
 */
function asStrictGdtDateTime(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const t = input.trim();
  if (!/^\d{8}(\d{6})?$/.test(t)) return undefined;
  return formatGdtDateTime(t);
}

function formatGdtDate(input: string | undefined): string | undefined {
  // GDT date is DDMMYYYY (8 chars).
  if (!input) return undefined;
  const m = input.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return undefined;
  // M-P5: validate the real calendar, not just the shape. The old code was
  // shape-only, so "99999999" produced "9999-99-99" and shipped downstream to
  // fail far from the source. An invalid date returns undefined and is treated
  // like any unparseable date by the callers (skip/mtime-fallback per convention).
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!isValidCalendarDate(year, month, day)) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * M-P5: true when (year, month, day) is a real calendar date. Month 1-12 and
 * day within the month's length, accounting for leap years. Rejects the
 * shape-valid but impossible dates the shape-only regex used to accept.
 */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
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

function formatGdtDateTime(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const d = formatGdtDate(input.slice(0, 8));
  if (!d) return undefined;
  if (input.length >= 14) {
    const t = `${input.slice(8, 10)}:${input.slice(10, 12)}:${input.slice(12, 14)}`;
    return `${d}T${t}.000Z`;
  }
  return `${d}T00:00:00.000Z`;
}

function mapGender(input: string | undefined): "f" | "m" | "d" | "x" | undefined {
  if (!input) return undefined;
  // GDT codes: 1 = männlich, 2 = weiblich.
  if (input === "1" || input.toLowerCase() === "m") return "m";
  if (input === "2" || input.toLowerCase() === "w" || input.toLowerCase() === "f") return "f";
  return undefined;
}
