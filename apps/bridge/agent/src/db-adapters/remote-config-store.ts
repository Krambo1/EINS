import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "../config.js";
import { isSafeVendorId } from "./config-signature.js";

/**
 * On-disk cache for remotely delivered vendor configs.
 *
 * Layout under <configDir>/vendor-configs/:
 *
 *   <vendor>.yaml            the config currently in force
 *   <vendor>.json            its metadata (version, digest, signer, appliedAt)
 *   <vendor>.prev.yaml       the config it replaced
 *   <vendor>.prev.json       and that one's metadata
 *   <vendor>.quarantine.json versions this machine must never apply again
 *   rollbacks.json           the last few automatic rollbacks, for the heartbeat
 *
 * The `.prev` pair exists for the probation rollback (see config-sync.ts): a
 * pushed config that halts streams which were healthy a minute ago gets undone
 * on the machine itself, without waiting for anyone to notice in the portal.
 *
 * Every write goes through a temp file + rename so a power cut mid-write leaves
 * either the old complete config or the new one, never a half-file that would
 * fail YAML validation on the next boot. Same commit-point discipline as
 * config.ts's saveConfig.
 *
 * A vendor id is only ever used as a filename after isSafeVendorId(); the id
 * arrives from the network, and every path helper here re-checks rather than
 * trusting an earlier caller.
 */

export interface RemoteConfigMeta {
  vendor: string;
  version: number;
  sha256: string;
  keyId: string;
  signature: string;
  signedAt: number;
  minAgentVersion: string;
  notes: string | null;
  /** Epoch-ms this agent put the config into force. */
  appliedAt: number;
  /**
   * Per-stream status for this vendor captured immediately BEFORE the apply.
   * The probation check compares against it: a stream that was fine before and
   * is halted after is a regression caused by the new config, whereas a stream
   * that was already halted (that is usually WHY the config was pushed) is not.
   */
  preApplyStatuses: Array<{ stream: string; status: string }>;
  /** Set once the probation window closed without a regression. */
  probationClearedAt?: number;
}

export interface QuarantineEntry {
  version: number;
  reason: string;
  at: number;
}

export interface RollbackRecord {
  vendor: string;
  /** The version that was rolled back. */
  rejectedVersion: number;
  /** The version restored in its place, or null when we fell back to bundled. */
  revertedTo: number | null;
  reason: string;
  at: number;
}

/** Keep the heartbeat payload bounded; older rollbacks stay in the agent log. */
const MAX_ROLLBACK_RECORDS = 10;

export function configStoreDir(): string {
  return join(configDir(), "vendor-configs");
}

function assertSafeVendor(vendor: string): string {
  if (!isSafeVendorId(vendor)) {
    throw new Error(`unsafe vendor id '${vendor}' refused as a filename`);
  }
  return vendor;
}

function activeYamlPath(vendor: string): string {
  return join(configStoreDir(), `${assertSafeVendor(vendor)}.yaml`);
}
function activeMetaPath(vendor: string): string {
  return join(configStoreDir(), `${assertSafeVendor(vendor)}.json`);
}
function prevYamlPath(vendor: string): string {
  return join(configStoreDir(), `${assertSafeVendor(vendor)}.prev.yaml`);
}
function prevMetaPath(vendor: string): string {
  return join(configStoreDir(), `${assertSafeVendor(vendor)}.prev.json`);
}
function quarantinePath(vendor: string): string {
  return join(configStoreDir(), `${assertSafeVendor(vendor)}.quarantine.json`);
}
function rollbacksPath(): string {
  return join(configStoreDir(), "rollbacks.json");
}

