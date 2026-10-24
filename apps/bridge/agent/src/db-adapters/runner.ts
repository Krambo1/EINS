import { createHash } from "node:crypto";
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
import {
  describeAuthError,
  describeSuspectAuthError,
  errorMessage,
  isAmbiguousAuthError,
  isAuthError,
} from "./error-classes.js";
import {
  bumpGeneration,
  isStreamDue,
  loadAux,
  loadState,
  loadVendorAux,
  pollOnce,
  recordStreamFailure,
  resetStreamAux,
  saveState,
  saveVendorAux,
  withDeadline,
} from "./framework.js";
import {
  loadEffectiveVendorConfigs,
  loadVendorConfigFile,
} from "./vendor-config.js";
import {
  listStoredVendors,
  readActiveConfig,
} from "./remote-config-store.js";
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
  /** Cumulative rows this stream skipped without an event (unmappable or a
   *  normalization error). Reported on the heartbeat so a systematic data problem
   *  is visible portal-side, not only in the local log. */
  skippedRows: number;
  /** Category of the most recent skip ("missing_required_field" |
   *  "normalize_error"); never a cell value. null = nothing skipped. */
  lastSkipReason: string | null;
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
/** Connect-retry backoff: 10 s doubling to 30 min. A wrong password retried every
 *  10 s can lock a shared vendor account (Oracle FAILED_LOGIN_ATTEMPTS, MSSQL
 *  lockout policy, a SYSDBA the PVS itself uses). */
const CONNECT_BACKOFF_BASE_MS = 10_000;
const CONNECT_BACKOFF_MAX_MS = 30 * 60_000;
/** How often a latched (auth_failed) vendor re-reads the credential store to see
 *  whether the password was rotated. Reading is local; it never touches the DB. */
const CREDENTIAL_RECHECK_MS = 30_000;
/** An ambiguous (SQL Server "Login failed") latch allows ONE connect attempt per
 *  this interval: a boot-time "database recovering" must not latch a correct
 *  password forever, while a wrong one must not get close to a lockout policy. */
const AUTH_SUSPECT_RETRY_MS = 6 * 3_600_000;

export function connectBackoffMs(failures: number): number {
  return Math.min(
    CONNECT_BACKOFF_MAX_MS,
    CONNECT_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, failures - 1))
  );
}

function fingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
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
  /** Clock override (test): connect backoff and credential re-checks. */
  now?: () => number;
  /**
   * Remote (portal-delivered) configs to overlay on the bundled ones, keyed by
   * vendor id with the raw YAML as the value. Defaults to whatever the local
   * remote-config store holds. Pass an empty Map to force bundled-only.
   */
  remoteConfigs?: ReadonlyMap<string, string>;
}

export interface RunnerHandle {
  stop: () => Promise<void>;
  /** For tests: drive a single tick manually. */
  tickOnce: () => Promise<void>;
  /** M-D4: live per-stream adapter status for the heartbeat. Reads the
   *  persisted db_adapter_state for every configured stream, so a halted or
   *  failing stream is reported to the portal rather than staying invisible. */
  statusSnapshot: () => AdapterStreamStatus[];
  /**
   * Swap a vendor's config at runtime (remote config push, or the rollback
   * that undoes one) without restarting the process. Returns false when the
   * vendor is not enabled on this machine, in which case nothing changed.
   */
  reloadVendor: (vendor: string, next: VendorConfig) => boolean;
  /** Vendors this runner currently has enabled. */
  enabledVendors: () => string[];
}

interface VendorRuntime {
  config: VendorConfig;
  driver: DbDriver;
  connected: boolean;
  lastConnectAttemptAt: number;
  /** M-D4: last connection failure reason, surfaced via statusSnapshot(). */
  lastConnectError: string | null;
  /** Consecutive failed connect attempts (drives the exponential backoff). */
  connectFailures: number;
  /** Earliest time the next connect attempt may run. */
  nextConnectAt: number;
  /** sha256 of the credential the database rejected. While set, no connect is
   *  attempted; it clears when the stored credential changes. Persisted, so a
   *  crash-looping service does not retry a bad password on every restart. */
  authFailedFp: string | null;
  /** Ambiguous latch only: earliest time of the next single retry (null = hard
   *  latch, only a credential change clears it). */
  authRetryAt: number | null;
  lastCredentialCheckAt: number;
}

