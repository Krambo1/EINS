import {
  compareVersions,
  isSafeVendorId,
  verifyBundle,
  type TrustedConfigKey,
  type VendorConfigBundle,
} from "./config-signature.js";
import {
  addQuarantine,
  appendRollback,
  applyConfig,
  clearPrev,
  readActiveConfig,
  readPrevConfig,
  readQuarantine,
  readRollbacks,
  revertConfig,
  updateActiveMeta,
  type RemoteConfigMeta,
  type RollbackRecord,
  type StoredConfig,
} from "./remote-config-store.js";
import { isEnvironmentError } from "./error-classes.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type { VendorConfig } from "./types.js";

/**
 * Remote vendor-config delivery.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * A PVS update shifts a column and the agent's drift detector halts the
 * affected stream. Until now the only recovery was: edit the YAML, cut a new
 * agent build, and physically reinstall it on every affected Praxis machine.
 * At two Praxen that is an afternoon; at thirty on the same PVS it is thirty
 * site visits for a one-line change.
 *
 * With this module the agent pulls a signed replacement config on its next
 * heartbeat, verifies it, validates it exactly as it would a bundled config,
 * puts it into force and clears the halt. The site visit becomes a publish.
 *
 * THE PART THAT KEEPS IT SAFE
 * ---------------------------
 * Pushing configs to thirty machines is also how you break thirty machines at
 * once, so every apply is on probation. We snapshot each stream's status just
 * before the swap; if a stream that was healthy is halted a few minutes later,
 * the machine reverts itself to the previous config, quarantines the bad
 * version so it is never re-applied, and reports what it did on the heartbeat.
 * Recovery does not depend on anyone noticing in the portal.
 *
 * Layers, in the order they run, each of which can only reject:
 *   signature → yaml digest → monotonic version → quarantine → agent version
 *   → full YAML validation → identity cross-check → probation
 */

/** What the portal advertises on the heartbeat response. */
export interface VendorConfigManifestEntry {
  vendor: string;
  version: number;
  sha256: string;
}

/**
 * Statuses that a CONFIG can cause and that mean a stream is not producing
 * events. `error` is judged separately (see isConfigRegression): it is also what
 * a lost connection or a rotated password looks like after five failed polls,
 * and no config rollback can fix those. auth_failed and suspect_empty are never
 * regressions.
 */
const CONFIG_HALT_STATUSES = new Set(["schema_drift", "config_invalid"]);

/**
 * A quarantine is a judgement made on one machine at one moment; it must not
 * outlive the evidence. After this long the version may be applied again (and is
 * re-quarantined, with a fresh timestamp, if it regresses again).
 */
export const QUARANTINE_TTL_MS = 24 * 60 * 60_000;

/**
 * How long after an apply we start judging it. Streams poll on their own
 * cadence (60s by default), so a check that ran immediately would see the
 * pre-apply state and clear a genuinely broken config.
 */
export const PROBATION_GRACE_MS = 2 * 60_000;

/**
 * How long an applied config stays under observation. Past this, with no
 * regression, the `.prev` copy is dropped and the version is considered good.
 * Long enough for the slowest configured interval to have run several times.
 */
export const PROBATION_WINDOW_MS = 15 * 60_000;

export interface StreamStatusSnapshot {
  stream: string;
  status: string;
  /** Last error text of the stream (from the runner's status snapshot). Needed
   *  to tell a config-caused `error` from an environment-caused one. */
  lastError?: string | null;
  /** The vendor's last connection failure; while set, stream statuses say
   *  nothing about the config. */
  connectError?: string | null;
}

/**
 * Is `now` a halt the CONFIG caused? An `error` status counts only when its
 * lastError is known and is not environmental (connection lost, auth, timeout);
 * with no lastError there is no evidence, so no rollback.
 */
function isConfigRegression(now: StreamStatusSnapshot): boolean {
  if (now.connectError) return false;
  if (CONFIG_HALT_STATUSES.has(now.status)) return true;
  if (now.status !== "error") return false;
  if (!now.lastError) return false;
  return !isEnvironmentError(new Error(now.lastError));
}

/** Was the stream already halted (by anything) before the apply? */
function wasHalted(status: string | undefined): boolean {
  return (
    status === "error" ||
    status === "schema_drift" ||
    status === "config_invalid" ||
    status === "auth_failed"
  );
}

