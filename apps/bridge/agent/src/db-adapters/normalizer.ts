import { createHash } from "node:crypto";
import {
  berlinDateToUtcIso,
  berlinWallClockToUtcMs,
  naiveUtcDateAsBerlin,
} from "../berlin-time.js";
import {
  FUTURE_CURSOR_TOLERANCE_MS,
  cursorFormatOf,
  domainNowMs,
  parseCursorValue,
  timezoneOf,
} from "./time-utils.js";
import type {
  CanonicalEventBase,
  DbTimezone,
  CanonicalEventKind,
  DecimalFormat,
  FieldMapping,
  StreamConfig,
  StreamFieldMap,
  TransformName,
  VendorConfig,
} from "./types.js";

/**
 * Row → canonical event transformer.
 *
 * Driven entirely by the `map:` block in vendor YAML configs. Three forms
 * for each canonical-event field:
 *
 *   1. Direct column reference:    `pvsPatientId: id`
 *   2. Template with column refs:  `fullName: "{first_name} {last_name}"`
 *   3. Object with transform:      `gender: { from: geschlecht, transform: gender }`
 *   4. Object with literal:        `currency: { literal: "EUR" }`
 *
 * Unknown columns referenced from `from:` produce a structured warning and
 * an undefined value (the field is omitted from the event). Required-field
 * misses are caught earlier in vendor-config.ts.
 *
 * Output is then trimmed to drop undefined-valued keys, so the portal Zod
 * schema's `.optional()` semantics work cleanly.
 */

export interface NormalizeContext {
  clinicId: string;
  vendor: VendorConfig;
  stream: StreamConfig;
}

export class NormalizerWarning extends Error {
  constructor(public readonly vendor: string, public readonly stream: CanonicalEventKind, message: string) {
    super(`normalize ${vendor}/${stream}: ${message}`);
    this.name = "NormalizerWarning";
  }
}

/**
 * Normalise a single row. Returns null if a REQUIRED field on the canonical
 * event resolves to undefined (which means the row violates the vendor's
 * own declared schema, likely a NULL in a NOT-NULL position the DB allowed
 * historically). The caller logs the warning and skips the row.
 */
export function normalizeRow(
  row: Record<string, unknown>,
  ctx: NormalizeContext
): CanonicalEventBase | null {
  const out: Record<string, unknown> = {
    kind: ctx.stream.kind,
    clinicId: ctx.clinicId,
    bridgeSource: ctx.vendor.bridgeSource,
  };
  const warnings: string[] = [];
  const tz = timezoneOf(ctx.vendor, ctx.stream);
  const fnHitsBefore = functionCellHits;
  for (const [field, mapping] of Object.entries(ctx.stream.map)) {
    const value = resolveFieldValue(mapping, row, warnings, tz, ctx.stream.decimalFormat);
    if (value !== undefined) {
      out[field] = value;
    }
  }
  if (functionCellHits > fnHitsBefore) {
    warnings.push(
      `${functionCellHits - fnHitsBefore} function-valued cell(s) skipped (unread BLOB reader); the field was dropped`
    );
  }
  if (warnings.length > 0) {
    console.warn(
      `[db-normalizer] ${ctx.vendor.vendor}/${ctx.stream.kind}: ${warnings.join(
        "; "
      )}`
    );
  }
  // Worker-contract enforcement is done at config-load time; here we just
  // make sure the canonical envelope is structurally complete.
  if (
    typeof out.pvsExternalEventId !== "string" ||
    typeof out.occurredAt !== "string"
  ) {
    return null;
  }
  if (ctx.stream.kind === "InvoiceRefunded") applyRefundIdentity(out);
  out.pvsExternalEventId = versionedEventId(out as Record<string, unknown> & { pvsExternalEventId: string });
  // Set AFTER the id: a bare touch (only modified_at moved) keeps its id and
  // dedups; a real change already gets a new id from the payload hash.
  if (ctx.stream.kind === "InvoicePaid" || ctx.stream.kind === "InvoiceRefunded") {
    const revision = sourceRevisionOf(row, ctx);
    if (revision !== null) out.sourceRevision = revision;
  }
  return out as CanonicalEventBase;
}