export async function startRunner(opts: RunnerOptions): Promise<RunnerHandle> {
  const configsDir = opts.configsDir ?? defaultConfigsDir();
  const remote =
    opts.remoteConfigs ?? (await loadStoredRemoteConfigs(opts.enabledVendors));
  const allConfigs = await loadEffectiveVendorConfigs(configsDir, remote);

  const runtime = new Map<string, VendorRuntime>();
  const credLoader = opts.credentialLoader ?? loadDbCredential;
  const driverFactory = opts.driverFactory ?? defaultDriverFactory;
  const clock = opts.now ?? Date.now;

  for (const vendorId of opts.enabledVendors) {
    const cfg = allConfigs.get(vendorId);
    if (!cfg) {
      console.error(`[db-runner] enabled vendor '${vendorId}' not found in ${configsDir}`);
      continue;
    }
    const persisted = loadVendorAuxSafe(vendorId);
    runtime.set(vendorId, {
      config: cfg,
      driver: driverFactory(cfg),
      connected: false,
      lastConnectAttemptAt: 0,
      lastConnectError: persisted.authFailedMessage,
      connectFailures: 0,
      nextConnectAt: 0,
      authFailedFp: persisted.authFailedFingerprint,
      authRetryAt: persisted.authFailedFingerprint !== null ? persisted.authRetryAt ?? null : null,
      lastCredentialCheckAt: 0,
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

  /** Stream states of a vendor currently latched as auth_failed. */
  function markAuthFailed(rt: VendorRuntime, message: string): void {
    for (const stream of rt.config.streams) {
      const state = loadState(rt.config.vendor, stream.kind);
      if (state.status === "disabled") continue;
      saveState({
        ...state,
        status: "auth_failed",
        lastError: message.slice(0, 900),
        lastRunAt: clock(),
      });
    }
  }

  function clearAuthFailed(rt: VendorRuntime): void {
    rt.authFailedFp = null;
    rt.authRetryAt = null;
    rt.connectFailures = 0;
    rt.nextConnectAt = 0;
    try {
      saveVendorAux(rt.config.vendor, {
        authFailedFingerprint: null,
        authFailedMessage: null,
        authRetryAt: null,
      });
    } catch {
      // advisory
    }
    for (const stream of rt.config.streams) {
      const state = loadState(rt.config.vendor, stream.kind);
      if (state.status !== "auth_failed") continue;
      saveState({ ...state, status: "idle", lastError: null, nextRunAt: 0 });
    }
  }

  /**
   * While latched as auth_failed, look (locally) at whether the credential was
   * rotated. Returns true when the latch was cleared and a connect may be tried.
   */
  async function credentialRotated(rt: VendorRuntime): Promise<boolean> {
    if (rt.authFailedFp === null) return true;
    const nowMs = clock();
    if (nowMs - rt.lastCredentialCheckAt < CREDENTIAL_RECHECK_MS) return false;
    rt.lastCredentialCheckAt = nowMs;
    const password = await credLoader(rt.config.connection.credentialId);
    if (!password || fingerprint(password) === rt.authFailedFp) return false;
    console.log(
      `[db-runner] ${rt.config.vendor}: the stored credential changed; retrying the connection`
    );
    clearAuthFailed(rt);
    return true;
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
    if (!(await credentialRotated(rt))) return false;
    // Exponential backoff between attempts (10 s ... 30 min), not a fixed 10 s.
    if (clock() < rt.nextConnectAt) return false;
    rt.lastConnectAttemptAt = clock();
    const failAttempt = (): boolean => {
      rt.connectFailures += 1;
      rt.nextConnectAt = clock() + connectBackoffMs(rt.connectFailures);
      return false;
    };
    const conn = opts.connections[rt.config.vendor];
    if (!conn) {
      rt.lastConnectError = "no connection override configured";
      console.error(
        `[db-runner] no connection override for '${rt.config.vendor}'; skipping`
      );
      return failAttempt();
    }
    const password = await credLoader(rt.config.connection.credentialId);
    if (!password) {
      rt.lastConnectError = `no credential for '${rt.config.connection.credentialId}' (run --rotate-db-credential)`;
      console.error(
        `[db-runner] no credential found for '${rt.config.connection.credentialId}' (vendor=${rt.config.vendor}). Run --rotate-db-credential.`
      );
      return failAttempt();
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
      rt.connectFailures = 0;
      rt.nextConnectAt = 0;
      if (rt.authFailedFp !== null) clearAuthFailed(rt);
      console.log(
        `[db-runner] connected to ${rt.config.vendor} at ${conn.host}:${conn.port ?? rt.config.connection.port}`
      );
      return true;
    } catch (err) {
      if (isAuthError(err)) {
        // The database rejected the credential. Retrying only risks locking the
        // account (shared with the PVS itself), so STOP until it is rotated.
        // An ambiguous SQL Server login error stays visible as auth_failed but
        // is retried once every 6 h (the DB may just have been recovering).
        const ambiguous = isAmbiguousAuthError(err);
        const message = ambiguous
          ? describeSuspectAuthError(err)
          : describeAuthError(rt.config.driver, err);
        rt.lastConnectError = message;
        rt.authFailedFp = fingerprint(password);
        rt.authRetryAt = ambiguous ? clock() + AUTH_SUSPECT_RETRY_MS : null;
        rt.lastCredentialCheckAt = clock();
        try {
          saveVendorAux(rt.config.vendor, {
            authFailedFingerprint: rt.authFailedFp,
            authFailedMessage: message,
            authRetryAt: rt.authRetryAt,
          });
          markAuthFailed(rt, message);
        } catch (persistErr) {
          console.error(
            `[db-runner] ${rt.config.vendor}: could not persist the auth_failed latch: ${errorMessage(persistErr)}`
          );
        }
        console.error(
          ambiguous
            ? `[db-runner] ${rt.config.vendor}: LOGIN FAILED (ambiguous: wrong password or database unavailable); one retry every 6 h: ${message}`
            : `[db-runner] ${rt.config.vendor}: AUTH FAILED, connection attempts stopped until the credential changes (--rotate-db-credential ${rt.config.connection.credentialId}): ${message}`
        );
        return false;
      }
      rt.lastConnectError = errorMessage(err);
      console.error(
        `[db-runner] connect to ${rt.config.vendor} failed (attempt ${rt.connectFailures + 1}, next try in ${Math.round(
          connectBackoffMs(rt.connectFailures + 1) / 1000
        )}s): ${errorMessage(err)}`
      );
      return failAttempt();
    }
  }

  async function tickVendor(rt: VendorRuntime): Promise<void> {
    // L14: decide which streams are actually due BEFORE touching the
    // connection. ensureConnected() fires a healthCheck() round-trip against
    // the Praxis DB every time it runs on an already-connected vendor; doing
    // that on every 5s tick for a vendor whose streams poll on a much slower
    // cadence is pure waste. When nothing is due, skip the connection (and thus
    // the health check) entirely: the next tick that has due work reconnects.
    // A credential the DB rejected: only a rotated credential un-latches it.
    if (rt.authFailedFp !== null && !(await credentialRotated(rt))) {
      // Ambiguous latch: once the 6 h window is open, lift the latch for ONE
      // attempt. A repeated auth error re-latches with a fresh window.
      if (rt.authRetryAt !== null && clock() >= rt.authRetryAt) {
        console.log(
          `[db-runner] ${rt.config.vendor}: retrying the connection after an ambiguous login failure`
        );
        clearAuthFailed(rt);
      } else {
        return;
      }
    }

    // isStreamDue also schedules the 30-minute re-probe of halted streams,
    // clamps a nextRunAt that a clock jump pushed far into the future, and skips
    // disabled / auth_failed streams.
    const dueNow = clock();
    const dueStreams = rt.config.streams.filter((stream) =>
      isStreamDue(rt.config, stream, loadState(rt.config.vendor, stream.kind), dueNow)
    );
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
          now: opts.now,
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
            `[db-runner] ${rt.config.vendor}/${stream.kind}: SCHEMA DRIFT; stream halted until config update or a successful re-probe`
          );
        }
        if (outcome.recovered) {
          console.log(
            `[db-runner] ${rt.config.vendor}/${stream.kind}: stream recovered after a re-probe`
          );
        }
      } catch (err) {
        // pollOnce records its own failure state; if it still threw, back the
        // stream off so the next 5 s tick does not simply re-run it.
        console.error(
          `[db-runner] ${rt.config.vendor}/${stream.kind}: poll threw outside framework:`,
          err
        );
        recordStreamFailure(
          rt.config,
          stream,
          `poll threw: ${errorMessage(err)}`,
          opts.now
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
    const vendors = Array.from(runtime.values());
    const settled = await Promise.allSettled(vendors.map((rt) => tickVendor(rt)));
    settled.forEach((res, i) => {
      if (res.status !== "rejected") return;
      // tickVendor catches poll errors itself, so a rejection here is a
      // connect / state-store problem. Log it and back every stream of that
      // vendor off instead of silently dropping the rejection.
      const rt = vendors[i];
      const reason = errorMessage(res.reason);
      console.error(`[db-runner] ${rt.config.vendor}: tick failed: ${reason}`);
      rt.lastConnectError = reason;
      for (const stream of rt.config.streams) {
        recordStreamFailure(rt.config, stream, `tick failed: ${reason}`, opts.now);
      }
    });
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

  /**
   * Put a new config for `vendor` into force mid-run.
   *
   * Three things have to happen together, and each of them is a bug if left
   * out:
   *
   *   1. CLEAR THE HALT. A drifted stream sits in status='schema_drift' (or
   *      'config_invalid'), which tickVendor filters out permanently. A config
   *      push that fixes the drift would otherwise change nothing at all: the
   *      stream stays halted until someone restarts the agent by hand, which is
   *      the site visit this whole mechanism exists to avoid.
   *   2. CLEAR THE COLUMN SNAPSHOT. Drift is "observed columns differ from the
   *      snapshot taken on the first successful poll". The new config exists
   *      precisely because the columns changed, so keeping the old snapshot
   *      would re-detect drift on the very next poll and halt the stream again.
   *   3. RESET THE CURSOR ONLY WHEN ITS TYPE CHANGED. The cursor is how we
   *      avoid re-ingesting years of history, so it survives a config swap. But
   *      a timestamp cursor bound into an integer column (or the reverse) makes
   *      every future query malformed, so a cursorType change starts that one
   *      stream over from scratch. Server-side dedup absorbs the re-send.
   *
   * The driver is rebuilt only when connection-relevant fields changed; a pure
   * SQL/mapping change keeps the existing connection and the next tick just
   * uses the new queries.
   */
  function reloadVendor(vendor: string, next: VendorConfig): boolean {
    const rt = runtime.get(vendor);
    if (!rt) return false;
    const prev = rt.config;

    const connectionChanged =
      prev.driver !== next.driver ||
      prev.connection.credentialId !== next.connection.credentialId ||
      prev.connection.port !== next.connection.port ||
      prev.connection.database !== next.connection.database ||
      JSON.stringify(prev.connection.options ?? null) !==
        JSON.stringify(next.connection.options ?? null);

    // Invalidate every in-flight poll of this vendor BEFORE rewriting its state:
    // a pollOnce that loaded its state before this reload and is still awaiting
    // the PVS database must not write that stale snapshot back afterwards.
    bumpGeneration(vendor);
    rt.config = next;

    const prevByKind = new Map(prev.streams.map((s) => [s.kind, s]));
    for (const stream of next.streams) {
      const state = loadState(vendor, stream.kind);
      const before = prevByKind.get(stream.kind);
      const cursorTypeChanged =
        before !== undefined && before.cursorType !== stream.cursorType;
      const halted =
        state.status === "schema_drift" ||
        state.status === "config_invalid" ||
        state.status === "error";
      resetStreamAux(vendor, stream.kind);
      saveState({
        ...state,
        // disabled stays disabled; auth_failed stays until the credential
        // changes (the latch is cleared by connection changes / rotation).
        status:
          state.status === "disabled" || state.status === "auth_failed"
            ? state.status
            : "idle",
        lastError: halted ? null : state.lastError,
        consecutiveFailures: 0,
        // Re-run immediately so a fixed stream recovers within a tick rather
        // than after its normal interval.
        nextRunAt: 0,
        columnSnapshot: null,
        cursor: cursorTypeChanged ? "" : state.cursor,
        cursorTiebreak: cursorTypeChanged ? "" : state.cursorTiebreak,
      });
      if (cursorTypeChanged) {
        console.warn(
          `[db-runner] ${vendor}/${stream.kind}: cursorType changed ${before?.cursorType} → ${stream.cursorType}; cursor reset (the stream re-reads from the beginning, portal-side dedup absorbs the overlap)`
        );
      }
    }

    if (connectionChanged) {
      discardDriver(rt, "connection parameters changed in the new config");
      rt.lastConnectAttemptAt = 0;
      rt.connectFailures = 0;
      rt.nextConnectAt = 0;
      if (rt.authFailedFp !== null) clearAuthFailed(rt);
    }
    console.log(
      `[db-runner] ${vendor}: config reloaded (streams=${next.streams
        .map((s) => s.kind)
        .join(", ")}${connectionChanged ? ", connection rebuilt" : ""})`
    );
    return true;
  }

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
    reloadVendor,
    enabledVendors: () => Array.from(runtime.keys()),
    statusSnapshot() {
      const out: AdapterStreamStatus[] = [];
      for (const rt of runtime.values()) {
        for (const stream of rt.config.streams) {
          const st = loadState(rt.config.vendor, stream.kind);
          let skippedRows = 0;
          let lastSkipReason: string | null = null;
          try {
            const aux = loadAux(rt.config.vendor, stream.kind);
            skippedRows = aux.skippedRows;
            lastSkipReason = aux.lastSkipReason;
          } catch {
            // advisory
          }
          out.push({
            vendor: rt.config.vendor,
            stream: stream.kind,
            status: st.status,
            lastError: st.lastError,
            consecutiveFailures: st.consecutiveFailures,
            lastRunAt: st.lastRunAt,
            skippedRows,
            lastSkipReason,
            connectError: rt.lastConnectError,
          });
        }
      }
      return out;
    },
  };
}

/**
 * Read the locally cached remote configs for the vendors this agent runs.
 *
 * Restricted to `enabledVendors` on purpose: a config left over from a vendor
 * that has since been disabled must not be loaded, validated or reported. A
 * single unreadable entry is skipped rather than failing the boot, because a
 * corrupt cache should degrade to the bundled config, not to no agent at all.
 */
export async function loadStoredRemoteConfigs(
  enabledVendors: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = new Set(enabledVendors);
  let stored: string[];
  try {
    stored = await listStoredVendors();
  } catch (err) {
    console.error(
      `[db-runner] could not read the remote config store: ${(err as Error).message}. Using bundled configs.`
    );
    return out;
  }
  for (const vendor of stored) {
    if (!wanted.has(vendor)) continue;
    try {
      const entry = await readActiveConfig(vendor);
      if (entry) out.set(vendor, entry.yaml);
    } catch (err) {
      console.error(
        `[db-runner] cached remote config for '${vendor}' could not be read: ${(err as Error).message}. Using the bundled config.`
      );
    }
  }
  return out;
}

function loadVendorAuxSafe(vendorId: string): ReturnType<typeof loadVendorAux> {
  try {
    return loadVendorAux(vendorId);
  } catch {
    return { authFailedFingerprint: null, authFailedMessage: null };
  }
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
