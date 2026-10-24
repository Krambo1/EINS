// H7: MUST be the first import so process.env.TZ = "UTC" is set before any DB
// client library initialises or any Date is constructed. Do not reorder.
import "./tz-pin.js";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MappingFileError,
  configDir,
  configPath,
  effectiveGdtReceiverId,
  isValidGdtReceiverId,
  legacyUserDataDir,
  loadConfig,
  loadCsvMappingFileStrict,
  outboxPath,
  saveConfig,
  type AgentConfig,
  type DbAdapterEnrollment,
} from "./config.js";
import { enroll, completePendingEnrollment, defaultWatchPath } from "./enrollment.js";
import { watchFolderConflict } from "./watch-folders.js";
import { scheduleMaintenance } from "./maintenance-schedule.js";
import { csvWatcherDetails, gdtWatcherDetails } from "./heartbeat-details.js";
import { watchFolder, type GdtWatcherHandle } from "./watcher.js";
import { getCsvWatcherStatus, watchHonorarFolder } from "./csv-watcher.js";
import {
  csvFolderConflictHealth,
  csvWatcherHealth,
  gdtWatcherHealth,
  type WatcherStreamStatus,
} from "./file-watcher-health.js";
import { runSchemaProbeCli } from "./db-adapters/schema-probe.js";
import {
  dueRows,
  markSent,
  markFailedPermanent,
  recordRetry,
  vacuumOld,
  getFailureSummary,
  getPendingReasons,
  pruneFailedOlderThan,
  requeueFailed,
  setOutboxKey,
  closeOutbox,
} from "./outbox.js";
import { getOrCreateOutboxKey } from "./outbox-key.js";
import { existsSync } from "node:fs";
import {
  postEvent,
  postEventBatch,
  postHeartbeat,
  postFailureSummary,
  fetchVendorConfigs,
  type HeartbeatPayload,
} from "./portal-client.js";
import { storeDbCredential } from "./secure-store.js";
import {
  startRunner,
  defaultConfigsDir,
  type RunnerHandle,
  type AdapterStreamStatus,
} from "./db-adapters/runner.js";
import {
  runConfigSync,
  reportedConfigs,
  readRollbacks,
  type ConfigSyncDeps,
  type SyncOutcome,
  type VendorConfigManifestEntry,
} from "./db-adapters/config-sync.js";
import { trustedConfigKeys } from "./db-adapters/config-trust.js";
import { loadAllVendorConfigs } from "./db-adapters/vendor-config.js";
import type { VendorConfig } from "./db-adapters/types.js";
import {
  publishPendingDrift,
  bridgeSourceForVendor,
} from "./db-adapters/drift-publisher.js";
import { validatePortalUrl } from "./portal-url.js";
import { configureGlobalDispatcher } from "./net-setup.js";
import {
  createFlushState,
  flushTick,
  uploadStateSnapshot,
  type FlushDeps,
  type FlushState,
  type OutageSnapshot,
} from "./flush.js";
import { makeRateLimiter } from "./log-throttle.js";
import { checkFolders, describeFolderProblem } from "./folder-check.js";
// Lives in its own module because the offline config signer imports it too:
// a signed bundle's `minAgentVersion` is compared against this exact value.
import { AGENT_VERSION } from "./version.js";
import { DataDirError, ensureDataDir } from "./data-dir.js";
import { migrateLegacyData } from "./data-dir-migration.js";
import {
  EXIT_LOCK_HELD,
  acquireInstanceLock,
  describeLockHolder,
  inspectLock,
  type InstanceLock,
} from "./instance-lock.js";
import { installCrashHandlers } from "./crash-handlers.js";
import { SHUTDOWN_MESSAGE_TYPE, superviseMain } from "./supervisor.js";
import {
  installService,
  serviceStatus,
  startService,
  stopService,
  uninstallService,
} from "./service-windows.js";
import { isElevated, isRunningAsSystem } from "./win-context.js";
import { evaluateRuntime, readBuildInfo } from "./runtime-check.js";

