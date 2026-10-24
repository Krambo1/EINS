import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/**
 * Single-instance lock for the agent (and, under another name, the supervisor).
 *
 * Two agents against one data directory would both consume the same GDT files
 * and race on the outbox. The lock is `<dataDir>\agent.lock`, created with
 * flag 'wx' (create exclusively) and holding `{pid, startedAt, token}`.
 *
 * Staleness. A lock file outlives a crash, a hard kill (Task Scheduler "End")
 * and a power cut, so "the file exists" cannot mean "an agent runs". A lock is
 * LIVE only when ALL of these hold:
 *
 *   - the recorded PID is alive and is not our own PID (kill(pid, 0)), and
 *   - the lock was refreshed recently (mtime within LOCK_STALE_MS).
 *
 * The second condition is what makes this survive reboots: Windows reuses PIDs,
 * so after a power cut the stale lock's PID can belong to an unrelated process
 * by the time the BootTrigger starts the agent. A live holder touches the file
 * every LOCK_HEARTBEAT_MS; a lock that old after a reboot is never "fresh".
 * (Fast Startup keeps os.uptime() running across a shutdown, so boot time is no
 * usable signal; wall-clock file age is.)
 *
 * Self-fencing. The heartbeat also re-reads the file and compares the token. If
 * another process took the lock over (this one was frozen for longer than
 * LOCK_STALE_MS), `onLost` fires and the agent exits at once instead of running
 * two agents side by side.
 *
 * Residual race: two processes that both find the SAME stale lock in the same
 * millisecond can both take it over; the take-over re-checks the file token
 * right before deleting it and the winner re-reads its own token after
 * creating, which narrows the window to the interval between those two steps.
 * The supervisor serializes legitimate starts, so this only matters for a
 * manual start racing the service on a stale lock.
 */

export const EXIT_LOCK_HELD = 75;
export const LOCK_STALE_MS = 60_000;
export const LOCK_HEARTBEAT_MS = 15_000;
/**
 * Errors that mean "somebody else has the file open right now" (antivirus,
 * backup, indexer), not "the lock is gone". They never end the agent by
 * themselves.
 */
export const TRANSIENT_LOCK_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"]);
/** Give up on an unreadable lock file only after it stayed unreadable this long. */
export const LOCK_TRANSIENT_GIVE_UP_MS = 10 * 60_000;

export interface LockInfo {
  pid: number;
  /** ISO timestamp of when the holder acquired the lock. */
  startedAt: string;
  token: string;
}

export interface LockEnv {
  pid?: number;
  now?: () => number;
  isPidAlive?: (pid: number) => boolean;
}

export type LockState =
  | { state: "none" }
  | {
      state: "live";
      holder: { pid: number | null; startedAt: string | null };
      ageMs: number;
    }
  | { state: "stale"; reason: string; token: string | null };

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone we cannot signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockPath(dir: string, name: string): string {
  return join(dir, name);
}

function readLock(path: string): { info: LockInfo | null; mtimeMs: number } | null {
  let raw: string;
  let mtimeMs: number;
  try {
    raw = readFileSync(path, "utf8");
    mtimeMs = statSync(path).mtimeMs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LockInfo>;
    if (
      typeof parsed.pid === "number" &&
      Number.isInteger(parsed.pid) &&
      parsed.pid > 0 &&
      typeof parsed.token === "string"
    ) {
      return {
        info: {
          pid: parsed.pid,
          startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
          token: parsed.token,
        },
        mtimeMs,
      };
    }
  } catch {
    // Unparseable: a holder that is mid-creation (file created, content not yet
    // written) looks like this for a few microseconds.
  }
  return { info: null, mtimeMs };
}

