import chokidar from "chokidar";
import { mkdir, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseGdtFile, type GdtParseResult } from "./gdt-parser.js";
import { gdtToCanonical } from "./normalize.js";
import { enqueueMany } from "./outbox.js";
import {
  failedFiles,
  forgetFile,
  ignoredFiles,
  ledgerSummary,
  pruneLedger,
  recordFileDone,
  recordFileFailed,
  recordFileIgnored,
  shouldProcessFile,
  type FileIdentity,
} from "./file-ledger.js";

/**
 * GDT inbox watcher: EINS acts as a GDT "device".
 *
 * Contract with the PVS (GDT 2.1 spec, section 2.3):
 *   - File names are `<Empfänger≤4><Sender≤4>.NNN` (counter from .001) or a
 *     fixed `<Empfänger><Sender>.GDT`. EINS's receiver id defaults to "EINS",
 *     so the PVS is configured to write e.g. `EINSPVS.GDT` / `EINSPVS.001`.
 *   - The receiver processes files FIFO by date/time and DELETES each file
 *     after reading. The sender must not overwrite an unread `.GDT` file, so
 *     a receiver that never deletes blocks the PVS's EINS channel after the
 *     first export. (The previous watcher never deleted anything.)
 *
 * Safety rules for a real Praxis:
 *   1. Only files ADDRESSED to EINS are consumed: the file name starts with
 *      the receiver id, or a Satz carries FK 8315 (GDT-ID des Empfängers) =
 *      receiver id. Practices often share one GDT folder between devices
 *      (ECG, spirometry, ...). Files for other devices are never moved,
 *      deleted or translated; they are remembered in the file ledger so they
 *      are not re-read on every rescan, and counted for the heartbeat.
 *   2. Claim before process: an addressed file is atomically renamed into
 *      `<folder>\.eins\processing\`. On Windows the rename fails while the
 *      PVS still holds the file open for writing (EBUSY/EPERM) → retried
 *      later. After the claim the PVS can immediately write its next file.
 *   3. Durable before delete: all events of the file are enqueued in one
 *      SQLite transaction (enqueueMany) BEFORE the claimed copy is deleted.
 *      A crash in between leaves the file in `processing`, which is
 *      re-processed on the next rescan (event ids are deterministic, so the
 *      outbox dedups the replay).
 *   4. Unreadable / non-GDT files addressed to EINS are moved to
 *      `<folder>\.eins\failed\` (so the PVS channel is not blocked) and kept
 *      30 days for diagnosis, then deleted (they contain patient data).
 *   5. A file without the mandatory final CR LF is accepted once it has been
 *      stable for TORN_GRACE_MS, or immediately when every Satz's FK 8100
 *      length matches. Some exporters omit the last CR LF; waiting forever
 *      would block the channel.
 *   6. BDT files (`.bdt`, full PVS exports used for an initial patient
 *      import) are read-only: translated once per file version, never moved
 *      or deleted.
 *   7. A periodic rescan (default 30 s) backs up chokidar, which misses
 *      events on SMB shares and when the folder is recreated. UNC paths skip
 *      chokidar entirely (its polling mode keeps one stat watcher per file)
 *      and rely on a faster rescan (7 s) with bounded stat concurrency.
 *   8. The watch folder itself is never created: a missing folder (moved
 *      export dir, typo, PVS reinstall) is a failed listing, surfaced in the
 *      status; only `.eins\processing` / `.eins\failed` are created, and only
 *      below an existing folder.
 *   9. Stability is judged by the agent's own first-seen age (never by the
 *      file's mtime: a share host's clock may lag), the file is re-stat'ed
 *      right before the claim, and a file whose FK 8100 declares more bytes
 *      than present waits for the torn grace period.
 */

