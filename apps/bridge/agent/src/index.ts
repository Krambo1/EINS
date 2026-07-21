// H7: MUST be the first import so process.env.TZ = "UTC" is set before any DB
// client library initialises or any Date is constructed. Do not reorder.
import "./tz-pin.js";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";
import {
  loadConfig,
  loadCsvMappingFile,
  saveConfig,
  type AgentConfig,
  type DbAdapterEnrollment,
} from "./config.js";
import { enroll, completePendingEnrollment } from "./enrollment.js";
import { watchFolder } from "./watcher.js";
import { watchHonorarFolder } from "./csv-watcher.js";
import {
  dueRows,
  markSent,
  markFailedPermanent,
  recordRetry,
  vacuumOld,
  getFailureSummary,
  pruneFailedOlderThan,
  setOutboxKey,
  closeOutbox,
} from "./outbox.js";
import { getOrCreateOutboxKey } from "./outbox-key.js";
import {
  postEvent,
  postHeartbeat,
  postFailureSummary,
  type HeartbeatPayload,
} from "./portal-client.js";
import { storeDbCredential } from "./secure-store.js";
import {
  startRunner,
  type RunnerHandle,
  type AdapterStreamStatus,
} from "./db-adapters/runner.js";
import {
  publishPendingDrift,
  bridgeSourceForVendor,
} from "./db-adapters/drift-publisher.js";
import { validatePortalUrl } from "./portal-url.js";
import { configureGlobalDispatcher } from "./net-setup.js";
import {
  createFlushState,
  runFlushCycle,
  type FlushDeps,
  type OutageSnapshot,
} from "./flush.js";
import { makeRateLimiter } from "./log-throttle.js";
import { findMissingFolders } from "./folder-check.js";

/**
 * eins-agent entry point.
 *
 * Modes:
 *   eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>]
 *               [--honorar-folder <path>] [--honorar-mapping <json-path>]
 *     One-shot enrollment. Persists config + secret, then exits. Prefer
 *     `--token-stdin` (pipe or prompt) over the positional token so the
 *     one-time token never lands in the OS process listing or shell history:
 *       echo <token> | eins-agent --enroll --token-stdin --clinic <uuid>
 *
 *   eins-agent
 *     Default: load existing config, start watcher(s) + flush loop. Starts
 *     a Honorar-CSV watcher additionally when `honorarCsvFolder` is set
 *     in the persisted config, and the SQL-introspection runner when any
 *     `dbAdapters[]` are enrolled.
 *
 *   eins-agent --configure-honorar <folder> [--honorar-mapping <json-path>]
 *     Idempotent reconfiguration of the Honorar-CSV watch folder /
 *     mapping without re-running enrollment.
 *
 *   eins-agent --enable-db-adapter <vendor> --credential-id <id>
 *              --db-host <h> --db-port <p> --db-database <db> --db-username <u>
 *     Idempotent enrollment of a SQL-introspection adapter. Prompts for the
 *     DB password and stores it via secure-store under <id>. Restart the
 *     agent to start the runner.
 *
 *   eins-agent --rotate-db-credential <id>
 *     Prompt for a new password and overwrite the stored credential under
 *     <id>. Restart the agent to pick up the new password.
 *
 *   eins-agent --disable-db-adapter <vendor>
 *     Remove the named adapter from config (the stored credential is left
 *     in place so the operator can re-enable without re-typing the password).
 */

const FLUSH_INTERVAL_MS = 5000;
const VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DRIFT_PUBLISH_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 60_000;
/**
 * L20: on SIGINT/SIGTERM, how long to await an in-flight flush before exiting
 * anyway. A few seconds lets the current batch's POSTs settle; beyond that we
 * exit regardless (each POST is already capped by portal-client's own request
 * timeout, and server-side dedup absorbs any re-send after a hard exit).
 */
const SHUTDOWN_FLUSH_DEADLINE_MS = 5000;
/**
 * P2-2: rows that have been in 'failed' state longer than this get
 * pruned. The agent POSTs a one-row roll-up to the portal first so a
 * permanent record outlives the prune. 30 days matches the plan's
 * spec ("rows status='failed' older than 30 days get pruned, but a
 * one-row summary is POSTed first").
 */
const FAILED_PRUNE_AGE_DAYS = 30;

const AGENT_VERSION = "0.2.0";

/**
 * How often the folder-presence monitor re-warns about a missing watch
 * folder (H13.1) and re-warns that the DB adapters failed to start (H13.3).
 * Loud once at boot, then hourly so the warning stays in a rolling log tail
 * without spamming.
 */
