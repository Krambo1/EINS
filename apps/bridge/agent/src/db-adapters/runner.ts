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
import { loadState, pollOnce, saveState, withDeadline } from "./framework.js";
import { loadAllVendorConfigs, loadVendorConfigFile } from "./vendor-config.js";
import type {
  CanonicalEventKind,
  DbDriver,
  StreamConfig,
  StreamStatus,
  VendorConfig,
} from "./types.js";

/**
 * M-D4: a single stream's LIVE runtime status, read from db_adapter_state.
 * Surfaced through the runner so index.ts can put the ACTUAL adapter health
 * (error / schema_drift / config_invalid / idle) on the heartbeat, instead of
 * only the configured vendor list. A rotated DB password or a drifted schema
 * halts a stream to status='error'/'schema_drift'; without this the portal saw
 * nothing but stale data.
 */
export interface AdapterStreamStatus {
  vendor: string;
  stream: CanonicalEventKind;
  status: StreamStatus;
  lastError: string | null;
  consecutiveFailures: number;
  lastRunAt: number | null;
  /** M-D4: last vendor-level connection failure (rotated/stale DB password,
   *  unreachable host, missing credential), or null when connected. A connect
   *  failure never touches db_adapter_state, so without this a rotated password
   *  would leave every stream reporting a stale 'idle'/'error' and nothing
   *  explaining why no new data arrives. */
  connectError: string | null;
}

/**
 * Long-running runner for SQL-introspection adapters.
 *
 * For each enabled vendor:
 *   1. Resolve the credential from secure-store (loadDbCredential).
 *   2. Instantiate one driver per vendor (single connection serves all streams).
 *   3. Tick every TICK_MS. For each stream whose nextRunAt is in the past,
 *      call pollOnce(). Streams run sequentially per vendor (one connection)
 *      but vendors run in parallel (Promise.all per tick, C4).
 *
 * Failure isolation: a driver-connect failure for one vendor doesn't stop
 * other vendors from running. Per-stream failures are recorded by the
 * framework; the runner only owns the tick loop. Hung-call protection (C4):
 * every driver.query() is deadline-raced by the framework and every
 * healthCheck() by this runner, and a driver whose health check fails or
 * times out is DISCARDED and rebuilt from the factory: a wedged
 * connection can otherwise absorb reconnect attempts forever (drivers
 * early-return from connect() while they still believe they are healthy).
 *
 * Stop semantics: stop() closes all drivers and clears the timer. The
 * outbox is independent of the runner, so events already enqueued continue
 * to flush via the agent's main flush loop.
 */

const TICK_MS = 5_000;
/** Deadline for a healthCheck() round-trip (C4). A wedged connection makes
 *  the probe hang, which previously wedged the whole tick loop. */
const HEALTHCHECK_DEADLINE_MS = 30_000;

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
  /** M-D4: live per-stream adapter status for the heartbeat. Reads the
   *  persisted db_adapter_state for every configured stream, so a halted or
   *  failing stream is reported to the portal rather than staying invisible. */
  statusSnapshot: () => AdapterStreamStatus[];
}

interface VendorRuntime {
  config: VendorConfig;
  driver: DbDriver;
  connected: boolean;
  lastConnectAttemptAt: number;
  /** M-D4: last connection failure reason, surfaced via statusSnapshot(). */
  lastConnectError: string | null;
}