/**
 * Pass 2: the row's modified_at (the timestamp cursor column) as the producer
 * revision, in epoch ms. Derive keeps the higher revision of an invoice, so a
 * stale version that arrives late (dead-letter requeue, retry behind newer
 * rows) or a correction that moved the payment date earlier cannot win.
 * Parsed exactly like the cursor (raw, no zone shift): only the order matters,
 * and the raw value keeps the DB's own order through DST changes. Omitted for
 * a non-timestamp cursor, a sentinel date, a pre-1970 date or garbage: the
 * portal rejects anything but a nonnegative integer, and an absent revision
 * falls back to the date / arrival order.
 */
function sourceRevisionOf(row: Record<string, unknown>, ctx: NormalizeContext): number | null {
  if (ctx.stream.cursorType !== "timestamp") return null;
  const fmt = cursorFormatOf(ctx.vendor, ctx.stream);
  let ms: number | null;
  try {
    ms = parseCursorValue(row[ctx.stream.cursorColumn], fmt);
  } catch {
    return null;
  }
  if (ms === null || !Number.isSafeInteger(ms) || ms < 0) return null;
  // "Now" in the column's own clock, exactly as the framework clamps the
  // cursor: a zone-less Berlin wall clock reads 1-2 h ahead of real UTC.
  const domainNow = domainNowMs(Date.now(), fmt, timezoneOf(ctx.vendor, ctx.stream));
  if (ms > domainNow + FUTURE_CURSOR_TOLERANCE_MS) return null;
  return ms;
}

/**
 * Refund identity (review finding 12). A Storno / credit note booked as a NEW
 * row has its own id; the original invoice is only reachable through a
 * reference column. So:
 *   pvsRefundId  = the refund row's own id (stable, never includes modified_at),
 *                  so the portal can SUM several distinct partial credit notes
 *                  of one invoice and still dedup re-reads of the same note;
 *   pvsInvoiceId = the mapped `originalInvoiceId` when non-null, otherwise the
 *                  row's own id (the flag-flip case: the invoice row itself
 *                  turned into a Storno).
 * `originalInvoiceId` is an agent-side mapping helper, never sent to the portal.
 */
function applyRefundIdentity(out: Record<string, unknown>): void {
  const ownId = out.pvsInvoiceId;
  if (out.pvsRefundId === undefined && ownId !== undefined && ownId !== null && String(ownId) !== "") {
    out.pvsRefundId = String(ownId);
  }
  const original = out.originalInvoiceId;
  delete out.originalInvoiceId;
  if (original !== undefined && original !== null && String(original).trim() !== "") {
    out.pvsInvoiceId = String(original).trim();
  }
}

/** Portal max length of pvsExternalEventId. */
const MAX_EVENT_ID_LENGTH = 200;
const VERSION_SUFFIX_LENGTH = 13; // ":" + 12 hex chars

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Event ids are deterministic per row, and the outbox (UNIQUE content_hash) and
 * the portal dedup on them, so a CORRECTED row (amount, paid date, reschedule,
 * status or email change) re-read under the same id would be swallowed and the
 * portal would keep the stale value. Append a short hash of the normalized
 * payload (everything except the id itself): an unchanged re-read (lookback
 * window) hashes identically and still dedups, any real change gets a new id.
 * The base is trimmed so the result stays within the portal's 200 chars.
 */
function versionedEventId(event: Record<string, unknown> & { pvsExternalEventId: string }): string {
  const { pvsExternalEventId, ...rest } = event;
  const hash = createHash("sha256").update(stableJson(rest)).digest("hex").slice(0, 12);
  const base =
    pvsExternalEventId.length > MAX_EVENT_ID_LENGTH - VERSION_SUFFIX_LENGTH
      ? pvsExternalEventId.slice(0, MAX_EVENT_ID_LENGTH - VERSION_SUFFIX_LENGTH)
      : pvsExternalEventId;
  return `${base}:${hash}`;
}

