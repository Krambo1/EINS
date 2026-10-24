import chokidar from "chokidar";
import { createHash } from "node:crypto";
import { readFile as fsReadFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseCsv } from "./csv-parser.js";
import {
  AUTO_MAPPING_VERSION,
  aggregateInvoiceRows,
  detectMapping,
  mapCsvRow,
  type CsvMapping,
} from "./csv-mapper.js";
import type { CanonicalEvent } from "./normalize.js";
import { enqueueMany } from "./outbox.js";
import {
  ledgerSummary,
  pruneLedger,
  recordFileDone,
  recordFileFailed,
  recordFileIgnored,
  shouldProcessFile,
  type FileIdentity,
  type LedgerSummary,
} from "./file-ledger.js";

/**
 * Honorar-CSV folder watcher.
 *
 * Mirrors apps/bridge/agent/src/watcher.ts (GDT) but watches `.csv`
 * files. The intended deployment is:
 *
 *   1. The Praxis configures medatixx (or any PVS) to write a nightly
 *      Honorar-CSV export to a known folder.
 *   2. The agent picks up new files, parses them, emits InvoicePaid /
 *      InvoiceRefunded events to the same outbox the GDT watcher uses.
 *   3. The portal aggregates per-patient revenue via the existing
 *      pvs-status-derive worker — no portal-side changes needed.
 *
 * The mapping can either be:
 *   - Provided via `cfg.honorarCsvMapping` (JSON loaded at boot), or
 *   - Auto-detected per-file from the header row using common medatixx /
 *     Albis / DURIA / T2Med column names.
 *
 * If neither produces a usable mapping the file is recorded as IGNORED with a
 * reason — we never guess column meanings.
 *
 * File bookkeeping: the per-file ledger (file-ledger.ts), NOT a per-folder
 * mtime cursor. A file is (re)processed when it is unseen, when its size /
 * mtime / mapping fingerprint changed, or when a previous attempt FAILED and
 * its backoff elapsed. That fixes three silent-loss modes of the old cursor:
 * a file that failed once (EBUSY, enqueue error) was stranded as soon as a
 * newer file succeeded; a file skipped for "no mapping" was never re-read
 * after the mapping was fixed; and files copied in with an old mtime were
 * invisible.
 *
 * Triggers: chokidar (low latency) plus a rescan at start and every
 * RESCAN_INTERVAL_MS (catches missed events, e.g. on SMB shares). Everything
 * runs through ONE serialized queue, so a file is never processed twice
 * concurrently.
 *
 * Privacy: logs carry file BASENAMES, counts and column header NAMES only,
 * never cell values, patient ids or invoice numbers.
 */

const STABILITY_THRESHOLD_MS = 2000;
const RESCAN_INTERVAL_MS = 5 * 60_000;
/** Events per outbox transaction (one fsync each). */
const ENQUEUE_CHUNK = 1_000;
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

export interface CsvWatcherStatus {
  folder: string;
  /** Ledger counts for this folder (null if the ledger is unavailable). */
  ledger: LedgerSummary | null;
  /** ISO time the last file was fully processed (events enqueued). */
  lastProcessedAt: string | null;
  /** Reason the most recent file was ignored (e.g. no_mapping). */
  lastIgnoreReason: string | null;
  /** Column NAMES detected in the last file's header (never cell values). */
  lastHeaderColumns: string[];
  /** Count summary of the last processed file (no values). */
  lastFile: {
    name: string;
    rows: number;
    invoices: number;
    inserted: number;
    duplicates: number;
  } | null;
  lastRescanAt: string | null;
  /** Pass 2: rows of the last processed file that could not be read (sent to
   *  the heartbeat; a partly unreadable export was only logged before). */
  skippedRows?: number | null;
  /** Pass 2: reason categories of those rows, e.g. "invalid_amountx3". */
  lastSkipReason?: string | null;
}

export interface CsvWatcherHandle {
  stop: () => void;
  status: () => CsvWatcherStatus;
  /** Run one rescan pass now (queued like every other trigger). */
  rescan: () => Promise<void>;
  /** Resolves when everything queued so far has been processed. */
  whenIdle: () => Promise<void>;
}

