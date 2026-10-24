import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

/**
 * Size-rotated, timestamped log file for the supervised agent:
 * `<dataDir>\logs\agent.log`, rotated at 10 MB, 5 old files kept
 * (agent.log.1 is the newest old file, agent.log.5 the oldest).
 *
 * Built for a machine nobody watches for months:
 *   - it NEVER throws. A full disk or a locked file drops log lines (and counts
 *     them) instead of killing the supervisor that keeps the agent alive;
 *   - rotation is attempted again later if Windows refuses the rename (an
 *     operator tailing the log with Get-Content -Wait holds the file without
 *     delete-sharing), and meanwhile logging continues in the current file;
 *   - lines are written synchronously with an exact byte count, so the size
 *     check does not depend on a stat per line.
 */

export const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_KEEP = 5;
const ROTATE_RETRY_MS = 60_000;

export interface RotatingLogOptions {
  dir: string;
  fileName?: string;
  maxBytes?: number;
  keep?: number;
  now?: () => Date;
  /** Also echo each line to this sink (interactive runs). */
  echo?: (line: string) => void;
}

export interface RotatingLog {
  readonly path: string;
  /** Append one logical line (embedded newlines become separate lines). */
  writeLine(text: string): void;
  /** Lines lost to write errors since start. */
  droppedLines(): number;
  close(): void;
}

/**
 * Shift agent.log.(keep-1) -> .keep ... agent.log.1 -> .2 and agent.log ->
 * agent.log.1. The oldest file is deleted. Exposed for tests.
 */
export function rotateFiles(path: string, keep: number): void {
  // The live file is the only one that can be locked by somebody else (an
  // operator tailing it), so it is moved aside FIRST. If that rename throws,
  // no older file has been touched and a retry later loses no history.
  // A leftover from an earlier rotation that failed half way is kept under its
  // own name rather than overwritten: it still holds a full log.
  let staged = `${path}.rotating`;
  if (existsSync(staged)) staged = `${staged}.${Date.now()}`;
  if (!existsSync(path)) return;
  renameSync(path, staged);
  try {
    const oldest = `${path}.${keep}`;
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = keep - 1; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
  } finally {
    // Only into a free slot: if the shift above failed, ".1" still holds the
    // previous newest log and must not be replaced.
    if (existsSync(staged) && !existsSync(`${path}.1`)) {
      renameSync(staged, `${path}.1`);
    }
  }
}

export function createRotatingLog(opts: RotatingLogOptions): RotatingLog {
  const fileName = opts.fileName ?? "agent.log";
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const keep = Math.max(1, opts.keep ?? DEFAULT_KEEP);
  const now = opts.now ?? (() => new Date());
  const path = join(opts.dir, fileName);

  let fd: number | null = null;
  let size = 0;
  let dropped = 0;
  let nextRotateAttempt = 0;

  const open = (): boolean => {
    try {
      mkdirSync(opts.dir, { recursive: true });
      fd = openSync(path, "a");
      try {
        size = statSync(path).size;
      } catch {
        size = 0;
      }
      return true;
    } catch {
      fd = null;
      return false;
    }
  };

  const closeFd = (): void => {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Nothing useful to do about a failed close.
      }
      fd = null;
    }
  };

  const maybeRotate = (incoming: number): void => {
    if (size === 0 || size + incoming <= maxBytes) return;
    if (now().getTime() < nextRotateAttempt) return;
    closeFd();
    try {
      rotateFiles(path, keep);
    } catch {
      // Windows refused (file held open elsewhere). Keep appending to the
      // current file and try again in a minute.
      nextRotateAttempt = now().getTime() + ROTATE_RETRY_MS;
    }
    open();
  };

  open();

  const write = (line: string): void => {
    const out = `${now().toISOString()} ${line}\n`;
    const bytes = Buffer.byteLength(out, "utf8");
    if (fd === null && !open()) {
      dropped++;
      return;
    }
    maybeRotate(bytes);
    if (fd === null) {
      dropped++;
      return;
    }
    try {
      writeSync(fd, out);
      size += bytes;
    } catch {
      dropped++;
      // Reopen on the next line: the handle may be dead (disk full, network
      // volume dropped).
      closeFd();
    }
  };

  return {
    path,
    writeLine(text: string) {
      for (const part of text.split(/\r?\n/)) {
        if (part === "") continue;
        write(part);
        if (opts.echo) {
          try {
            opts.echo(part);
          } catch {
            // The echo sink (a console that vanished) must not break logging.
          }
        }
      }
    },
    droppedLines: () => dropped,
    close: closeFd,
  };
}

/**
 * Turns arbitrary stream chunks into whole lines: buffers a trailing partial
 * line until its newline arrives (or `flush()` at end of stream).
 */
export function createLineSplitter(onLine: (line: string) => void): {
  push(chunk: Buffer | string): void;
  flush(): void;
} {
  let pending = "";
  // A multi-byte character (the umlauts in our German log lines) can be split
  // across two chunks; the decoder holds the partial bytes back.
  const decoder = new StringDecoder("utf8");
  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : decoder.write(chunk);
      let idx: number;
      while ((idx = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, idx).replace(/\r$/, "");
        pending = pending.slice(idx + 1);
        if (line !== "") onLine(line);
      }
      // A runaway line without a newline must not grow without bound.
      if (pending.length > 64 * 1024) {
        onLine(pending);
        pending = "";
      }
    },
    flush() {
      pending += decoder.end();
      if (pending !== "") {
        onLine(pending.replace(/\r$/, ""));
        pending = "";
      }
    },
  };
}