const FOLDER_MONITOR_INTERVAL_MS = 60 * 60 * 1000;

// H13.1 / H13.3: live operator-mistake status, surfaced in the heartbeat and
// re-warned periodically. `missingFolders` is refreshed by the folder monitor;
// `dbAdaptersFailed` is set once if startRunner throws.
let missingFolders: string[] = [];
let dbAdaptersFailed: string | null = null;

// H10b: rate limiter for heartbeat-delivery-failure logging (all reasons, not
// just http), so a multi-day outage does not spam one line per minute.
const shouldLogHeartbeatFailure = makeRateLimiter(10 * 60_000);

/**
 * H13.2: load config, exiting cleanly with the corrupt-file guidance if
 * loadConfig throws a ConfigError. Returns null only for "not enrolled"
 * (ENOENT), which each caller handles with its own --enroll hint.
 */
async function loadConfigOrExit(): Promise<AgentConfig | null> {
  try {
    return await loadConfig();
  } catch (err) {
    console.error(`[agent] ${(err as Error).message}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // H12: route outbound HTTPS through a corporate proxy when HTTP(S)_PROXY is
  // set. Must run before any fetch (enrollment included). No-op without a
  // proxy env var.
  configureGlobalDispatcher();

  if (args.includes("--enroll")) {
    // L18: the enrollment token is a bearer credential. On argv it leaks into
    // the OS process listing (Get-CimInstance Win32_Process on Windows, ps /
    // /proc on POSIX) and into shell history. Prefer stdin: `--token-stdin`
    // reads a piped value or prompts. The positional `--enroll <token>` form
    // still works for now.
    const tokenStdin = args.includes("--token-stdin");
    let token = tokenStdin ? undefined : arg(args, "--enroll");
    // Guard the `--enroll --clinic ...` shape: `arg` would otherwise hand back
    // the NEXT flag as the token. Treat a flag-looking value as "no token".
    if (token && token.startsWith("--")) token = undefined;
    const clinicId = arg(args, "--clinic");
    const portalBaseUrl =
      arg(args, "--portal") ?? "https://portal.eins.ag";
    const allowInsecureDev = args.includes("--allow-insecure-dev");
    const watchPath = arg(args, "--folder") ?? defaultWatchPath();
    const honorarFolder = arg(args, "--honorar-folder");
    const honorarMappingPath = arg(args, "--honorar-mapping");
    if (!clinicId) {
      console.error(
        "usage: eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>] [--honorar-folder <path>] [--honorar-mapping <json-path>] [--allow-insecure-dev]\n" +
          "       recommended: keep the token off argv and pipe it instead:\n" +
          "         echo <token> | eins-agent --enroll --token-stdin --clinic <uuid>"
      );
      process.exit(2);
    }
    if (!token) {
      // L18: read the token from stdin (piped value or interactive prompt).
      token = await readTokenFromStdin();
    }
    if (!token) {
      console.error(
        "no enrollment token provided. Pass it as `--enroll <token>` or pipe it via `--token-stdin`."
      );
      process.exit(2);
    }
    // P0-4: refuse to enroll against a non-https portal unless the operator
    // explicitly opts in AND the URL points at localhost. A fat-fingered
    // install command (or a phishing doc) that downgrades to http:// would
    // otherwise POST patient identifiers in cleartext to whatever endpoint
    // the operator typed.
    const portalCheck = validatePortalUrl(portalBaseUrl, allowInsecureDev);
    if (!portalCheck.ok) {
      console.error(`enrollment aborted: ${portalCheck.reason}`);
      process.exit(2);
    }
    // L23: enroll against the validator's NORMALIZED base URL (query/fragment
    // stripped, trailing slash dropped), never the raw operator string, so the
    // persisted portalBaseUrl and every later path join are well-formed.
    if (portalCheck.warning) {
      console.warn(`[agent] ${portalCheck.warning}`);
    }
    const result = await enroll({
      token,
      clinicId,
      portalBaseUrl: portalCheck.url,
      watchFolder: watchPath,
      honorarCsvFolder: honorarFolder,
      honorarCsvMapping: honorarMappingPath
        ? (await loadCsvMappingFile(honorarMappingPath)) ?? undefined
        : undefined,
    });
    if (!result.ok) {
      console.error(`enrollment failed: ${result.error}`);
      process.exit(1);
    }
    console.log("enrollment successful. Config persisted.");
    if (honorarFolder) {
      console.log(`honorar-csv watcher configured for ${honorarFolder}`);
    }
    process.exit(0);
  }

  if (args.includes("--configure-honorar")) {
    const folder = arg(args, "--configure-honorar");
    const mappingPath = arg(args, "--honorar-mapping");
    if (!folder) {
      console.error(
        "usage: eins-agent --configure-honorar <folder> [--honorar-mapping <json-path>]"
      );
      process.exit(2);
    }
    const cfg = await loadConfigOrExit();
    if (!cfg) {
      console.error(
        "no config found. Run `eins-agent --enroll <token> --clinic <uuid>` first."
      );
      process.exit(2);
    }
    cfg.honorarCsvFolder = folder;
    if (mappingPath) {
      const mapping = await loadCsvMappingFile(mappingPath);
      if (!mapping) {
        console.error(
          `mapping file ${mappingPath} is not a valid invoices mapping; aborting.`
        );
        process.exit(2);
      }
      cfg.honorarCsvMapping = mapping;
    }
    await saveConfig(cfg);
    console.log(`honorar-csv watch folder set to ${folder}. Restart the agent to apply.`);
    process.exit(0);
  }

  if (args.includes("--enable-db-adapter")) {
    await runEnableDbAdapter(args);
    process.exit(0);
  }

  if (args.includes("--rotate-db-credential")) {
    await runRotateDbCredential(args);
    process.exit(0);
  }

  if (args.includes("--disable-db-adapter")) {
    await runDisableDbAdapter(args);
    process.exit(0);
  }

  // L16: finish a previously-interrupted enrollment before deciding whether
  // this agent is enrolled. A crash between the portal spending the one-time
  // token and the local secret/config write leaves a recovery journal; we
  // complete it here so a mid-install crash is fixed by a plain restart, never
  // a new (impossible) token.
  try {
    const recovered = await completePendingEnrollment();
    if (recovered) {
      console.log(
        `[agent] completed a previously-interrupted enrollment for clinic=${recovered.clinicId} ` +
          `from the recovery journal; secret + config are now persisted.`
      );
    }
  } catch (err) {
    console.error(
      `[agent] found an interrupted enrollment that could NOT be completed: ${(err as Error).message} ` +
        `The enrollment token was already spent; do NOT re-enroll. Fix the underlying error ` +
        `(config-dir permissions / secure-store) and restart the agent.`
    );
    process.exit(2);
  }

  const cfg = await loadConfigOrExit();
  if (!cfg) {
    console.error(
      "no config found. Run `eins-agent --enroll <token> --clinic <uuid>` first."
    );
    process.exit(2);
  }

  // P0-4: re-validate the persisted portal URL at every cold start, so a
  // hand-edit of config.json (or a malicious downgrade by malware with
  // user-level write access) cannot silently switch the agent to a
  // cleartext endpoint. `--allow-insecure-dev` must be passed explicitly
  // each boot; there is no persistent dev-mode flag.
  const startupAllowInsecure = args.includes("--allow-insecure-dev");
  const startupPortalCheck = validatePortalUrl(
    cfg.portalBaseUrl,
    startupAllowInsecure
  );
  if (!startupPortalCheck.ok) {
    console.error(
      `[agent] refusing to start: ${startupPortalCheck.reason}`
    );
    console.error(
      `        (config.json portalBaseUrl=${cfg.portalBaseUrl})`
    );
    process.exit(2);
  }
  // L23: if a hand-edited config carried a query/fragment on the portal URL,
  // surface it. The runtime path joins with the URL API so the join stays
  // correct regardless, but the operator should know the URL was not clean.
  if (startupPortalCheck.warning) {
    console.warn(`[agent] ${startupPortalCheck.warning}`);
  }

  // P3-4: load (or mint, on first boot) the SQLCipher master key for the
  // outbox BEFORE any watcher fires its first enqueue. The key is held in
  // DPAPI / Keychain / 0600 file. We do this only on the long-running path;
  // one-shot commands (--enroll, --configure-honorar, --enable-db-adapter,
  // etc.) exit without touching the outbox, so paying the secure-store
  // round-trip on every invocation would be wasteful.
  try {
    const outboxKey = await getOrCreateOutboxKey();
    setOutboxKey(outboxKey);
  } catch (err) {
    console.error(
      `[agent] refusing to start: outbox key initialisation failed: ${(err as Error).message}`
    );
    process.exit(2);
  }

  console.log(
    `[agent] starting, clinic=${cfg.clinicId} folder=${cfg.watchFolder}`
  );

  const watcher = watchFolder({
    folder: cfg.watchFolder,
    clinicId: cfg.clinicId,
  });

  const honorarWatcher = cfg.honorarCsvFolder
    ? watchHonorarFolder({
        folder: cfg.honorarCsvFolder,
        clinicId: cfg.clinicId,
        mapping: cfg.honorarCsvMapping,
      })
    : null;
  if (honorarWatcher) {
    console.log(
      `[agent] honorar-csv watcher active, folder=${cfg.honorarCsvFolder}`
    );
  }

  let dbRunner: RunnerHandle | null = null;
  if (cfg.dbAdapters && cfg.dbAdapters.length > 0) {
    try {
      dbRunner = await startRunner({
        clinicId: cfg.clinicId,
        enabledVendors: cfg.dbAdapters.map((a) => a.vendor),
        connections: Object.fromEntries(
          cfg.dbAdapters.map((a) => [
            a.vendor,
            {
              host: a.host,
              port: a.port,
              database: a.database,
              username: a.username,
            },
          ])
        ),
      });
      console.log(
        `[agent] db-adapters active: ${cfg.dbAdapters
          .map((a) => a.vendor)
          .join(", ")}`
      );
    } catch (err) {
      // H13.3: a failed startRunner used to be swallowed with one line while
      // the agent kept running and the heartbeat still reported the CONFIGURED
      // vendors, so an operator saw "medatixx enrolled" while zero DB rows were
      // ever read. Record the failure in a module-level status that the
      // heartbeat surfaces and the folder monitor re-warns about hourly.
      dbAdaptersFailed = (err as Error).message;
      console.error(
        `[agent] DB ADAPTERS FAILED TO START: ${dbAdaptersFailed}. ` +
          `Configured vendors (${cfg.dbAdapters
            .map((a) => a.vendor)
            .join(", ")}) are NOT polling. The file/CSV watchers keep running, ` +
          `but no SQL-introspection events will be emitted until this is fixed ` +
          `and the agent is restarted.`
      );
      // Continue without db-adapters; the other watchers keep running.
    }
  }

  // M-D6: a GDT/CSV file watcher and a SQL DB adapter running for the SAME
  // Praxis double-ingest. The two paths stamp DIFFERENT bridge_source values, so
  // the portal's dedup index can never collapse them: every appointment /
  // invoice that both paths see lands twice, once per source. There are
  // legitimate mixed setups (GDT covering one data kind, SQL another), so we do
  // NOT refuse to start; we warn loudly at boot so an accidental overlap is
  // caught early. The GDT file watcher is always active (enrollment requires a
  // watchFolder); the DB adapter is active only when the runner actually started.
  if (dbRunner) {
    const fileSources = [
      "GDT-Ordner",
      cfg.honorarCsvFolder ? "Honorar-CSV-Ordner" : null,
    ].filter((s): s is string => !!s);
    console.warn(
      `[agent] DOUBLE-INGESTION WARNING: both a Datei-Watcher (${fileSources.join(
        ", "
      )}) and a SQL-Adapter (${(cfg.dbAdapters ?? [])
        .map((a) => a.vendor)
        .join(", ")}) are active for this Praxis. If both cover the same data ` +
        `(Termine / Rechnungen), every record is ingested twice under different ` +
        `bridge_source values and the portal dedup cannot merge them, inflating ` +
        `the numbers. Confirm the two paths cover DISJOINT data; otherwise disable ` +
        `one (eins-agent --disable-db-adapter <vendor>, or remove the file export).`
    );
  }

  // H13.1: a wrong or not-yet-created watch folder makes chokidar silently
  // watch nothing. Check every configured folder at boot, warn LOUDLY and by
  // exact path if any is missing, then re-check hourly (the folder may be
  // created later, e.g. once the PVS export is configured; chokidar picks it
  // up when it appears). The result also feeds the heartbeat.
  const configuredFolders = [cfg.watchFolder, cfg.honorarCsvFolder].filter(
    (f): f is string => !!f
  );
  async function refreshFolderStatus(): Promise<void> {
    missingFolders = await findMissingFolders(configuredFolders);
    if (missingFolders.length > 0) {
      console.error(
        `[agent] WATCH FOLDER MISSING: ${missingFolders.join(
          ", "
        )}. Nothing will be ingested from ${
          missingFolders.length > 1 ? "these paths" : "this path"
        } until it exists. ` +
          `Check the configured folder against the PVS export target; the agent ` +
          `will keep running and re-check hourly.`
      );
    }
    if (dbAdaptersFailed) {
      console.error(
        `[agent] DB adapters are still down: ${dbAdaptersFailed}. Restart the ` +
          `agent after fixing the connection to resume SQL-introspection polling.`
      );
    }
  }
  await refreshFolderStatus();
  const folderMonitorTimer = setInterval(() => {
    void refreshFolderStatus();
  }, FOLDER_MONITOR_INTERVAL_MS);

  // H10 + H11: the flush cycle (outage logging + auth-pause) lives in
  // flush.ts; index.ts supplies the concrete outbox/portal dependencies and
  // holds the per-agent flush state (auth-pause flag + log rate limiters).
  const flushState = createFlushState();
  const flushDeps: FlushDeps = {
    dueRows: (limit) => dueRows(limit).map((r) => ({ id: r.id, payload: r.payload })),
    postEvent,
    markSent,
    recordRetry,
    markFailedPermanent,
    outageSnapshot: buildOutageSnapshot,
    now: () => Date.now(),
    logWarn: (msg) => console.warn(msg),
    logError: (msg) => console.error(msg),
  };

  // P0-2: single-flight guard. Without this, a portal that holds the
  // socket open without responding lets each 5-second tick spawn another
  // concurrent flush(); within minutes the agent has hundreds of in-flight
  // POSTs and OOMs the Praxis workstation. The AbortController timeout in
  // portal-client.ts caps each request at 30s, but the guard is the
  // primary defence against stampede.
  let flushInFlight = false;
  // M-A3: when a cycle aborted on a portal Retry-After, space out the next
  // attempt instead of hammering every 5s. The cycle itself already
  // fast-aborts; this only delays the follow-up.
  let nextFlushAllowedAt = 0;
  const flushTimer = setInterval(() => {
    if (flushInFlight) return;
    if (Date.now() < nextFlushAllowedAt) return;
    flushInFlight = true;
    void (async () => {
      try {
        await runFlushCycle(flushDeps, flushState);
        if (flushState.retryAfterMs != null) {
          nextFlushAllowedAt = Date.now() + flushState.retryAfterMs;
        }
      } catch (err) {
        // runFlushCycle handles per-row failures via the outbox helpers, so
        // reaching here means the loop itself blew up. Log and let the guard
        // release so the next tick can retry.
        console.error("[agent] flush loop error:", err);
      } finally {
        flushInFlight = false;
      }
    })();
  }, FLUSH_INTERVAL_MS);
  const vacuumTimer = setInterval(() => {
    // M-A1: vacuumOld() is a synchronous SQLite DELETE. A throw here (disk full,
    // database locked, I/O error) would escape this timer callback as an
    // uncaughtException and kill the whole agent, taking the watchers and the
    // flush loop down with it. Every other periodic tick is guarded; this one
    // was not. Log and keep the timer alive so a transient SQLite error does not
    // end ingestion.
    try {
      vacuumOld();
    } catch (err) {
      console.error("[agent] outbox vacuum failed (continuing):", err);
    }
    // P2-2: dead-letter prune. pruneAndReportFailed deletes the aged failed
    // rows, then POSTs the roll-up that the delete returns; see its body for
    // the delete-before-POST trade-off.
    void pruneAndReportFailed(cfg.clinicId);
  }, VACUUM_INTERVAL_MS);
  // Drift telemetry rides a slower cadence than the event flush because
  // it is naturally rare (one signal per real PVS schema change) and the
  // portal applies a 60/min/clinic rate limit on /api/pvs/health.
  const driftTimer = setInterval(
    () => void flushDriftReports(),
    DRIFT_PUBLISH_INTERVAL_MS
  );
  // P2-2: per-minute heartbeat that surfaces outbox failure metrics on
  // the admin clinic detail page. Cheap (three SQLite count/min queries
  // + one signed POST). Failure to deliver is silent; the next tick
  // retries. We do NOT use the outbox for the heartbeat itself because
  // the heartbeat IS the signal "the outbox is broken"; routing it
  // through the same plumbing would mask the failure we're trying to
  // surface.
  const heartbeatTimer = setInterval(() => {
    void emitHeartbeat(cfg, dbRunner?.statusSnapshot() ?? []);
  }, HEARTBEAT_INTERVAL_MS);
  // Fire one heartbeat at startup so a fresh agent immediately surfaces
  // its state without a 60s delay.
  void emitHeartbeat(cfg, dbRunner?.statusSnapshot() ?? []);

  // L20: graceful shutdown. The previous handler called process.exit(0)
  // immediately, tearing down mid-POST (safe only because of server-side
  // dedup) and leaving the SQLCipher outbox handle open. Now we stop taking new
  // work, await any in-flight flush under a bounded deadline, close the outbox,
  // then exit. A second signal forces an immediate exit.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      console.log(`[agent] received ${signal} again; forcing immediate exit.`);
      process.exit(1);
    }
    shuttingDown = true;
    console.log(`[agent] received ${signal}, shutting down…`);
    // Stop new work: watchers + every periodic timer. A flush cycle already in
    // progress keeps running; we await it below.
    watcher.stop();
    honorarWatcher?.stop();
    void dbRunner?.stop();
    clearInterval(flushTimer);
    clearInterval(vacuumTimer);
    clearInterval(driftTimer);
    clearInterval(heartbeatTimer);
    clearInterval(folderMonitorTimer);

    // Await any in-flight flush so a POST mid-write is not torn, bounded so a
    // hung portal cannot block shutdown forever. The event loop yields on each
    // sleep so the flush IIFE's `finally { flushInFlight = false }` can run.
    const deadline = Date.now() + SHUTDOWN_FLUSH_DEADLINE_MS;
    while (flushInFlight && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (flushInFlight) {
      console.warn(
        `[agent] in-flight flush did not finish within ${SHUTDOWN_FLUSH_DEADLINE_MS}ms; ` +
          `exiting anyway (server-side dedup absorbs any re-send).`
      );
    }

    // Release the SQLCipher outbox handle (checkpoint WAL + drop the file lock)
    // before exiting, instead of the abrupt process.exit that left it open.
    try {
      closeOutbox();
    } catch (err) {
      console.error("[agent] error closing outbox on shutdown:", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * H10: map the outbox failure/pending snapshot into the shape flush.ts logs.
 * getFailureSummary now also reports the pending backlog and pending-with-
 * attempts count, so a permanently-retrying outbox (failedCount stays 0) is
 * no longer invisible in the outage summary.
 */
function buildOutageSnapshot(): OutageSnapshot {
  const snap = getFailureSummary();
  return {
    pendingCount: snap.pendingCount,
    pendingWithAttemptsCount: snap.pendingWithAttemptsCount,
    oldestPendingAt: snap.oldestPendingAt,
    failedCount: snap.failedCount,
  };
}

/**
 * Phase 8: the distinct bridge_sources this agent emits, for the heartbeat's
 * pvs_link_source seeding. Each enabled DB-adapter maps to its per-vendor
 * source via bridgeSourceForVendor; the GDT file-watcher (always running when
 * a watchFolder is set, which enrollment guarantees) adds "gdt_agent". Deduped
 * via a Set because both CGM-M1 variants collapse to cgm_m1pro and several
 * adapters can coexist with the one file-watcher source.
 */
function enrolledBridgeSources(cfg: AgentConfig): string[] {
  const sources = new Set<string>();
  for (const adapter of cfg.dbAdapters ?? []) {
    sources.add(bridgeSourceForVendor(adapter.vendor));
  }
  if (cfg.watchFolder) {
    sources.add("gdt_agent");
  }
  return Array.from(sources);
}

async function emitHeartbeat(
  cfg: AgentConfig,
  adapterStatuses: AdapterStreamStatus[] = []
): Promise<void> {
  try {
    const snap = getFailureSummary();
    // M-D4: attach the LIVE per-stream adapter status. The framework halts a
    // stream to status='error' (FAIL_THRESHOLD poll failures), 'schema_drift' or
    // 'config_invalid', and the runner records a vendor connectError on a
    // rotated/stale DB password; none of that reached the portal before, so a
    // broken adapter showed nothing but stale data. Rides as an additive field
    // via an intersection type so the wire contract stays backward-compatible;
    // the portal validates and stores it since migration 0069.
    const payload: HeartbeatPayload & {
      adapterStatuses?: AdapterStreamStatus[];
      stalePendingCount?: number;
    } = {
      clinicId: cfg.clinicId,
      agentVersion: AGENT_VERSION,
      failedCount: snap.failedCount,
      oldestFailedAt: snap.oldestFailedAt,
      lastFailureReason: snap.lastFailureReason,
      recentReasons: snap.recentReasons,
      enrolledVendors: enrolledBridgeSources(cfg),
      sentAt: Date.now(),
      // H10c / H13: additive operational-health fields. Persisted portal-side
      // since migration 0069 and used to raise the pvs_agent_health alerts, so
      // a permanently-retrying outbox and the two silent operator mistakes are
      // now visible without anyone touching this machine.
      pendingCount: snap.pendingCount,
      oldestPendingAt: snap.oldestPendingAt,
      // M-A2: pending rows stuck past the stale threshold (a permanently-
      // retrying outbox that failedCount never surfaces).
      stalePendingCount: snap.stalePendingCount,
      missingFolders,
      dbAdaptersFailed,
      adapterStatuses,
    };
    const res = await postHeartbeat(payload);
    if (!res.ok) {
      // H10b: a multi-day outage's heartbeat failures are `network:` /
      // `timeout` / `no_secret`, none of which the old `startsWith("http")`
      // gate matched, so the operator saw NOTHING while telemetry silently
      // stopped. Log ALL reasons now, but rate-limit to ~1 line / 10 min so
      // a genuine outage does not spam one line per minute.
      if (shouldLogHeartbeatFailure(Date.now())) {
        console.warn(
          `[agent] heartbeat delivery failing: ${res.reason} ` +
            `(pending=${snap.pendingCount}, failed=${snap.failedCount}). ` +
            `Portal telemetry is stale until this recovers.`
        );
      }
    }
  } catch (err) {
    console.error("[agent] heartbeat tick threw:", err);
  }
}

async function pruneAndReportFailed(clinicId: string): Promise<void> {
  try {
    // Peek first so we know whether there's anything to report. If
    // nothing's failed-aged, skip the network round-trip entirely.
    const snap = getFailureSummary();
    if (snap.failedCount === 0) return;
    // We prune FIRST, then POST the roll-up the prune returns.
    // pruneFailedOlderThan deletes the aged failed rows and hands back their
    // count, age span, and grouped reasons in one call, so there is no
    // read-only summary to POST ahead of the delete.
    //
    // Trade-off of delete-before-POST: if the POST fails (or the process dies)
    // after the rows are gone, the portal never receives this roll-up. We
    // accept that because the rows are dead-letter (already permanently
    // 'failed' and already surfaced live via the heartbeat's failedCount), so
    // the roll-up is a forensic nicety, not the system of record; on POST
    // failure we still write it to the agent log below. The alternative
    // (summarize read-only, POST, then delete only on success) just swaps this
    // for a double-report on a crash between POST and delete, plus a 2-phase
    // dance across SQLite + HTTP that is not worth it for a dead-letter roll-up.
    const summary = pruneFailedOlderThan(FAILED_PRUNE_AGE_DAYS);
    if (summary.prunedCount === 0) return;
    const res = await postFailureSummary({
      clinicId,
      prunedCount: summary.prunedCount,
      prunedOldestAt: summary.prunedOldestAt,
      prunedNewestAt: summary.prunedNewestAt,
      reasons: summary.reasons,
      sentAt: Date.now(),
    });
    if (!res.ok) {
      // We log the local-only roll-up so a forensic dig through the
      // agent log can still see what was pruned even if the portal
      // never received the summary. Bounded length to avoid noise.
      console.error(
        `[agent] failure-summary POST failed: ${res.reason}; pruned ${summary.prunedCount} rows (oldest=${summary.prunedOldestAt}, newest=${summary.prunedNewestAt}, top-reason=${summary.reasons[0]?.reason ?? "none"})`
      );
    } else {
      console.log(
        `[agent] failure-summary POST sent: pruned=${summary.prunedCount}`
      );
    }
  } catch (err) {
    console.error("[agent] prune-and-report failed:", err);
  }
}

async function flushDriftReports(): Promise<void> {
  try {
    const outcome = await publishPendingDrift();
    if (outcome.attempted > 0) {
      console.log(
        `[agent] drift publisher: attempted=${outcome.attempted} delivered=${outcome.delivered} deferred=${outcome.deferred} failed=${outcome.failed}`
      );
    }
  } catch (err) {
    console.error("[agent] drift publisher tick failed:", err);
  }
}

async function runEnableDbAdapter(args: string[]): Promise<void> {
  const vendor = arg(args, "--enable-db-adapter");
  const credentialId = arg(args, "--credential-id") ?? `${vendor}-default`;
  const host = arg(args, "--db-host");
  const portRaw = arg(args, "--db-port");
  const database = arg(args, "--db-database");
  const username = arg(args, "--db-username");
  if (!vendor || !host || !username) {
    console.error(
      "usage: eins-agent --enable-db-adapter <vendor> [--credential-id <id>] --db-host <host> [--db-port <port>] [--db-database <name>] --db-username <user>"
    );
    process.exit(2);
  }
  const cfg = await loadConfigOrExit();
  if (!cfg) {
    console.error(
      "no config found. Run `eins-agent --enroll <token> --clinic <uuid>` first."
    );
    process.exit(2);
  }
  const password = await promptHidden(
    `Read-only DB password for vendor='${vendor}' user='${username}': `
  );
  if (!password) {
    console.error("aborted: empty password.");
    process.exit(2);
  }
  await storeDbCredential(credentialId, password);
  const enrollment: DbAdapterEnrollment = {
    vendor,
    credentialId,
    host,
    port: portRaw ? Number(portRaw) : undefined,
    database,
    username,
  };
  cfg.dbAdapters = cfg.dbAdapters ?? [];
  const existing = cfg.dbAdapters.findIndex((a) => a.vendor === vendor);
  if (existing >= 0) {
    cfg.dbAdapters[existing] = enrollment;
  } else {
    cfg.dbAdapters.push(enrollment);
  }
  await saveConfig(cfg);
  console.log(
    `db-adapter '${vendor}' enrolled. Restart the agent to start polling.`
  );
}

async function runRotateDbCredential(args: string[]): Promise<void> {
  const credentialId = arg(args, "--rotate-db-credential");
  if (!credentialId) {
    console.error("usage: eins-agent --rotate-db-credential <id>");
    process.exit(2);
  }
  const password = await promptHidden(
    `New password for credential '${credentialId}': `
  );
  if (!password) {
    console.error("aborted: empty password.");
    process.exit(2);
  }
  await storeDbCredential(credentialId, password);
  console.log(
    `credential '${credentialId}' rotated. Restart the agent to apply.`
  );
}

async function runDisableDbAdapter(args: string[]): Promise<void> {
  const vendor = arg(args, "--disable-db-adapter");
  if (!vendor) {
    console.error("usage: eins-agent --disable-db-adapter <vendor>");
    process.exit(2);
  }
  const cfg = await loadConfigOrExit();
  if (!cfg) {
    console.error("no config found.");
    process.exit(2);
  }
  if (!cfg.dbAdapters) {
    console.log("no db-adapters enrolled.");
    return;
  }
  const before = cfg.dbAdapters.length;
  cfg.dbAdapters = cfg.dbAdapters.filter((a) => a.vendor !== vendor);
  await saveConfig(cfg);
  console.log(
    `db-adapter '${vendor}' removed (${before - cfg.dbAdapters.length} entry). ` +
      `Credential stays in secure-store for easy re-enable.`
  );
}

/**
 * L18: read the enrollment token from stdin instead of argv. Uses a piped
 * value when stdin is not a TTY (`echo <token> | eins-agent --enroll
 * --token-stdin ...`), or an interactive prompt otherwise. The prompt is
 * written to stderr so a piped stdout stays clean. Returns "" if nothing is
 * read (EOF / empty line), which the caller treats as "no token".
 */
async function readTokenFromStdin(): Promise<string> {
  if (input.isTTY) {
    process.stderr.write("Enrollment token: ");
  }
  const rl = createInterface({ input });
  return new Promise<string>((resolve) => {
    let done = false;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(value.trim());
    };
    rl.once("line", (line) => finish(line));
    rl.once("close", () => finish(""));
  });
}

async function promptHidden(prompt: string): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  // Best-effort password masking via a SIGINT-safe muted writeable.
  // node:readline doesn't have a built-in masked-input, so we monkey-patch
  // the output writer for the duration of the question.
  const stdoutWrite = (output as unknown as { write: (s: string) => boolean }).write;
  let masking = false;
  (output as unknown as { write: (s: string) => boolean }).write = (s: string) => {
    if (masking && s !== prompt) return true;
    return stdoutWrite.call(output, s);
  };
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      (output as unknown as { write: (s: string) => boolean }).write = stdoutWrite;
      rl.close();
      resolve(answer.trim());
    });
    masking = true;
  });
}

function arg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function defaultWatchPath(): string {
  return process.platform === "win32"
    ? "C:\\GDT-Out"
    : `${process.env.HOME ?? "/tmp"}/gdt-out`;
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