export type FetchBundlesResult =
  | { ok: true; bundles: unknown[] }
  | { ok: false; reason: string };

export interface ConfigSyncDeps {
  /** Vendor ids this agent actually runs (config.dbAdapters). */
  enabledVendors: string[];
  agentVersion: string;
  trustedKeys: ReadonlyArray<TrustedConfigKey>;
  /** Pull the full signed bundles for the given vendors from the portal. */
  fetchBundles: (vendors: string[]) => Promise<FetchBundlesResult>;
  /** Swap a vendor's config in the live runner. False = vendor not enabled. */
  reloadVendor: (vendor: string, cfg: VendorConfig) => boolean;
  /** Current per-stream status for one vendor, from the runner. */
  statusesFor: (vendor: string) => StreamStatusSnapshot[];
  /** The config that shipped with this build, for a rollback with no `.prev`. */
  loadBundledConfig: (vendor: string) => Promise<VendorConfig | null>;
  now: () => number;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface SyncOutcome {
  applied: Array<{ vendor: string; version: number }>;
  skipped: Array<{ vendor: string; version: number; reason: string }>;
  rolledBack: RollbackRecord[];
  /** Human-readable summary of what went wrong, for the heartbeat. */
  error: string | null;
}

function emptyOutcome(): SyncOutcome {
  return { applied: [], skipped: [], rolledBack: [], error: null };
}

/**
 * Versions this process already refused, so we stop re-fetching them.
 *
 * Without it, a bundle rejected for a reason the portal cannot see (an agent
 * too old for its `minAgentVersion`, a signature this build does not trust)
 * would be downloaded and rejected again on every single heartbeat, forever,
 * on every affected machine. The manifest keeps advertising it, and the local
 * version never moves.
 *
 * Deliberately IN MEMORY, unlike the on-disk quarantine. Some refusals stop
 * being true after a restart, most obviously `minAgentVersion` once the agent
 * has been upgraded; persisting those would make the upgrade look like it
 * changed nothing. A restart is exactly when re-trying is worth it.
 */
const refusedThisRun = new Map<string, Set<number>>();

function markRefused(vendor: string, version: number): void {
  const set = refusedThisRun.get(vendor) ?? new Set<number>();
  set.add(version);
  refusedThisRun.set(vendor, set);
}

function wasRefused(vendor: string, version: number): boolean {
  return refusedThisRun.get(vendor)?.has(version) ?? false;
}

/** Test-only: forget refusals between cases. */
export function _resetRefusedForTests(): void {
  refusedThisRun.clear();
}

/**
 * One full sync pass. Called from the heartbeat tick with whatever manifest
 * the portal returned (an empty array is normal and still runs probation).
 *
 * Probation runs FIRST: if the last push regressed this machine we want it
 * undone and quarantined before we look at what the portal is advertising,
 * otherwise a manifest still pointing at the bad version would re-apply it in
 * the same pass.
 */
export async function runConfigSync(
  manifest: VendorConfigManifestEntry[],
  deps: ConfigSyncDeps
): Promise<SyncOutcome> {
  const outcome = emptyOutcome();
  const errors: string[] = [];

  try {
    outcome.rolledBack = await runProbation(deps);
  } catch (err) {
    errors.push(`probation check failed: ${(err as Error).message}`);
  }

  try {
    const applyResult = await applyManifest(manifest, deps);
    outcome.applied = applyResult.applied;
    outcome.skipped = applyResult.skipped;
    if (applyResult.error) errors.push(applyResult.error);
  } catch (err) {
    errors.push(`config sync failed: ${(err as Error).message}`);
  }

  outcome.error = errors.length > 0 ? errors.join("; ").slice(0, 1_000) : null;
  return outcome;
}

// ---------------------------------------------------------------------------
// Manifest → apply
// ---------------------------------------------------------------------------

interface ApplyResult {
  applied: Array<{ vendor: string; version: number }>;
  skipped: Array<{ vendor: string; version: number; reason: string }>;
  error: string | null;
}

async function applyManifest(
  manifest: VendorConfigManifestEntry[],
  deps: ConfigSyncDeps
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], error: null };
  if (!Array.isArray(manifest) || manifest.length === 0) return result;

  // No trust anchor means every bundle would be refused after downloading it.
  // Say so once and skip the round-trip rather than fetching megabytes a minute
  // to throw them away.
  if (deps.trustedKeys.length === 0) {
    result.error =
      "this agent build carries no config signing key, so remote configs are refused; it keeps running its bundled configs";
    return result;
  }

  const enabled = new Set(deps.enabledVendors);
  const wanted: VendorConfigManifestEntry[] = [];

  for (const entry of manifest) {
    if (
      !entry ||
      !isSafeVendorId(entry.vendor) ||
      typeof entry.version !== "number" ||
      !Number.isSafeInteger(entry.version) ||
      entry.version < 1
    ) {
      // Malformed manifest rows are dropped silently-ish: the portal is the
      // only producer, so this is a version-skew guard, not an error state.
      continue;
    }
    // A config for a vendor this Praxis does not run is simply not our
    // business. The portal ships the full manifest so a freshly enabled
    // adapter is current from its first tick.
    if (!enabled.has(entry.vendor)) continue;

    const current = await readActiveConfig(entry.vendor);
    const localVersion = current?.meta.version ?? 0;
    if (entry.version === localVersion) continue;
    if (entry.version < localVersion) {
      // Downgrade attempt. Legitimate rollback is published as a NEW version
      // carrying the old content, so this only happens on a replay or on a
      // portal that lost rows. Never apply, always say so.
      result.skipped.push({
        vendor: entry.vendor,
        version: entry.version,
        reason: `portal offers v${entry.version} but this machine already runs v${localVersion}; refusing to downgrade`,
      });
      deps.warn(
        `[config-sync] ${entry.vendor}: portal advertises v${entry.version}, local is v${localVersion}. Refusing the downgrade. Publish a new version if you need to revert.`
      );
      continue;
    }
    const quarantined = await readQuarantine(entry.vendor);
    const hit = quarantined.find(
      (q) => q.version === entry.version && deps.now() - q.at < QUARANTINE_TTL_MS
    );
    if (hit) {
      result.skipped.push({
        vendor: entry.vendor,
        version: entry.version,
        reason: `quarantined on this machine: ${hit.reason}`,
      });
      continue;
    }
    if (wasRefused(entry.vendor, entry.version)) {
      result.skipped.push({
        vendor: entry.vendor,
        version: entry.version,
        reason:
          "already refused by this agent process; it will be retried after a restart",
      });
      continue;
    }
    wanted.push(entry);
  }

  if (wanted.length === 0) return result;

  const fetched = await deps.fetchBundles(wanted.map((w) => w.vendor));
  if (!fetched.ok) {
    result.error = `could not fetch vendor configs: ${fetched.reason}`;
    deps.warn(`[config-sync] ${result.error}`);
    return result;
  }

  const byVendor = new Map(wanted.map((w) => [w.vendor, w]));
  for (const raw of fetched.bundles) {
    const applied = await applyOneBundle(raw, byVendor, deps);
    if (applied.ok) {
      result.applied.push({ vendor: applied.vendor, version: applied.version });
    } else {
      result.skipped.push({
        vendor: applied.vendor,
        version: applied.version,
        reason: applied.reason,
      });
      // The same bytes fail the same way every time, so stop pulling them.
      if (applied.version > 0) markRefused(applied.vendor, applied.version);
      deps.error(
        `[config-sync] ${applied.vendor} v${applied.version}: REFUSED - ${applied.reason}`
      );
    }
  }
  return result;
}

