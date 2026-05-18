import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { parseCsv } from "./csv-parser.js";
import {
  mapCsvRow,
  autoDetectMapping,
  type CsvMapping,
} from "./csv-mapper.js";
import { enqueue } from "./outbox.js";

/**
 * Honorar-CSV folder watcher.
 *
 * Mirrors apps/bridge/agent/src/watcher.ts (GDT) but watches `.csv`
 * files. The intended deployment is:
 *
 *   1. The Praxis configures medatixx (or any PVS) to write a nightly
 *      Honorar-CSV export to a known folder.
 *   2. The agent picks up new files, parses them, emits InvoicePaid
 *      events to the same outbox the GDT watcher uses.
 *   3. The portal aggregates per-patient revenue via the existing
 *      pvs-status-derive worker — no portal-side changes needed.
 *
 * The mapping can either be:
 *   - Provided via `cfg.honorarCsvMapping` (JSON loaded at boot), or
 *   - Auto-detected per-file from the header row using common medatixx /
 *     Albis / DURIA / T2Med column names.
 *
 * If neither produces a usable mapping the file is logged and skipped —
 * we never guess column meanings.
 */

const DEBOUNCE_MS = 2000;

export function watchHonorarFolder(opts: {
  folder: string;
  clinicId: string;
  /** Optional pre-configured mapping. When absent, auto-detect per file. */
  mapping?: CsvMapping;
}): { stop: () => void } {
  const inFlight = new Map<string, NodeJS.Timeout>();

  const watcher = chokidar.watch(opts.folder, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: DEBOUNCE_MS,
      pollInterval: 200,
    },
    ignoreInitial: false,
  });

  watcher.on("add", (path) => schedule(path));
  watcher.on("change", (path) => schedule(path));

  function schedule(path: string) {
    if (!isCsvFile(path)) return;
    const existing = inFlight.get(path);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      inFlight.delete(path);
      void process(path);
    }, DEBOUNCE_MS);
    inFlight.set(path, t);
  }

  async function process(path: string): Promise<void> {
    try {
      const bytes = await readFile(path);
      const parsed = parseCsv(bytes);
      if (parsed.headers.length === 0) {
        console.log(`[csv-watcher] ${path} empty — skipped`);
        return;
      }

      const mapping = opts.mapping ?? autoDetectMapping(parsed.headers);
      if (!mapping) {
        console.warn(
          `[csv-watcher] ${path} no usable mapping (headers: ${parsed.headers.join(", ")}) — skipped`
        );
        return;
      }

      let emitted = 0;
      let skipped = 0;
      for (let i = 0; i < parsed.rows.length; i++) {
        const result = mapCsvRow({
          clinicId: opts.clinicId,
          fileHash: parsed.contentHash,
          rowIndex: i,
          row: parsed.rows[i],
          mapping,
        });
        if (!result.ok) {
          skipped++;
          // Row-level warnings are noisy on big files; only log the first
          // five and a summary.
          if (skipped <= 5) {
            console.warn(
              `[csv-watcher] ${path} row ${i + 2}: ${result.reason}`
            );
          }
          continue;
        }
        for (const event of result.events) {
          enqueue(JSON.stringify(event), event.pvsExternalEventId);
          emitted++;
        }
      }
      console.log(
        `[csv-watcher] ${path} rows=${parsed.rows.length} emitted=${emitted} skipped=${skipped}`
      );
    } catch (err) {
      console.error(`[csv-watcher] failed for ${path}:`, err);
    }
  }

  console.log(`[csv-watcher] watching ${opts.folder}`);
  return {
    stop() {
      void watcher.close();
      for (const t of inFlight.values()) clearTimeout(t);
    },
  };
}

function isCsvFile(path: string): boolean {
  return /\.csv$/i.test(path);
}
