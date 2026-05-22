import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline";
import {
  loadConfig,
  loadCsvMappingFile,
  saveConfig,
  type DbAdapterEnrollment,
} from "./config.js";
import { enroll } from "./enrollment.js";
import { watchFolder } from "./watcher.js";
import { watchHonorarFolder } from "./csv-watcher.js";
import {
  dueRows,
  markSent,
  markFailedPermanent,
  recordRetry,
  vacuumOld,
} from "./outbox.js";
import { postEvent } from "./portal-client.js";
import { storeDbCredential } from "./secure-store.js";
import { startRunner, type RunnerHandle } from "./db-adapters/runner.js";
import { publishPendingDrift } from "./db-adapters/drift-publisher.js";

/**
 * eins-agent entry point.
 *
 * Modes:
 *   eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>]
 *               [--honorar-folder <path>] [--honorar-mapping <json-path>]
 *     One-shot enrollment. Persists config + secret, then exits.
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--enroll")) {
    const token = arg(args, "--enroll");
    const clinicId = arg(args, "--clinic");
    const portalBaseUrl =
      arg(args, "--portal") ?? "https://portal.einsvisuals.de";
    const watchPath = arg(args, "--folder") ?? defaultWatchPath();
    const honorarFolder = arg(args, "--honorar-folder");
    const honorarMappingPath = arg(args, "--honorar-mapping");
    if (!token || !clinicId) {
      console.error(
        "usage: eins-agent --enroll <token> --clinic <uuid> [--portal <url>] [--folder <path>] [--honorar-folder <path>] [--honorar-mapping <json-path>]"
      );
      process.exit(2);
    }
    const result = await enroll({
      token,
      clinicId,
      portalBaseUrl,
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
    const cfg = await loadConfig();
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

  const cfg = await loadConfig();
  if (!cfg) {
    console.error(
      "no config found. Run `eins-agent --enroll <token> --clinic <uuid>` first."
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
      console.error(
        `[agent] db-adapters failed to start: ${(err as Error).message}`
      );
      // Continue without db-adapters; the other watchers keep running.
    }
  }

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const vacuumTimer = setInterval(() => vacuumOld(), VACUUM_INTERVAL_MS);
  // Drift telemetry rides a slower cadence than the event flush because
  // it is naturally rare (one signal per real PVS schema change) and the
  // portal applies a 60/min/clinic rate limit on /api/pvs/health.
  const driftTimer = setInterval(
    () => void flushDriftReports(),
    DRIFT_PUBLISH_INTERVAL_MS
  );

  const shutdown = (signal: string) => {
    console.log(`[agent] received ${signal}, shutting down…`);
    watcher.stop();
    honorarWatcher?.stop();
    void dbRunner?.stop();
    clearInterval(flushTimer);
    clearInterval(vacuumTimer);
    clearInterval(driftTimer);
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

async function flush(): Promise<void> {
  const rows = dueRows(50);
  for (const row of rows) {
    const result = await postEvent(row.payload);
    if (result.ok) {
      markSent(row.id);
    } else if (result.retryable) {
      recordRetry(row.id, result.reason);
    } else {
      markFailedPermanent(row.id, result.reason);
    }
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
  const cfg = await loadConfig();
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
  const cfg = await loadConfig();
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