const GDT_NAME = /\.(gdt|\d{3})$/i;
const BDT_NAME = /\.bdt$/i;
const WORK_DIR = ".eins";
const GDT_MAX_BYTES = 32 * 1024 * 1024;
const BDT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_RESCAN_MS = 30_000;
const DEFAULT_STABILITY_MS = 1_500;
const DEFAULT_TORN_GRACE_MS = 10_000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ENQUEUE_CHUNK = 1_000;
/** UNC shares: no chokidar, so rescan faster instead. */
const UNC_RESCAN_MS = 7_000;
const STAT_CONCURRENCY = 8;
/** Addressed files whose claim keeps failing block a fixed-name channel:
 *  retry at most every 5 min instead of backing off to an hour. */
const CLAIM_MAX_DELAY_MS = 5 * 60_000;
const SEVERE_ATTEMPTS = 3;
const SEVERE_AGE_MS = 5 * 60_000;
const MIN_PLAUSIBLE_MTIME_MS = Date.UTC(2000, 0, 1);
const MAX_FUTURE_MTIME_MS = 24 * 60 * 60 * 1000;
const DROP_WARN_INTERVAL_MS = 60 * 60_000;
const MISADDRESSED_PREFIX = "name_addressed_8315:";
const KIND = "gdt" as const;

export function isUncPath(p: string): boolean {
  return /^(\\\\|\/\/)/.test(p);
}

export interface GdtWatcherStatus {
  folder: string;
  receiverId: string;
  /** Files consumed (enqueued + deleted) since start. */
  consumedFiles: number;
  /** Events newly enqueued since start (duplicates excluded). */
  eventsEnqueued: number;
  /** Files in the folder not addressed to EINS or not GDT (left untouched). */
  ignoredFiles: number;
  /** Files whose processing failed and is being retried with backoff. */
  retryingFiles: number;
  /** Addressed files that could not be processed and sit in .eins\failed. */
  quarantinedFiles: number;
  /** Subset of retryingFiles that is an incident: attempts >= 3 or failing > 5 min. */
  retryingSevere: number;
  /** Addressed files with Sätze but no patient event (e.g. no FK 3000), moved to .eins\failed. */
  droppedFiles: number;
  /** Files addressed to EINS by name whose FK 8315 names another receiver. */
  misaddressedFiles: number;
  /** The FK 8315 value(s) of those files (device ids, no patient data). */
  misaddressedDetail: string | null;
  /** Claimed files still in .eins\processing because enqueue/delete failed. */
  stuckClaimed: number;
  /** Highest number of consecutive failed processing attempts of a stuck file. */
  stuckAttempts: number;
  /** Consecutive rescans whose folder listing failed (0 = last listing ok). */
  consecutiveListingFailures: number;
  lastRescanOkAt: string | null;
  lastFileAt: string | null;
  lastError: string | null;
}

export interface GdtWatcherHandle {
  stop: () => Promise<void>;
  status: () => GdtWatcherStatus;
  /** Run one rescan now and wait until the queue is drained (tests, CLI). */
  rescanNow: () => Promise<void>;
}

