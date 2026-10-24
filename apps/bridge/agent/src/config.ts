import { readFile, mkdir } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { homedir } from "node:os";
import type { CsvMapping } from "./csv-mapper.js";
import { atomicWriteFile } from "./atomic-write.js";
import { envGet } from "./win-context.js";

/**
 * Local config persistence for the agent.
 *
 * Windows: %ProgramData%\EINS-Agent\config.json + secrets in DPAPI (machine
 *          scope; see secure-store.ts). Machine-wide on purpose: the agent runs
 *          as a LocalSystem scheduled task with nobody logged in, and a
 *          per-user %APPDATA% would resolve to the (empty) systemprofile there.
 *          The directory is locked down to SYSTEM + Administrators by
 *          data-dir.ts. The legacy per-user location (%APPDATA%\EINS-Agent) is
 *          migrated once by data-dir-migration.ts.
 * macOS:   ~/Library/Application Support/EINS-Agent/config.json + secret in Keychain
 * Linux:   ~/.config/eins-agent/config.json + secret in plaintext (with warning)
 *
 * EINS_AGENT_DATA_DIR overrides the location on every platform (development,
 * tests, unusual deployments). An override is never ACL-hardened by the agent.
 */

/**
 * Connection params for a single enabled DB-adapter. The password is
 * stored separately in secure-store under `credentialId`; this struct
 * carries only the non-secret half. `vendor` matches a `vendor:` field in
 * one of the bundled YAML configs (apps/bridge/agent/src/db-adapters/configs).
 */
export interface DbAdapterEnrollment {
  vendor: string;
  credentialId: string;
  host: string;
  port?: number;
  database?: string;
  username: string;
}

export interface AgentConfig {
  clinicId: string;
  portalBaseUrl: string;
  watchFolder: string;
  machineFingerprint: string;
  /**
   * Optional second watch folder for Honorar / Abrechnungs CSV exports.
   * When set, the agent starts a second chokidar watcher on this folder
   * and emits InvoicePaid events for each row. Mapping is taken from
   * `honorarCsvMapping` when provided, else auto-detected per file.
   */
  honorarCsvFolder?: string;
  honorarCsvMapping?: CsvMapping;
  /**
   * SQL-introspection adapter enrollments. Each entry references a bundled
   * vendor config by id and stores the connection parameters captured at
   * enrollment time. The DB password lives in secure-store, never in
   * config.json.
   */
  dbAdapters?: DbAdapterEnrollment[];
  /**
   * GDT receiver (Empfaenger) id this agent announces to the PVS in the GDT
   * files it writes/expects. 1-8 characters of [A-Za-z0-9_]; defaults to
   * "EINS" when absent. Read it through `effectiveGdtReceiverId(cfg)`, never
   * directly. Set at enrollment with `--gdt-receiver-id <id>`.
   */
  gdtReceiverId?: string;
  // PVS HMAC secret is read from secure-store, never persisted in this JSON.
}

// ---------- GDT receiver id ------------------------------------------------

export const DEFAULT_GDT_RECEIVER_ID = "EINS";
const GDT_RECEIVER_ID_RE = /^[A-Za-z0-9_]{1,8}$/;

/** True when `id` is a legal GDT receiver id (1-8 chars of [A-Za-z0-9_]). */
export function isValidGdtReceiverId(id: unknown): id is string {
  return typeof id === "string" && GDT_RECEIVER_ID_RE.test(id);
}

/**
 * The receiver id to use: the configured one, or "EINS" when none is set.
 * A value that is present but illegal is an operator error in a hand-edited
 * config and fails loudly (ConfigError) instead of silently falling back to
 * the default and talking to the PVS under the wrong identity.
 */
export function effectiveGdtReceiverId(
  cfg: Pick<AgentConfig, "gdtReceiverId">
): string {
  const id = cfg.gdtReceiverId;
  if (id === undefined || id === null) return DEFAULT_GDT_RECEIVER_ID;
  if (!isValidGdtReceiverId(id)) {
    throw new ConfigError(
      `config gdtReceiverId '${String(id)}' is invalid: expected 1-8 characters of ` +
        `[A-Za-z0-9_]. Fix gdtReceiverId in ${configPath()} (or remove it to use ` +
        `the default '${DEFAULT_GDT_RECEIVER_ID}').`
    );
  }
  return id;
}

// ---------- data directory --------------------------------------------------

interface DataDirContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

function currentContext(): DataDirContext {
  return { platform: process.platform, env: process.env, home: homedir() };
}