/**
 * Resolve a single field mapping against a row, discarding warnings. Used by
 * the framework's first-poll value validator (Phase 5) to attribute a
 * per-field miss precisely without re-implementing the resolution rules, and
 * to surface the raw source value behind a failing transform.
 */
export function resolveField(
  mapping: FieldMapping,
  row: Record<string, unknown>,
  tz: DbTimezone = "utc",
  streamDecimalFormat?: DecimalFormat
): unknown {
  return resolveFieldValue(mapping, row, [], tz, streamDecimalFormat);
}

function resolveFieldValue(
  mapping: FieldMapping,
  row: Record<string, unknown>,
  warnings: string[],
  tz: DbTimezone,
  streamDecimalFormat?: DecimalFormat
): unknown {
  const decimalFormat =
    typeof mapping === "string" ? streamDecimalFormat : mapping.decimalFormat ?? streamDecimalFormat;
  if (typeof mapping === "string") {
    return coerceForEmit(row[mapping], tz);
  }
  if ("literal" in mapping && mapping.literal !== undefined) {
    return mapping.literal;
  }
  if (mapping.template) {
    // Templates build event ids / free text. A Date placeholder expands to the
    // real instant (same as a plain mapped field), so a row version's id matches
    // the REST path's id for the same Tomedo row and stays deterministic.
    const expanded = expandTemplate(mapping.template, row, warnings, tz);
    if (mapping.transform)
      return applyTransform(mapping.transform, expanded, tz, decimalFormat);
    return expanded;
  }
  if (mapping.from) {
    // isoDate keeps the wall-clock calendar day, so it reads the raw naive
    // value; every other transform sees the real instant.
    const raw =
      mapping.transform === "isoDate"
        ? (coerceScalar(row[mapping.from]) ?? undefined)
        : coerceForEmit(row[mapping.from], tz);
    if (raw === undefined) {
      if (!(mapping.from in row)) {
        warnings.push(`unknown column '${mapping.from}'`);
      }
      return undefined;
    }
    if (mapping.transform) return applyTransform(mapping.transform, raw, tz, decimalFormat);
    return raw;
  }
  return undefined;
}

/**
 * Template expansion. `{col}` → row[col] coerced to string. Multiple
 * placeholders are expanded in one pass; missing columns become empty
 * string after a warning (so a template like "{first_name} {last_name}"
 * doesn't degrade to `undefined undefined` for a half-NULL row).
 *
 * Empty result (all placeholders unresolved + no static text) returns
 * undefined so the caller drops the field.
 */
function expandTemplate(
  template: string,
  row: Record<string, unknown>,
  warnings: string[],
  tz: DbTimezone = "utc"
): string | undefined {
  let anyResolved = false;
  const expanded = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, col) => {
    if (!(col in row)) {
      warnings.push(`template references unknown column '${col}'`);
      return "";
    }
    const v = coerceForEmit(row[col], tz);
    if (v === undefined || v === null || v === "") return "";
    anyResolved = true;
    return String(v);
  });
  const trimmed = expanded.replace(/\s+/g, " ").trim();
  if (!anyResolved && trimmed === "") return undefined;
  return trimmed;
}

/**
 * Coerce a DB scalar to a friendly JS value. Date → ISO string; Buffer →
 * utf8; numbers/strings pass through. NULL → undefined so the event omits
 * the field via `if (value !== undefined)`.
 */
/**
 * A Date (or time-bearing value) headed INTO a canonical event: converts a
 * zone-less database wall clock to the real instant. With the process pinned to
 * UTC (tz-pin.ts) a node driver builds the Date from a zone-less TIMESTAMP so
 * its UTC fields ARE the Berlin wall clock; emitting toISOString() directly
 * would label Berlin time as UTC (1-2 h in the future, wrong day boundaries).
 *
 * A Date at exactly 00:00:00.000 is taken to be a DATE column (no time of day)
 * and anchored at 12:00 Berlin, so it stays on the same calendar day in every
 * UTC-bucketed report. (A TIMESTAMP that really is midnight sharp lands at noon
 * the same day; accepted, the day is what matters for those.)
 */
