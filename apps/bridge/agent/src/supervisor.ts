import {
  spawn as nodeSpawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { installCrashHandlers } from "./crash-handlers.js";
import {
  EXIT_LOCK_HELD,
  acquireInstanceLock,
  describeLockHolder,
} from "./instance-lock.js";
import { createLineSplitter, createRotatingLog } from "./rotating-log.js";

/**
 * `eins-agent --supervise`: a small parent process that keeps the agent's
 * normal run mode alive. node.exe cannot be a native Windows service, so the
 * scheduled task (service-windows.ts) starts THIS, and this starts the agent.
 *
 *   - restarts the child whenever it exits, with a growing delay (2 s doubling
 *     to 60 s, back to 2 s once a child has stayed up 10 minutes), so a crash
 *     loop cannot spin the CPU or flood the log;
 *   - sends the child's stdout/stderr to logs/agent.log with a timestamp per
 *     line and size rotation (rotating-log.ts);
 *   - on SIGINT / SIGTERM / SIGBREAK asks the child to shut down gracefully,
 *     waits up to 10 s, then kills it.
 *
 * Graceful stop on Windows. Node implements child.kill(<any signal>) as
 * TerminateProcess there, i.e. there is no "forward SIGTERM so the child can
 * clean up". The child is therefore spawned with an IPC channel and asked to
 * stop with a message; the child's own handler runs the same clean shutdown
 * as for SIGTERM (finish the flush, close the outbox). If it does not exit
 * within the grace period it is killed. Conversely, if THIS process dies, the
 * IPC channel closes and the child shuts itself down, so the supervisor being
 * hard-killed does not leave an orphaned agent running.
 */

export const BACKOFF_INITIAL_MS = 2_000;
export const BACKOFF_MAX_MS = 60_000;
export const BACKOFF_RESET_AFTER_MS = 10 * 60_000;
export const STOP_GRACE_MS = 10_000;
/** After 'exit', how long to wait for the child's stdio to drain ('close'). */
export const STDIO_DRAIN_MS = 1_000;
/** IPC message that asks the child to run its graceful shutdown. */
export const SHUTDOWN_MESSAGE_TYPE = "eins-shutdown";

/**
 * Delay before the next restart.
 *
 *   first failure / child was up >= 10 min  -> 2 s
 *   otherwise                               -> previous delay doubled, max 60 s
 *   child refused to start (exit 75, another agent holds the lock) -> 60 s
 */
export function nextBackoffMs(
  prevDelayMs: number | null,
  uptimeMs: number,
  exitCode?: number | null
): number {
  if (exitCode === EXIT_LOCK_HELD) return BACKOFF_MAX_MS;
  if (prevDelayMs === null || uptimeMs >= BACKOFF_RESET_AFTER_MS) {
    return BACKOFF_INITIAL_MS;
  }
  return Math.min(prevDelayMs * 2, BACKOFF_MAX_MS);
}

/** The child's argv: ours without --supervise (it must run the normal mode). */
export function buildChildArgs(argv: string[]): string[] {
  return argv.filter((a) => a !== "--supervise");
}

type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

export interface SupervisorOptions {
  nodePath: string;
  execArgv: string[];
  scriptPath: string;
  childArgs: string[];
  /** The supervisor's own messages (already without timestamp). */
  log: (line: string) => void;
  /** One line of child output. */
  childLog: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  spawnFn?: SpawnFn;
  now?: () => number;
  stopGraceMs?: number;
  platform?: NodeJS.Platform;
  signalTarget?: Pick<NodeJS.Process, "on" | "removeListener">;
}

export interface SupervisorHandle {
  /** Ask the child to stop and end supervision. Idempotent. */
  stop(reason: string): Promise<void>;
  /** Resolves with the supervisor's exit code (0) once the child is gone. */
  done: Promise<number>;
}

export function startSupervisor(opts: SupervisorOptions): SupervisorHandle {
  const spawnFn: SpawnFn = opts.spawnFn ?? ((c, a, o) => nodeSpawn(c, a, o));
  const now = opts.now ?? Date.now;
  const platform = opts.platform ?? process.platform;
  const graceMs = opts.stopGraceMs ?? STOP_GRACE_MS;
  const signalTarget = opts.signalTarget ?? process;

  let child: ChildProcess | null = null;
  let stopping = false;
  let restartTimer: NodeJS.Timeout | null = null;
  let graceTimer: NodeJS.Timeout | null = null;
  let hardTimer: NodeJS.Timeout | null = null;
  let prevDelay: number | null = null;
  let restartCount = 0;
  let finished = false;
  let resolveDone!: (code: number) => void;
  const done = new Promise<number>((r) => (resolveDone = r));

  const signalHandlers: Array<[string, () => void]> = [];

  const finish = (): void => {
    if (finished) return;
    finished = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (graceTimer) clearTimeout(graceTimer);
    if (hardTimer) clearTimeout(hardTimer);
    for (const [sig, fn] of signalHandlers) {
      signalTarget.removeListener(sig, fn);
    }
    resolveDone(0);
  };

  const scheduleRestart = (startedAt: number, exitCode: number | null): void => {
    const uptime = now() - startedAt;
    const delay = nextBackoffMs(prevDelay, uptime, exitCode);
    prevDelay = delay;
    restartCount++;
    // The supervisor never gives up on a failing child: a PC nobody looks at
    // for months must come back by itself once the cause (full disk, locked
    // file, bad update) is gone.
    opts.log(
      `[supervisor] agent ran ${Math.round(uptime / 1000)}s (exit code ${exitCode ?? "none"}); ` +
        `restarting in ${Math.round(delay / 1000)}s (restart #${restartCount})`
    );
    restartTimer = setTimeout(() => {
      restartTimer = null;
      launch();
    }, delay);
  };

  const launch = (): void => {
    if (stopping) return;
    const startedAt = now();
    let c: ChildProcess;
    try {
      c = spawnFn(opts.nodePath, [...opts.execArgv, opts.scriptPath, ...opts.childArgs], {
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
        env: { ...(opts.env ?? process.env), EINS_AGENT_SUPERVISED: "1" },
      });
    } catch (err) {
      opts.log(`[supervisor] could not start the agent: ${(err as Error).message}`);
      scheduleRestart(startedAt, null);
      return;
    }
    child = c;
    opts.log(`[supervisor] started agent (pid ${c.pid ?? "unknown"})`);

    const outLines = createLineSplitter(opts.childLog);
    const errLines = createLineSplitter(opts.childLog);
    c.stdout?.on("data", (d: Buffer | string) => outLines.push(d));
    c.stderr?.on("data", (d: Buffer | string) => errLines.push(d));
    c.stdout?.on("end", () => outLines.flush());
    c.stderr?.on("end", () => errLines.flush());

    let gone = false;
    const onGone = (code: number | null, signal: string | null): void => {
      if (gone) return;
      gone = true;
      outLines.flush();
      errLines.flush();
      child = null;
      opts.log(
        `[supervisor] agent exited (code ${code ?? "none"}${signal ? `, signal ${signal}` : ""})`
      );
      if (stopping) {
        finish();
        return;
      }
      scheduleRestart(startedAt, code);
    };
    // 'exit' can fire before the child's last stdout/stderr has been read, and
    // the last thing a crashing child writes (the FATAL line with its stack) is
    // exactly what must reach the log. So wait for 'close' (stdio drained), but
    // never longer than STDIO_DRAIN_MS: a grandchild that inherited the pipes
    // could otherwise delay it indefinitely.
    let drainTimer: NodeJS.Timeout | null = null;
    c.on("exit", (code, signal) => {
      if (gone || drainTimer) return;
      drainTimer = setTimeout(() => onGone(code, signal), STDIO_DRAIN_MS);
    });
    c.on("close", (code, signal) => {
      if (drainTimer) {
        clearTimeout(drainTimer);
        drainTimer = null;
      }
      onGone(code, signal);
    });
    c.on("error", (err) => {
      opts.log(`[supervisor] agent process error: ${err.message}`);
      // A failed spawn (no pid) never emits 'exit'; treat it as gone.
      if (c.pid === undefined) onGone(null, null);
    });
  };

  const stop = async (reason: string): Promise<void> => {
    if (!stopping) {
      stopping = true;
      opts.log(`[supervisor] stopping (${reason})`);
      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
      }
      const c = child;
      if (!c) {
        finish();
      } else {
        try {
          c.send?.({ type: SHUTDOWN_MESSAGE_TYPE });
        } catch {
          // IPC channel already closed: the child is going away anyway.
        }
        if (platform !== "win32") {
          try {
            c.kill("SIGTERM");
          } catch {
            // already gone
          }
        }
        graceTimer = setTimeout(() => {
          opts.log(
            `[supervisor] agent did not stop within ${Math.round(graceMs / 1000)}s; killing it`
          );
          try {
            c.kill("SIGKILL");
          } catch {
            // already gone
          }
          // If even the kill produces no exit event, do not hang forever.
          hardTimer = setTimeout(finish, 3_000);
        }, graceMs);
      }
    }
    await done;
  };

  for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
    const fn = (): void => void stop(sig);
    signalHandlers.push([sig, fn]);
    signalTarget.on(sig as NodeJS.Signals, fn);
  }

  launch();
  return { stop, done };
}

