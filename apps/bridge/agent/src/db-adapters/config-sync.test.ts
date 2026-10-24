import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG_BUNDLE_SCHEMA,
  sha256Hex,
  signingInput,
  type SignedBundleCore,
  type TrustedConfigKey,
  type VendorConfigBundle,
} from "./config-signature.js";
import {
  PROBATION_GRACE_MS,
  PROBATION_WINDOW_MS,
  _resetRefusedForTests,
  reportedConfigs,
  runConfigSync,
  type ConfigSyncDeps,
  type StreamStatusSnapshot,
  type VendorConfigManifestEntry,
} from "./config-sync.js";
import {
  readActiveConfig,
  readPrevConfig,
  readQuarantine,
  readRollbacks,
} from "./remote-config-store.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type { VendorConfig } from "./types.js";

/**
 * Remote-config delivery, end to end against the real on-disk store.
 *
 * The store is redirected into a temp dir by overriding the same platform env
 * vars configDir() reads (see config-io.test.ts), so these exercise the actual
 * atomic writes, `.prev` bookkeeping and quarantine file rather than a mock.
 */

const VENDOR = "test-db";

function yamlFor(vendor = VENDOR, table = "patient"): string {
  return [
    `vendor: ${vendor}`,
    "driver: sqlite",
    "bridgeSource: gdt_agent",
    "connection:",
    "  credentialId: test-cred",
    "streams:",
    "  - kind: PatientUpserted",
    "    cursorColumn: updated_at",
    `    query: SELECT id, updated_at FROM ${table} WHERE updated_at > :cursor`,
    "    map:",
    "      pvsExternalEventId: id",
    "      occurredAt: updated_at",
    "      pvsPatientId: id",
    "",
  ].join("\n");
}

let tempRoot: string;
const savedEnv: Record<string, string | undefined> = {};
let signer: {
  trusted: TrustedConfigKey;
  sign: (core: SignedBundleCore) => string;
};

function makeSigner(keyId = "test-key"): typeof signer {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = (
    publicKey.export({ format: "der", type: "spki" }) as Buffer
  ).subarray(12);
  return {
    trusted: { keyId, publicKey: raw.toString("base64") },
    sign: (core) =>
      cryptoSign(
        null,
        Buffer.from(signingInput(core), "utf8"),
        privateKey
      ).toString("base64"),
  };
}

function bundleFor(
  version: number,
  yaml = yamlFor(),
  overrides: Partial<SignedBundleCore> = {}
): VendorConfigBundle {
  const core: SignedBundleCore = {
    schema: CONFIG_BUNDLE_SCHEMA,
    vendor: VENDOR,
    version,
    bridgeSource: "gdt_agent",
    driver: "sqlite",
    streams: ["PatientUpserted"],
    minAgentVersion: "0.3.0",
    notes: `v${version}`,
    signedAt: 1_753_000_000_000,
    sha256: sha256Hex(yaml),
    keyId: signer.trusted.keyId,
    ...overrides,
  };
  return { ...core, yaml, signature: signer.sign(core) };
}

function manifestFor(bundle: VendorConfigBundle): VendorConfigManifestEntry[] {
  return [
    { vendor: bundle.vendor, version: bundle.version, sha256: bundle.sha256 },
  ];
}

interface Harness {
  deps: ConfigSyncDeps;
  setNow: (ms: number) => void;
  advance: (ms: number) => void;
  setStatuses: (statuses: StreamStatusSnapshot[]) => void;
  reloaded: Array<{ vendor: string; cfg: VendorConfig }>;
  fetched: string[][];
  serve: (bundles: unknown[]) => void;
  failFetch: (reason: string) => void;
}