type ApplyOne =
  | { ok: true; vendor: string; version: number }
  | { ok: false; vendor: string; version: number; reason: string };

async function applyOneBundle(
  raw: unknown,
  wanted: Map<string, VendorConfigManifestEntry>,
  deps: ConfigSyncDeps
): Promise<ApplyOne> {
  const verified = verifyBundle(raw, deps.trustedKeys);
  if (!verified.ok) {
    const probe = raw as { vendor?: unknown; version?: unknown };
    return {
      ok: false,
      vendor: isSafeVendorId(probe?.vendor) ? probe.vendor : "<unknown>",
      version: typeof probe?.version === "number" ? probe.version : 0,
      reason: verified.reason,
    };
  }
  const bundle: VendorConfigBundle = verified.bundle;

  const fail = (reason: string): ApplyOne => ({
    ok: false,
    vendor: bundle.vendor,
    version: bundle.version,
    reason,
  });

  // The portal is free to send extras, but we only apply what this pass asked
  // for. Anything else means the response does not match the manifest we acted
  // on, and applying it would skip every check we ran against the manifest.
  const request = wanted.get(bundle.vendor);
  if (!request) {
    return fail("bundle is for a vendor this sync pass did not request");
  }
  if (request.version !== bundle.version) {
    return fail(
      `bundle is v${bundle.version} but the manifest advertised v${request.version}`
    );
  }
  if (request.sha256 !== bundle.sha256) {
    return fail("bundle digest does not match the digest in the manifest");
  }

  if (compareVersions(deps.agentVersion, bundle.minAgentVersion) < 0) {
    return fail(
      `needs agent ${bundle.minAgentVersion}, this agent is ${deps.agentVersion}`
    );
  }

  // Re-validate with the SAME loader that validates bundled configs. The signer
  // already did this, but a config that only the signer approved is a config
  // nobody checked against the code actually running here.
  let cfg: VendorConfig;
  try {
    cfg = await loadVendorConfigFromString(bundle.yaml, `<remote:${bundle.vendor}>`);
  } catch (err) {
    return fail(`YAML failed validation: ${(err as Error).message}`);
  }

  // The signed header is what the portal displays and what the manifest is
  // keyed on. If it disagrees with the YAML, the operator is looking at a
  // different config from the one that would run.
  if (cfg.vendor !== bundle.vendor) {
    return fail(`YAML declares vendor '${cfg.vendor}', bundle claims '${bundle.vendor}'`);
  }
  if (cfg.bridgeSource !== bundle.bridgeSource) {
    return fail(
      `YAML declares bridgeSource '${cfg.bridgeSource}', bundle claims '${bundle.bridgeSource}'`
    );
  }
  if (cfg.driver !== bundle.driver) {
    return fail(`YAML declares driver '${cfg.driver}', bundle claims '${bundle.driver}'`);
  }

  const meta: RemoteConfigMeta = {
    vendor: bundle.vendor,
    version: bundle.version,
    sha256: bundle.sha256,
    keyId: bundle.keyId,
    signature: bundle.signature,
    signedAt: bundle.signedAt,
    minAgentVersion: bundle.minAgentVersion,
    notes: bundle.notes,
    appliedAt: deps.now(),
    preApplyStatuses: deps.statusesFor(bundle.vendor),
  };

  await applyConfig(bundle.vendor, bundle.yaml, meta);

  if (!deps.reloadVendor(bundle.vendor, cfg)) {
    // Written but not live: the runner has no such vendor (it failed to start,
    // or the adapter was disabled between the manifest check and now). The file
    // is in place, so the next agent start picks it up.
    deps.warn(
      `[config-sync] ${bundle.vendor} v${bundle.version} stored but the runner has no such vendor; it takes effect on the next agent start.`
    );
  } else {
    deps.log(
      `[config-sync] ${bundle.vendor}: applied v${bundle.version} (${
        bundle.notes ?? "keine Notiz"
      }). Halted streams reset; watching for ${Math.round(
        PROBATION_WINDOW_MS / 60_000
      )} minutes.`
    );
  }
  return { ok: true, vendor: bundle.vendor, version: bundle.version };
}

