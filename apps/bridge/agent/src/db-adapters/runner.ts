import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { loadDbCredential } from "../secure-store.js";
import { FirebirdDriver } from "./drivers/firebird.js";
import { MssqlDriver } from "./drivers/mssql.js";
import { MysqlDriver } from "./drivers/mysql.js";
import { OracleDriver } from "./drivers/oracle.js";
import { PostgresDriver } from "./drivers/postgres.js";
import { SqliteDriver } from "./drivers/sqlite.js";
import { loadState, pollOnce, saveState } from "./framework.js";
import { loadAllVendorConfigs, loadVendorConfigFile } from "./vendor-config.js";
import type { DbDriver, StreamConfig, VendorConfig } from "./types.js";

/**
 * Long-running runner for SQL-introspection adapters.
 *
 * For each enabled vendor:
 *   1. Resolve the credential from secure-store (loadDbCredential).
 *   2. Instantiate one driver per vendor (single connection serves all streams).
 *   3. Tick every TICK_MS. For each stream whose nextRunAt is in the past,
 *      call pollOnce(). Streams run sequentially per vendor (one connection)
 *      but vendors run in parallel.
 *
 * Failure isolation: a driver-connect failure for one vendor doesn't stop
 * other vendors from running. Per-stream failures are recorded by the
 * framework; the runner only owns the tick loop.
 *
 * Stop semantics: stop() closes all drivers and clears the timer. The
 * outbox is independent of the runner, so events already enqueued continue
 * to flush via the agent's main flush loop.
 */

const TICK_MS = 5_000;

export interface RunnerOptions {
  clinicId: string;
  /** Vendors to enable. Each must match a `vendor:` in the loaded configs. */
  enabledVendors: string[];
  /** Per-vendor connection overrides. Required: host, username. Optional:
   *  port (falls back to config default), database (ditto). */
  connections: Record<
    string,
    { host: string; port?: number; database?: string; username: string }
  >;
  /** Custom configs dir for tests. Defaults to ./configs next to this file. */
  configsDir?: string;
  /** Custom driver factory for tests. Real runs use the built-in registry. */
  driverFactory?: (vendor: VendorConfig) => DbDriver;
  /** Custom credential loader for tests. */
  credentialLoader?: (credentialId: string) => Promise<string | null>;
  /** Override tick cadence (test). */
  tickMs?: number;
}

export interface RunnerHandle {
  stop: () => Promise<void>;
  /** For tests: drive a single tick manually. */
  tickOnce: () => Promise<void>;
}

interface VendorRuntime {
  config: VendorConfig;
  driver: DbDriver;
  connected: boolean;
  lastConnectAttemptAt: number;
}

