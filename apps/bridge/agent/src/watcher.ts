import chokidar from "chokidar";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseGdtFile } from "./gdt-parser.js";
import { gdtToCanonical } from "./normalize.js";
import { enqueue } from "./outbox.js";
import { getWatcherCursor, setWatcherCursor } from "./watcher-state.js";

/**
 * chokidar-based folder watcher for GDT/BDT files.
 *
 * P1-5 cleanup:
 *   • Removed the manual setTimeout debounce layer. It ran ON TOP of
 *     chokidar's awaitWriteFinish, which already guarantees a file has
 *     been stable for STABILITY_THRESHOLD_MS before firing add/change.
 *     The second layer opened a small race: if a re-write started during
 *     the manual debounce window, the timer could fire mid-write and
 *     hand process() a partial buffer. We now process directly from the
 *     chokidar event, which is the right primitive.
 *
 *   • Switched to ignoreInitial: true with an explicit startup catch-up
 *     pass that re-enqueues only files newer than the persisted mtime
 *     cursor (apps/bridge/agent/src/watcher-state.ts). Previous behaviour
 *     re-parsed every file in the folder on every restart — safe due to
 *     content-hash dedup in the outbox, but wasteful on workstations
 *     with thousands of archived GDT files.
 */

const STABILITY_THRESHOLD_MS = 1500;
/**
 * P3-1 / Section 5 of pvs-redteam.md: maximum GDT file we will read.
 * The largest legitimate GDT we've observed at pilots is ~150 KB (a
 * year of patient export for a small Praxis); 32 MiB is two orders of
 * magnitude above that and well below memory exhaustion territory on
 * the Praxis workstation. A file above this is logged + skipped, the
 * mtime cursor advances past it so we don't re-attempt on restart, and
 * the watcher keeps running.
 */
const GDT_MAX_BYTES = 32 * 1024 * 1024;

export function watchFolder(opts: {
  folder: string;
  clinicId: string;
}): { stop: () => void } {
  const watcher = chokidar.watch(opts.folder, {
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: STABILITY_THRESHOLD_MS,
      pollInterval: 200,
    },
    // P1-5: don't replay every existing file on startup; the catch-up
    // pass below handles "anything newer than the cursor".
    ignoreInitial: true,
  });

  watcher.on("add", (path) => {
    if (!isGdtFile(path)) return;
    void process(path);
  });
  watcher.on("change", (path) => {
    if (!isGdtFile(path)) return;
    void process(path);
  });

  async function process(path: string): Promise<void> {
    try {
      // P3-1 size guard: stat first, read only if size is sane. A
      // 100 MB file allocated into Buffer would balloon the Praxis-
      // workstation resident set; the guard short-circuits before the
      // allocation.
      const preStat = await stat(path).catch(() => null);
      if (preStat && preStat.size > GDT_MAX_BYTES) {
        console.warn(
          `[watcher] ${path} exceeds GDT_MAX_BYTES (${preStat.size} > ${GDT_MAX_BYTES}); skipped`
        );
        // Advance the cursor so the file is not re-attempted on
        // restart. Operator triage path: read the log line, decide
        // whether to investigate the rogue file (legitimate but
        // overflowed PVS export, or hostile drop).
        try {
          setWatcherCursor(opts.folder, preStat.mtimeMs);
        } catch {
          // cursor advance failure is non-fatal; next restart re-skips.
        }
        return;
      }
      const bytes = await readFile(path);
      const parsed = await parseGdtFile(bytes);
      const events = gdtToCanonical(parsed, {
        clinicId: opts.clinicId,
        contentHash: parsed.contentHash,
      });
      for (const event of events) {
        enqueue(JSON.stringify(event), `${event.pvsExternalEventId}`);
      }
      // Advance the cursor to this file's mtime. We do this AFTER enqueue
      // so a parser failure (which logs and bails above) doesn't strand
      // the cursor past a file that wasn't actually processed.
      try {
        const st = await stat(path);
        setWatcherCursor(opts.folder, st.mtimeMs);
      } catch {
        // stat failed (file deleted between read + stat?). The events are
        // already enqueued; skipping the cursor update means we'll re-
        // process this file next boot — which the outbox content-hash
        // dedup makes idempotent.
      }
      console.log(
        `[watcher] ${path} parsed satzart=${parsed.satzart ?? "?"} events=${events.length}`
      );
    } catch (err) {
      console.error(`[watcher] failed for ${path}:`, err);
    }
  }

  // P1-5 startup catch-up: scan the watch folder once for files newer
  // than the persisted cursor and enqueue them. We do this BEFORE
  // chokidar settles its initial scan so any files added between
  // readdir and chokidar-ready are still caught (chokidar will then
  // fire 'add' for them; the content-hash dedup handles the overlap).
  void (async () => {
    try {
      const cursor = getWatcherCursor(opts.folder);
      const entries = await readdir(opts.folder).catch(() => []);
      const toProcess: Array<{ path: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (!isGdtFile(entry)) continue;
        const full = join(opts.folder, entry);
        const st = await stat(full).catch(() => null);
        if (!st || !st.isFile()) continue;
        if (st.mtimeMs > cursor) {
          toProcess.push({ path: full, mtimeMs: st.mtimeMs });
        }
      }
      // Process in mtime order so the cursor advances monotonically.
      toProcess.sort((a, b) => a.mtimeMs - b.mtimeMs);
      console.log(
        `[watcher] startup catch-up: ${toProcess.length} file(s) newer than cursor=${cursor}`
      );
      for (const f of toProcess) {
        await process(f.path);
      }
    } catch (err) {
      console.error(`[watcher] startup catch-up failed:`, err);
    }
  })();

  console.log(`[watcher] watching ${opts.folder}`);
  return {
    stop() {
      void watcher.close();
    },
  };
}

function isGdtFile(path: string): boolean {
  return /\.(gdt|bdt)$/i.test(path);
}