/** Classify the lock without touching it. */
export function inspectLock(
  dir: string,
  name = "agent.lock",
  env: LockEnv = {}
): LockState {
  const ownPid = env.pid ?? process.pid;
  const now = env.now ?? Date.now;
  const alive = env.isPidAlive ?? defaultIsPidAlive;
  const found = readLock(lockPath(dir, name));
  if (!found) return { state: "none" };
  const ageMs = Math.max(0, now() - found.mtimeMs);
  if (!found.info) {
    return ageMs < LOCK_STALE_MS
      ? { state: "live", holder: { pid: null, startedAt: null }, ageMs }
      : { state: "stale", reason: "unreadable and old", token: null };
  }
  const { info } = found;
  if (info.pid === ownPid) {
    return { state: "stale", reason: "recorded by this very process", token: info.token };
  }
  if (!alive(info.pid)) {
    return { state: "stale", reason: `process ${info.pid} is not running`, token: info.token };
  }
  if (ageMs >= LOCK_STALE_MS) {
    return {
      state: "stale",
      reason: `process ${info.pid} exists but has not refreshed the lock for ${Math.round(ageMs / 1000)}s`,
      token: info.token,
    };
  }
  return {
    state: "live",
    holder: { pid: info.pid, startedAt: info.startedAt || null },
    ageMs,
  };
}

export interface InstanceLock {
  readonly path: string;
  readonly token: string;
  /** Remove the lock file if it is still ours. Idempotent, never throws. */
  releaseSync(): void;
  /** Refresh mtime periodically and detect a takeover; unref'd timer. */
  startHeartbeat(onLost: (reason: string) => void): void;
  stopHeartbeat(): void;
}

export type AcquireResult =
  | { acquired: true; lock: InstanceLock; tookOverStale?: string }
  | {
      acquired: false;
      holder: { pid: number | null; startedAt: string | null };
      ageMs: number;
    };

export interface AcquireOptions extends LockEnv {
  dir: string;
  name?: string;
  heartbeatMs?: number;
  /** Where transient-error notes go (default console.warn). */
  log?: (message: string) => void;
  /** Test seam: replaces the lock-file read of the periodic check. */
  readLockFn?: (path: string) => ReturnType<typeof readLock>;
}

export function acquireInstanceLock(opts: AcquireOptions): AcquireResult {
  const name = opts.name ?? "agent.lock";
  const ownPid = opts.pid ?? process.pid;
  const now = opts.now ?? Date.now;
  const path = lockPath(opts.dir, name);
  mkdirSync(opts.dir, { recursive: true });

  const token = randomBytes(8).toString("hex");
  const body = JSON.stringify({
    pid: ownPid,
    startedAt: new Date(now()).toISOString(),
    token,
  } satisfies LockInfo);

  let tookOverStale: string | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, body);
      } finally {
        closeSync(fd);
      }
      // Confirm the file really carries our token (a racing take-over could
      // have replaced it between our create and now).
      const verify = readLock(path);
      if (verify?.info?.token !== token) continue;
      return {
        acquired: true,
        lock: makeLock(path, token, opts.heartbeatMs ?? LOCK_HEARTBEAT_MS, now, {
          log: opts.log ?? ((m) => console.warn(m)),
          read: opts.readLockFn ?? readLock,
        }),
        ...(tookOverStale ? { tookOverStale } : {}),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }

    const state = inspectLock(opts.dir, name, { pid: ownPid, now, isPidAlive: opts.isPidAlive });
    if (state.state === "live") {
      return { acquired: false, holder: state.holder, ageMs: state.ageMs };
    }
    if (state.state === "stale") {
      // Re-check right before deleting: if the token changed, someone else just
      // took the lock over and it is theirs now.
      const again = readLock(path);
      if ((again?.info?.token ?? null) !== state.token) continue;
      try {
        unlinkSync(path);
        tookOverStale = state.reason;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    // state "none" (vanished) or stale-and-removed: try to create again.
  }
  // Could not settle after several rounds: report whoever holds it now.
  const finalState = inspectLock(opts.dir, name, { pid: ownPid, now, isPidAlive: opts.isPidAlive });
  return {
    acquired: false,
    holder:
      finalState.state === "live"
        ? finalState.holder
        : { pid: null, startedAt: null },
    ageMs: finalState.state === "live" ? finalState.ageMs : 0,
  };
}