function harness(overrides: Partial<ConfigSyncDeps> = {}): Harness {
  let now = 1_000_000;
  let statuses: StreamStatusSnapshot[] = [
    { stream: "PatientUpserted", status: "idle" },
  ];
  let served: unknown[] = [];
  let fetchFailure: string | null = null;
  const reloaded: Array<{ vendor: string; cfg: VendorConfig }> = [];
  const fetched: string[][] = [];

  const deps: ConfigSyncDeps = {
    enabledVendors: [VENDOR],
    agentVersion: "0.3.0",
    trustedKeys: [signer.trusted],
    fetchBundles: async (vendors) => {
      fetched.push(vendors);
      if (fetchFailure) return { ok: false, reason: fetchFailure };
      return { ok: true, bundles: served };
    },
    reloadVendor: (vendor, cfg) => {
      reloaded.push({ vendor, cfg });
      return true;
    },
    statusesFor: () => statuses,
    loadBundledConfig: (vendor) =>
      loadVendorConfigFromString(yamlFor(vendor, "bundled_patient"), "<bundled>"),
    now: () => now,
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    ...overrides,
  };

  return {
    deps,
    setNow: (ms) => {
      now = ms;
    },
    advance: (ms) => {
      now += ms;
    },
    setStatuses: (s) => {
      statuses = s;
    },
    reloaded,
    fetched,
    serve: (bundles) => {
      served = bundles;
      fetchFailure = null;
    },
    failFetch: (reason) => {
      fetchFailure = reason;
    },
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "eins-cfgsync-"));
  for (const k of ["APPDATA", "XDG_CONFIG_HOME", "HOME", "EINS_AGENT_DATA_DIR"]) savedEnv[k] = process.env[k];
  process.env.APPDATA = tempRoot;
  process.env.XDG_CONFIG_HOME = tempRoot;
  process.env.HOME = tempRoot;
  process.env.EINS_AGENT_DATA_DIR = tempRoot;
  signer = makeSigner();
  _resetRefusedForTests();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("applying a pushed config", () => {
  it("verifies, validates, stores and reloads it", async () => {
    const h = harness();
    const bundle = bundleFor(4);
    h.serve([bundle]);

    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.error).toBeNull();
    expect(outcome.applied).toEqual([{ vendor: VENDOR, version: 4 }]);
    expect(h.reloaded).toHaveLength(1);
    expect(h.reloaded[0]!.cfg.streams[0]!.query).toContain("FROM patient");

    const stored = await readActiveConfig(VENDOR);
    expect(stored?.meta.version).toBe(4);
    expect(stored?.meta.sha256).toBe(bundle.sha256);
    expect(stored?.meta.preApplyStatuses).toEqual([
      { stream: "PatientUpserted", status: "idle" },
    ]);

    expect(await reportedConfigs([VENDOR])).toEqual([
      {
        vendor: VENDOR,
        version: 4,
        sha256: bundle.sha256,
        appliedAt: stored!.meta.appliedAt,
        source: "remote",
      },
    ]);
  });

  it("does nothing when the manifest matches what is already applied", async () => {
    const h = harness();
    const bundle = bundleFor(4);
    h.serve([bundle]);
    await runConfigSync(manifestFor(bundle), h.deps);

    h.advance(1_000);
    const second = await runConfigSync(manifestFor(bundle), h.deps);

    expect(second.applied).toEqual([]);
    // One fetch total: the second pass never went to the network.
    expect(h.fetched).toHaveLength(1);
  });

  it("ignores vendors this Praxis does not run", async () => {
    const h = harness();
    const bundle = bundleFor(4);
    h.serve([bundle]);

    const outcome = await runConfigSync(
      [{ vendor: "someone-else-db", version: 9, sha256: bundle.sha256 }],
      h.deps
    );

    expect(outcome.applied).toEqual([]);
    expect(h.fetched).toHaveLength(0);
  });

  it("reports a fetch failure instead of throwing", async () => {
    const h = harness();
    const bundle = bundleFor(4);
    h.failFetch("http 503");
    const outcome = await runConfigSync(manifestFor(bundle), h.deps);
    expect(outcome.error).toMatch(/http 503/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });
});

describe("refusing a config", () => {
  async function applyV4(h: Harness): Promise<VendorConfigBundle> {
    const bundle = bundleFor(4);
    h.serve([bundle]);
    await runConfigSync(manifestFor(bundle), h.deps);
    return bundle;
  }

  it("refuses to go backwards to an older version", async () => {
    const h = harness();
    await applyV4(h);

    const older = bundleFor(3);
    h.serve([older]);
    const outcome = await runConfigSync(manifestFor(older), h.deps);

    expect(outcome.skipped[0]?.reason).toMatch(/refusing to downgrade/);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(4);
  });

  it("refuses a bundle whose version disagrees with the manifest", async () => {
    const h = harness();
    const advertised = bundleFor(5);
    // Portal advertises v5 but serves a differently-versioned bundle.
    h.serve([bundleFor(6)]);
    const outcome = await runConfigSync(manifestFor(advertised), h.deps);

    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0]?.reason).toMatch(/manifest advertised/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });

  it("refuses a bundle whose digest disagrees with the manifest", async () => {
    const h = harness();
    const bundle = bundleFor(5);
    h.serve([bundle]);
    const outcome = await runConfigSync(
      [{ vendor: VENDOR, version: 5, sha256: "0".repeat(64) }],
      h.deps
    );
    expect(outcome.skipped[0]?.reason).toMatch(/digest does not match/);
  });

  it("refuses a config that needs a newer agent", async () => {
    const h = harness();
    const bundle = bundleFor(5, yamlFor(), { minAgentVersion: "9.0.0" });
    h.serve([bundle]);
    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.skipped[0]?.reason).toMatch(/needs agent 9\.0\.0/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });

  it("refuses a signed header that disagrees with the YAML it carries", async () => {
    const h = harness();
    // Header says test-db (what the manifest and the admin UI show); the YAML
    // inside declares a different vendor entirely.
    const yaml = yamlFor("other-db");
    const bundle = bundleFor(5, yaml);
    h.serve([bundle]);
    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.skipped[0]?.reason).toMatch(/YAML declares vendor 'other-db'/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });

  it("refuses a config that fails the same validation bundled configs face", async () => {
    const h = harness();
    // Query without :cursor — the stream could never advance.
    const broken = yamlFor().replace(" WHERE updated_at > :cursor", "");
    const bundle = bundleFor(5, broken);
    h.serve([bundle]);
    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.skipped[0]?.reason).toMatch(/failed validation/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });

  it("refuses a bundle signed by a key this build does not trust", async () => {
    const h = harness();
    const attacker = makeSigner("test-key");
    const core: SignedBundleCore = {
      schema: CONFIG_BUNDLE_SCHEMA,
      vendor: VENDOR,
      version: 5,
      bridgeSource: "gdt_agent",
      driver: "sqlite",
      streams: ["PatientUpserted"],
      minAgentVersion: "0.3.0",
      notes: null,
      signedAt: 1_753_000_000_000,
      sha256: sha256Hex(yamlFor()),
      keyId: "test-key",
    };
    h.serve([{ ...core, yaml: yamlFor(), signature: attacker.sign(core) }]);

    const outcome = await runConfigSync(
      [{ vendor: VENDOR, version: 5, sha256: core.sha256 }],
      h.deps
    );
    expect(outcome.skipped[0]?.reason).toMatch(/signature does not verify/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });
});