export interface SuperviseMainOptions {
  dataDir: string;
  scriptPath: string;
  /** process.argv.slice(2) of the supervisor. */
  argv: string[];
  nodePath?: string;
  execArgv?: string[];
  interactive?: boolean;
  /**
   * Startup checks (runtime/ABI check, data dir creation + ACL). Runs with the
   * log open and the crash handlers installed, so a failure is written to
   * agent.log. A throw ends supervision with exit code 2.
   */
  prepare?: () => Promise<void>;
  /** Test seams. */
  spawnFn?: SpawnFn;
  signalTarget?: Pick<NodeJS.Process, "on" | "removeListener">;
  crashTarget?: Pick<NodeJS.Process, "on" | "removeListener">;
  crashExit?: (code: number) => void;
}

/** True when `dir` is already a real directory (not a link): safe to log into. */
function isRealDirectory(dir: string): boolean {
  try {
    const st = lstatSync(dir);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Entry point used by index.ts: take the supervisor lock, open the rotating
 * log, run until stopped. Resolves with the process exit code.
 */
export async function superviseMain(opts: SuperviseMainOptions): Promise<number> {
  let prepared = false;
  const runPrepare = async (): Promise<unknown> => {
    prepared = true;
    try {
      await opts.prepare?.();
      return null;
    } catch (err) {
      return err ?? new Error("startup check failed");
    }
  };
  const failText = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

  // The data dir may not exist yet on a first start. Creating the log dir
  // inside it would happen before the ACL lockdown (and as a possibly
  // unprivileged user), so in that case prepare() creates and hardens the
  // directory first; only then is there anywhere to log to.
  if (opts.prepare && !isRealDirectory(opts.dataDir)) {
    const err = await runPrepare();
    if (err) {
      console.error(`[supervisor] startup failed: ${failText(err)}`);
      return 2;
    }
  }

  const logDir = join(opts.dataDir, "logs");
  const log = createRotatingLog({
    dir: logDir,
    echo: opts.interactive ? (line) => console.log(line) : undefined,
  });

  let lockHandle: { releaseSync(): void } | null = null;
  // Uncaught errors and unhandled rejections reach agent.log (the SYSTEM task
  // has no console), then exit 70 so Task Scheduler starts a fresh supervisor.
  const removeCrashHandlers = installCrashHandlers({
    writeLine: (line) => {
      log.writeLine(line);
      try {
        console.error(line);
      } catch {
        // no console under a scheduled task
      }
    },
    releaseLock: () => lockHandle?.releaseSync(),
    timestamp: false,
    target: opts.crashTarget,
    exit: opts.crashExit,
  });

  if (opts.prepare && !prepared) {
    const err = await runPrepare();
    if (err) {
      log.writeLine(`[supervisor] startup failed: ${failText(err)}`);
      removeCrashHandlers();
      log.close();
      return 2;
    }
  }

  const lock = acquireInstanceLock({ dir: opts.dataDir, name: "supervisor.lock" });
  if (!lock.acquired) {
    log.writeLine(
      `[supervisor] ${describeLockHolder(lock.holder, join(opts.dataDir, "supervisor.lock"))}`
    );
    removeCrashHandlers();
    log.close();
    return EXIT_LOCK_HELD;
  }
  lockHandle = lock.lock;
  const releaseOnExit = (): void => lock.lock.releaseSync();
  process.on("exit", releaseOnExit);
  if (lock.tookOverStale) {
    log.writeLine(`[supervisor] took over a stale supervisor lock (${lock.tookOverStale})`);
  }
  lock.lock.startHeartbeat((reason) => {
    log.writeLine(`[supervisor] ${reason}; exiting.`);
    process.exit(EXIT_LOCK_HELD);
  });

  log.writeLine(
    `[supervisor] starting (node ${process.version}, pid ${process.pid}); log: ${log.path}`
  );
  const handle = startSupervisor({
    nodePath: opts.nodePath ?? process.execPath,
    execArgv: opts.execArgv ?? process.execArgv,
    scriptPath: opts.scriptPath,
    childArgs: buildChildArgs(opts.argv),
    log: (line) => log.writeLine(line),
    childLog: (line) => log.writeLine(line),
    spawnFn: opts.spawnFn,
    signalTarget: opts.signalTarget,
  });
  const code = await handle.done;
  lock.lock.releaseSync();
  process.removeListener("exit", releaseOnExit);
  log.writeLine("[supervisor] stopped");
  removeCrashHandlers();
  log.close();
  return code;
}
