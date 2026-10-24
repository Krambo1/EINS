import { writeSync } from "node:fs";

/**
 * Last-resort handlers for the long-running agent.
 *
 * An uncaught exception or unhandled rejection leaves the process in an unknown
 * state (half-updated module state, a watcher that stopped, a timer that never
 * re-arms), and the old behaviour for rejections was to keep running like that.
 * The agent instead logs the error WITH its stack, closes the outbox on a best
 * effort basis, and exits with code 70 so the supervisor (or the scheduled
 * task's restart-on-failure) starts a clean process. Server-side dedup absorbs
 * any event that is sent twice across the restart.
 *
 * The log write is a synchronous fs.writeSync on the stderr descriptor. With
 * stderr piped to the supervisor, an async console.error right before
 * process.exit() can be lost, and the crash line is the one a support person
 * needs most.
 */

export const EXIT_CODE_CRASH = 70;

export interface CrashHandlerDeps {
  /** Best-effort synchronous outbox close (outbox.ts closeOutbox). */
  closeOutbox?: () => void;
  /** Release the instance lock (instance-lock.ts releaseSync). */
  releaseLock?: () => void;
  /** Synchronous write of one finished log line to stderr. */
  writeLine?: (line: string) => void;
  exit?: (code: number) => void;
  now?: () => Date;
  /**
   * Prefix each line with an ISO timestamp. Off when supervised: the
   * supervisor already timestamps every child line, and two stamps are noise.
   */
  timestamp?: boolean;
  /** process-like target, injectable for tests. */
  target?: Pick<NodeJS.Process, "on" | "removeListener">;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? err.stack : `${err.name}: ${err.message}`;
  }
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** The exact text logged for a crash; exported for tests. */
export function formatCrashLine(
  kind: "uncaughtException" | "unhandledRejection",
  err: unknown,
  now: Date,
  withTimestamp: boolean
): string {
  const prefix = withTimestamp ? `${now.toISOString()} ` : "";
  return (
    `${prefix}[agent] FATAL ${kind}; exiting with code ${EXIT_CODE_CRASH} so the ` +
    `supervisor restarts a clean process: ${errorText(err)}`
  );
}

/** Install both handlers; returns a function that removes them. */
export function installCrashHandlers(deps: CrashHandlerDeps = {}): () => void {
  const target = deps.target ?? process;
  const now = deps.now ?? (() => new Date());
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const writeLine =
    deps.writeLine ??
    ((line: string) => {
      try {
        writeSync(2, `${line}\n`);
      } catch {
        console.error(line);
      }
    });
  const withTimestamp = deps.timestamp ?? true;
  let handling = false;

  const handle = (
    kind: "uncaughtException" | "unhandledRejection",
    err: unknown
  ): void => {
    if (handling) {
      // A second failure while already crashing (e.g. closing the outbox
      // throws): get out immediately.
      exit(EXIT_CODE_CRASH);
      return;
    }
    handling = true;
    try {
      writeLine(formatCrashLine(kind, err, now(), withTimestamp));
    } catch {
      // Logging must not prevent the exit.
    }
    try {
      deps.closeOutbox?.();
    } catch (closeErr) {
      try {
        writeLine(
          `${withTimestamp ? `${now().toISOString()} ` : ""}[agent] error closing outbox during crash: ${errorText(closeErr)}`
        );
      } catch {
        // ignore
      }
    }
    try {
      deps.releaseLock?.();
    } catch {
      // ignore: a stale lock is taken over by the next start
    }
    exit(EXIT_CODE_CRASH);
  };

  const onUncaught = (err: unknown): void => handle("uncaughtException", err);
  const onRejection = (reason: unknown): void => handle("unhandledRejection", reason);
  target.on("uncaughtException", onUncaught);
  target.on("unhandledRejection", onRejection);
  return () => {
    target.removeListener("uncaughtException", onUncaught);
    target.removeListener("unhandledRejection", onRejection);
  };
}