describe("probation", () => {
  /** Apply `version`, then let it clear probation so `.prev` is dropped. */
  async function applyAndSettle(h: Harness, version: number): Promise<void> {
    const bundle = bundleFor(version);
    h.serve([bundle]);
    await runConfigSync(manifestFor(bundle), h.deps);
    h.advance(PROBATION_WINDOW_MS + 1);
    await runConfigSync(manifestFor(bundle), h.deps);
  }

  it("clears a config that survives its window and drops the undo copy", async () => {
    const h = harness();
    await applyAndSettle(h, 3);

    const active = await readActiveConfig(VENDOR);
    expect(active?.meta.probationClearedAt).toBeGreaterThan(0);
    expect(await readPrevConfig(VENDOR)).toBeNull();
    expect(await readRollbacks()).toEqual([]);
  });

  it("does not judge an apply before the grace period", async () => {
    const h = harness();
    const bundle = bundleFor(4);
    h.serve([bundle]);
    await runConfigSync(manifestFor(bundle), h.deps);

    h.setStatuses([{ stream: "PatientUpserted", status: "error", lastError: "query failed: syntax error" }]);
    h.advance(PROBATION_GRACE_MS - 1_000);
    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.rolledBack).toEqual([]);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(4);
  });

  it("rolls back to the previous version when a healthy stream halts", async () => {
    const h = harness();
    await applyAndSettle(h, 3);

    const v4 = bundleFor(4, yamlFor(VENDOR, "patient_v2"));
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(4);

    // The new config halts the stream that was fine a minute ago.
    h.setStatuses([{ stream: "PatientUpserted", status: "schema_drift" }]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.rolledBack).toHaveLength(1);
    expect(outcome.rolledBack[0]).toMatchObject({
      vendor: VENDOR,
      rejectedVersion: 4,
      revertedTo: 3,
    });
    const active = await readActiveConfig(VENDOR);
    expect(active?.meta.version).toBe(3);
    // The runner was handed the restored config, not left on the broken one.
    expect(h.reloaded.at(-1)!.cfg.streams[0]!.query).toContain("FROM patient ");
    expect(await readRollbacks()).toHaveLength(1);
  });

  it("never re-applies a version it rolled back, even if the portal keeps offering it", async () => {
    const h = harness();
    await applyAndSettle(h, 3);
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);
    h.setStatuses([{ stream: "PatientUpserted", status: "config_invalid" }]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    await runConfigSync(manifestFor(v4), h.deps);

    expect(await readQuarantine(VENDOR)).toMatchObject([{ version: 4 }]);

    // Portal still advertises v4 on the next tick.
    h.setStatuses([{ stream: "PatientUpserted", status: "idle" }]);
    h.advance(60_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.applied).toEqual([]);
    expect(outcome.skipped[0]?.reason).toMatch(/quarantined/);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(3);
  });

  it("does not roll back a config pushed to repair an already-halted stream", async () => {
    const h = harness();
    // The stream is halted BEFORE the push: this is why the config exists.
    h.setStatuses([{ stream: "PatientUpserted", status: "schema_drift" }]);
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    // It has not recovered yet (the next poll has not run), but that is the
    // state we inherited, not a regression.
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.rolledBack).toEqual([]);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(4);
  });

  it("falls back to the bundled config when there is no earlier remote version", async () => {
    const h = harness();
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    h.setStatuses([{ stream: "PatientUpserted", status: "error", lastError: "query failed: syntax error" }]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.rolledBack[0]).toMatchObject({
      rejectedVersion: 4,
      revertedTo: null,
    });
    // No remote config remains, so the loader falls back to the bundled one.
    expect(await readActiveConfig(VENDOR)).toBeNull();
    expect(h.reloaded.at(-1)!.cfg.streams[0]!.query).toContain("bundled_patient");
  });

  it("never judges a halt that shows up after the window (stale statuses)", async () => {
    const h = harness();
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    h.setStatuses([{ stream: "PatientUpserted", status: "schema_drift" }]);
    h.advance(PROBATION_WINDOW_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.rolledBack).toHaveLength(0);
    expect((await readActiveConfig(VENDOR))?.meta.probationClearedAt).toBeGreaterThan(0);
  });

  it("does not roll back for an environment error", async () => {
    const h = harness();
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    h.setStatuses([
      { stream: "PatientUpserted", status: "error", lastError: "connect ECONNREFUSED 127.0.0.1:3050" },
    ]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);
    expect(outcome.rolledBack).toHaveLength(0);
  });

  it("does not roll back while the vendor connection is down", async () => {
    const h = harness();
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    h.setStatuses([
      { stream: "PatientUpserted", status: "schema_drift", connectError: "ECONNREFUSED" },
    ]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);
    expect(outcome.rolledBack).toHaveLength(0);
  });

  it("lets a quarantined version expire after 24 h instead of banning it forever", async () => {
    const h = harness();
    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);
    h.setStatuses([{ stream: "PatientUpserted", status: "schema_drift" }]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const rolled = await runConfigSync(manifestFor(v4), h.deps);
    expect(rolled.rolledBack).toHaveLength(1);
    expect((await readQuarantine(VENDOR)).some((q) => q.version === 4)).toBe(true);

    h.setStatuses([{ stream: "PatientUpserted", status: "idle" }]);
    const still = await runConfigSync(manifestFor(v4), h.deps);
    expect(still.skipped[0]?.reason).toMatch(/quarantined/);

    h.advance(25 * 60 * 60 * 1000);
    const again = await runConfigSync(manifestFor(v4), h.deps);
    expect(again.applied).toEqual([{ vendor: VENDOR, version: 4 }]);
  });

  it("treats a brand-new stream that is immediately halted as a regression", async () => {
    const h = harness();
    await applyAndSettle(h, 3);

    const v4 = bundleFor(4);
    h.serve([v4]);
    await runConfigSync(manifestFor(v4), h.deps);

    // A stream name the pre-apply snapshot never contained.
    h.setStatuses([{ stream: "InvoicePaid", status: "config_invalid" }]);
    h.advance(PROBATION_GRACE_MS + 1_000);
    const outcome = await runConfigSync(manifestFor(v4), h.deps);

    expect(outcome.rolledBack).toHaveLength(1);
  });
});