// ---------------------------------------------------------------------------
// Probation → auto-rollback
// ---------------------------------------------------------------------------

/**
 * Judge every config that is still inside its probation window.
 *
 * A regression is: a stream that was NOT halted before the apply and IS halted
 * now. That asymmetry is the whole point. Most pushes exist to fix an
 * already-halted stream, so "is halted" on its own would roll back every
 * legitimate repair before it had a chance to run.
 */
async function runProbation(deps: ConfigSyncDeps): Promise<RollbackRecord[]> {
  const rolled: RollbackRecord[] = [];
  for (const vendor of deps.enabledVendors) {
    if (!isSafeVendorId(vendor)) continue;
    const active = await readActiveConfig(vendor);
    if (!active || active.meta.probationClearedAt) continue;

    const elapsed = deps.now() - active.meta.appliedAt;
    if (elapsed < PROBATION_GRACE_MS) continue;

    if (elapsed > PROBATION_WINDOW_MS) {
      // Judged only INSIDE [GRACE, WINDOW]. Past the window the statuses no
      // longer say anything about this config (the agent may have been down for
      // days and be looking at leftovers, the environment may have broken since),
      // so a rollback here would be a stale judgement. Close the probation.
      await updateActiveMeta(vendor, {
        ...active.meta,
        probationClearedAt: deps.now(),
      });
      await clearPrev(vendor);
      deps.log(
        `[config-sync] ${vendor}: v${active.meta.version} left its probation window without being judged as a regression.`
      );
      continue;
    }

    const before = new Map(
      (active.meta.preApplyStatuses ?? []).map((s) => [s.stream, s.status])
    );
    const regressions = deps
      .statusesFor(vendor)
      .filter((now) => {
        if (!isConfigRegression(now)) return false;
        // A stream with no pre-apply entry is new in this config; if it is
        // already halted, the config that introduced it is what broke it.
        const prior = before.get(now.stream) ?? "idle";
        return !wasHalted(prior);
      })
      .map((s) => `${s.stream}=${s.status}`);

    if (regressions.length > 0) {
      const reason = `Streams halted after the update: ${regressions.join(", ")}`;
      const record = await rollback(vendor, active, reason, deps);
      if (record) rolled.push(record);
      continue;
    }
  }
  return rolled;
}

