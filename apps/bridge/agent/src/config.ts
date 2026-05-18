import { readFile, writeFile, mkdir } from "node:fs/promises";
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
  // Secret is read from secure-store, never persisted in this JSON.
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

export async function loadConfig(): Promise<AgentConfig | null> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return JSON.parse(raw) as AgentConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(cfg: AgentConfig): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(cfg, null, 2), "utf8");
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