function makeLock(
  path: string,
  token: string,
  heartbeatMs: number,
  now: () => number,
  hooks: { log: (message: string) => void; read: typeof readLock }
): InstanceLock {
  let timer: NodeJS.Timeout | null = null;
  let released = false;
  // Start of the current run of consecutive transient read failures.
  let transientSince: number | null = null;
  let transientLogged = false;

  const stillOurs = (): boolean => {
    try {
      return readLock(path)?.info?.token === token;
    } catch {
      return false;
    }
  };

  /**
   * Periodic check. "lost" only when the file is gone or carries another
   * token (a successor wrote it), or when it stayed unreadable for
   * LOCK_TRANSIENT_GIVE_UP_MS. A short EBUSY/EPERM/EACCES is ignored.
   */
  const checkOwnership = (): "ours" | "lost" | "transient" => {
    try {
      const found = hooks.read(path);
      transientSince = null;
      return found?.info?.token === token ? "ours" : "lost";
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (!TRANSIENT_LOCK_ERRORS.has(code)) return "lost";
      const t = now();
      if (transientSince === null) transientSince = t;
      if (!transientLogged) {
        transientLogged = true;
        hooks.log(
          `[agent] instance lock file temporarily unreadable (${code}); probably antivirus or backup. Still treating the lock as ours; will give up only if this lasts ${Math.round(LOCK_TRANSIENT_GIVE_UP_MS / 60_000)} minutes.`
        );
      }
      return t - transientSince >= LOCK_TRANSIENT_GIVE_UP_MS ? "lost" : "transient";
    }
  };

  return {
    path,
    token,
    releaseSync() {
      if (released) return;
      released = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      try {
        if (stillOurs()) unlinkSync(path);
      } catch {
        // Already gone or unremovable: nothing more a shutdown path can do.
      }
    },
    startHeartbeat(onLost) {
      if (timer || released) return;
      timer = setInterval(() => {
        if (released) return;
        const ownership = checkOwnership();
        if (ownership === "transient") return;
        if (ownership === "lost") {
          if (timer) {
            clearInterval(timer);
            timer = null;
          }
          onLost(
            transientSince !== null
              ? "the instance lock file could not be read for 10 minutes (EBUSY/EPERM/EACCES); treating the lock as lost"
              : "the instance lock was taken over or removed; another agent is running against this data directory"
          );
          return;
        }
        try {
          const t = new Date(now());
          utimesSync(path, t, t);
        } catch {
          // A transient failure to touch the file is retried next tick; if it
          // persists the lock goes stale and a successor takes over, which the
          // token check above then reports.
        }
      }, heartbeatMs);
      timer.unref();
    },
    stopHeartbeat() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/** German + English text for "another agent holds the lock". */
export function describeLockHolder(
  holder: { pid: number | null; startedAt: string | null },
  lockFile: string
): string {
  const who =
    holder.pid !== null
      ? `PID ${holder.pid}${holder.startedAt ? `, gestartet ${holder.startedAt}` : ""}`
      : "PID unbekannt";
  const whoEn =
    holder.pid !== null
      ? `PID ${holder.pid}${holder.startedAt ? `, started ${holder.startedAt}` : ""}`
      : "PID unknown";
  return (
    `Ein anderer EINS-Agent läuft bereits für diesen Datenordner (${who}). ` +
    `Dieser Start wird beendet. Falls sicher kein Agent läuft, die Datei ${lockFile} löschen. ` +
    `/ Another EINS agent is already running against this data directory (${whoEn}); exiting. ` +
    `If you are certain none is running, delete ${lockFile}.`
  );
}