/**
 * eins-agent entry point.
 *
 * Modes:
 *   eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>]
 *               [--honorar-folder <path>] [--honorar-mapping <json-path>]
 *               [--gdt-receiver-id <id>]
 *     One-shot enrollment. Persists config + secret, then exits. Prefer
 *     `--token-stdin` (pipe or prompt) over the positional token so the
 *     one-time token never lands in the OS process listing or shell history:
 *       echo <token> | eins-agent --enroll --token-stdin --clinic <uuid>
 *     Refuses to run while a live agent holds the instance lock (it rewrites
 *     config + secret). A bad --honorar-mapping file aborts instead of silently
 *     falling back to auto-detection.
 *
 *   eins-agent
 *     Default: load existing config, start watcher(s) + flush loop. Starts
 *     a Honorar-CSV watcher additionally when `honorarCsvFolder` is set
 *     in the persisted config, and the SQL-introspection runner when any
 *     `dbAdapters[]` are enrolled. Takes the single-instance lock
 *     (<dataDir>\agent.lock; a second agent exits with code 75), installs
 *     crash handlers (uncaught error -> log + exit code 70) and, on Windows,
 *     first migrates data from the legacy per-user %APPDATA%\EINS-Agent.
 *
 *   eins-agent --supervise
 *     Parent process for background operation: runs the default mode as a
 *     child, restarts it with backoff (2 s .. 60 s), logs to
 *     <dataDir>\logs\agent.log (10 MB x 5 rotation). This is what the
 *     scheduled task starts.
 *
 *   eins-agent --install-service [--allow-writable-install]   (Windows, elevated)
 *   eins-agent --uninstall-service                            (Windows, elevated)
 *   eins-agent --stop-service                                 (Windows, elevated)
 *   eins-agent --start-service                                (Windows, elevated)
 *   eins-agent --service-status                               (Windows)
 *     Register / remove / inspect the scheduled task "EINS-Agent" (SYSTEM,
 *     starts at boot and then every 5 minutes, a no-op while it runs; no logon
 *     needed). --install-service first migrates the legacy per-user data (run
 *     it as the Windows user who did the setup) and waits up to 60 s for the
 *     agent to come up (exit 1 with a pointer to agent.log if it does not).
 *     Upgrade: --stop-service (disables the task, ends the instance, waits
 *     until the instance lock is released), replace the files, then
 *     --install-service or --start-service.
 *     Data dir (Windows): %ProgramData%\EINS-Agent, SYSTEM + Administrators
 *     only. EINS_AGENT_DATA_DIR overrides the location (development).
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
 *
 *   eins-agent --requeue-failed [--reason <code>]
 *     Move dead-lettered outbox rows (status failed) back to pending so the agent
 *     tries them again, after the cause (bad deploy, wrong portal URL, version
 *     skew) is fixed. --reason limits it to rows whose last error contains that
 *     text, for example invalid_envelope. Prints how many rows were moved. Safe
 *     while the agent runs.
 *
 *   eins-agent --probe-db-adapter <vendor> [--json]
 *     Read-only check of an enrolled adapter against the real PVS database:
 *     does every table and column the vendor YAML uses exist, with which
 *     types, and which status values are present. Exit 0 = all found,
 *     1 = differences (report lists them), 2 = probe failed. Run it on the
 *     first real Praxis PC before trusting a stream (the YAMLs are guesses).
 */

const FLUSH_INTERVAL_MS = 5000;
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
/** Pass 2: set when the GDT and Honorar CSV folders are the same folder. */
let csvFolderConflict: string | null = null;
let dbAdaptersFailed: string | null = null;

/** The running flush state, read by the heartbeat (B5 upload state). */
let activeFlushState: FlushState | null = null;
/** Monotonic ms of the last heartbeat the portal accepted (-Infinity = none yet). */
let lastHeartbeatOkMono = Number.NEGATIVE_INFINITY;

// H10b: rate limiter for heartbeat-delivery-failure logging (all reasons, not
// just http), so a multi-day outage does not spam one line per minute.
const shouldLogHeartbeatFailure = makeRateLimiter(10 * 60_000);

/**
 * Result of the most recent remote-config sync pass, reported on the NEXT
 * heartbeat. Config sync rides the heartbeat response, so its outcome is
 * always one tick behind: the pass that fetched a config reports its result
 * sixty seconds later. That is deliberate. The alternative (a second POST to
 * report the result immediately) doubles the request rate for a value the
 * operator reads on a dashboard, not in real time.
 */
let lastConfigSync: SyncOutcome | null = null;