export function watchFolder(opts: {
  folder: string;
  clinicId: string;
  receiverId?: string;
  rescanIntervalMs?: number;
  stabilityMs?: number;
  tornGraceMs?: number;
  /** Disable chokidar (tests drive rescanNow directly). */
  useChokidar?: boolean;
  /** Test seams only. */
  testHooks?: {
    /** Runs after the file was read and judged ours, right before the claim. */
    beforeClaim?: (path: string) => Promise<void>;
    /** Replaces fs.stat for the rescan's mtime sort. */
    stat?: typeof stat;
    enqueueMany?: typeof enqueueMany;
  };
}): GdtWatcherHandle {
  const folder = opts.folder;
  const receiverId = (opts.receiverId ?? "EINS").trim() || "EINS";
  const receiverUpper = receiverId.toUpperCase();
  const stabilityMs = opts.stabilityMs ?? DEFAULT_STABILITY_MS;
  const tornGraceMs = opts.tornGraceMs ?? DEFAULT_TORN_GRACE_MS;
  const processingDir = join(folder, WORK_DIR, "processing");
  const failedDir = join(folder, WORK_DIR, "failed");

  const unc = isUncPath(folder);

  const stats = {
    consumedFiles: 0,
    eventsEnqueued: 0,
    quarantinedFiles: 0,
    droppedFiles: 0,
    consecutiveListingFailures: 0,
    lastRescanOkAt: null as string | null,
    lastFileAt: null as string | null,
    lastError: null as string | null,
  };
  /** True while stats.lastError is the listing error (cleared on recovery). */
  let lastErrorIsListing = false;
  let stopped = false;
  let claimSeq = 0;
  let lastFailedPruneAt = 0;
  let lastDropWarnAt = 0;
  /** Addressed files (by FK 8315) whose claim failed, for the health count. */
  const addressedFailing = new Set<string>();
  const failSince = new Map<string, number>();
  /** claimed path -> consecutive failed processing attempts. */
  const claimedAttempts = new Map<string, number>();

  function isAddressedFailing(fileName: string): boolean {
    return fileName.toUpperCase().startsWith(receiverUpper) || addressedFailing.has(fileName);
  }
  function failAddressed(id: FileIdentity, msg: string): void {
    recordFileFailed(id, msg, Date.now(), CLAIM_MAX_DELAY_MS);
    addressedFailing.add(id.fileName);
    if (!failSince.has(id.fileName)) failSince.set(id.fileName, Date.now());
  }
  function clearFailure(fileName: string): void {
    addressedFailing.delete(fileName);
    failSince.delete(fileName);
  }
  function markStuck(claimed: string): void {
    claimedAttempts.set(claimed, (claimedAttempts.get(claimed) ?? 0) + 1);
  }

  /** `.eins\processing` + `.eins\failed`, created only below an EXISTING
   *  watch folder (never recreate a moved/typo'd folder). Throws ENOENT when
   *  the folder is missing. */
  async function ensureWorkDirs(): Promise<void> {
    const st = await stat(folder);
    if (!st.isDirectory()) {
      throw Object.assign(new Error("watch path is not a directory"), { code: "ENOTDIR" });
    }
    await mkdir(processingDir, { recursive: true });
    await mkdir(failedDir, { recursive: true });
  }

  function noteError(msg: string): void {
    stats.lastError = `${new Date().toISOString()} ${msg}`;
    console.error(`[watcher] ${msg}`);
  }

  // ---- serialized work queue --------------------------------------------
  const pending = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  function run(task: () => Promise<void>): Promise<void> {
    chain = chain.then(task).catch((err) => {
      noteError(`queue task failed: ${errText(err)}`);
    });
    return chain;
  }
  function schedule(path: string): void {
    if (stopped || pending.has(path)) return;
    pending.add(path);
    void run(async () => {
      pending.delete(path);
      if (!stopped) await handle(path);
    });
  }
  const retryTimers = new Map<string, NodeJS.Timeout>();
  function retryLater(path: string, delayMs: number): void {
    if (stopped || retryTimers.has(path)) return;
    const t = setTimeout(() => {
      retryTimers.delete(path);
      schedule(path);
    }, Math.max(100, delayMs));
    t.unref?.();
    retryTimers.set(path, t);
  }

  /**
   * How long WE have seen the file with the same size + mtime. The file's own
   * mtime is deliberately ignored: a share host whose clock lags makes a file
   * that is being written right now look old on first sight.
   */
  const observed = new Map<string, { size: number; mtimeMs: number; since: number }>();
  function unchangedForMs(path: string, size: number, mtimeMs: number): number {
    const now = Date.now();
    const prev = observed.get(path);
    if (!prev || prev.size !== size || prev.mtimeMs !== mtimeMs) {
      observed.set(path, { size, mtimeMs, since: now });
    }
    if (observed.size > 10_000) observed.clear(); // bound memory on huge folders
    return now - (observed.get(path)?.since ?? now);
  }

  // ---- per-file handling --------------------------------------------------
  async function handle(path: string): Promise<void> {
    const name = basename(path);
    if (BDT_NAME.test(name)) return observeBdt(path, name);
    if (!GDT_NAME.test(name)) return;

    const st = await stat(path).catch(() => null);
    if (!st || !st.isFile()) return;
    const id: FileIdentity = {
      watchPath: folder,
      fileName: name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      kind: KIND,
      // A changed receiver id re-evaluates files ignored under the old one.
      fingerprint: receiverId,
    };
    if (!shouldProcessFile(id)) return;
    const age = unchangedForMs(path, st.size, st.mtimeMs);
    if (age < stabilityMs) {
      retryLater(path, stabilityMs - age + 100); // still settling
      return;
    }

    const addressedByName = name.toUpperCase().startsWith(receiverUpper);
    if (!addressedByName && st.size > GDT_MAX_BYTES) {
      recordFileIgnored(id, "not_addressed_too_large");
      return;
    }
    if (addressedByName && st.size > GDT_MAX_BYTES) {
      await claimAndQuarantine(path, name, id, `file exceeds ${GDT_MAX_BYTES} bytes`);
      return;
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      if (errCode(err) === "ENOENT") return;
      if (addressedByName) failAddressed(id, `read: ${errText(err)}`);
      else recordFileFailed(id, `read: ${errText(err)}`);
      noteError(`${name}: read failed (${errCode(err) ?? "error"}), will retry`);
      return;
    }
    const parsed = await parseGdtFile(bytes);

    const addressing = addressingOf(parsed, addressedByName, receiverUpper);
    if (addressing !== "ours") {
      // Not ours to delete: another receiver (FK 8315 wins over the file
      // name), a device→PVS Satz (6300/6310 belong to the PVS even when a
      // misconfigured device names EINS), or not GDT at all.
      if (addressing === "not_addressed" && addressedByName) {
        // The name says EINS, FK 8315 says someone else: it would sit here
        // forever (and block a fixed-name channel). Surface it in the health.
        const values = fk8315Values(parsed).join(",").slice(0, 100);
        recordFileIgnored(id, `${MISADDRESSED_PREFIX}${values}`);
        noteError(
          `${name}: file name addresses EINS but FK 8315 is "${values}" (configured receiver id "${receiverId}"); left untouched`
        );
        return;
      }
      recordFileIgnored(id, addressing);
      return;
    }
    if (!looksComplete(parsed) && age < tornGraceMs) {
      retryLater(path, tornGraceMs - age + 100); // may still be written
      return;
    }

    await opts.testHooks?.beforeClaim?.(path);

    // The writer may have touched the file since we read it (a PVS that
    // opened it with FILE_SHARE_DELETE does not block the rename): claim only
    // a file that is byte-for-byte what we judged.
    const again = await stat(path).catch(() => null);
    if (!again) return;
    if (again.size !== st.size || again.mtimeMs !== st.mtimeMs) {
      observed.delete(path);
      retryLater(path, stabilityMs + 100);
      return;
    }

    // Claim: atomic rename into our work dir.
    const claimed = join(processingDir, `${Date.now()}-${++claimSeq}-${name}`);
    try {
      await ensureWorkDirs();
      await rename(path, claimed);
    } catch (err) {
      if (errCode(err) === "ENOENT") return;
      failAddressed(id, `claim: ${errText(err)}`);
      noteError(
        `${name}: cannot move file into ${WORK_DIR}\\processing (${errCode(err) ?? "error"}); ` +
          `PVS still writing or no delete/rename permission on the GDT folder. Will retry.`
      );
      return;
    }
    forgetFile(folder, name, KIND);
    clearFailure(name);
    await processClaimed(claimed, name);
  }

  /**
   * Translate + enqueue + delete a file we own (in .eins\processing). Also
   * the crash-recovery path for files left there by a previous run.
   */
  async function processClaimed(claimed: string, originalName: string): Promise<void> {
    let bytes: Buffer;
    let mtimeMs: number;
    try {
      const st = await stat(claimed);
      mtimeMs = st.mtimeMs; // rename preserves the PVS's write time
      bytes = await readFile(claimed);
    } catch (err) {
      if (errCode(err) === "ENOENT") {
        claimedAttempts.delete(claimed);
        return;
      }
      markStuck(claimed);
      noteError(`${originalName}: cannot read claimed file (${errCode(err) ?? "error"}); will retry`);
      return;
    }
    const parsed = await parseGdtFile(bytes);
    if (parsed.saetze.length === 0) {
      await quarantine(claimed, originalName, "no GDT Satz (FK 8000) found");
      return;
    }
    const events = gdtToCanonical(parsed, {
      clinicId: opts.clinicId,
      contentHash: parsed.contentHash,
      fileModifiedAtIso: new Date(plausibleMtimeMs(mtimeMs)).toISOString(),
    });
    if (events.length === 0) {
      // Sätze but no patient event (no FK 3000, or the line was dropped by the
      // length rule): not a consumed file. Keep it for diagnosis.
      if (Date.now() - lastDropWarnAt > DROP_WARN_INTERVAL_MS) {
        lastDropWarnAt = Date.now();
        console.warn(
          `[watcher] ${originalName}: no patient Satz (6301/6302/6311 with FK 3000) in file; ` +
            `moved to ${WORK_DIR}\\failed. Check the GDT export settings in the PVS`
        );
      }
      await quarantine(claimed, originalName, "no patient Satz with FK 3000", true);
      return;
    }
    try {
      const res = (opts.testHooks?.enqueueMany ?? enqueueMany)(
        events.map((e) => ({ payload: JSON.stringify(e), contentHash: e.pvsExternalEventId }))
      );
      stats.eventsEnqueued += res.inserted;
    } catch (err) {
      // Disk full / DB busy: keep the file in processing; next rescan retries.
      markStuck(claimed);
      noteError(`${originalName}: enqueue failed (${errText(err)}); kept for retry`);
      return;
    }
    try {
      await unlink(claimed);
    } catch (err) {
      if (errCode(err) !== "ENOENT") {
        // Events are durable; a leftover file is re-processed (deduped) later
        // and counted as consumed only once it is really gone.
        markStuck(claimed);
        noteError(`${originalName}: delete after enqueue failed (${errCode(err) ?? "error"})`);
        return;
      }
    }
    claimedAttempts.delete(claimed);
    stats.consumedFiles++;
    stats.lastFileAt = new Date().toISOString();
    const satzarten = [...new Set(parsed.saetze.map((s) => s.satzart))].join(",");
    console.log(
      `[watcher] ${originalName} consumed satzart=${satzarten} encoding=${parsed.encoding} events=${events.length}` +
        (parsed.endsWithTerminator ? "" : " (no final CR LF)")
    );
  }

  async function claimAndQuarantine(
    path: string,
    name: string,
    id: FileIdentity,
    reason: string
  ): Promise<void> {
    const claimed = join(processingDir, `${Date.now()}-${++claimSeq}-${name}`);
    try {
      await ensureWorkDirs();
      await rename(path, claimed);
    } catch (err) {
      if (errCode(err) !== "ENOENT") failAddressed(id, `claim: ${errText(err)}`);
      return;
    }
    forgetFile(folder, name, KIND);
    clearFailure(name);
    await quarantine(claimed, name, reason);
  }

  async function quarantine(
    claimed: string,
    name: string,
    reason: string,
    dropped = false
  ): Promise<void> {
    try {
      await ensureWorkDirs();
      await rename(claimed, join(failedDir, basename(claimed)));
      claimedAttempts.delete(claimed);
      stats.quarantinedFiles++;
      if (dropped) stats.droppedFiles++;
      noteError(`${name}: moved to ${WORK_DIR}\\failed (${reason})`);
    } catch (err) {
      markStuck(claimed);
      noteError(`${name}: quarantine failed (${errText(err)}); left in processing`);
    }
  }

  async function observeBdt(path: string, name: string): Promise<void> {
    const st = await stat(path).catch(() => null);
    if (!st || !st.isFile()) return;
    const id: FileIdentity = {
      watchPath: folder,
      fileName: name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      kind: KIND,
    };
    if (!shouldProcessFile(id)) return;
    const age = unchangedForMs(path, st.size, st.mtimeMs);
    if (age < stabilityMs) {
      retryLater(path, stabilityMs - age + 100);
      return;
    }
    if (st.size > BDT_MAX_BYTES) {
      recordFileIgnored(id, "bdt_too_large");
      noteError(
        `${name}: BDT export larger than ${BDT_MAX_BYTES} bytes ignored; please export only the Patientenstamm`
      );
      return;
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (err) {
      if (errCode(err) !== "ENOENT") recordFileFailed(id, `read: ${errText(err)}`);
      return;
    }
    const parsed = await parseGdtFile(bytes);
    if (!looksComplete(parsed) && age < tornGraceMs) {
      retryLater(path, tornGraceMs - age + 100);
      return;
    }
    const events = gdtToCanonical(parsed, {
      clinicId: opts.clinicId,
      contentHash: parsed.contentHash,
      fileModifiedAtIso: new Date(plausibleMtimeMs(st.mtimeMs)).toISOString(),
    });
    try {
      for (let i = 0; i < events.length; i += ENQUEUE_CHUNK) {
        const res = enqueueMany(
          events
            .slice(i, i + ENQUEUE_CHUNK)
            .map((e) => ({ payload: JSON.stringify(e), contentHash: e.pvsExternalEventId }))
        );
        stats.eventsEnqueued += res.inserted;
        await new Promise((r) => setImmediate(r));
      }
    } catch (err) {
      recordFileFailed(id, `enqueue: ${errText(err)}`);
      noteError(`${name}: enqueue failed (${errText(err)}), will retry`);
      return;
    }
    recordFileDone(id);
    stats.lastFileAt = new Date().toISOString();
    console.log(`[watcher] ${name} (BDT, read-only) events=${events.length}`);
  }

  // ---- rescan ---------------------------------------------------------------
  async function rescan(): Promise<void> {
    // 0. Work folders, only below an existing watch folder (a missing folder
    //    surfaces as a failed listing below; startup and claims report
    //    permission problems).
    await ensureWorkDirs().catch(() => undefined);
    // 1. Crash recovery: anything we claimed but did not finish.
    const leftovers = await readdir(processingDir).catch(() => [] as string[]);
    for (const f of leftovers.sort()) {
      const original = f.replace(/^\d+-\d+-/, "");
      await processClaimed(join(processingDir, f), original);
    }
    // 2. The folder itself, FIFO by modification time (spec 2.3.1).
    let names: string[];
    try {
      const entries = await readdir(folder, { withFileTypes: true });
      names = entries
        .filter((e) => e.isFile() && (GDT_NAME.test(e.name) || BDT_NAME.test(e.name)))
        .map((e) => e.name);
    } catch (err) {
      stats.consecutiveListingFailures++;
      noteError(`cannot list GDT folder (${errCode(err) ?? errText(err)})`);
      lastErrorIsListing = true;
      return;
    }
    stats.consecutiveListingFailures = 0;
    stats.lastRescanOkAt = new Date().toISOString();
    if (lastErrorIsListing) {
      stats.lastError = null;
      lastErrorIsListing = false;
    }
    const statFn = opts.testHooks?.stat ?? stat;
    const withTimes = await mapLimit(names, STAT_CONCURRENCY, async (n) => ({
      n,
      t: (await statFn(join(folder, n)).catch(() => null))?.mtimeMs ?? 0,
    }));
    withTimes.sort((a, b) => a.t - b.t);
    for (const { n } of withTimes) schedule(join(folder, n));
    try {
      pruneLedger(folder, new Set(names), KIND);
    } catch {
      // ledger prune is housekeeping only
    }
    // 3. Housekeeping: failed files older than the retention.
    if (Date.now() - lastFailedPruneAt > 60 * 60_000) {
      lastFailedPruneAt = Date.now();
      await pruneFailedDir();
    }
  }

  async function pruneFailedDir(): Promise<void> {
    const files = await readdir(failedDir).catch(() => [] as string[]);
    let kept = 0;
    for (const f of files) {
      const p = join(failedDir, f);
      const st = await stat(p).catch(() => null);
      if (!st) continue;
      if (Date.now() - st.mtimeMs > FAILED_RETENTION_MS) {
        await unlink(p).catch(() => undefined);
      } else {
        kept++;
      }
    }
    stats.quarantinedFiles = kept;
  }

  let rescanQueued = false;
  function queueRescan(): Promise<void> {
    if (rescanQueued || stopped) return chain;
    rescanQueued = true;
    return run(async () => {
      rescanQueued = false;
      await rescan();
    });
  }

  // ---- wiring ---------------------------------------------------------------
  let fsWatcher: ReturnType<typeof chokidar.watch> | null = null;
  // UNC: chokidar's polling mode would stat-watch every file every 2 s over
  // SMB; the (faster) rescan alone is cheaper and just as complete.
  if (opts.useChokidar !== false && !unc) {
    fsWatcher = chokidar.watch(folder, {
      persistent: true,
      ignoreInitial: true,
      depth: 0,
      ignored: (p: string) => basename(p) === WORK_DIR,
      awaitWriteFinish: { stabilityThreshold: stabilityMs, pollInterval: 200 },
    });
    const onFile = (p: string) => {
      const n = basename(p);
      if (GDT_NAME.test(n) || BDT_NAME.test(n)) schedule(p);
    };
    fsWatcher.on("add", onFile);
    fsWatcher.on("change", onFile);
    fsWatcher.on("error", (err) => {
      noteError(`file watcher error (${errText(err)}); periodic rescan continues`);
    });
  }
  const timer = setInterval(
    () => void queueRescan(),
    opts.rescanIntervalMs ?? (unc ? UNC_RESCAN_MS : DEFAULT_RESCAN_MS)
  );
  timer.unref?.();
  void (async () => {
    try {
      await ensureWorkDirs();
    } catch (err) {
      // A missing folder is reported by the listing, not here.
      if (errCode(err) !== "ENOENT") noteError(
        `cannot create ${WORK_DIR} work folders in the GDT folder (${errCode(err) ?? errText(err)}); ` +
          `EINS needs write + delete permission there to consume GDT files`
      );
    }
    await queueRescan();
  })();

  console.log(`[watcher] watching ${folder} (GDT receiver id ${receiverId})`);

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      for (const t of retryTimers.values()) clearTimeout(t);
      retryTimers.clear();
      await fsWatcher?.close();
      await chain.catch(() => undefined);
    },
    status() {
      let ignored = 0;
      let failed: ReturnType<typeof failedFiles> = [];
      let mis: ReturnType<typeof ignoredFiles> = [];
      try {
        ignored = ledgerSummary(folder, KIND).ignored;
        failed = failedFiles(folder, KIND);
        mis = ignoredFiles(folder, KIND, MISADDRESSED_PREFIX);
      } catch {
        // outbox closed during shutdown
      }
      // Foreign files that failed to read are not our incident.
      const addressed = failed.filter((r) => isAddressedFailing(r.fileName));
      for (const k of [...failSince.keys()]) {
        if (!failed.some((r) => r.fileName === k)) failSince.delete(k);
      }
      const now = Date.now();
      const severe = addressed.filter(
        (r) =>
          r.attempts >= SEVERE_ATTEMPTS ||
          now - (failSince.get(r.fileName) ?? now) > SEVERE_AGE_MS
      ).length;
      const misValues = [
        ...new Set(mis.map((m) => m.reason.slice(MISADDRESSED_PREFIX.length))),
      ].join(", ");
      return {
        folder,
        receiverId,
        consumedFiles: stats.consumedFiles,
        eventsEnqueued: stats.eventsEnqueued,
        ignoredFiles: ignored,
        retryingFiles: addressed.length,
        retryingSevere: severe,
        quarantinedFiles: stats.quarantinedFiles,
        droppedFiles: stats.droppedFiles,
        misaddressedFiles: mis.length,
        misaddressedDetail: mis.length > 0 ? misValues : null,
        stuckClaimed: claimedAttempts.size,
        stuckAttempts: Math.max(0, ...claimedAttempts.values()),
        consecutiveListingFailures: stats.consecutiveListingFailures,
        lastRescanOkAt: stats.lastRescanOkAt,
        lastFileAt: stats.lastFileAt,
        lastError:
          stats.lastError ??
          ([...addressed].reverse().find((r) => r.lastError)?.lastError ?? null),
      };
    },
    async rescanNow() {
      await queueRescan();
      // schedule() calls made by the rescan append to the chain; wait for them.
      let last: Promise<void> | null = null;
      while (last !== chain) {
        last = chain;
        await chain;
      }
    },
  };
}