async function rollback(
  vendor: string,
  active: StoredConfig,
  reason: string,
  deps: ConfigSyncDeps
): Promise<RollbackRecord | null> {
  const badVersion = active.meta.version;
  const prev = await readPrevConfig(vendor);

  // Work out what we are reverting TO before touching the store, so a config
  // that cannot be parsed does not leave the machine with no config at all.
  let target: VendorConfig | null = null;
  if (prev) {
    try {
      target = await loadVendorConfigFromString(prev.yaml, `<remote-prev:${vendor}>`);
    } catch (err) {
      deps.error(
        `[config-sync] ${vendor}: the previous config (v${prev.meta.version}) no longer validates (${
          (err as Error).message
        }); falling back to the config bundled with this agent build.`
      );
      target = null;
    }
  }
  if (!target) {
    target = await deps.loadBundledConfig(vendor);
    // Drop the unusable `.prev` so revertConfig below deletes the remote pair
    // instead of restoring a config we just proved does not validate.
    if (prev) await clearPrev(vendor);
  }
  if (!target) {
    // Nothing to fall back to. Keep the bad config in place rather than leaving
    // the vendor with none, quarantine it so we stop re-applying, and shout.
    await addQuarantine(vendor, badVersion, reason, deps.now());
    deps.error(
      `[config-sync] ${vendor}: v${badVersion} regressed (${reason}) but there is nothing to roll back to (no previous remote config and no bundled config). The vendor stays on v${badVersion}; publish a fixed version.`
    );
    return null;
  }

  // revertConfig restores `.prev` when there is one and otherwise deletes the
  // remote pair so the loader falls back to bundled. By this point the two
  // cases already agree: an unusable `.prev` was cleared above, so the call
  // lands on exactly the target we validated.
  const restoredVersion = await revertConfig(vendor);
  await addQuarantine(vendor, badVersion, reason, deps.now());
  deps.reloadVendor(vendor, target);

  const record: RollbackRecord = {
    vendor,
    rejectedVersion: badVersion,
    revertedTo: restoredVersion,
    reason: reason.slice(0, 500),
    at: deps.now(),
  };
  await appendRollback(record);
  deps.error(
    `[config-sync] ${vendor}: ROLLED BACK v${badVersion} → ${
      record.revertedTo === null
        ? "the config bundled with this agent build"
        : `v${record.revertedTo}`
    }. ${reason}. v${badVersion} will not be applied again on this machine.`
  );
  return record;
}

// ---------------------------------------------------------------------------
// Heartbeat reporting
// ---------------------------------------------------------------------------

export interface ReportedVendorConfig {
  vendor: string;
  version: number;
  sha256: string;
  appliedAt: number;
  source: "remote";
}

/**
 * What this machine is actually running, for the heartbeat. Only remote
 * configs are listed: a vendor absent from this array is running the config
 * bundled with its agent build, which the reported agentVersion already tells
 * the portal.
 */
export async function reportedConfigs(
  enabledVendors: string[]
): Promise<ReportedVendorConfig[]> {
  const out: ReportedVendorConfig[] = [];
  for (const vendor of enabledVendors) {
    if (!isSafeVendorId(vendor)) continue;
    const active = await readActiveConfig(vendor);
    if (!active) continue;
    out.push({
      vendor,
      version: active.meta.version,
      sha256: active.meta.sha256,
      appliedAt: active.meta.appliedAt,
      source: "remote",
    });
  }
  return out;
}

export { readRollbacks };