/**
 * Pure data-dir resolution (injectable platform / env / home for tests).
 *
 *   EINS_AGENT_DATA_DIR            -> that path, any platform
 *   win32                          -> %ProgramData%\EINS-Agent
 *                                     (fallback <SystemDrive>\ProgramData)
 *   darwin / linux                 -> unchanged from before
 *
 * win32 / posix path flavours are chosen explicitly so the result does not
 * depend on the OS the code happens to run on.
 */
export function resolveDataDir(ctx: DataDirContext = currentContext()): string {
  const override = envGet(ctx.env, "EINS_AGENT_DATA_DIR")?.trim();
  if (override) return override;
  switch (ctx.platform) {
    case "win32": {
      const configured = envGet(ctx.env, "ProgramData")?.trim();
      const base =
        configured && win32.isAbsolute(configured)
          ? configured
          : win32.join(
              envGet(ctx.env, "SystemDrive")?.trim() || "C:",
              "ProgramData"
            );
      return win32.join(base, "EINS-Agent");
    }
    case "darwin":
      return posix.join(
        ctx.home,
        "Library",
        "Application Support",
        "EINS-Agent"
      );
    default:
      return posix.join(
        envGet(ctx.env, "XDG_CONFIG_HOME") ?? posix.join(ctx.home, ".config"),
        "eins-agent"
      );
  }
}

/**
 * The per-user directory older agent versions used on Windows
 * (%APPDATA%\EINS-Agent of the CURRENT user). null on every other platform,
 * where nothing moved. Only data-dir-migration.ts looks at it.
 */
export function legacyUserDataDir(
  ctx: DataDirContext = currentContext()
): string | null {
  if (ctx.platform !== "win32") return null;
  const appData = envGet(ctx.env, "APPDATA")?.trim();
  return win32.join(
    appData || win32.join(ctx.home, "AppData", "Roaming"),
    "EINS-Agent"
  );
}

/**
 * True when the data dir was chosen by EINS_AGENT_DATA_DIR rather than the
 * platform default. data-dir.ts never ACL-hardens an override.
 */
export function dataDirIsOverridden(
  ctx: DataDirContext = currentContext()
): boolean {
  return !!envGet(ctx.env, "EINS_AGENT_DATA_DIR")?.trim();
}

/** Machine-wide data directory (see resolveDataDir). */
export function configDir(): string {
  return resolveDataDir();
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function outboxPath(): string {
  return join(configDir(), "outbox.sqlite");
}

/**
 * H13.2: a corrupt config.json (Notepad BOM, trailing comma, torn write)
 * must be distinguishable from a missing one, because the advice differs
 * fundamentally: "not enrolled" → run --enroll; "corrupt" → fix/restore the
 * file (re-enrollment is WRONG, the enrollment token is one-time and already
 * spent). ConfigError carries the corrupt-file message so callers can print
 * it verbatim without re-deriving the guidance.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load the persisted config.
 *
 *   • File absent (ENOENT)  → returns null ("not enrolled yet").
 *   • Read or JSON error    → throws ConfigError with the exact problem,
 *                             the file path, the `.bak` restore hint, and an
 *                             explicit "do NOT re-enroll" note.
 *
 * A UTF-8 BOM (Notepad's default when an operator hand-edits the file) is
 * stripped before parsing so an otherwise-valid config isn't rejected for a
 * leading 0xFEFF.
 */
export async function loadConfig(): Promise<AgentConfig | null> {
  const path = configPath();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // On Windows the data dir is restricted to SYSTEM + Administrators, so a
    // permission error from an ordinary user's prompt is expected, not corruption.
    const restricted =
      code === "EACCES" || code === "EPERM"
        ? ` The data directory is restricted to SYSTEM and Administrators: run this command ` +
          `from an elevated (Administrator) prompt. / Das Datenverzeichnis ist auf SYSTEM und ` +
          `Administratoren beschränkt: den Befehl in einer Eingabeaufforderung "Als Administrator ausführen" starten.`
        : "";
    throw new ConfigError(
      `config at ${path} could not be read: ${(err as Error).message}.${restricted} ` +
        `Fix permissions or restore the file (a backup may exist at ${path}.bak). ` +
        `Do NOT re-run --enroll: the enrollment token is one-time and already used.`
    );
  }
  // Strip a leading UTF-8 BOM (U+FEFF) before parsing. Notepad writes one by
  // default when an operator hand-edits config.json, and JSON.parse rejects
  // it. charCodeAt avoids embedding a literal BOM in this source file.
  const cleaned =
    raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed: AgentConfig;
  try {
    parsed = JSON.parse(cleaned) as AgentConfig;
  } catch (err) {
    throw new ConfigError(
      `config at ${path} is not valid JSON: ${(err as Error).message}. ` +
        `Fix or restore the file (a backup may exist at ${path}.bak). ` +
        `Do NOT re-run --enroll: the enrollment token is one-time and already used.`
    );
  }
  // Fail loudly at load time on a hand-edited, illegal receiver id rather than
  // on first use deep inside the watcher.
  if (parsed && typeof parsed === "object" && "gdtReceiverId" in parsed) {
    effectiveGdtReceiverId(parsed);
  }
  return parsed;
}

