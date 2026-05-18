import chokidar from "chokidar";
import { readFile } from "node:fs/promises";
import { parseGdtFile } from "./gdt-parser.js";
import { gdtToCanonical } from "./normalize.js";
import { enqueue } from "./outbox.js";

/**
 * chokidar-based folder watcher. Debounces close-write events so we don't
 * race with PVSs that write GDT files in multiple chunks.
 */

const DEBOUNCE_MS = 1500;

export function watchFolder(opts: {
  folder: string;
  clinicId: string;
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
    if (!isGdtFile(path)) return;
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
      const parsed = await parseGdtFile(bytes);
      const events = gdtToCanonical(parsed, {
        clinicId: opts.clinicId,
        contentHash: parsed.contentHash,
      });
      for (const event of events) {
        enqueue(JSON.stringify(event), `${event.pvsExternalEventId}`);
      }
      console.log(
        `[watcher] ${path} parsed satzart=${parsed.satzart ?? "?"} events=${events.length}`
      );
    } catch (err) {
      console.error(`[watcher] failed for ${path}:`, err);
    }
  }

  console.log(`[watcher] watching ${opts.folder}`);
  return {
    stop() {
      void watcher.close();
      for (const t of inFlight.values()) clearTimeout(t);
    },
  };
}

function isGdtFile(path: string): boolean {
  return /\.(gdt|bdt)$/i.test(path);
}