export async function startRunner(opts: RunnerOptions): Promise<RunnerHandle> {
  const configsDir = opts.configsDir ?? defaultConfigsDir();
  const allConfigs = await loadAllVendorConfigs(configsDir);

  const runtime = new Map<string, VendorRuntime>();
  const credLoader = opts.credentialLoader ?? loadDbCredential;
  const driverFactory = opts.driverFactory ?? defaultDriverFactory;

  for (const vendorId of opts.enabledVendors) {
    const cfg = allConfigs.get(vendorId);
    if (!cfg) {
      console.error(`[db-runner] enabled vendor '${vendorId}' not found in ${configsDir}`);
      continue;
    }
    runtime.set(vendorId, {
      config: cfg,
      driver: driverFactory(cfg),
      connected: false,
      lastConnectAttemptAt: 0,
      lastConnectError: null,
    });
  }

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  /** Discard a driver whose connection is (or may be) wedged and rebuild a
   *  fresh instance (C4). close() is fire-and-forget: awaiting it on a
   *  wedged connection can itself hang. Rebuilding (rather than reusing)
   *  matters because drivers early-return from connect() while their
   *  internal healthy flag is still true: a wedged-but-"healthy" driver
   *  would absorb every reconnect attempt as a no-op. */
  function discardDriver(rt: VendorRuntime, reason: string): void {
    console.warn(
      `[db-runner] ${rt.config.vendor}: discarding connection (${reason}); a fresh one will be built on the next attempt`
    );
    void rt.driver.close().catch(() => void 0);
    rt.driver = driverFactory(rt.config);
    rt.connected = false;
  }

  async function ensureConnected(rt: VendorRuntime): Promise<boolean> {
    if (rt.connected) {
      const health = await withDeadline(
        `${rt.config.vendor} healthCheck`,
        HEALTHCHECK_DEADLINE_MS,
        () => rt.driver.healthCheck()
      ).catch((err) => ({
        ok: false as const,
        reason: (err as Error).message,
      }));
      if (health.ok) return true;
      discardDriver(rt, `health check failed: ${health.reason}`);
    }
    // Don't hammer reconnects on a failing endpoint. Wait at least 10s between attempts.
    if (Date.now() - rt.lastConnectAttemptAt < 10_000) return false;
    rt.lastConnectAttemptAt = Date.now();
    const conn = opts.connections[rt.config.vendor];
    if (!conn) {
      rt.lastConnectError = "no connection override configured";
      console.error(
        `[db-runner] no connection override for '${rt.config.vendor}'; skipping`
      );
      return false;
    }
    const password = await credLoader(rt.config.connection.credentialId);
    if (!password) {
      rt.lastConnectError = `no credential for '${rt.config.connection.credentialId}' (run --rotate-db-credential)`;
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
      rt.lastConnectError = null;
      console.log(
        `[db-runner] connected to ${rt.config.vendor} at ${conn.host}:${conn.port ?? rt.config.connection.port}`
      );
      return true;
    } catch (err) {
      rt.lastConnectError = (err as Error).message;
      console.error(
        `[db-runner] connect to ${rt.config.vendor} failed: ${(err as Error).message}`
      );
      return false;
    }
  }

  async function tickVendor(rt: VendorRuntime): Promise<void> {
    // L14: decide which streams are actually due BEFORE touching the
    // connection. ensureConnected() fires a healthCheck() round-trip against
    // the Praxis DB every time it runs on an already-connected vendor; doing
    // that on every 5s tick for a vendor whose streams poll on a much slower
    // cadence is pure waste. When nothing is due, skip the connection (and thus
    // the health check) entirely: the next tick that has due work reconnects.
    const dueNow = Date.now();
    const dueStreams = rt.config.streams.filter((stream) => {
      const state = loadState(rt.config.vendor, stream.kind);
      if (
        state.status === "schema_drift" ||
        state.status === "config_invalid" ||
        state.status === "disabled"
      ) {
        return false;
      }
      return state.nextRunAt <= dueNow;
    });
    if (dueStreams.length === 0) return;

    const ready = await ensureConnected(rt);
    if (!ready) return;
    for (const stream of dueStreams) {
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
        if (outcome.skippedRows && outcome.skippedRows > 0) {
          // H6: rows that failed normalization or lacked a required field are
          // skipped (not fatal), but surfaced here so a systematic data problem
          // is visible in the runner log, not just the framework log.
          console.warn(
            `[db-runner] ${rt.config.vendor}/${stream.kind}: skipped=${outcome.skippedRows} row(s) (failed normalization / missing required field)`
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

  async function tick(): Promise<void> {
    if (stopped) return;
    // Vendors run in parallel (C4): each has its own connection, so one
    // slow or backed-off vendor must not delay the others. Streams within
    // a vendor stay sequential (single shared connection). allSettled: a
    // per-vendor throw (tickVendor already catches poll errors, but
    // ensureConnected could surprise) must not cancel the other vendors.
    await Promise.allSettled(
      Array.from(runtime.values(), (rt) => tickVendor(rt))
    );
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
    statusSnapshot() {
      const out: AdapterStreamStatus[] = [];
      for (const rt of runtime.values()) {
        for (const stream of rt.config.streams) {
          const st = loadState(rt.config.vendor, stream.kind);
          out.push({
            vendor: rt.config.vendor,
            stream: stream.kind,
            status: st.status,
            lastError: st.lastError,
            consecutiveFailures: st.consecutiveFailures,
            lastRunAt: st.lastRunAt,
            connectError: rt.lastConnectError,
          });
        }
      }
      return out;
    },
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
