import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { CsvMapping } from "./csv-mapper.js";

/**
 * Local config persistence for the agent.
 *
 * Windows: %APPDATA%\EINS-Agent\config.json + secret in DPAPI
 * macOS:   ~/Library/Application Support/EINS-Agent/config.json + secret in Keychain
 * Linux:   ~/.config/eins-agent/config.json + secret in plaintext (with warning)
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
  // PVS HMAC secret is read from secure-store, never persisted in this JSON.
}

export function configDir(): string {
  switch (process.platform) {
    case "win32":
      return join(
        process.env.APPDATA ??
          join(homedir(), "AppData", "Roaming"),
        "EINS-Agent"
      );
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "EINS-Agent"
      );
    default:
      return join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "eins-agent"
      );
  }
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
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ConfigError(
      `config at ${path} could not be read: ${(err as Error).message}. ` +
        `Fix permissions or restore the file (a backup may exist at ${path}.bak). ` +
        `Do NOT re-run --enroll: the enrollment token is one-time and already used.`
    );
  }
  // Strip a leading UTF-8 BOM (U+FEFF) before parsing. Notepad writes one by
  // default when an operator hand-edits config.json, and JSON.parse rejects
  // it. charCodeAt avoids embedding a literal BOM in this source file.
  const cleaned =
    raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  try {
    return JSON.parse(cleaned) as AgentConfig;
  } catch (err) {
    throw new ConfigError(
      `config at ${path} is not valid JSON: ${(err as Error).message}. ` +
        `Fix or restore the file (a backup may exist at ${path}.bak). ` +
        `Do NOT re-run --enroll: the enrollment token is one-time and already used.`
    );
  }
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
  const tmp = join(dir, `config.json.tmp-${process.pid}`);
  const body = JSON.stringify(cfg, null, 2);
  await writeFile(tmp, body, "utf8");

  // Best-effort backup of the previous config so a bad save (or a later
  // hand-edit) has a known-good restore point. Absent on first enrollment.
  try {
    const prev = await readFile(target, "utf8");
    await writeFile(`${target}.bak`, prev, "utf8");
  } catch {
    // No previous config (first save) or unreadable: nothing to back up.
  }

  try {
    await rename(tmp, target);
  } catch {
    // Windows can refuse a rename-over-existing if the target is briefly
    // locked; fall back to unlink + rename. On failure here the temp file is
    // left behind for forensics rather than clobbering a possibly-good target.
    await unlink(target).catch(() => {});
    await rename(tmp, target);
  }
}

/**
 * Load a CsvMapping from a path supplied on the CLI. Returns null on any
 * read or parse error so the caller can fall back to auto-detection.
 *
 * Light validation: stream must be one of the five known names and
 * `columns.pvsPatientId` must be present (every stream requires it). The
 * full Zod-grade validation lives at apps/portal/src/server/pvs-csv-mapper.ts;
 * here we keep the agent thin and rely on per-row validation in
 * mapCsvRow to reject malformed entries.
 */
export async function loadCsvMappingFile(
  path: string
): Promise<CsvMapping | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.stream === "string" &&
      ["patients", "appointments", "encounters", "recalls", "invoices"].includes(
        parsed.stream
      ) &&
      parsed.columns &&
      typeof parsed.columns.pvsPatientId === "string"
    ) {
      return parsed as CsvMapping;
    }
    return null;
  } catch {
    return null;
  }
}
