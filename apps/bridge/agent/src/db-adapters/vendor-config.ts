import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { BRIDGE_SOURCES, EVENT_KINDS } from "./generated-canonical.js";
import {
  isSafeIdentifierPath,
  selectOutputColumns,
  validateSingleSelect,
} from "./sql-analysis.js";
import {
  DEFAULT_INITIAL_HORIZON_DAYS,
  DEFAULT_LOOKBACK_MINUTES,
  DEFAULT_TIMEZONE,
} from "./time-utils.js";
import type {
  CanonicalEventKind,
  CursorFormat,
  DbTimezone,
  FieldMapping,
  StreamConfig,
  StreamFieldMap,
  TransformName,
  VendorConfig,
} from "./types.js";

/**
 * Vendor YAML loader + validator.
 *
 * Configs live in apps/bridge/agent/src/db-adapters/configs/<vendor>.yaml and
 * are bundled into the agent build. A Praxis enables a config at runtime via
 * `eins-agent --enable-db-adapter <vendor>`; the credential is provisioned
 * separately and bound by `credentialId`.
 *
 * Validation is intentionally strict: a malformed config should fail loudly
 * at boot, not silently emit empty events at 2am. We refuse on:
 *   • Unknown driver
 *   • Unknown event kind
 *   • Unknown transform name
 *   • Stream with no cursorColumn or no SELECT
 *   • Missing required field per event kind (e.g. pvsAppointmentId for
 *     AppointmentCreated; see worker contract in apps/portal/src/worker/
 *     processors/pvs-status-derive.ts)
 *   • SQL without :cursor binding (would never advance)
 *   • SQL that is not ONE read-only SELECT (';' separated statements, DML/DDL)
 *   • cursorColumn / tiebreakColumn that the SELECT does not output (the cursor
 *     could never advance: a 1 s hot loop re-reading the first batch)
 *   • batchSize outside 1..5000
 */

const VALID_CURSOR_FORMATS: ReadonlySet<string> = new Set([
  "native",
  "iso_text",
  "iso_t_text",
  "epoch_s",
  "epoch_ms",
  "julian",
]);
export const MAX_BATCH_SIZE = 5000;

// Derived from the generated canonical set so a new event kind can never be
// valid here but unknown to the portal (or vice-versa). EVENT_KINDS is the
// committed mirror of apps/bridge/src/canonical/schema-source.ts.
const VALID_KINDS: ReadonlySet<CanonicalEventKind> = new Set(EVENT_KINDS);

// Likewise for bridge sources: deriving from BRIDGE_SOURCES fixes the latent
// bug where this validator was missing `pabau` and `consentz` (a config
// stamping either would have been rejected at load even though the portal
// accepts them).
const VALID_BRIDGE_SOURCES: ReadonlySet<string> = new Set(BRIDGE_SOURCES);

const VALID_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "gender",
  "appointmentStatus",
  "amountToCents",
  "absAmountToCents",
  "integerCents",
  "isoDateTime",
  "isoDate",
  "lowerEmail",
  "phone",
  "bemerkung",
]);

const VALID_DRIVERS: ReadonlySet<string> = new Set([
  "postgres",
  "firebird",
  "mssql",
  "sqlite",
  "mysql",
  "oracle",
]);

/**
 * Per-kind contract. Lists the fields the portal worker requires (or
 * silently drops the event for). Validation refuses configs that don't
 * declare these in `map:`. Optional fields are advisory.
 */
