import { pickFirst, pickAll, type GdtParseResult } from "./gdt-parser.js";

/**
 * GDT → canonical event translator. Returns 1..N events depending on the
 * Satzart:
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
}

export function gdtToCanonical(
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent[] {
  if (!parsed.satzart) return [];

  switch (parsed.satzart) {
    case "6301":
    case "6310":
      return [patientFromGdt(parsed, ctx)];
    case "8316": {
      const events: CanonicalEvent[] = [
        patientFromGdt(parsed, ctx),
        encounterFromGdt(parsed, ctx),
      ];
      const invoice = invoiceFromGdt(parsed, ctx);
      if (invoice) events.push(invoice);
      return events;
    }
    case "6200": {
      const events: CanonicalEvent[] = [encounterFromGdt(parsed, ctx)];
      const invoice = invoiceFromGdt(parsed, ctx);
      if (invoice) events.push(invoice);
      return events;
    }
    default:
      return [];
  }
}

function patientFromGdt(
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent {
  const fks = parsed.records;
  const pvsPatientId = pickFirst(fks, "3000") ?? `unknown:${ctx.contentHash}`;
  const lastName = pickFirst(fks, "3101");
  const firstName = pickFirst(fks, "3102");
  const dob = formatGdtDate(pickFirst(fks, "3103"));
  const gender = mapGender(pickFirst(fks, "3110"));
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || undefined;
  const bemerkung = collectBemerkung(fks);
  const email = pickEmail(fks);
  const phone = pickPhone(fks);
  return {
    kind: "PatientUpserted",
    clinicId: ctx.clinicId,
    bridgeSource: "gdt_agent",
    pvsExternalEventId: `gdt:patient:${pvsPatientId}:${ctx.contentHash}`,
    occurredAt: new Date().toISOString(),
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
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent {
  const fks = parsed.records;
  const pvsPatientId = pickFirst(fks, "3000") ?? `unknown:${ctx.contentHash}`;
  // 6200 = Befund — use the file's timestamp from FK 6200 / 8311 / current date.
  const dateRaw =
    pickFirst(fks, "6200") ?? pickFirst(fks, "8431") ?? undefined;
  const occurredAt = formatGdtDateTime(dateRaw) ?? new Date().toISOString();
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
 * If multiple FK 8420 lines appear in a single file, we sum them (medatixx
 * exports each Honorar-Position as a separate line; the invoice total is
 * the sum).
 *
 * Returns null when no billing fields are present, so the caller can skip
 * the event entirely (this is the common case for non-Honorar GDT files).
 */
function invoiceFromGdt(
  parsed: GdtParseResult,
  ctx: NormalizeContext
): CanonicalEvent | null {
  const fks = parsed.records;
  const pvsPatientId = pickFirst(fks, "3000") ?? `unknown:${ctx.contentHash}`;
  const amountStrings = pickAll(fks, "8420");
  if (amountStrings.length === 0) return null;

  const amountCents = sumAmountsAsCents(amountStrings);
  if (amountCents === null) return null;

  const invoiceNumber = pickFirst(fks, "6225");
  const pvsInvoiceId =
    invoiceNumber ?? `gdt-honorar:${pvsPatientId}:${ctx.contentHash}`;
  const paidAtRaw =
    pickFirst(fks, "6228") ??
    pickFirst(fks, "8431") ??
    pickFirst(fks, "6200");
  const paidAt = formatGdtDateTime(paidAtRaw) ?? new Date().toISOString();

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
    amountCents,
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
      if (trimmed) parts.push(trimmed);
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
  // Last-resort fan-out for non-conformant PVS exports.
  for (const r of records) {
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
 * Sum a list of GDT-amount strings into integer cents. Tolerates both
 * comma-decimal ("12,50") and dot-decimal ("12.50"), with or without a
 * EUR / € prefix, and optional thousands separators. Returns null if any
 * value is unparseable so the caller can suppress the InvoicePaid event
 * entirely rather than report a wrong total.
 */
function sumAmountsAsCents(values: string[]): number | null {
  let total = 0;
  for (const raw of values) {
    const cents = parseAmountToCents(raw);
    if (cents === null) return null;
    total += cents;
  }
  // Guard against zero-only files — a "0 EUR" invoice carries no signal.
  return total > 0 ? total : null;
}

function parseAmountToCents(raw: string): number | null {
  const cleaned = raw
    .replace(/EUR/gi, "")
    .replace(/€/g, "")
    .replace(/\s/g, "");
  if (!cleaned) return null;

  // Detect decimal separator: if a comma is the *last* punctuation, treat
  // it as the decimal separator; otherwise dot.
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalised: string;
  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    normalised = cleaned.replace(/,/g, "");
  }
  const num = Number(normalised);
  if (!Number.isFinite(num) || num < 0) return null;
  // Heuristic: integers ≥ 1000 with no decimal separator are already in
  // cents (medatixx writes "1250" for 12.50 EUR). Floats keep their EUR
  // interpretation.
  const isCents =
    !normalised.includes(".") &&
    Number.isInteger(num) &&
    num >= 1000 &&
    // No leading zero (would suggest "00500" = 5 EUR with leading zero pad)
    !normalised.startsWith("0");
  return isCents ? Math.round(num) : Math.round(num * 100);
}

function formatGdtDate(input: string | undefined): string | undefined {
  // GDT date is DDMMYYYY (8 chars).
  if (!input) return undefined;
  const m = input.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
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
