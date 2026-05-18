import { loadConfig, loadCsvMappingFile, saveConfig } from "./config.js";
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
 *     in the persisted config.
 *
 *   eins-agent --configure-honorar <folder> [--honorar-mapping <json-path>]
 *     Idempotent reconfiguration of the Honorar-CSV watch folder /
 *     mapping without re-running enrollment. Persists the updated config
 *     and exits; the running agent (if any) must be restarted to pick
 *     up the change.
 */

const FLUSH_INTERVAL_MS = 5000;
const VACUUM_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
    console.log("enrollment successful — config persisted.");
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

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const vacuumTimer = setInterval(() => vacuumOld(), VACUUM_INTERVAL_MS);

  const shutdown = (signal: string) => {
    console.log(`[agent] received ${signal}, shutting down…`);
    watcher.stop();
    honorarWatcher?.stop();
    clearInterval(flushTimer);
    clearInterval(vacuumTimer);
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
