import chokidar from "chokidar";
import type { Stats } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
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

  // M-P9 part 3: serialize live file processing through a single promise chain.
  // chokidar fires add/change concurrently; running process() concurrently made
  // the per-file mtime cursor race, so after a crash a slower older file could
  // be skipped (its newer sibling had already advanced the cursor past it).
  // Chaining guarantees each file is fully processed, and its cursor advanced,
  // before the next one starts.
  let processingChain: Promise<void> = Promise.resolve();
  function enqueueProcessing(path: string): void {
    processingChain = processingChain
      .then(() => process(path))
      .catch((err) => {
        // process() has its own try/catch; this is a belt-and-suspenders guard
        // so one rejected link cannot break the chain for every later file.
        console.error(
          `[csv-watcher] queued processing failed for ${basename(path)}:`,
          err
        );
      });
  }

  watcher.on("add", (path) => {
    if (!isCsvFile(path)) return;
    enqueueProcessing(path);
  });
  watcher.on("change", (path) => {
    if (!isCsvFile(path)) return;
    enqueueProcessing(path);
  });

  /**
   * L22: log the file BASENAME only, never the full path. Some PVS write
   * patient identifiers into the export filename; the containing folder
   * (a config value) stays loggable elsewhere, but per-file log lines must
   * not carry the filename verbatim into logs that may be shipped for support.
   */
  async function process(path: string): Promise<void> {
    const base = basename(path);
    /**
     * L4/L5: ONE rule for "this file produced zero events" (empty file, no
     * usable column mapping, or every row failed to map). The rule:
     *   1. Never silently lose data: emit a LOUD per-file summary (warn level)
     *      with counts so an operator can see it in the log.
     *   2. Never warn forever: advance the mtime cursor past the file so it is
     *      not re-processed on every restart. Because the cursor keys on mtime,
     *      a genuinely new content version (rewrite) gets a fresh mtime and is
     *      re-processed, so this is effectively "warn once per content version".
     * The torn-write guard (droppedSuspectLastRow) is the ONE exception that
     * deliberately does NOT advance the cursor; it is handled separately below.
     */
    async function advanceCursorPastFile(): Promise<void> {
      try {
        const st = (await stat(path).catch(() => null)) ?? preStat;
        if (st) setWatcherCursor(opts.folder, st.mtimeMs);
      } catch {
        // cursor advance failure is non-fatal; next restart re-attempts.
      }
    }
    let preStat: Stats | null = null;
    try {
      // P3-1 byte-size guard: stat first, skip before reading if the
      // file is past the cap. Same rationale as watcher.ts; defends
      // the Praxis workstation against allocation explosion.
      preStat = await stat(path).catch(() => null);
      if (preStat && preStat.size > CSV_MAX_BYTES) {
        console.warn(
          `[csv-watcher] ${base} exceeds CSV_MAX_BYTES (${preStat.size} > ${CSV_MAX_BYTES}); skipped`
        );
        try {
          setWatcherCursor(opts.folder, preStat.mtimeMs);
        } catch {
          // cursor advance failure is non-fatal.
        }
        return;
      }

      const bytes = await readFile(path);
      // M-P9 parts 1+2: pass the caps INTO the parser. maxBytes gates the
      // multi-candidate decode before it runs three passes over the buffer;
      // maxRows stops row-object allocation early instead of building millions
      // of rows first and checking afterwards.
      const parsed = parseCsv(bytes, {
        maxRows: CSV_MAX_ROWS,
        maxBytes: CSV_MAX_BYTES,
      });
      if (parsed.headers.length === 0) {
        // L4: zero-byte / empty file produced zero events. Warn once, then
        // advance the cursor so it never re-warns on restart (was: return
        // without advancing -> re-warn forever).
        console.warn(
          `[csv-watcher] ${base} produced ZERO events: file is empty (no header row). Cursor advanced; will retry only if the file content changes.`
        );
        await advanceCursorPastFile();
        return;
      }
      // P3-1 / M-P9 row-count guard: the parser stopped building rows once the
      // cap was reached (parsed.rowCapExceeded), so a CSV with pathologically
      // many rows never fully materialises. Skip it loudly.
      if (parsed.rowCapExceeded) {
        console.warn(
          `[csv-watcher] ${base} exceeds CSV_MAX_ROWS (${CSV_MAX_ROWS}); parsing stopped early and file skipped`
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
        // L5: "no usable header mapping" is a zero-events outcome. Apply the
        // single rule (see advanceCursorPastFile): loud warn with the headers
        // that failed to map, THEN advance the cursor so we do not re-warn on
        // every restart (was: return without advancing -> warn forever, while
        // the "all rows failed" case below advanced -> inconsistent drift).
        console.warn(
          `[csv-watcher] ${base} produced ZERO events: no usable column mapping (headers: ${parsed.headers.join(", ")}). Cursor advanced; will retry only if the file content changes.`
        );
        await advanceCursorPastFile();
        return;
      }

      // M-P3: duplicate headers. A duplicate collides in the per-row record
      // (last column wins), which silently swaps meaning. If a duplicated
      // header is one the resolved mapping actually maps (e.g. two "Betrag"
      // columns → a netto/brutto swap), the file is ambiguous at the data
      // level: fail it loudly as a config/format error rather than guess which
      // column is authoritative. Harmless unmapped duplicates only warn.
      if (parsed.duplicateHeaders.length > 0) {
        const mappedHeaders = new Set(
          Object.values(mapping.columns).filter(
            (h): h is string => typeof h === "string" && h.length > 0
          )
        );
        const ambiguous = parsed.duplicateHeaders.filter((h) =>
          mappedHeaders.has(h)
        );
        if (ambiguous.length > 0) {
          console.error(
            `[csv-watcher] ${base} has duplicate mapped column(s): ${ambiguous.join(", ")}. ` +
              `Ambiguous meaning (e.g. netto vs brutto Betrag); file skipped as a config/format error. ` +
              `Fix the PVS export to emit each column once.`
          );
          await advanceCursorPastFile();
          return;
        }
        console.warn(
          `[csv-watcher] ${base} has duplicate header(s) not used by the mapping: ` +
            `${parsed.duplicateHeaders.join(", ")}; continuing.`
        );
      }

      // M-P3: ragged rows (cell count != header count). Tolerated as before
      // (extra cells dropped, missing cells blanked) but surfaced as one
      // rate-limited per-file warning so a systematic column shift is visible.
      if (parsed.raggedRowCount > 0) {
        console.warn(
          `[csv-watcher] ${base} has ${parsed.raggedRowCount} ragged row(s) whose column count ` +
            `did not match the ${parsed.headers.length}-column header; extra cells dropped, missing cells blanked.`
        );
      }

      // Torn-write guard (C1): the parser dropped the last physical row
      // because the file did not end with a line terminator. Warn loudly;
      // the cursor is NOT advanced below, so the completed file (or a
      // legitimately newline-less export, until the export setting is
      // fixed) is re-processed on the next change event or restart.
      if (parsed.droppedSuspectLastRow) {
        console.warn(
          `[csv-watcher] ${base} does not end with a line terminator; last row skipped as a torn-write guard. ` +
            `If this export legitimately omits the final newline, configure the PVS export to terminate the last line.`
        );
      }

      // Torn-write guard, part 2 (C1): if the file changed while we were
      // parsing, the exporter is still writing. Enqueue nothing: a partial
      // parse would win the per-event-id outbox dedup and the corrected
      // re-parse would be silently discarded.
      const postStat = await stat(path).catch(() => null);
      if (
        preStat &&
        postStat &&
        (postStat.size !== preStat.size || postStat.mtimeMs !== preStat.mtimeMs)
      ) {
        console.warn(
          `[csv-watcher] ${base} changed while being processed; skipping this pass (will re-process on the next change event)`
        );
        return;
      }

      let emitted = 0;
      let skipped = 0;
      // H4: one deterministic occurredAt fallback for every row of this file,
      // from the PRE-read stat mtime (matching the parsed bytes). Re-processing
      // the same file after watcher-state loss then yields byte-identical
      // events the portal dedups. Null preStat → undefined → wall-clock path.
      const fileModifiedAtIso = preStat
        ? new Date(preStat.mtimeMs).toISOString()
        : undefined;
      for (let i = 0; i < parsed.rows.length; i++) {
        const result = mapCsvRow({
          clinicId: opts.clinicId,
          fileHash: parsed.contentHash,
          rowIndex: i,
          row: parsed.rows[i],
          mapping,
          fileModifiedAtIso,
        });
        if (!result.ok) {
          skipped++;
          // Row-level warnings are noisy on big files; only log the first
          // five and a summary.
          if (skipped <= 5) {
            console.warn(
              `[csv-watcher] ${base} row ${i + 2}: ${result.reason}`
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
      // C1: when the torn-write guard dropped the last row, leave the cursor
      // where it is so the file is re-processed once the write completes.
      if (!parsed.droppedSuspectLastRow) {
        try {
          const st = await stat(path);
          setWatcherCursor(opts.folder, st.mtimeMs);
        } catch {
          // stat failed; events are enqueued: let the outbox dedup catch
          // the re-process on next restart.
        }
      }
      // L5: consistent, loud per-file summary. When a file mapped fine but
      // produced ZERO events (every row failed to map), warn instead of the
      // quiet info line: same loudness as the no-mapping / empty cases above,
      // and the cursor already advanced (see !droppedSuspectLastRow) so it will
      // not re-warn until the content changes. A file that emitted at least one
      // event logs at info level as before.
      const summary = `[csv-watcher] ${base} rows=${parsed.rows.length} emitted=${emitted} skipped=${skipped}`;
      if (emitted === 0 && parsed.rows.length > 0) {
        console.warn(
          `${summary}: produced ZERO events (all rows failed to map). Cursor advanced; will retry only if the file content changes.`
        );
      } else {
        console.log(summary);
      }
    } catch (err) {
      console.error(`[csv-watcher] failed for ${base}:`, err);
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
      // M-P9 part 3: feed catch-up files through the same serialization chain
      // as live events, so a live add/change that arrives mid-catch-up cannot
      // interleave and advance the cursor out of mtime order.
      for (const f of toProcess) {
        enqueueProcessing(f.path);
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