export const REQUIRED_FIELDS_BY_KIND: Record<CanonicalEventKind, string[]> = {
  PatientUpserted: ["pvsPatientId"],
  AppointmentCreated: ["pvsPatientId", "pvsAppointmentId", "scheduledAt"],
  AppointmentStatusChanged: ["pvsPatientId", "pvsAppointmentId", "newStatus"],
  AppointmentCancelled: ["pvsPatientId", "pvsAppointmentId"],
  // pvsAppointmentId is non-required in the Zod schema but pvs-status-derive
  // silently drops events without it. Mark as required so the YAML can't
  // omit it for a SQL-introspection vendor that DOES have appointment ids.
  // (If a vendor's PVS truly has no appointment-encounter linkage, the
  // stream should be omitted entirely rather than feed unlinkable events.)
  EncounterCompleted: ["pvsPatientId", "pvsEncounterId", "pvsAppointmentId", "completedAt"],
  InvoicePaid: [
    "pvsPatientId",
    "pvsInvoiceId",
    "pvsAppointmentId",
    "amountCents",
    "paidAt",
  ],
  // pvsAppointmentId is optional for refunds (the derive worker bridges via
  // invoiceApptIndex on pvsInvoiceId). Adding this entry is forced now because
  // CanonicalEventKind gained InvoiceRefunded; the InvoiceRefunded DB streams
  // themselves land in a later phase.
  InvoiceRefunded: [
    "pvsPatientId",
    "pvsInvoiceId",
    "refundedAmountCents",
    "refundedAt",
  ],
  RecallScheduled: ["pvsPatientId", "pvsRecallId", "recallAt"],
  PatientMerged: ["fromPvsPatientId", "toPvsPatientId"],
};

/**
 * Fields that the framework synthesises automatically from the row's primary
 * key + cursor when not declared by the YAML. The map: block must declare
 * `pvsExternalEventId` and `occurredAt` for stable canonicalisation, but
 * config authors usually copy the same template across streams; future work
 * can default them per-vendor.
 */
export const ALWAYS_REQUIRED: string[] = ["pvsExternalEventId", "occurredAt"];

export class VendorConfigError extends Error {
  constructor(
    public readonly vendor: string,
    public readonly path: string,
    message: string
  ) {
    super(`vendor config '${vendor}' (${path}): ${message}`);
    this.name = "VendorConfigError";
  }
}

export async function loadVendorConfigFromString(
  source: string,
  pathForErrors: string
): Promise<VendorConfig> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    throw new VendorConfigError(
      "<unknown>",
      pathForErrors,
      `YAML parse failed: ${(err as Error).message}`
    );
  }
  return validateConfig(parsed, pathForErrors);
}

export async function loadVendorConfigFile(path: string): Promise<VendorConfig> {
  const source = await readFile(path, "utf8");
  return loadVendorConfigFromString(source, path);
}

/**
 * Load every *.yaml file in the configs/ dir. Returns a map keyed by
 * `vendor:` (the YAML's declared id), not the filename, so a typo'd
 * filename surfaces as a duplicate-vendor error, not a silent miss.
 */
export async function loadAllVendorConfigs(
  configsDir: string
): Promise<Map<string, VendorConfig>> {
  const out = new Map<string, VendorConfig>();
  let entries: string[];
  try {
    entries = await readdir(configsDir);
  } catch (err) {
    throw new Error(
      `configs dir not found: ${configsDir}: ${(err as Error).message}`
    );
  }
  for (const entry of entries) {
    if (!/\.(yaml|yml)$/i.test(entry)) continue;
    const full = join(configsDir, entry);
    const cfg = await loadVendorConfigFile(full);
    if (out.has(cfg.vendor)) {
      throw new VendorConfigError(
        cfg.vendor,
        full,
        `duplicate vendor id (already loaded from another file in ${configsDir})`
      );
    }
    out.set(cfg.vendor, cfg);
  }
  return out;
}

/**
 * Bundled configs overlaid with the ones this machine pulled from the portal.
 *
 * The bundled YAMLs stay the floor: a Praxis that never received a push, or
 * whose cached config went unreadable, keeps running exactly what shipped with
 * its build. A remote entry replaces the bundled config for that vendor only.
 *
 * A remote config that fails validation here is SKIPPED, not fatal. config-sync
 * validates before it ever writes, so reaching this branch means the cached
 * file was corrupted after the fact (torn write, AV quarantine, hand-edit); the
 * right move is to fall back to bundled and keep ingesting, not to refuse to
 * boot. The skip is logged so it shows up in the agent log tail.
 */
