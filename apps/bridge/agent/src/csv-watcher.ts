import chokidar from "chokidar";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseCsv } from "./csv-parser.js";
import {
  mapCsvRow,
  autoDetectMapping,
  type CsvMapping,
} from "./csv-mapper.js";
import { enqueue } from "./outbox.js";
import { getWatcherCursor, setWatcherCursor } from "./watcher-state.js";

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
 *
 * P1-5: removed the manual setTimeout debounce (chokidar's
 * awaitWriteFinish already provides stability) and switched to
 * ignoreInitial: true with mtime-cursor catch-up. See watcher.ts for
 * the long-form rationale.
 */

const STABILITY_THRESHOLD_MS = 2000;
/**
 * P3-1 / Section 6 of pvs-redteam.md: byte-size + row-count caps so a
 * hostile or accidental CSV bomb can't OOM the Praxis workstation.
 * The biggest legitimate medatixx Honorar export we have observed is
 * ~25,000 rows × ~50 KB. The byte cap defends against allocation-time
 * explosion before parseCsv runs; the row cap defends against the
 * post-parse "10 M rows of 10 bytes each" pattern that the byte cap
 * would let through.
 */
const CSV_MAX_BYTES = 32 * 1024 * 1024;
const CSV_MAX_ROWS = 1_000_000;

export function watchHonorarFolder(opts: {
  folder: string;
  clinicId: string;
  /** Optional pre-configured mapping. When absent, auto-detect per file. */
  mapping?: CsvMapping;
}): { stop: () => void } {
  const watcher = chokidar.watch(opts.folder, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      pollInterval: 200,
    },
    ignoreInitial: true,
  });

  watcher.on("add", (path) => {
    if (!isCsvFile(path)) return;
    void process(path);
  });
  watcher.on("change", (path) => {
    if (!isCsvFile(path)) return;
    void process(path);
  });

  async function process(path: string): Promise<void> {
    try {
      // P3-1 byte-size guard: stat first, skip before reading if the
      // file is past the cap. Same rationale as watcher.ts; defends
      // the Praxis workstation against allocation explosion.
      const preStat = await stat(path).catch(() => null);
      if (preStat && preStat.size > CSV_MAX_BYTES) {
        console.warn(
          `[csv-watcher] ${path} exceeds CSV_MAX_BYTES (${preStat.size} > ${CSV_MAX_BYTES}); skipped`
        );
        try {
          setWatcherCursor(opts.folder, preStat.mtimeMs);
        } catch {
          // cursor advance failure is non-fatal.
        }
        return;
      }

      const bytes = await readFile(path);
      const parsed = parseCsv(bytes);
      if (parsed.headers.length === 0) {
        console.log(`[csv-watcher] ${path} empty — skipped`);
        return;
      }
      // P3-1 row-count guard: a CSV under the byte cap but with
      // pathologically many rows is still a memory-pressure risk.
      if (parsed.rows.length > CSV_MAX_ROWS) {
        console.warn(
          `[csv-watcher] ${path} row count ${parsed.rows.length} exceeds CSV_MAX_ROWS (${CSV_MAX_ROWS}); skipped`
        );
        try {
          if (preStat) setWatcherCursor(opts.folder, preStat.mtimeMs);
        } catch {
          // non-fatal.
        }
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
      // P1-5: advance the cursor AFTER successful enqueue so a parse-or-
      // mapping failure doesn't strand the cursor past an unprocessed file.
      try {
        const st = await stat(path);
        setWatcherCursor(opts.folder, st.mtimeMs);
      } catch {
        // stat failed; events are enqueued — let the outbox dedup catch
        // the re-process on next restart.
      }
      console.log(
        `[csv-watcher] ${path} rows=${parsed.rows.length} emitted=${emitted} skipped=${skipped}`
      );
    } catch (err) {
      console.error(`[csv-watcher] failed for ${path}:`, err);
    }
  }

  // P1-5 startup catch-up.
  void (async () => {
    try {
      const cursor = getWatcherCursor(opts.folder);
      const entries = await readdir(opts.folder).catch(() => []);
      const toProcess: Array<{ path: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (!isCsvFile(entry)) continue;
        const full = join(opts.folder, entry);
        const st = await stat(full).catch(() => null);
        if (!st || !st.isFile()) continue;
        if (st.mtimeMs > cursor) {
          toProcess.push({ path: full, mtimeMs: st.mtimeMs });
        }
      }
      toProcess.sort((a, b) => a.mtimeMs - b.mtimeMs);
      console.log(
        `[csv-watcher] startup catch-up: ${toProcess.length} file(s) newer than cursor=${cursor}`
      );
      for (const f of toProcess) {
        await process(f.path);
      }
    } catch (err) {
      console.error(`[csv-watcher] startup catch-up failed:`, err);
    }
  })();

  console.log(`[csv-watcher] watching ${opts.folder}`);
  return {
    stop() {
      void watcher.close();
    },
  };
}

function isCsvFile(path: string): boolean {
  return /\.csv$/i.test(path);
}