/** Satzarten a device sends TO the PVS; never consumed by EINS. */
const DEVICE_TO_PVS_SATZARTEN = new Set(["6300", "6310"]);

type Addressing = "ours" | "not_addressed" | "device_to_pvs_satzart" | "not_gdt";

/**
 * Is this file ours to consume (and therefore delete)?
 *   - FK 8315 (GDT-ID des Empfängers), when present, decides: the file name
 *     `<Empf><Send>.NNN` cannot tell receiver "EINS" from a receiver "EIN"
 *     with sender "S...", and a file naming another receiver in 8315 must
 *     never be taken just because its name starts with our id.
 *   - Without 8315 the file name prefix decides.
 *   - A file containing a device→PVS Satz is never ours.
 *   - An addressed-by-name file that is not GDT at all is ours, so it is
 *     quarantined and the PVS channel stays free.
 */
export function addressingOf(
  parsed: GdtParseResult,
  addressedByName: boolean,
  receiverUpper: string
): Addressing {
  if (parsed.saetze.length === 0) return addressedByName ? "ours" : "not_gdt";
  const receivers = new Set<string>();
  for (const s of parsed.saetze) {
    for (const r of s.records) {
      if (r.feldKennung === "8315" && r.value.trim() !== "") {
        receivers.add(r.value.trim().toUpperCase());
      }
    }
  }
  const ours =
    receivers.size > 0
      ? receivers.size === 1 && receivers.has(receiverUpper)
      : addressedByName;
  if (!ours) return "not_addressed";
  if (parsed.saetze.some((s) => DEVICE_TO_PVS_SATZARTEN.has(s.satzart))) {
    return "device_to_pvs_satzart";
  }
  return "ours";
}