export async function loadEffectiveVendorConfigs(
  configsDir: string,
  remote: ReadonlyMap<string, string>
): Promise<Map<string, VendorConfig>> {
  const out = await loadAllVendorConfigs(configsDir);
  for (const [vendor, source] of remote) {
    let cfg: VendorConfig;
    try {
      cfg = await loadVendorConfigFromString(source, `<remote:${vendor}>`);
    } catch (err) {
      console.error(
        `[vendor-config] cached remote config for '${vendor}' is invalid and was ignored: ${
          (err as Error).message
        }. Falling back to the config bundled with this agent build.`
      );
      continue;
    }
    if (cfg.vendor !== vendor) {
      // The cache is keyed by filename; a mismatch means the file was swapped.
      console.error(
        `[vendor-config] cached remote config filed under '${vendor}' declares vendor '${cfg.vendor}'; ignoring it.`
      );
      continue;
    }
    out.set(vendor, cfg);
  }
  return out;
}

function validateConfig(input: unknown, path: string): VendorConfig {
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new VendorConfigError("<unknown>", path, "expected a YAML mapping at top level");
  }

  const vendor = stringField(raw, "vendor", path, "<unknown>");
  if (!/^[a-z][a-z0-9_-]{1,63}$/i.test(vendor)) {
    throw new VendorConfigError(vendor, path, "invalid vendor id");
  }

  const driver = stringField(raw, "driver", path, vendor);
  if (!VALID_DRIVERS.has(driver)) {
    throw new VendorConfigError(
      vendor,
      path,
      `unknown driver '${driver}' (expected one of: ${Array.from(VALID_DRIVERS).join(", ")})`
    );
  }

  const bridgeSource = stringField(raw, "bridgeSource", path, vendor);
  if (!VALID_BRIDGE_SOURCES.has(bridgeSource)) {
    throw new VendorConfigError(
      vendor,
      path,
      `bridgeSource '${bridgeSource}' is not a known BridgeSource (expected one of: ${BRIDGE_SOURCES.join(", ")}). The portal route rejects unknown values.`
    );
  }

  const connection = raw.connection as Record<string, unknown> | undefined;
  if (!connection || typeof connection !== "object") {
    throw new VendorConfigError(
      vendor,
      path,
      "missing or invalid `connection:` block"
    );
  }
  const credentialId = stringField(connection, "credentialId", path, vendor);

  const defaultIntervalSeconds = numberFieldOrDefault(
    raw,
    "defaultIntervalSeconds",
    60
  );
  const batchSize = numberFieldOrDefault(raw, "batchSize", 500);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new VendorConfigError(
      vendor,
      path,
      `batchSize ${String(batchSize)} must be an integer between 1 and ${MAX_BATCH_SIZE}`
    );
  }
  const timezone = validateTimezone(raw.timezone, vendor, path, "") ?? DEFAULT_TIMEZONE;
  const cursorFormat =
    validateCursorFormat(raw.cursorFormat, vendor, path, "") ??
    (driver === "sqlite" ? "iso_text" : "native");
  const initialHorizonDays =
    validateRange(raw.initialHorizonDays, "initialHorizonDays", 0, 3650, true, vendor, path, "") ??
    DEFAULT_INITIAL_HORIZON_DAYS;
  const lookbackMinutes =
    validateRange(raw.lookbackMinutes, "lookbackMinutes", 0, 1440, false, vendor, path, "") ??
    DEFAULT_LOOKBACK_MINUTES;

  const streamsRaw = raw.streams;
  if (!Array.isArray(streamsRaw) || streamsRaw.length === 0) {
    throw new VendorConfigError(
      vendor,
      path,
      "missing or empty `streams:` block; at least one stream is required"
    );
  }
  const streams: StreamConfig[] = [];
  for (let i = 0; i < streamsRaw.length; i++) {
    streams.push(validateStream(streamsRaw[i], i, vendor, path));
  }

  // Cross-stream sanity: a single vendor shouldn't declare the same kind
  // twice (the cursor key (vendor, kind) couldn't disambiguate).
  const seen = new Set<string>();
  for (const s of streams) {
    if (seen.has(s.kind)) {
      throw new VendorConfigError(
        vendor,
        path,
        `stream kind '${s.kind}' declared more than once`
      );
    }
    seen.add(s.kind);
  }

  return {
    vendor,
    driver: driver as VendorConfig["driver"],
    bridgeSource: bridgeSource as VendorConfig["bridgeSource"],
    connection: {
      credentialId,
      port: optionalNumberField(connection, "port"),
      database: optionalStringField(connection, "database"),
      options: connection.options as Record<string, unknown> | undefined,
    },
    defaultIntervalSeconds,
    batchSize,
    timezone,
    cursorFormat,
    initialHorizonDays,
    lookbackMinutes,
    streams,
  };
}