export interface WatchHonorarOptions {
  folder: string;
  clinicId: string;
  /** Optional pre-configured mapping. When absent, auto-detect per file. */
  mapping?: CsvMapping;
  /** Test seams / tuning. */
  rescanIntervalMs?: number;
  readFile?: (path: string) => Promise<Buffer>;
  enqueueMany?: typeof enqueueMany;
  /** false = no chokidar (tests drive `rescan()`); default true. */
  useChokidar?: boolean;
}

let activeStatus: (() => CsvWatcherStatus) | null = null;

/** Status of the running Honorar watcher, or null when none is running. */
export function getCsvWatcherStatus(): CsvWatcherStatus | null {
  return activeStatus ? activeStatus() : null;
}

function isUncPath(p: string): boolean {
  return p.startsWith("\\\\") || p.startsWith("//");
}

/** Stable fingerprint of the effective mapping configuration. */
function mappingFingerprint(mapping: CsvMapping | undefined): string {
  if (!mapping) return `auto-v${AUTO_MAPPING_VERSION}`;
  const h = createHash("sha256").update(JSON.stringify(mapping)).digest("hex");
  return `mapping-${h.slice(0, 16)}`;
}

/** Error text safe for logs/heartbeat: code or class name, never a path. */
function describeError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; name?: unknown };
    if (typeof e.code === "string" && e.code) return e.code;
    if (typeof e.name === "string" && e.name) return e.name;
  }
  return "Error";
}

/** Strip the cell value that some mapper reasons append ("invalid x: <value>"). */
function reasonCategory(reason: string): string {
  return reason.split(/[:(]/)[0].trim() || "unknown";
}

function trimmedMapping(mapping: CsvMapping): CsvMapping {
  const columns: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(mapping.columns)) {
    columns[k] = typeof v === "string" ? v.trim() : v;
  }
  return { ...mapping, columns } as CsvMapping;
}

function mappedColumnNames(mapping: CsvMapping): string[] {
  return Object.values(mapping.columns).filter(
    (h): h is string => typeof h === "string" && h.length > 0
  );
}