export function emitInstantIso(d: Date, tz: DbTimezone): string | undefined {
  const t = d.getTime();
  if (Number.isNaN(t)) return undefined;
  if (tz === "utc") return d.toISOString();
  const midnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (midnight) {
    const iso = berlinDateToUtcIso(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate()
    );
    if (iso) return iso;
  } else {
    const real = naiveUtcDateAsBerlin(d);
    if (real) return real.toISOString();
  }
  // Outside the 1900-2200 window the conversion refuses (e.g. a 9999-12-31
  // sentinel). Keep the raw ISO so the row still flows as it always did.
  return d.toISOString();
}

/** Function-valued cells seen so far (lazy node-firebird BLOB readers). */
let functionCellHits = 0;

function coerceForEmit(v: unknown, tz: DbTimezone): unknown {
  if (v instanceof Date) return emitInstantIso(v, tz);
  const s = coerceScalar(v);
  // null = "unusable cell" (a function): the field is dropped like a NULL.
  return s === null ? undefined : s;
}

/**
 * Coerce a DB scalar. NULL / undefined / an unrepresentable Date → undefined; a
 * FUNCTION value → null (an unread lazy BLOB reader, e.g. node-firebird's BLOB
 * SUB_TYPE TEXT without blobAsText: String(fn) would be JS source text and end
 * up in the portal). Callers treat null like undefined and count it.
 */
function coerceScalar(v: unknown): unknown {
  if (typeof v === "function") {
    functionCellHits++;
    return null;
  }
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) {
    // Legacy MySQL / MariaDB zero-dates (0000-00-00) arrive as an Invalid Date
    // under mysql2's dateStrings:false; toISOString() on one throws RangeError
    // (review finding H6). Treat an unrepresentable Date like a NULL: drop the
    // field rather than crash the whole poll.
    if (Number.isNaN(v.getTime())) return undefined;
    return v.toISOString();
  }
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

// ---------- transforms -----------------------------------------------------

export function applyTransform(
  name: TransformName,
  raw: unknown,
  tz: DbTimezone = "utc",
  decimalFormat?: DecimalFormat
): unknown {
  switch (name) {
    case "gender":
      return mapGender(raw);
    case "appointmentStatus":
      return mapAppointmentStatus(raw);
    case "amountToCents":
      return amountToCents(raw, decimalFormat);
    case "absAmountToCents":
      return absAmountToCents(raw, decimalFormat);
    case "integerCents":
      return integerCents(raw);
    case "isoDateTime":
      return isoDateTime(raw, tz);
    case "isoDate":
      return isoDate(raw);
    case "lowerEmail":
      return lowerEmail(raw);
    case "phone":
      return normalisePhone(raw);
    case "bemerkung":
      return clampBemerkung(raw);
  }
}

function mapGender(v: unknown): "f" | "m" | "d" | "x" | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["w", "weiblich", "f", "female", "frau"].includes(s)) return "f";
  if (["m", "männlich", "maennlich", "male", "mann"].includes(s)) return "m";
  if (["d", "divers"].includes(s)) return "d";
  if (["x", "unknown", "unbekannt", "k.a."].includes(s)) return "x";
  // Tomedo historically stored 1/2/3 for m/w/divers.
  if (s === "1") return "m";
  if (s === "2") return "f";
  if (s === "3") return "d";
  return undefined;
}

function mapAppointmentStatus(
  v: unknown
): "scheduled" | "checked_in" | "completed" | "no_show" | "cancelled" | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (["scheduled", "geplant", "terminiert", "offen", "open", "neu"].includes(s))
    return "scheduled";
  if (
    [
      "checked_in",
      "checked-in",
      "anwesend",
      "erschienen",
      "arrived",
      "eingecheckt",
      "anwesenheit",
    ].includes(s)
  )
    return "checked_in";
  if (
    ["completed", "abgeschlossen", "fertig", "done", "erledigt", "behandelt"].includes(s)
  )
    return "completed";
  if (
    [
      "no_show",
      "no-show",
      "noshow",
      "nicht_erschienen",
      "nicht-erschienen",
      "ausgefallen",
      "nicht erschienen",
    ].includes(s)
  )
    return "no_show";
  if (
    ["cancelled", "canceled", "storniert", "abgesagt", "stornierung", "abgebrochen"].includes(
      s
    )
  )
    return "cancelled";
  return undefined;
}