function validateTimezone(
  v: unknown,
  vendor: string,
  path: string,
  where: string
): DbTimezone | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "Europe/Berlin" || v === "utc") return v;
  throw new VendorConfigError(
    vendor,
    path,
    `${where}timezone '${String(v)}' must be 'Europe/Berlin' or 'utc'`
  );
}

function validateDecimalFormat(
  v: unknown,
  vendor: string,
  path: string,
  where: string
): "de" | undefined {
  if (v === undefined || v === null) return undefined;
  if (v === "de") return "de";
  throw new VendorConfigError(
    vendor,
    path,
    `${where}decimalFormat '${String(v)}' must be 'de' when present`
  );
}

function validateCursorFormat(
  v: unknown,
  vendor: string,
  path: string,
  where: string
): CursorFormat | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string" && VALID_CURSOR_FORMATS.has(v)) return v as CursorFormat;
  throw new VendorConfigError(
    vendor,
    path,
    `${where}cursorFormat '${String(v)}' must be one of ${Array.from(VALID_CURSOR_FORMATS).join("|")}`
  );
}

function validateRange(
  v: unknown,
  field: string,
  min: number,
  max: number,
  integer: boolean,
  vendor: string,
  path: string,
  where: string
): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  ) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}${field} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`
    );
  }
  return v;
}

function validateStream(
  input: unknown,
  index: number,
  vendor: string,
  path: string
): StreamConfig {
  const where = `stream[${index}]`;
  const raw = input as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    throw new VendorConfigError(vendor, path, `${where}: expected a mapping`);
  }
  const kind = stringField(raw, "kind", path, vendor) as CanonicalEventKind;
  if (!VALID_KINDS.has(kind)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: unknown event kind '${kind}'`
    );
  }
  const cursorColumn = stringField(raw, "cursorColumn", path, vendor);
  const cursorTypeRaw = (raw.cursorType as string | undefined) ?? "timestamp";
  if (
    cursorTypeRaw !== "timestamp" &&
    cursorTypeRaw !== "integer" &&
    cursorTypeRaw !== "string"
  ) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: cursorType '${cursorTypeRaw}' must be one of timestamp|integer|string`
    );
  }
  const query = stringField(raw, "query", path, vendor);
  if (!/:cursor\b/.test(query)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: query must reference :cursor (otherwise it would not advance)`
    );
  }

  const mapRaw = raw.map;
  if (!mapRaw || typeof mapRaw !== "object" || Array.isArray(mapRaw)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: missing or invalid \`map:\` block`
    );
  }
  const sqlProblem = validateSingleSelect(query);
  if (sqlProblem) {
    throw new VendorConfigError(vendor, path, `${where}: ${sqlProblem}`);
  }
  const outputs = selectOutputColumns(query);
  if (outputs !== null && !outputs.includes(cursorColumn.toLowerCase())) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: cursorColumn '${cursorColumn}' is not in the SELECT output (${outputs.join(
        ", "
      )}); the cursor could never advance and the first batch would be re-read endlessly`
    );
  }
  const map = validateMap(
    mapRaw as Record<string, unknown>,
    kind,
    vendor,
    path,
    where
  );

  const intervalSeconds = optionalNumberField(raw, "intervalSeconds");

  // Keyset pagination (review finding 6): tiebreakColumn + the :cursorTiebreak
  // bind must agree, or the query fails at runtime (driver throws on an
  // unbound placeholder) or silently keeps the single-column skip bug.
  let tiebreakColumn: string | undefined;
  if (raw.tiebreakColumn !== undefined && raw.tiebreakColumn !== null) {
    if (
      typeof raw.tiebreakColumn !== "string" ||
      raw.tiebreakColumn.trim() === ""
    ) {
      throw new VendorConfigError(
        vendor,
        path,
        `${where}: tiebreakColumn must be a non-empty string when present`
      );
    }
    tiebreakColumn = raw.tiebreakColumn;
  }
  const usesTiebreakBind = /:cursorTiebreak\b/.test(query);
  if (tiebreakColumn && !usesTiebreakBind) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: tiebreakColumn is set but the query never references :cursorTiebreak (keyset predicate missing)`
    );
  }
  if (!tiebreakColumn && usesTiebreakBind) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: query references :cursorTiebreak but no tiebreakColumn is set`
    );
  }

  // Keyset tiebreak comparison type (review finding L11). Defaults to integer.
  // Declaring "string" opts a UUID / non-numeric primary key into lexical
  // comparison; without it, a non-numeric tiebreak halts the stream loudly at
  // runtime rather than silently comparing NaN.
  let tiebreakType: StreamConfig["tiebreakType"];
  if (raw.tiebreakType !== undefined && raw.tiebreakType !== null) {
    if (raw.tiebreakType !== "integer" && raw.tiebreakType !== "string") {
      throw new VendorConfigError(
        vendor,
        path,
        `${where}: tiebreakType '${String(
          raw.tiebreakType
        )}' must be one of integer|string`
      );
    }
    if (!tiebreakColumn) {
      throw new VendorConfigError(
        vendor,
        path,
        `${where}: tiebreakType is set but no tiebreakColumn is declared`
      );
    }
    tiebreakType = raw.tiebreakType;
  }

  if (
    tiebreakColumn &&
    outputs !== null &&
    !outputs.includes(tiebreakColumn.toLowerCase())
  ) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: tiebreakColumn '${tiebreakColumn}' is not in the SELECT output (${outputs.join(", ")})`
    );
  }

  const sWhere = `${where}: `;
  const streamCursorFormat = validateCursorFormat(raw.cursorFormat, vendor, path, sWhere);
  if (streamCursorFormat && cursorTypeRaw !== "timestamp") {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: cursorFormat only applies to cursorType: timestamp`
    );
  }
  const timezone = validateTimezone(raw.timezone, vendor, path, sWhere);
  let cursorSqlType: StreamConfig["cursorSqlType"];
  if (raw.cursorSqlType !== undefined && raw.cursorSqlType !== null) {
    if (raw.cursorSqlType !== "datetime" && raw.cursorSqlType !== "datetime2") {
      throw new VendorConfigError(
        vendor,
        path,
        `${where}: cursorSqlType '${String(raw.cursorSqlType)}' must be one of datetime|datetime2`
      );
    }
    cursorSqlType = raw.cursorSqlType;
  }
  const decimalFormat = validateDecimalFormat(raw.decimalFormat, vendor, path, sWhere);
  const lookbackMinutes = validateRange(raw.lookbackMinutes, "lookbackMinutes", 0, 1440, false, vendor, path, sWhere);
  const initialHorizonDays = validateRange(raw.initialHorizonDays, "initialHorizonDays", 0, 3650, true, vendor, path, sWhere);
  const diagnosticTable = optionalStringField(raw, "diagnosticTable");
  if (diagnosticTable !== undefined && !isSafeIdentifierPath(diagnosticTable)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: diagnosticTable '${diagnosticTable}' must be a plain (optionally schema-qualified) identifier`
    );
  }
  const statusColumn = optionalStringField(raw, "statusColumn");
  if (statusColumn !== undefined && !isSafeIdentifierPath(statusColumn)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: statusColumn '${statusColumn}' must be a plain identifier`
    );
  }

  return {
    kind,
    cursorColumn,
    cursorType: cursorTypeRaw,
    query,
    map,
    tiebreakColumn,
    tiebreakType,
    intervalSeconds,
    ...(streamCursorFormat ? { cursorFormat: streamCursorFormat } : {}),
    ...(timezone ? { timezone } : {}),
    ...(cursorSqlType ? { cursorSqlType } : {}),
    ...(decimalFormat ? { decimalFormat } : {}),
    ...(lookbackMinutes !== undefined ? { lookbackMinutes } : {}),
    ...(initialHorizonDays !== undefined ? { initialHorizonDays } : {}),
    ...(diagnosticTable ? { diagnosticTable } : {}),
    ...(statusColumn ? { statusColumn } : {}),
  };
}