export async function startRunner(opts: RunnerOptions): Promise<RunnerHandle> {
  const configsDir = opts.configsDir ?? defaultConfigsDir();
  const allConfigs = await loadAllVendorConfigs(configsDir);

  const runtime = new Map<string, VendorRuntime>();
  const credLoader = opts.credentialLoader ?? loadDbCredential;

  for (const vendorId of opts.enabledVendors) {
    const cfg = allConfigs.get(vendorId);
    if (!cfg) {
      console.error(`[db-runner] enabled vendor '${vendorId}' not found in ${configsDir}`);
      continue;
    }
    const driver = (opts.driverFactory ?? defaultDriverFactory)(cfg);
    runtime.set(vendorId, {
      config: cfg,
      driver,
      connected: false,
      lastConnectAttemptAt: 0,
    });
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function ensureConnected(rt: VendorRuntime): Promise<boolean> {
    if (rt.connected) {
      const health = await rt.driver.healthCheck();
      if (health.ok) return true;
      rt.connected = false;
    }
    // Don't hammer reconnects on a failing endpoint. Wait at least 10s between attempts.
    if (Date.now() - rt.lastConnectAttemptAt < 10_000) return false;
    rt.lastConnectAttemptAt = Date.now();
    const conn = opts.connections[rt.config.vendor];
    if (!conn) {
      console.error(
        `[db-runner] no connection override for '${rt.config.vendor}'; skipping`
      );
      return false;
    }
    const password = await credLoader(rt.config.connection.credentialId);
    if (!password) {
      console.error(
        `[db-runner] no credential found for '${rt.config.connection.credentialId}' (vendor=${rt.config.vendor}). Run --rotate-db-credential.`
      );
      return false;
    }
    try {
      await rt.driver.connect({
        host: conn.host,
        port:
          conn.port ??
          rt.config.connection.port ??
          defaultPortForEngine(rt.config.driver),
        database: conn.database ?? rt.config.connection.database ?? "",
        username: conn.username,
        password,
        options: rt.config.connection.options,
      });
      rt.connected = true;
      console.log(
        `[db-runner] connected to ${rt.config.vendor} at ${conn.host}:${conn.port ?? rt.config.connection.port}`
      );
      return true;
    } catch (err) {
      console.error(
        `[db-runner] connect to ${rt.config.vendor} failed: ${(err as Error).message}`
      );
      return false;
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    for (const rt of runtime.values()) {
      const ready = await ensureConnected(rt);
      if (!ready) continue;
      for (const stream of rt.config.streams) {
        const state = loadState(rt.config.vendor, stream.kind);
        if (state.status === "schema_drift" || state.status === "disabled") continue;
        if (state.nextRunAt > Date.now()) continue;
        try {
          const outcome = await pollOnce({
            clinicId: opts.clinicId,
            vendor: rt.config,
            stream,
            driver: rt.driver,
          });
          if (outcome.emitted > 0) {
            console.log(
              `[db-runner] ${rt.config.vendor}/${stream.kind}: emitted=${outcome.emitted} cursor=${outcome.newCursor}`
            );
          }
          if (outcome.driftDetected) {
            console.warn(
              `[db-runner] ${rt.config.vendor}/${stream.kind}: SCHEMA DRIFT; stream halted until config update`
            );
          }
        } catch (err) {
          // pollOnce records its own failure state; just log.
          console.error(
            `[db-runner] ${rt.config.vendor}/${stream.kind}: poll threw outside framework:`,
            err
          );
        }
      }
    }
  }

  const tickMs = opts.tickMs ?? TICK_MS;
  function scheduleNextTick(): void {
    if (stopped) return;
    timer = setTimeout(async () => {
      await tick().catch((err) =>
        console.error("[db-runner] tick failed:", err)
      );
      scheduleNextTick();
    }, tickMs);
  }
  scheduleNextTick();

  console.log(
    `[db-runner] started: vendors=[${Array.from(runtime.keys()).join(", ")}] tick=${tickMs}ms`
  );

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const rt of runtime.values()) {
        try {
          await rt.driver.close();
        } catch {
          // Swallow.
        }
      }
    },
    tickOnce: tick,
  };
}

export function defaultDriverFactory(vendor: VendorConfig): DbDriver {
  switch (vendor.driver) {
    case "postgres":
      return new PostgresDriver();
    case "firebird":
      return new FirebirdDriver();
    case "mssql":
      return new MssqlDriver();
    case "sqlite":
      return new SqliteDriver();
    case "mysql":
      return new MysqlDriver();
    case "oracle":
      return new OracleDriver();
  }
}

export function defaultPortForEngine(engine: VendorConfig["driver"]): number {
  switch (engine) {
    case "postgres":
      return 5432;
    case "mysql":
      return 3306;
    case "firebird":
      return 3050;
    case "mssql":
      return 1433;
    case "oracle":
      return 1521;
    case "sqlite":
      // SQLite is file-based; the port field is ignored by the driver.
      return 0;
  }
}

export function defaultConfigsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // In dev (tsx) we're at src/db-adapters; in compiled builds at dist/db-adapters.
  // configs/ lives next to this file in both cases.
  const candidate = join(here, "configs");
  if (existsSync(candidate)) return candidate;
  // Fall back to src copy for builds that didn't copy configs/ into dist (e.g.
  // pkg single-binary builds: assets are embedded separately).
  return join(here, "..", "..", "src", "db-adapters", "configs");
}

/** Test helper: load a single config file directly. */
export const _internal = {
  loadVendorConfigFile,
};