function amountToCents(v: unknown, decimalFormat?: DecimalFormat): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return undefined;
    return Math.round(v * 100);
  }
  const s = String(v).replace(/EUR/gi, "").replace(/€/g, "").replace(/\s/g, "");
  if (!s) return undefined;
  const normalised =
    decimalFormat === "de" ? normaliseGermanDecimalString(s) : normaliseDriverDecimalString(s);
  if (normalised === undefined) return undefined;
  const num = Number(normalised);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/**
 * Like amountToCents, but returns the POSITIVE magnitude. Refund / Storno /
 * Gutschrift rows store the amount either as a negative number (a credit note)
 * or as a positive number on a storno-status row; refundedAmountCents must be a
 * nonnegative magnitude (the portal Zod rejects negatives). Doing the abs here
 * rather than as a SQL ABS() keeps the vendor SQL minimal and engine-agnostic
 * (no reliance on each engine's ABS(), which pg-mem also does not implement).
 */
function absAmountToCents(v: unknown, decimalFormat?: DecimalFormat): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return undefined;
    return Math.round(Math.abs(v) * 100);
  }
  // Strip a leading sign so the magnitude survives amountToCents' own
  // negative-rejection, then reuse its localized-decimal parsing.
  return amountToCents(String(v).trim().replace(/^[-+]/, ""), decimalFormat);
}

/**
 * DEFAULT parser for decimal strings that come out of a DB driver (numeric /
 * decimal columns arrive as strings: "12.500" from numeric(12,3), "0.500").
 * A driver string has NO thousands separators and "." is always the decimal
 * point, so "12.500" is 12.5, not 12,500 (the German heuristic below read it
 * as thousands and over-counted a EUR 12.50 amount 1000x). A lone "," is a
 * German decimal comma ("12,50"); when both separators occur the rightmost is
 * the decimal point. Text columns that really hold German thousands ("1.234")
 * must declare `decimalFormat: de` in the YAML.
 */
function normaliseDriverDecimalString(s: string): string | undefined {
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  }
  if (!hasComma && !hasDot) return s;
  const sep = hasComma ? "," : ".";
  const parts = s.split(sep);
  // A repeated single separator can only be grouping ("1.234.567").
  if (parts.length > 2) return parts.join("");
  return `${parts[0]}.${parts[1] ?? ""}`;
}

/**
 * Turn a localized money string into a plain JS-number string ("1234.56").
 * Opt-in via `decimalFormat: de`.
 *
 * The dangerous case (review finding 7) is a SINGLE separator with no clear
 * decimal intent. Currency never has three decimal places, so a group of
 * exactly three digits after a lone separator is a THOUSANDS group, not a
 * fraction. The old code read "1.234" as 1.234 -> EUR 1.23, a 1000x
 * under-count of a EUR 1,234 invoice.
 *
 *   "1.234"      -> "1234"     (German thousands; was the EUR 1.23 bug)
 *   "1,234"      -> "1234"     (English thousands)
 *   "1.50"       -> "1.50"     (two decimals -> fraction)
 *   "1,5"        -> "1.5"      (one decimal -> fraction)
 *   "1.234,56"   -> "1234.56"  (two separators -> the LAST is the decimal)
 *   "1,234.56"   -> "1234.56"
 *   "1.234.567"  -> "1234567"  (repeated separator -> all grouping)
 */