/**
 * Bundled vendor configs, loaded once. Used as the rollback floor when a pushed
 * config regresses on a machine that has no earlier remote config to fall back
 * to. Cached because it is a directory read of committed, already-validated
 * files that cannot change without restarting the process.
 */
let bundledConfigsCache: Map<string, VendorConfig> | null = null;

async function loadBundledConfig(vendor: string): Promise<VendorConfig | null> {
  try {
    if (!bundledConfigsCache) {
      bundledConfigsCache = await loadAllVendorConfigs(defaultConfigsDir());
    }
    return bundledConfigsCache.get(vendor) ?? null;
  } catch (err) {
    console.error(
      `[agent] could not read the bundled vendor configs: ${(err as Error).message}`
    );
    return null;
  }
}

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

// ---------- operating context: service, supervisor, instance lock -----------

/** Set by supervisor.ts on the child it spawns: this process is supervised. */
const SUPERVISED = process.env.EINS_AGENT_SUPERVISED === "1";

/** The single-instance lock held by this run-mode process (see instance-lock.ts). */
let instanceLock: InstanceLock | null = null;

/** Absolute path of the running script (dist/index.js in a built agent). */
function agentScriptPath(): string {
  return fileURLToPath(import.meta.url);
}

/**
 * A bundle built for one Node ABI must not run under another: the encrypted
 * outbox would die with an obscure "bindings file" error. The bundle script
 * stamps build-info.json beside dist/; compare it with the running Node.
 * Skipped when there is no stamp (running from sources).
 */
function checkRuntimeAbiOrExit(): void {
  const stamp = readBuildInfo(
    join(dirname(agentScriptPath()), "..", "build-info.json")
  );
  if (!stamp) return;
  const verdict = evaluateRuntime(stamp);
  if (!verdict.ok) {
    for (const problem of verdict.problems) console.error(`[agent] ${problem}`);
    process.exit(2);
  }
}

/**
 * Create + lock down the machine-wide data dir, then move legacy per-user data
 * into it (Windows). Called once before any mode that reads or writes the data
 * dir. The supervised child skips the ACL pass the supervisor already did.
 */
async function prepareDataDirOrExit(opts: { migrate: boolean }): Promise<void> {
  try {
    await ensureDataDir({ harden: SUPERVISED ? false : undefined });
  } catch (err) {
    if (err instanceof DataDirError) {
      console.error(`[agent] ${err.message}`);
      process.exit(2);
    }
    throw err;
  }
  if (!opts.migrate) return;
  const isSystem = isRunningAsSystem();
  const migration = await migrateLegacyData({
    newDir: configDir(),
    legacyDir: legacyUserDataDir(),
    isSystem,
    // Look under every user profile when SYSTEM or elevated (they can see them).
    scanAllProfiles: isSystem || (process.platform === "win32" && (await isElevated())),
  });
  if (migration.status === "unreachable") {
    console.error(`[agent] ${migration.message}`);
  } else if (migration.status === "blocked" || migration.status === "ambiguous") {
    // Nothing was copied. Exit non-zero so --install-service does not go on to
    // register a service that would start with an empty data directory.
    console.error(`[agent] ${migration.message}`);
    process.exit(2);
  } else if (migration.status === "failed") {
    console.error(
      `[agent] Die Datenübernahme aus dem alten Benutzerordner ist fehlgeschlagen: ${migration.error} ` +
        `/ migrating the legacy per-user data failed. Nothing was switched over; fix the cause and run again.`
    );
    process.exit(2);
  }
}

