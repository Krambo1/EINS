import type {
  CanonicalEventBase,
  CanonicalEventKind,
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
  for (const [field, mapping] of Object.entries(ctx.stream.map)) {
    const value = resolveFieldValue(mapping, row, warnings);
    if (value !== undefined) {
      out[field] = value;
    }
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
  return out as CanonicalEventBase;
}

function resolveFieldValue(
  mapping: FieldMapping,
  row: Record<string, unknown>,
  warnings: string[]
): unknown {
  if (typeof mapping === "string") {
    return coerceScalar(row[mapping]);
  }
  if ("literal" in mapping && mapping.literal !== undefined) {
    return mapping.literal;
  }
  if (mapping.template) {
    const expanded = expandTemplate(mapping.template, row, warnings);
    if (mapping.transform) return applyTransform(mapping.transform, expanded);
    return expanded;
  }
  if (mapping.from) {
    const raw = coerceScalar(row[mapping.from]);
    if (raw === undefined) {
      if (!(mapping.from in row)) {
        warnings.push(`unknown column '${mapping.from}'`);
      }
      return undefined;
    }
    if (mapping.transform) return applyTransform(mapping.transform, raw);
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
  warnings: string[]
): string | undefined {
  let anyResolved = false;
  const expanded = template.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_m, col) => {
    if (!(col in row)) {
      warnings.push(`template references unknown column '${col}'`);
      return "";
    }
    const v = coerceScalar(row[col]);
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
function coerceScalar(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("utf8");
  return v;
}

// ---------- transforms -----------------------------------------------------

export function applyTransform(name: TransformName, raw: unknown): unknown {
  switch (name) {
    case "gender":
      return mapGender(raw);
    case "appointmentStatus":
      return mapAppointmentStatus(raw);
    case "amountToCents":
      return amountToCents(raw);
    case "integerCents":
      return integerCents(raw);
    case "isoDateTime":
      return isoDateTime(raw);
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

function amountToCents(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return undefined;
    return Math.round(v * 100);
  }
  const s = String(v).replace(/EUR/gi, "").replace(/€/g, "").replace(/\s/g, "");
  if (!s) return undefined;
  const normalised = normaliseDecimalString(s);
  if (normalised === undefined) return undefined;
  const num = Number(normalised);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/**
 * Turn a localized money string into a plain JS-number string ("1234.56").
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
function normaliseDecimalString(s: string): string | undefined {
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

function isoDateTime(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") {
    // Already-ISO strings pass through (zod accepts both Z and ±HH:mm).
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  }
  return undefined;
}

function isoDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
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
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.length > 4000 ? s.slice(0, 4000) : s;
}

// ---------- exported helpers for tests -----------------------------------

export const _internal = {
  mapGender,
  mapAppointmentStatus,
  amountToCents,
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