/**
 * H13.2: write config.json atomically so a crash or power loss mid-write can
 * never leave a torn/half-written file that then reads as "corrupt" on the
 * next boot. We write a sibling temp file, fsync-implicit via writeFile, back
 * up the previous config to `.bak`, then rename the temp over the target. The
 * rename is the single commit point: the target is always either the old
 * complete file or the new complete file, never a partial one.
 */
export async function saveConfig(cfg: AgentConfig): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const target = configPath();
  const body = JSON.stringify(cfg, null, 2);

  // Best-effort backup of the previous config so a bad save (or a later
  // hand-edit) has a known-good restore point. Absent on first enrollment.
  try {
    const prev = await readFile(target, "utf8");
    await atomicWriteFile(`${target}.bak`, prev);
  } catch {
    // No previous config (first save) or unreadable: nothing to back up.
  }

  // fsync + rename with retry, and no unlink-then-rename fallback: that
  // fallback opened a window where a crash lost both the old and the new file.
  await atomicWriteFile(target, body);
}

/**
 * Raised by loadCsvMappingFileStrict when a mapping file given on the CLI is
 * unreadable, not JSON, or not a recognisable mapping. The message names the
 * file and the exact problem so the operator can fix it; it never carries
 * file content beyond the JSON parser's own position hint.
 */
export class MappingFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MappingFileError";
  }
}

const CSV_STREAMS = [
  "patients",
  "appointments",
  "encounters",
  "recalls",
  "invoices",
];

/**
 * Parse + lightly validate the TEXT of a mapping file. Strips a leading UTF-8
 * BOM (Notepad writes one) and throws MappingFileError with a specific reason
 * on invalid JSON or an unusable shape. `path` is only used in messages.
 *
 * Light validation: stream must be one of the five known names and
 * `columns.pvsPatientId` must be present (every stream requires it). The
 * full Zod-grade validation lives at apps/portal/src/server/pvs-csv-mapper.ts;
 * here we keep the agent thin and rely on per-row validation in
 * mapCsvRow to reject malformed entries.
 */
export function parseCsvMappingText(raw: string, path: string): CsvMapping {
  // charCodeAt avoids embedding a literal BOM in this source file.
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new MappingFileError(
      `mapping file ${path} is not valid JSON: ${(err as Error).message}. ` +
        `Fix the file (check commas and quotes) and run the command again. ` +
        `No fallback to auto-detection is used.`
    );
  }
  const obj = parsed as {
    stream?: unknown;
    columns?: { pvsPatientId?: unknown } | null;
  } | null;
  if (
    !obj ||
    typeof obj !== "object" ||
    typeof obj.stream !== "string" ||
    !CSV_STREAMS.includes(obj.stream)
  ) {
    throw new MappingFileError(
      `mapping file ${path} has no valid "stream" (expected one of: ` +
        `${CSV_STREAMS.join(", ")}).`
    );
  }
  if (!obj.columns || typeof obj.columns.pvsPatientId !== "string") {
    throw new MappingFileError(
      `mapping file ${path} is missing "columns.pvsPatientId" (required for every stream).`
    );
  }
  return parsed as CsvMapping;
}

/**
 * Load a CsvMapping from a path supplied on the CLI and FAIL LOUDLY: throws
 * MappingFileError on a read error, a JSON typo or an unusable shape. Used by
 * `--enroll --honorar-mapping` and `--configure-honorar`, where silently
 * falling back to auto-detect would ingest invoices under the wrong mapping.
 */
export async function loadCsvMappingFileStrict(
  path: string
): Promise<CsvMapping> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new MappingFileError(
      `mapping file ${path} could not be read: ${(err as Error).message}`
    );
  }
  return parseCsvMappingText(raw, path);
}

/**
 * Lenient variant kept for callers that want a null on any problem. A UTF-8
 * BOM is stripped like in the strict loader. Prefer loadCsvMappingFileStrict
 * on any CLI path: this one cannot tell the caller WHY the file was rejected.
 */
export async function loadCsvMappingFile(
  path: string
): Promise<CsvMapping | null> {
  try {
    return await loadCsvMappingFileStrict(path);
  } catch {
    return null;
  }
}