function validateMap(
  raw: Record<string, unknown>,
  kind: CanonicalEventKind,
  vendor: string,
  path: string,
  where: string
): StreamFieldMap {
  const out: StreamFieldMap = {};
  for (const [field, value] of Object.entries(raw)) {
    out[field] = validateFieldMapping(value, field, vendor, path, where);
  }
  if ("originalInvoiceId" in out && kind !== "InvoiceRefunded") {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}: map.originalInvoiceId is only valid on InvoiceRefunded streams`
    );
  }
  const required = [...ALWAYS_REQUIRED, ...REQUIRED_FIELDS_BY_KIND[kind]];
  for (const r of required) {
    if (!(r in out)) {
      throw new VendorConfigError(
        vendor,
        path,
        `${where}: kind=${kind} requires \`map.${r}\` (worker contract: events missing this field are silently dropped)`
      );
    }
  }
  return out;
}

function validateFieldMapping(
  value: unknown,
  field: string,
  vendor: string,
  path: string,
  where: string
): FieldMapping {
  if (typeof value === "string") return value;
  if (typeof value === "number") return { literal: value };
  if (!value || typeof value !== "object") {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}.map.${field}: expected string (column ref), number (literal), or mapping ({from|template|literal, transform})`
    );
  }
  const obj = value as Record<string, unknown>;
  if (obj.transform && !VALID_TRANSFORMS.has(obj.transform as TransformName)) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}.map.${field}: unknown transform '${String(obj.transform)}'`
    );
  }
  const decimalFormat = validateDecimalFormat(
    obj.decimalFormat,
    vendor,
    path,
    `${where}.map.${field}: `
  );
  const hasFrom = typeof obj.from === "string";
  const hasTemplate = typeof obj.template === "string";
  const hasLiteral = "literal" in obj;
  const n = [hasFrom, hasTemplate, hasLiteral].filter(Boolean).length;
  if (n === 0) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}.map.${field}: mapping needs one of from|template|literal`
    );
  }
  if (n > 1) {
    throw new VendorConfigError(
      vendor,
      path,
      `${where}.map.${field}: from/template/literal are mutually exclusive`
    );
  }
  return {
    from: hasFrom ? (obj.from as string) : undefined,
    template: hasTemplate ? (obj.template as string) : undefined,
    literal: hasLiteral
      ? (obj.literal as string | number | undefined)
      : undefined,
    transform: obj.transform as TransformName | undefined,
    ...(decimalFormat ? { decimalFormat } : {}),
  };
}

// ---------- field helpers --------------------------------------------------

function stringField(
  raw: Record<string, unknown>,
  field: string,
  path: string,
  vendor: string
): string {
  const v = raw[field];
  if (typeof v !== "string" || v.trim() === "") {
    throw new VendorConfigError(
      vendor,
      path,
      `missing required string field '${field}'`
    );
  }
  return v;
}

function optionalStringField(
  raw: Record<string, unknown>,
  field: string
): string | undefined {
  const v = raw[field];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numberFieldOrDefault(
  raw: Record<string, unknown>,
  field: string,
  def: number
): number {
  const v = raw[field];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return def;
}

function optionalNumberField(
  raw: Record<string, unknown>,
  field: string
): number | undefined {
  const v = raw[field];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