async function writeAtomic(path: string, body: string): Promise<void> {
  await mkdir(configStoreDir(), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, body, "utf8");
  try {
    await rename(tmp, path);
    return;
  } catch (firstErr) {
    // Windows can refuse rename-over-existing while the target is briefly
    // locked (AV scan). Never delete the good target first: that loses it if
    // the second rename fails as well. Move it ASIDE to .bak, put the new file
    // in place, and restore .bak if that fails. The temp file is left for
    // forensics on a final failure.
    const bak = `${path}.bak`;
    let movedAside = false;
    try {
      await rm(bak, { force: true });
      await rename(path, bak);
      movedAside = true;
    } catch (asideErr) {
      if ((asideErr as NodeJS.ErrnoException).code !== "ENOENT") {
        // The target is locked even for a rename: leave it exactly as it was.
        throw firstErr;
      }
    }
    try {
      await rename(tmp, path);
    } catch (secondErr) {
      if (movedAside) {
        await rename(bak, path).catch(() => void 0);
      }
      throw secondErr;
    }
    await rm(bak, { force: true }).catch(() => void 0);
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export interface StoredConfig {
  yaml: string;
  meta: RemoteConfigMeta;
}

/**
 * The config currently in force for `vendor`, or null when this machine has
 * never applied a remote config for it (bundled config still wins).
 *
 * A meta file without its YAML sibling (or vice versa) reads as "nothing
 * stored": a half-present pair is not something to run SQL from.
 */
export async function readActiveConfig(
  vendor: string
): Promise<StoredConfig | null> {
  if (!isSafeVendorId(vendor)) return null;
  const meta = await readJson<RemoteConfigMeta>(activeMetaPath(vendor));
  if (!meta || typeof meta.version !== "number" || meta.vendor !== vendor) {
    return null;
  }
  let yaml: string;
  try {
    yaml = await readFile(activeYamlPath(vendor), "utf8");
  } catch {
    return null;
  }
  return { yaml, meta };
}

/** Every vendor with a stored remote config, for boot-time overlay + heartbeat. */
export async function listStoredVendors(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(configStoreDir());
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    // `<vendor>.json` only; `.prev.json` / `.quarantine.json` / rollbacks.json
    // are excluded by the dot check and the safe-id test.
    if (!entry.endsWith(".json")) continue;
    const base = entry.slice(0, -".json".length);
    if (base.includes(".")) continue;
    if (!isSafeVendorId(base)) continue;
    out.push(base);
  }
  return out.sort();
}

/**
 * Put a new config into force, keeping the one it replaces as `.prev` so the
 * probation check can undo it. Writes the YAML first: if the process dies
 * between the two writes, the meta still points at the OLD version and the
 * orphan YAML is simply overwritten on the next attempt. The reverse order
 * would claim the new version is live while the old SQL is still on disk.
 */
export async function applyConfig(
  vendor: string,
  yaml: string,
  meta: RemoteConfigMeta
): Promise<void> {
  assertSafeVendor(vendor);
  const current = await readActiveConfig(vendor);
  if (current) {
    await writeAtomic(prevYamlPath(vendor), current.yaml);
    await writeAtomic(prevMetaPath(vendor), JSON.stringify(current.meta, null, 2));
  } else {
    // No previous remote config: a rollback goes back to the bundled config,
    // so make sure a stale `.prev` from an earlier generation can't be restored.
    await clearPrev(vendor);
  }
  await writeAtomic(activeYamlPath(vendor), yaml);
  await writeAtomic(activeMetaPath(vendor), JSON.stringify(meta, null, 2));
}

/** Overwrite the active meta in place (used to stamp probationClearedAt). */
export async function updateActiveMeta(
  vendor: string,
  meta: RemoteConfigMeta
): Promise<void> {
  assertSafeVendor(vendor);
  await writeAtomic(activeMetaPath(vendor), JSON.stringify(meta, null, 2));
}

export async function readPrevConfig(
  vendor: string
): Promise<StoredConfig | null> {
  if (!isSafeVendorId(vendor)) return null;
  const meta = await readJson<RemoteConfigMeta>(prevMetaPath(vendor));
  if (!meta || typeof meta.version !== "number") return null;
  let yaml: string;
  try {
    yaml = await readFile(prevYamlPath(vendor), "utf8");
  } catch {
    return null;
  }
  return { yaml, meta };
}

export async function clearPrev(vendor: string): Promise<void> {
  assertSafeVendor(vendor);
  await rm(prevYamlPath(vendor), { force: true });
  await rm(prevMetaPath(vendor), { force: true });
}

/**
 * Undo the active config. With a `.prev` present we restore it; without one
 * the config came from a machine that had only ever run the bundled config,
 * so we delete the remote pair entirely and the loader falls back to bundled.
 * Returns the version we landed on (null = bundled).
 */
export async function revertConfig(vendor: string): Promise<number | null> {
  assertSafeVendor(vendor);
  const prev = await readPrevConfig(vendor);
  if (!prev) {
    await rm(activeYamlPath(vendor), { force: true });
    await rm(activeMetaPath(vendor), { force: true });
    return null;
  }
  await writeAtomic(activeYamlPath(vendor), prev.yaml);
  await writeAtomic(
    activeMetaPath(vendor),
    JSON.stringify({ ...prev.meta, appliedAt: Date.now() }, null, 2)
  );
  await clearPrev(vendor);
  return prev.meta.version;
}

export async function readQuarantine(vendor: string): Promise<QuarantineEntry[]> {
  if (!isSafeVendorId(vendor)) return [];
  const data = await readJson<{ entries?: QuarantineEntry[] }>(
    quarantinePath(vendor)
  );
  if (!data || !Array.isArray(data.entries)) return [];
  return data.entries.filter(
    (e) => e && typeof e.version === "number" && typeof e.reason === "string"
  );
}

/**
 * Refuse a version on this machine (until the entry expires, see config-sync
 * QUARANTINE_TTL_MS). Without this, the portal keeps advertising the bad version
 * in the manifest and the agent would re-apply, regress, roll back, re-apply, in
 * a loop every 60 seconds. Recovery is a NEW signed version, which is exactly
 * what an operator would publish anyway.
 */
export async function addQuarantine(
  vendor: string,
  version: number,
  reason: string,
  at: number = Date.now()
): Promise<void> {
  assertSafeVendor(vendor);
  const entries = await readQuarantine(vendor);
  // A repeated rollback of the same version refreshes its timestamp: the
  // quarantine expires (config-sync QUARANTINE_TTL_MS), so a judgement is only
  // ever as old as its last confirmation.
  const existing = entries.findIndex((e) => e.version === version);
  if (existing !== -1) entries.splice(existing, 1);
  entries.push({ version, reason: reason.slice(0, 500), at });
  await writeAtomic(
    quarantinePath(vendor),
    JSON.stringify({ entries: entries.slice(-50) }, null, 2)
  );
}

export async function readRollbacks(): Promise<RollbackRecord[]> {
  const data = await readJson<{ records?: RollbackRecord[] }>(rollbacksPath());
  if (!data || !Array.isArray(data.records)) return [];
  return data.records;
}

export async function appendRollback(record: RollbackRecord): Promise<void> {
  const records = await readRollbacks();
  records.push(record);
  await writeAtomic(
    rollbacksPath(),
    JSON.stringify({ records: records.slice(-MAX_ROLLBACK_RECORDS) }, null, 2)
  );
}