export function watchHonorarFolder(opts: WatchHonorarOptions): CsvWatcherHandle {
  const explicitMapping = opts.mapping ? trimmedMapping(opts.mapping) : undefined;
  const fingerprint = mappingFingerprint(opts.mapping);
  const enqueueBatch = opts.enqueueMany ?? enqueueMany;
  const readFile = opts.readFile ?? ((p: string) => fsReadFile(p));
  let stopped = false;

  const st: CsvWatcherStatus = {
    folder: opts.folder,
    ledger: null,
    lastProcessedAt: null,
    lastIgnoreReason: null,
    lastHeaderColumns: [],
    lastFile: null,
    lastRescanAt: null,
    skippedRows: null,
    lastSkipReason: null,
  };
  function status(): CsvWatcherStatus {
    let ledger: LedgerSummary | null = null;
    try {
      ledger = ledgerSummary(opts.folder);
    } catch {
      ledger = null;
    }
    return { ...st, ledger, lastHeaderColumns: [...st.lastHeaderColumns] };
  }

  // ---- one serialized queue for chokidar events and rescans --------------
  let chain: Promise<void> = Promise.resolve();
  const pendingPaths = new Set<string>();
  let rescanPending = false;
  function enqueueTask(task: () => Promise<void>, label: string): void {
    chain = chain.then(task).catch((err) => {
      // Every task has its own try/catch; this guard only keeps one rejected
      // link from breaking the chain for every later file.
      console.error(`[csv-watcher] ${label} failed: ${describeError(err)}`);
    });
  }
  function enqueueFile(path: string): void {
    if (stopped || pendingPaths.has(path)) return;
    pendingPaths.add(path);
    enqueueTask(async () => {
      pendingPaths.delete(path);
      if (stopped) return;
      await processFile(path);
    }, "file processing");
  }
  function enqueueRescan(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (!rescanPending) {
      rescanPending = true;
      enqueueTask(async () => {
        rescanPending = false;
        if (stopped) return;
        await rescanFolder();
      }, "rescan");
    }
    return chain;
  }

  /** Header predicate handed to the parser (title lines etc. are skipped). */
  function isHeaderRow(headers: string[]): boolean {
    if (explicitMapping) {
      const set = new Set(headers);
      return mappedColumnNames(explicitMapping).every((c) => set.has(c));
    }
    const d = detectMapping(headers);
    return d.ok || d.reason === "ambiguous_amount_columns";
  }

  async function enqueueEvents(
    events: CanonicalEvent[]
  ): Promise<{ inserted: number; duplicates: number }> {
    let inserted = 0;
    let duplicates = 0;
    for (let i = 0; i < events.length; i += ENQUEUE_CHUNK) {
      const chunk = events.slice(i, i + ENQUEUE_CHUNK).map((e) => ({
        payload: JSON.stringify(e),
        contentHash: e.pvsExternalEventId,
      }));
      // One transaction (one fsync) per chunk, then yield so heartbeat and
      // flush timers run during a 25k-row backlog.
      const r = enqueueBatch(chunk);
      inserted += r.inserted;
      duplicates += r.duplicates;
      if (i + ENQUEUE_CHUNK < events.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
    return { inserted, duplicates };
  }

  function ignore(id: FileIdentity, base: string, reason: string): void {
    st.lastIgnoreReason = reason;
    console.warn(
      `[csv-watcher] ${base} produced ZERO events: ${reason}. Ignored until the file or the mapping changes.`
    );
    recordFileIgnored(id, reason);
  }

  /**
   * L22: log the file BASENAME only, never the full path. Some PVS write
   * patient identifiers into the export filename.
   */
  async function processFile(path: string): Promise<void> {
    const base = basename(path);
    let id: FileIdentity | null = null;
    try {
      const preStat = await stat(path).catch(() => null);
      if (!preStat || !preStat.isFile()) return;
      id = {
        watchPath: opts.folder,
        fileName: base,
        size: preStat.size,
        mtimeMs: preStat.mtimeMs,
        fingerprint,
      };
      if (!shouldProcessFile(id)) return;

      // A rescan can meet a file the exporter is still writing. Leave very
      // fresh files for chokidar's awaitWriteFinish event / the next rescan
      // (a future mtime from clock skew must not park the file forever).
      const ageMs = Date.now() - preStat.mtimeMs;
      if (ageMs >= 0 && ageMs < STABILITY_THRESHOLD_MS) return;

      // P3-1 byte-size guard: skip before reading if past the cap.
      if (preStat.size > CSV_MAX_BYTES) {
        ignore(id, base, `file_too_large: ${preStat.size} > ${CSV_MAX_BYTES} bytes`);
        return;
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (err) {
        // EBUSY / EPERM while the PVS or a virus scanner holds the file:
        // retry with backoff instead of stranding it.
        const msg = `read_failed: ${describeError(err)}`;
        const next = recordFileFailed(id, msg);
        console.warn(
          `[csv-watcher] ${base} ${msg}; retry after ${new Date(next).toISOString()}`
        );
        return;
      }

      // M-P9: caps INTO the parser (bytes gate the multi-candidate decode,
      // rows stop row-object allocation early). The watcher already waited
      // for write stability, so an unterminated last line is a real row
      // (tornWriteGuard off); the pre/post stat check below still catches a
      // file that grows while we parse.
      const parsed = parseCsv(bytes, {
        maxRows: CSV_MAX_ROWS,
        maxBytes: CSV_MAX_BYTES,
        isHeader: isHeaderRow,
        tornWriteGuard: false,
      });
      if (parsed.headers.length === 0) {
        st.lastHeaderColumns = [];
        ignore(id, base, "empty_file: no header row");
        return;
      }
      st.lastHeaderColumns = parsed.headers.filter((h) => h !== "");
      if (!parsed.headerFound) {
        ignore(
          id,
          base,
          `no_header_found: no usable header in the first 15 lines (columns seen: ${st.lastHeaderColumns.join(", ")})`
        );
        return;
      }
      if (parsed.rowCapExceeded) {
        ignore(id, base, `row_cap_exceeded: more than ${CSV_MAX_ROWS} rows`);
        return;
      }

      let mapping: CsvMapping;
      if (explicitMapping) {
        mapping = explicitMapping;
      } else {
        const d = detectMapping(parsed.headers);
        if (!d.ok) {
          if (d.reason === "ambiguous_amount_columns") {
            ignore(id, base, `ambiguous_amount_columns: ${d.columns.join(", ")}`);
          } else {
            ignore(
              id,
              base,
              `no_mapping: no usable column mapping (columns: ${st.lastHeaderColumns.join(", ")})`
            );
          }
          return;
        }
        mapping = d.mapping;
      }

      // M-P3: a duplicated header that the mapping actually uses collides in
      // the per-row record (two "Betrag" columns -> netto/brutto swap): refuse
      // the file as a format error rather than guess. Unmapped duplicates warn.
      if (parsed.duplicateHeaders.length > 0) {
        const mapped = new Set(mappedColumnNames(mapping));
        const ambiguous = parsed.duplicateHeaders.filter((h) => mapped.has(h));
        if (ambiguous.length > 0) {
          ignore(id, base, `duplicate_mapped_columns: ${ambiguous.join(", ")}`);
          return;
        }
        console.warn(
          `[csv-watcher] ${base} has duplicate header(s) not used by the mapping: ${parsed.duplicateHeaders.join(", ")}; continuing.`
        );
      }
      if (parsed.raggedRowCount > 0) {
        console.warn(
          `[csv-watcher] ${base} has ${parsed.raggedRowCount} ragged row(s) whose column count did not match the ${parsed.headers.length}-column header; extra cells dropped, missing cells blanked.`
        );
      }

      // Torn-write guard, part 2: if the file changed while we were reading
      // and parsing, the exporter is still writing. Enqueue nothing and do
      // NOT record the file: the next pass sees the new size/mtime.
      const postStat = await stat(path).catch(() => null);
      if (
        postStat &&
        (postStat.size !== preStat.size || postStat.mtimeMs !== preStat.mtimeMs)
      ) {
        console.warn(
          `[csv-watcher] ${base} changed while being processed; leaving it for the next pass`
        );
        return;
      }

      // H4: deterministic occurredAt fallback from the PRE-read mtime.
      const fileModifiedAtIso = new Date(preStat.mtimeMs).toISOString();
      let events: CanonicalEvent[] = [];
      let invoices = 0;
      let allRowsUnusable = false;
      let skippedRows = 0;
      let skipReason: string | null = null;
      const notes: string[] = [];

      if (mapping.stream === "invoices") {
        const agg = aggregateInvoiceRows({
          clinicId: opts.clinicId,
          rows: parsed.rows,
          mapping,
          // Pass 2: a later export of an invoice wins in derive even when its
          // dates are not later (storno re-exported with the original date).
          sourceRevision: Math.floor(preStat.mtimeMs),
        });
        events = agg.events;
        const s = agg.stats;
        invoices = s.invoices;
        notes.push(
          `paidInvoices=${s.paidInvoices} refundInvoices=${s.refundInvoices}`,
          `skipped(footer=${s.skippedFooter} notPaid=${s.skippedNotPaid} storno=${s.skippedStorno} invalid=${s.invalidRows})`
        );
        if (s.netZeroInvoices > 0) notes.push(`netZero=${s.netZeroInvoices}`);
        if (s.conflictingInvoices > 0) {
          notes.push(`conflictingInvoices=${s.conflictingInvoices} (ignored: same invoice number, different patients)`);
        }
        const invalidDetail = Object.entries(s.invalidReasons)
          .map(([r, n]) => `${reasonCategory(r)}x${n}`)
          .join(",");
        if (invalidDetail) notes.push(`invalidReasons=${invalidDetail}`);
        skippedRows = s.invalidRows;
        skipReason = invalidDetail || null;
        allRowsUnusable =
          s.rows > 0 &&
          s.invalidRows === s.rows;
        if (
          s.conflictingInvoices > 0 ||
          s.skippedStorno > 0 ||
          s.invalidRows > 0
        ) {
          notes.push("WARN");
        }
      } else {
        let failed = 0;
        const reasons = new Map<string, number>();
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
            failed++;
            const cat = reasonCategory(result.reason);
            reasons.set(cat, (reasons.get(cat) ?? 0) + 1);
            continue;
          }
          for (const e of result.events) events.push(e);
        }
        allRowsUnusable = parsed.rows.length > 0 && failed === parsed.rows.length;
        notes.push(`skipped=${failed}`);
        skippedRows = failed;
        skipReason = [...reasons].map(([r, n]) => `${r}x${n}`).join(",") || null;
        if (failed > 0) {
          notes.push(
            `reasons=${[...reasons].map(([r, n]) => `${r}x${n}`).join(",")}`,
            "WARN"
          );
        }
      }

      if (parsed.droppedSuspectLastRow) {
        notes.push(
          "last row dropped: file ends inside an unbalanced quote (damaged row)",
          "WARN"
        );
      }
      if (allRowsUnusable) {
        ignore(
          id,
          base,
          `all_rows_invalid: none of ${parsed.rows.length} rows could be mapped (${notes.join(" ")})`
        );
        return;
      }

      // One transaction per 1000 events instead of one fsync per row.
      const { inserted, duplicates } = await enqueueEvents(events);
      recordFileDone(id);
      st.lastProcessedAt = new Date().toISOString();
      st.lastIgnoreReason = null;
      st.skippedRows = skippedRows;
      st.lastSkipReason = skipReason;
      st.lastFile = {
        name: base,
        rows: parsed.rows.length,
        invoices,
        inserted,
        duplicates,
      };
      const warn = notes.includes("WARN");
      const summary =
        `[csv-watcher] ${base} stream=${mapping.stream} rows=${parsed.rows.length}` +
        (mapping.stream === "invoices" ? ` invoices=${invoices}` : "") +
        ` events=${events.length} inserted=${inserted} duplicates=${duplicates} ` +
        notes.filter((n) => n !== "WARN").join(" ");
      if (warn || (events.length === 0 && parsed.rows.length > 0)) {
        console.warn(summary);
      } else {
        console.log(summary);
      }
    } catch (err) {
      const msg = `process_failed: ${describeError(err)}`;
      console.error(`[csv-watcher] ${base} ${msg}`);
      if (id) {
        try {
          recordFileFailed(id, msg);
        } catch {
          // ledger unavailable: the next rescan retries (file stays unseen).
        }
      }
    }
  }

  /**
   * List the folder, prune ledger rows of vanished files, then process every
   * file the ledger says needs it, oldest mtime first, one at a time.
   */
  async function rescanFolder(): Promise<void> {
    try {
      const entries = await readdir(opts.folder).catch(() => null);
      st.lastRescanAt = new Date().toISOString();
      if (entries === null) {
        console.warn(`[csv-watcher] rescan: folder not readable`);
        return; // never prune on a failed listing (offline share)
      }
      const present = new Set<string>();
      const files: Array<{ path: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (!isCsvFile(entry)) continue;
        const full = join(opts.folder, entry);
        const s = await stat(full).catch(() => null);
        if (!s || !s.isFile()) continue;
        present.add(entry);
        files.push({ path: full, mtimeMs: s.mtimeMs });
      }
      try {
        pruneLedger(opts.folder, present);
      } catch (err) {
        console.error(`[csv-watcher] ledger prune failed: ${describeError(err)}`);
      }
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const f of files) {
        if (stopped) return;
        await processFile(f.path);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (err) {
      console.error(`[csv-watcher] rescan failed: ${describeError(err)}`);
    }
  }

  // ---- triggers -----------------------------------------------------------
  let watcher: ReturnType<typeof chokidar.watch> | null = null;
  if (opts.useChokidar !== false) {
    watcher = chokidar.watch(opts.folder, {
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: STABILITY_THRESHOLD_MS,
        pollInterval: 200,
      },
      // The startup rescan below is the catch-up path.
      ignoreInitial: true,
      // fs.watch on SMB shares misses events: poll UNC folders.
      ...(isUncPath(opts.folder) ? { usePolling: true, interval: 5000 } : {}),
    });
    watcher.on("add", (p) => {
      if (isCsvFile(p)) enqueueFile(p);
    });
    watcher.on("change", (p) => {
      if (isCsvFile(p)) enqueueFile(p);
    });
    watcher.on("error", (err) => {
      // Keep going: the periodic rescan still covers the folder.
      console.error(`[csv-watcher] watcher error: ${describeError(err)}`);
    });
  }

  const timer = setInterval(
    () => void enqueueRescan(),
    opts.rescanIntervalMs ?? RESCAN_INTERVAL_MS
  );
  timer.unref?.();
  void enqueueRescan();

  activeStatus = status;
  console.log(`[csv-watcher] watching ${opts.folder}`);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      if (activeStatus === status) activeStatus = null;
      if (watcher) void watcher.close();
    },
    status,
    rescan: () => enqueueRescan(),
    whenIdle: () => chain,
  };
}

function isCsvFile(path: string): boolean {
  return /\.csv$/i.test(path);
}
