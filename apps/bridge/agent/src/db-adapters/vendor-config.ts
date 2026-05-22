import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  CanonicalEventKind,
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
 */

const VALID_KINDS: ReadonlySet<CanonicalEventKind> = new Set([
  "PatientUpserted",
  "AppointmentCreated",
  "AppointmentStatusChanged",
  "AppointmentCancelled",
  "EncounterCompleted",
  "InvoicePaid",
  "RecallScheduled",
  "PatientMerged",
]);

const VALID_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "gender",
  "appointmentStatus",
  "amountToCents",
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
const REQUIRED_FIELDS_BY_KIND: Record<CanonicalEventKind, string[]> = {
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
const ALWAYS_REQUIRED: string[] = ["pvsExternalEventId", "occurredAt"];

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
  if (
    bridgeSource !== "tomedo" &&
    bridgeSource !== "healthhub" &&
    bridgeSource !== "red" &&
    bridgeSource !== "gdt_agent" &&
    bridgeSource !== "csv_upload" &&
    bridgeSource !== "n8n_custom"
  ) {
    throw new VendorConfigError(
      vendor,
      path,
      `bridgeSource '${bridgeSource}' is not a known BridgeSource. The portal route rejects unknown values.`
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
    streams,
  };
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
  const map = validateMap(
    mapRaw as Record<string, unknown>,
    kind,
    vendor,
    path,
    where
  );

  const intervalSeconds = optionalNumberField(raw, "intervalSeconds");

  return {
    kind,
    cursorColumn,
    cursorType: cursorTypeRaw,
    query,
    map,
    intervalSeconds,
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