/** `--enroll` rewrites config + secret; a running agent would not pick that up. */
function refuseIfAgentRunning(): void {
  const lock = inspectLock(configDir());
  if (lock.state !== "live") return;
  const pid = lock.holder.pid !== null ? ` (PID ${lock.holder.pid})` : "";
  console.error(
    `Der Agent läuft gerade${pid} und würde die neue Einrichtung nicht übernehmen. Bitte zuerst beenden: ` +
      `eins-agent --stop-service, danach die Einrichtung wiederholen und mit ` +
      `eins-agent --start-service wieder starten. ` +
      `/ A live agent${pid} holds the instance lock; stop it first (eins-agent --stop-service), ` +
      `then re-run --enroll and start it again with --start-service.`
  );
  process.exit(EXIT_LOCK_HELD);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // The supervisor is what the scheduled task starts. It runs BEFORE anything
  // else so that every startup failure (runtime check, data dir, proxy setup)
  // happens with agent.log open and the crash handlers installed: a SYSTEM
  // task has no console, so otherwise the cause would be lost.
  if (args.includes("--supervise")) {
    process.exit(
      await superviseMain({
        dataDir: configDir(),
        scriptPath: agentScriptPath(),
        argv: args,
        interactive: !!process.stdout.isTTY,
        prepare: async () => {
          const stamp = readBuildInfo(
            join(dirname(agentScriptPath()), "..", "build-info.json")
          );
          if (stamp) {
            const verdict = evaluateRuntime(stamp);
            if (!verdict.ok) throw new Error(verdict.problems.join(" | "));
          }
          // DataDirError messages are already German + English.
          await ensureDataDir({ harden: SUPERVISED ? false : undefined });
        },
      })
    );
  }

  // H12: route outbound HTTPS through a corporate proxy when HTTP(S)_PROXY is
  // set. Must run before any fetch (enrollment included). No-op without a
  // proxy env var.
  await configureGlobalDispatcher();

  // Service management first: these must work on a PC whose agent is not (yet)
  // healthy, so they run before anything touches the config or the outbox.
  if (args.includes("--service-status")) {
    process.exit(
      await serviceStatus({
        dataDir: configDir(),
        out: (l) => console.log(l),
        err: (l) => console.error(l),
        readClinicId: async () => (await loadConfig())?.clinicId ?? null,
      })
    );
  }
  if (args.includes("--stop-service")) {
    process.exit(
      await stopService({
        dataDir: configDir(),
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    );
  }
  if (args.includes("--start-service")) {
    process.exit(
      await startService({
        dataDir: configDir(),
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    );
  }
  if (args.includes("--uninstall-service")) {
    process.exit(
      await uninstallService({
        out: (l) => console.log(l),
        err: (l) => console.error(l),
      })
    );
  }

  checkRuntimeAbiOrExit();

  if (args.includes("--install-service")) {
    // First step as the interactive admin: migrate the per-user data while we
    // can still decrypt it, then register the task.
    await prepareDataDirOrExit({ migrate: true });
    const scriptPath = agentScriptPath();
    process.exit(
      await installService({
        nodePath: process.execPath,
        scriptPath,
        workingDir: dirname(dirname(scriptPath)),
        dataDir: configDir(),
        allowWritableInstall: args.includes("--allow-writable-install"),
        out: (l) => console.log(l),
        err: (l) => console.error(l),
        isEnrolled: async () => (await loadConfig().catch(() => null)) !== null,
        readClinicId: async () => (await loadConfig())?.clinicId ?? null,
      })
    );
  }

  // Every remaining mode (enroll, the config editors, the run mode) reads or
  // writes the data directory.
  await prepareDataDirOrExit({ migrate: true });

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
    // No default here: enroll() keeps an existing config's folder and only
    // falls back to the default GDT folder on a fresh install.
    const watchPath = arg(args, "--folder");
    const honorarFolder = arg(args, "--honorar-folder");
    const honorarMappingPath = arg(args, "--honorar-mapping");
    const gdtReceiverId = arg(args, "--gdt-receiver-id");
    if (!clinicId) {
      console.error(
        "usage: eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>] [--honorar-folder <path>] [--honorar-mapping <json-path>] [--gdt-receiver-id <id>] [--allow-insecure-dev]\n" +
          "       recommended: keep the token off argv and pipe it instead:\n" +
          "         echo <token> | eins-agent --enroll --token-stdin --clinic <uuid>"
      );
      process.exit(2);
    }
    // Validate everything that can be validated locally BEFORE the one-time
    // token is spent on the network: a typo here must cost a retry, not a new
    // token.
    if (
      args.includes("--gdt-receiver-id") &&
      (!gdtReceiverId || !isValidGdtReceiverId(gdtReceiverId))
    ) {
      console.error(
        `enrollment aborted: --gdt-receiver-id '${gdtReceiverId ?? ""}' is invalid; ` +
          `expected 1-8 characters of [A-Za-z0-9_] (default: EINS).`
      );
      process.exit(2);
    }
    let honorarMapping: Awaited<ReturnType<typeof loadCsvMappingFileStrict>> | undefined;
    if (honorarMappingPath) {
      try {
        honorarMapping = await loadCsvMappingFileStrict(honorarMappingPath);
      } catch (err) {
        if (err instanceof MappingFileError) {
          console.error(`enrollment aborted: ${err.message}`);
          process.exit(2);
        }
        throw err;
      }
    }
    // A running agent would keep the old secret/config in memory.
    refuseIfAgentRunning();
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
      honorarCsvMapping: honorarMapping,
    });
    if (!result.ok) {
      console.error(`enrollment failed: ${result.error}`);
      process.exit(1);
    }
    if (gdtReceiverId) {
      // enroll() persists a fixed set of fields; the receiver id is added to
      // the freshly written config right after.
      try {
        const saved = await loadConfig();
        if (!saved) throw new Error("config.json is missing after enrollment");
        saved.gdtReceiverId = gdtReceiverId;
        await saveConfig(saved);
      } catch (err) {
        console.error(
          `enrollment succeeded, but the GDT receiver id could not be saved: ${(err as Error).message}. ` +
            `Add "gdtReceiverId": "${gdtReceiverId}" to ${configPath()} by hand; do NOT re-enroll.`
        );
        process.exit(1);
      }
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
    const folderConflict = watchFolderConflict({
      watchFolder: cfg.watchFolder,
      honorarCsvFolder: folder,
    });
    if (folderConflict) {
      console.error(`${folderConflict} Nothing was changed.`);
      process.exit(2);
    }
    cfg.honorarCsvFolder = folder;
    if (mappingPath) {
      try {
        cfg.honorarCsvMapping = await loadCsvMappingFileStrict(mappingPath);
      } catch (err) {
        if (err instanceof MappingFileError) {
          console.error(`${err.message}; aborting.`);
          process.exit(2);
        }
        throw err;
      }
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

  if (args.includes("--probe-db-adapter")) {
    process.exit(await runProbeDbAdapter(args));
  }

  if (args.includes("--requeue-failed")) {
    process.exit(await runRequeueFailed(args));
  }

  // ---- run mode from here on ------------------------------------------------

  // An uncaught error or unhandled rejection logs its stack, closes the outbox
  // on a best-effort basis and exits 70; the supervisor (or the scheduled
  // task's restart-on-failure) starts a clean process.
  installCrashHandlers({
    closeOutbox: () => closeOutbox(),
    releaseLock: () => instanceLock?.releaseSync(),
    timestamp: !SUPERVISED,
  });

  // One agent per data directory: two would both consume the same GDT files and
  // race on the outbox. Taken before anything below writes config or secrets.
  const lockAttempt = acquireInstanceLock({ dir: configDir() });
  if (!lockAttempt.acquired) {
    console.error(
      `[agent] ${describeLockHolder(lockAttempt.holder, join(configDir(), "agent.lock"))}`
    );
    process.exit(EXIT_LOCK_HELD);
  }
  instanceLock = lockAttempt.lock;
  if (lockAttempt.tookOverStale) {
    console.warn(
      `[agent] took over a stale instance lock (${lockAttempt.tookOverStale}); the previous agent did not shut down cleanly.`
    );
  }
  process.on("exit", () => instanceLock?.releaseSync());
  instanceLock.startHeartbeat((reason) => {
    // Another agent took the lock while this one was frozen: step aside at once
    // instead of running two agents against the same outbox.
    console.error(`[agent] FATAL ${reason}; exiting.`);
    process.exit(EXIT_LOCK_HELD);
  });

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

  // Pass 2: same GDT and CSV folder. Do NOT exit: after an upgrade that would
  // stop GDT, the DB adapters and the upload of everything already queued.
  // Only the CSV watcher stays off; the heartbeat reports config_invalid.
  csvFolderConflict = watchFolderConflict(cfg);
  if (csvFolderConflict) {
    console.error(
      `[agent] Honorar-CSV watcher NOT started: ${csvFolderConflict} ` +
        `Fix it with: eins-agent --configure-honorar <other folder>`
    );
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

  // Only GDT files addressed to this receiver id (file name prefix or FK 8315)
  // are consumed and deleted; files for other devices stay untouched.
  const watcher = watchFolder({
    folder: cfg.watchFolder,
    clinicId: cfg.clinicId,
    receiverId: effectiveGdtReceiverId(cfg),
  });
  gdtWatcher = watcher;

  const honorarWatcher = cfg.honorarCsvFolder && !csvFolderConflict
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
    // Each problem folder carries a reason (missing / no_access / not_a_directory
    // / unreachable) and, as SYSTEM, a hint for mapped drive letters and
    // network shares, so the operator checks the right thing.
    const folderProblems = await checkFolders(configuredFolders);
    missingFolders = folderProblems.map((p) => p.path);
    if (folderProblems.length > 0) {
      console.error(
        `[agent] WATCH FOLDER PROBLEM: ${folderProblems
          .map(describeFolderProblem)
          .join(" | ")}. Nothing will be ingested from ${
          folderProblems.length > 1 ? "these paths" : "this path"
        } until this is fixed. ` +
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
  activeFlushState = flushState;
  const flushDeps: FlushDeps = {
    dueRows: (limit) => dueRows(limit).map((r) => ({ id: r.id, payload: r.payload })),
    postEvent,
    postBatch: (payloads) => postEventBatch(cfg.clinicId, payloads),
    markSent,
    recordRetry,
    markFailedPermanent,
    outageSnapshot: buildOutageSnapshot,
    now: () => Date.now(),
    // Every in-memory gate (backoff, auth probe) runs on this clock, so a wall
    // clock that steps backwards cannot freeze the flush loop.
    monotonicNow: () => performance.now(),
    // Heartbeats got through recently: the portal is up, so a batch that keeps
    // timing out has a stuck event in it and not a dead network.
    portalReachable: () =>
      performance.now() - lastHeartbeatOkMono < 3 * HEARTBEAT_INTERVAL_MS,
    logWarn: (msg) => console.warn(msg),
    logError: (msg) => console.error(msg),
  };

  // P0-2: single-flight guard (flushState.inFlight). Without it, a portal that
  // holds the socket open without responding lets each 5-second tick spawn
  // another concurrent flush; within minutes the agent has hundreds of in-flight
  // POSTs and OOMs the Praxis workstation. The AbortController timeout in
  // portal-client.ts caps each request at 30s, but the guard is the primary
  // defence against stampede. flushTick also holds back the next cycle when the
  // portal asked for a backoff (M-A3), on the monotonic clock (A9).
  const flushTimer = setInterval(() => {
    void flushTick(flushDeps, flushState);
  }, FLUSH_INTERVAL_MS);
  // Daily maintenance: vacuum sent rows, prune old dead letters, POST the
  // roll-up. Runs once ~60 s after start (a PC that is shut down nightly never
  // reaches 24 h of uptime), then every 24 h.
  const maintenance = scheduleMaintenance({
    run: async () => {
      // M-A1: vacuumOld() is a synchronous SQLite DELETE; a throw (disk full,
      // database locked) must not end ingestion.
      try {
        vacuumOld();
      } catch (err) {
        console.error("[agent] outbox vacuum failed (continuing):", err);
      }
      // P2-2: dead-letter prune. pruneAndReportFailed deletes the aged failed
      // rows, then POSTs the roll-up that the delete returns; see its body for
      // the delete-before-POST trade-off.
      await pruneAndReportFailed(cfg.clinicId);
    },
    onError: (err) => console.error("[agent] outbox maintenance failed (continuing):", err),
  });
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
    void emitHeartbeat(cfg, dbRunner);
  }, HEARTBEAT_INTERVAL_MS);
  // Fire one heartbeat at startup so a fresh agent immediately surfaces
  // its state without a 60s delay. This is also the tick that pulls any
  // vendor config published while the machine was off.
  void emitHeartbeat(cfg, dbRunner);

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
    // The GDT watcher's stop() waits for a file mid-claim to finish (bounded),
    // so a half-consumed file is not left in .eins\processing on every stop.
    honorarWatcher?.stop();
    void dbRunner?.stop();
    await Promise.race([
      watcher.stop().catch(() => undefined),
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
    clearInterval(flushTimer);
    maintenance.stop();
    clearInterval(driftTimer);
    clearInterval(heartbeatTimer);
    clearInterval(folderMonitorTimer);

    // Await any in-flight flush so a POST mid-write is not torn, bounded so a
    // hung portal cannot block shutdown forever. The event loop yields on each
    // sleep so flushTick's `finally { inFlight = false }` can run.
    const deadline = Date.now() + SHUTDOWN_FLUSH_DEADLINE_MS;
    while (flushState.inFlight && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (flushState.inFlight) {
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
    instanceLock?.releaseSync();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Ctrl+Break (and console close) on Windows.
  process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  if (typeof process.send === "function") {
    // Spawned by the supervisor with an IPC channel. On Windows a signal cannot
    // be "forwarded" (child.kill() is TerminateProcess), so the supervisor asks
    // for a graceful stop with a message; and if the supervisor itself dies the
    // channel closes and this process must not linger as an orphan.
    // Ignored while already shutting down (a console Ctrl+C reaches both).
    process.on("message", (msg) => {
      if ((msg as { type?: string } | null)?.type !== SHUTDOWN_MESSAGE_TYPE) return;
      if (!shuttingDown) void shutdown("supervisor stop request");
    });
    process.on("disconnect", () => {
      if (!shuttingDown) void shutdown("supervisor channel closed");
    });
  }
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

/** Set once the GDT watcher runs; read by the heartbeat. */
let gdtWatcher: GdtWatcherHandle | null = null;

async function emitHeartbeat(
  cfg: AgentConfig,
  dbRunner: RunnerHandle | null
): Promise<void> {
  // DB-adapter streams plus the two file watchers, in the same row shape, so
  // the portal's stream_halted alert also covers a GDT file the agent cannot
  // consume (blocks the PVS export channel) and an unreadable Honorar export.
  const adapterStatuses: Array<AdapterStreamStatus | WatcherStreamStatus> = [
    ...(dbRunner?.statusSnapshot() ?? []),
    ...gdtWatcherHealth(gdtWatcher?.status() ?? null),
    ...csvWatcherHealth(getCsvWatcherStatus()),
    ...csvFolderConflictHealth(csvFolderConflict),
  ];
  try {
    const snap = getFailureSummary();
    const enabledVendors = (cfg.dbAdapters ?? []).map((a) => a.vendor);
    // M-D4: attach the LIVE per-stream adapter status. The framework halts a
    // stream to status='error' (FAIL_THRESHOLD poll failures), 'schema_drift' or
    // 'config_invalid', and the runner records a vendor connectError on a
    // rotated/stale DB password; none of that reached the portal before, so a
    // broken adapter showed nothing but stale data. Rides as an additive field
    // via an intersection type so the wire contract stays backward-compatible;
    // the portal validates and stores it since migration 0069.
    const payload: HeartbeatPayload & {
      adapterStatuses?: Array<AdapterStreamStatus | WatcherStreamStatus>;
      stalePendingCount?: number;
      vendorConfigs?: Awaited<ReturnType<typeof reportedConfigs>>;
      configSyncError?: string | null;
      configRollbacks?: Awaited<ReturnType<typeof readRollbacks>>;
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
      // B5: why uploads are (not) flowing. The heartbeat itself proves the
      // portal is reachable, so these are what lets the backlog alert name the
      // real reason instead of guessing "firewall".
      ...(activeFlushState ? { uploadState: uploadStateSnapshot(activeFlushState) } : {}),
      pendingReasons: getPendingReasons(5),
      fileWatchers: {
        gdt: gdtWatcherDetails(gdtWatcher?.status() ?? null),
        csv: csvWatcherDetails(getCsvWatcherStatus()),
      },
      // Remote config: what this machine actually runs, whether the last sync
      // pass failed, and any config it rolled back on its own. Without these
      // the portal can advertise v7 to thirty Praxen and have no idea that six
      // of them refused it.
      vendorConfigs: await reportedConfigs(enabledVendors),
      configSyncError: lastConfigSync?.error ?? null,
      configRollbacks: await readRollbacks(),
    };
    const res = await postHeartbeat(payload);
    if (res.ok) {
      lastHeartbeatOkMono = performance.now();
      // The heartbeat response carries the manifest. Running the sync here
      // rather than on its own timer means a Praxis that cannot reach the
      // portal never spins a second failing loop, and a config push lands
      // within one heartbeat of being published.
      await syncRemoteConfigs(cfg, dbRunner, res.body);
    }
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

/**
 * Act on the vendor-config manifest that came back with the heartbeat.
 *
 * Skipped entirely when no DB adapter is enrolled: a GDT-only Praxis has no
 * vendor configs to hold, so there is nothing to sync and nothing to probate.
 *
 * Everything below is best-effort. A throw here must not take the heartbeat
 * tick (and with it every other piece of telemetry) down with it, so the whole
 * pass is wrapped and its failure is reported on the next heartbeat instead.
 */
async function syncRemoteConfigs(
  cfg: AgentConfig,
  dbRunner: RunnerHandle | null,
  responseBody: unknown
): Promise<void> {
  const enabledVendors = (cfg.dbAdapters ?? []).map((a) => a.vendor);
  if (enabledVendors.length === 0) return;

  const body = responseBody as
    | { configManifest?: VendorConfigManifestEntry[] }
    | undefined;
  const manifest = Array.isArray(body?.configManifest) ? body.configManifest : [];

  const deps: ConfigSyncDeps = {
    enabledVendors,
    agentVersion: AGENT_VERSION,
    trustedKeys: trustedConfigKeys(),
    fetchBundles: (vendors) => fetchVendorConfigs(cfg.clinicId, vendors),
    reloadVendor: (vendor, next) => dbRunner?.reloadVendor(vendor, next) ?? false,
    statusesFor: (vendor) =>
      (dbRunner?.statusSnapshot() ?? [])
        .filter((s) => s.vendor === vendor)
        .map((s) => ({
          stream: s.stream,
          status: s.status,
          // Lets config sync tell a config-caused error from a dead database.
          lastError: s.lastError,
          connectError: s.connectError,
        })),
    loadBundledConfig,
    now: () => Date.now(),
    log: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };

  try {
    lastConfigSync = await runConfigSync(manifest, deps);
  } catch (err) {
    lastConfigSync = {
      applied: [],
      skipped: [],
      rolledBack: [],
      error: `config sync threw: ${(err as Error).message}`,
    };
    console.error("[agent] remote config sync threw:", err);
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

async function runProbeDbAdapter(args: string[]): Promise<number> {
  const vendor = arg(args, "--probe-db-adapter");
  if (!vendor) {
    console.error("usage: eins-agent --probe-db-adapter <vendor> [--json]");
    return 2;
  }
  const cfg = await loadConfigOrExit();
  const entry = cfg?.dbAdapters?.find((a) => a.vendor === vendor);
  if (!entry) {
    const known = (cfg?.dbAdapters ?? []).map((a) => a.vendor).join(", ") || "none";
    console.error(
      `adapter '${vendor}' is not enabled on this machine (enabled: ${known}). ` +
        `Enable it first: eins-agent --enable-db-adapter ${vendor} ...`
    );
    return 2;
  }
  try {
    return await runSchemaProbeCli({
      vendorId: vendor,
      connection: {
        host: entry.host,
        port: entry.port,
        database: entry.database,
        username: entry.username,
      },
      json: args.includes("--json"),
    });
  } catch (err) {
    console.error(`probe failed: ${(err as Error).message}`);
    return 2;
  }
}

/**
 * `--requeue-failed [--reason <code>]`: give dead-lettered events another try.
 * UNIQUE(content_hash) makes a re-enqueue impossible (the insert is ignored), so
 * the rows are flipped back to pending in place. Works while the agent runs: the
 * outbox allows a second connection and the update is one short statement.
 */
async function runRequeueFailed(args: string[]): Promise<number> {
  const wantsReason = args.includes("--reason");
  const reason = arg(args, "--reason");
  if (wantsReason && (!reason || reason.startsWith("--"))) {
    console.error("usage: eins-agent --requeue-failed [--reason <code>]");
    return 2;
  }
  if (!existsSync(outboxPath())) {
    console.error(`no outbox found at ${outboxPath()}; nothing to requeue.`);
    return 2;
  }
  try {
    setOutboxKey(await getOrCreateOutboxKey());
    const moved = requeueFailed(reason ? { reason } : {});
    console.log(
      `${moved} failed event(s)${reason ? ` matching '${reason}'` : ""} moved back to pending; ` +
        `the agent will upload them on its next cycle.`
    );
    return 0;
  } catch (err) {
    console.error(`requeue failed: ${(err as Error).message}`);
    return 1;
  } finally {
    closeOutbox();
  }
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

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