describe("not re-fetching what it already refused", () => {
  it("downloads a refused version once, not once a minute forever", async () => {
    const h = harness();
    // The manifest keeps advertising it and the local version never moves, so
    // without a refusal memory this would re-download on every heartbeat.
    const tooNew = bundleFor(5, yamlFor(), { minAgentVersion: "9.0.0" });
    h.serve([tooNew]);

    await runConfigSync(manifestFor(tooNew), h.deps);
    expect(h.fetched).toHaveLength(1);

    h.advance(60_000);
    const second = await runConfigSync(manifestFor(tooNew), h.deps);

    expect(h.fetched).toHaveLength(1);
    expect(second.skipped[0]?.reason).toMatch(/already refused/);
  });

  it("skips the network entirely when the build carries no signing key", async () => {
    const h = harness({ trustedKeys: [] });
    const bundle = bundleFor(4);
    h.serve([bundle]);

    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(h.fetched).toHaveLength(0);
    expect(outcome.error).toMatch(/no config signing key/);
    expect(await readActiveConfig(VENDOR)).toBeNull();
  });
});

describe("runner integration", () => {
  it("stores the config even when the runner cannot take it live", async () => {
    const reload = vi.fn().mockReturnValue(false);
    const h = harness({ reloadVendor: reload });
    const bundle = bundleFor(4);
    h.serve([bundle]);

    const outcome = await runConfigSync(manifestFor(bundle), h.deps);

    expect(outcome.applied).toEqual([{ vendor: VENDOR, version: 4 }]);
    expect((await readActiveConfig(VENDOR))?.meta.version).toBe(4);
  });
});