/**
 * Complete = at least one Satz, no Satz declares (FK 8100) more bytes than are
 * present, and the file ends with a line terminator or every Satz's 8100
 * matches. An empty file or one cut at a CR LF boundary therefore waits for
 * the torn grace period instead of being claimed or quarantined at once.
 */
function looksComplete(parsed: GdtParseResult): boolean {
  if (parsed.saetze.length === 0) return false;
  if (parsed.saetze.some((s) => (s.declaredLength ?? 0) > s.actualLength)) return false;
  if (parsed.endsWithTerminator) return true;
  return parsed.saetze.every((s) => s.lengthVerified);
}

/** FK 8315 values (device ids, not patient data) of all Sätze. */
function fk8315Values(parsed: GdtParseResult): string[] {
  const out = new Set<string>();
  for (const s of parsed.saetze) {
    for (const r of s.records) {
      if (r.feldKennung === "8315" && r.value.trim() !== "") out.add(r.value.trim());
    }
  }
  return [...out];
}

/** A dead RTC on the share host / DOS dates give impossible mtimes; the
 *  portal would reject the event forever. Fall back to the claim time. */
function plausibleMtimeMs(mtimeMs: number, now = Date.now()): number {
  return Number.isFinite(mtimeMs) &&
    mtimeMs >= MIN_PLAUSIBLE_MTIME_MS &&
    mtimeMs <= now + MAX_FUTURE_MTIME_MS
    ? mtimeMs
    : now;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function errCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
