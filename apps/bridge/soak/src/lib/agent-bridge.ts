import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AGENT_DIR } from "./env.js";

/**
 * Bridge into the agent's OWN persistence modules (config.ts, secure-store.ts)
 * so the harness writes credentials and config in exactly the format the
 * agent reads — no reimplementation drift possible.
 *
 * The agent derives its config dir from %APPDATA% at CALL time, so we swap
 * process.env.APPDATA around each call to address the per-clinic stores.
 * Loaded lazily via dynamic import (tsx resolves the .ts sources).
 */

type AgentConfigModule = {
  loadConfig: () => Promise<AgentConfig | null>;
  saveConfig: (cfg: AgentConfig) => Promise<void>;
  configPath: () => string;
};

type SecureStoreModule = {
  storeDbCredential: (id: string, password: string) => Promise<void>;
  loadDbCredential: (id: string) => Promise<string | null>;
};

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
  honorarCsvFolder?: string;
  honorarCsvMapping?: unknown;
  dbAdapters?: DbAdapterEnrollment[];
}

let configMod: AgentConfigModule | null = null;
let storeMod: SecureStoreModule | null = null;

async function mods(): Promise<{ cfg: AgentConfigModule; store: SecureStoreModule }> {
  if (!configMod) {
    configMod = (await import(
      pathToFileURL(join(AGENT_DIR, "src", "config.ts")).href
    )) as AgentConfigModule;
  }
  if (!storeMod) {
    storeMod = (await import(
      pathToFileURL(join(AGENT_DIR, "src", "secure-store.ts")).href
    )) as SecureStoreModule;
  }
  return { cfg: configMod, store: storeMod };
}

async function withAppdata<T>(appdata: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.APPDATA;
  process.env.APPDATA = appdata;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prev;
  }
}

export async function readAgentConfig(appdata: string): Promise<AgentConfig | null> {
  const { cfg } = await mods();
  return withAppdata(appdata, () => cfg.loadConfig());
}

export async function writeAgentConfig(
  appdata: string,
  config: AgentConfig
): Promise<void> {
  const { cfg } = await mods();
  await withAppdata(appdata, () => cfg.saveConfig(config));
}

export async function writeDbCredential(
  appdata: string,
  credentialId: string,
  password: string
): Promise<void> {
  const { store } = await mods();
  await withAppdata(appdata, () => store.storeDbCredential(credentialId, password));
}