function normaliseGermanDecimalString(s: string): string | undefined {
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    // Two separator types present: the rightmost one is the decimal point.
    return s.lastIndexOf(",") > s.lastIndexOf(".")
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  }

  const sep = hasComma ? "," : hasDot ? "." : "";
  if (sep === "") return s; // no separator -> plain integer

  const parts = s.split(sep);
  if (parts.length > 2) {
    // Repeated single separator -> it can only be a grouping separator.
    return parts.join("");
  }
  const trailing = parts[1] ?? "";
  // Exactly three trailing digits -> thousands separator (currency has <=2
  // decimals, so ".234" is never a fraction). Otherwise it is the decimal.
  return trailing.length === 3 ? parts[0] + trailing : `${parts[0]}.${trailing}`;
}

function integerCents(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return undefined;
    return Math.round(v);
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n);
}

const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoDateTime(v: unknown, tz: DbTimezone = "utc"): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  // Invalid Date (e.g. a legacy zero-date) would throw on toISOString(); treat
  // it as an absent value so the field is dropped instead of crashing the poll
  // (review finding H6).
  if (v instanceof Date) return emitInstantIso(v, tz);
  if (typeof v === "string") {
    const s = v.trim();
    if (tz !== "utc") {
      // Zone-less text (sqlite 'YYYY-MM-DD HH:MM:SS', a date-only cell) is a
      // Berlin wall clock: convert it to the real instant. Text that carries
      // its own zone (Z / +02:00) is already an instant and passes unchanged.
      const dm = DATE_ONLY.exec(s);
      if (dm) {
        return berlinDateToUtcIso(Number(dm[1]), Number(dm[2]), Number(dm[3]));
      }
      const nm = NAIVE_DATETIME.exec(s);
      if (nm) {
        const ms = berlinWallClockToUtcMs(
          Number(nm[1]),
          Number(nm[2]),
          Number(nm[3]),
          Number(nm[4]),
          Number(nm[5]),
          Number(nm[6] ?? "0")
        );
        if (ms === null) return undefined;
        const frac = nm[7] ? Math.round(Number(`0.${nm[7]}`) * 1000) : 0;
        return new Date(ms + frac).toISOString();
      }
    }
    if (tz === "utc") {
      // Zone-less text under timezone: utc is a UTC wall clock. Parse it
      // explicitly: new Date('YYYY-MM-DD HH:MM:SS') would use the process zone.
      const nm = NAIVE_DATETIME.exec(s);
      if (nm) {
        const ms = Date.UTC(
          Number(nm[1]),
          Number(nm[2]) - 1,
          Number(nm[3]),
          Number(nm[4]),
          Number(nm[5]),
          Number(nm[6] ?? "0")
        );
        const frac = nm[7] ? Math.round(Number(`0.${nm[7]}`) * 1000) : 0;
        const out = new Date(ms + frac);
        return Number.isNaN(out.getTime()) ? undefined : out.toISOString();
      }
    }
    // Already-ISO strings pass through (zod accepts both Z and ±HH:mm).
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }
  return undefined;
}

function isoDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  // Same Invalid-Date guard as isoDateTime (review finding H6).
  if (v instanceof Date)
    return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString().slice(0, 10);
  }
  return undefined;
}

function lowerEmail(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s || s.length > 200) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined;
  return s;
}

function normalisePhone(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim().replace(/\s{2,}/g, " ");
  if (!s || s.length > 64) return undefined;
  return s;
}

function clampBemerkung(v: unknown): string | undefined {
  if (v === null || v === undefined || typeof v === "function") return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.length > 4000 ? s.slice(0, 4000) : s;
}

// ---------- exported helpers for tests -----------------------------------

export const _internal = {
  mapGender,
  mapAppointmentStatus,
  amountToCents,
  absAmountToCents,
  integerCents,
  isoDateTime,
  isoDate,
  lowerEmail,
  normalisePhone,
  clampBemerkung,
  expandTemplate,
  coerceScalar,
};

// Type-narrowing helper: convince TS that out has the expected shape per
// the StreamFieldMap declarations; the runtime guarantee is in
// vendor-config.ts's required-field validation.
export type _Unused = StreamFieldMap;
