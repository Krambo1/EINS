import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  BACKOFF_RESET_AFTER_MS,
  SHUTDOWN_MESSAGE_TYPE,
  STDIO_DRAIN_MS,
  STOP_GRACE_MS,
  buildChildArgs,
  nextBackoffMs,
  startSupervisor,
} from "./supervisor.js";

describe("constants", () => {
  it("2 s doubling to 60 s, reset after 10 min up, 10 s stop grace", () => {
    expect(BACKOFF_INITIAL_MS).toBe(2_000);
    expect(BACKOFF_MAX_MS).toBe(60_000);
    expect(BACKOFF_RESET_AFTER_MS).toBe(600_000);
    expect(STOP_GRACE_MS).toBe(10_000);
  });
});

describe("nextBackoffMs", () => {
  it("starts at 2 s and doubles up to the 60 s cap", () => {
    const seq: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < 8; i++) {
      prev = nextBackoffMs(prev, 1_000);
      seq.push(prev);
    }
    expect(seq).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("resets to 2 s once the child stayed up 10 minutes", () => {
    expect(nextBackoffMs(60_000, BACKOFF_RESET_AFTER_MS)).toBe(2_000);
    expect(nextBackoffMs(32_000, BACKOFF_RESET_AFTER_MS + 1)).toBe(2_000);
  });

  it("does not reset just below 10 minutes", () => {
    expect(nextBackoffMs(8_000, BACKOFF_RESET_AFTER_MS - 1)).toBe(16_000);
  });

  it("exit code 75 (another agent holds the lock) waits the maximum", () => {
    expect(nextBackoffMs(null, 100, 75)).toBe(60_000);
    expect(nextBackoffMs(2_000, 100, 75)).toBe(60_000);
  });

  it("other exit codes (including the crash code 70) follow the normal curve", () => {
    expect(nextBackoffMs(null, 100, 70)).toBe(2_000);
    expect(nextBackoffMs(2_000, 100, 1)).toBe(4_000);
  });
});

describe("buildChildArgs", () => {
  it("drops --supervise and keeps everything else in order", () => {
    expect(buildChildArgs(["--supervise"])).toEqual([]);
    expect(buildChildArgs(["--supervise", "--foo", "bar"])).toEqual(["--foo", "bar"]);
    expect(buildChildArgs(["--foo", "--supervise", "bar"])).toEqual(["--foo", "bar"]);
  });
});

// ---------------------------------------------------------------------------

class FakeChild extends EventEmitter {
  pid: number;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  sent: unknown[] = [];
  killed: string[] = [];
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  send(msg: unknown): boolean {
    this.sent.push(msg);
    return true;
  }
  kill(signal?: string): boolean {
    this.killed.push(signal ?? "SIGTERM");
    return true;
  }
  /** Process ended and its stdio drained: Node emits "exit" then "close". */
  exit(code: number | null, signal: string | null = null): void {
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
  /** Process ended but a pipe is still open (no "close" yet). */
  exitOnly(code: number | null): void {
    this.emit("exit", code, null);
  }
}

interface Rig {
  children: FakeChild[];
  spawnCalls: Array<{ command: string; args: string[]; options: SpawnOptions }>;
  logs: string[];
  childLogs: string[];
  clock: { t: number };
  signals: EventEmitter;
  start: (over?: Partial<Parameters<typeof startSupervisor>[0]>) => ReturnType<typeof startSupervisor>;
}

function rig(): Rig {
  const children: FakeChild[] = [];
  const spawnCalls: Rig["spawnCalls"] = [];
  const logs: string[] = [];
  const childLogs: string[] = [];
  const clock = { t: 1_000_000 };
  const signals = new EventEmitter();
  const start: Rig["start"] = (over = {}) =>
    startSupervisor({
      nodePath: "C:\\Program Files\\EINS-Agent\\node.exe",
      execArgv: [],
      scriptPath: "C:\\Program Files\\EINS-Agent\\dist\\index.js",
      childArgs: [],
      log: (l) => logs.push(l),
      childLog: (l) => childLogs.push(l),
      env: { PATH: "x" },
      now: () => clock.t,
      platform: "win32",
      signalTarget: signals as unknown as NodeJS.Process,
      spawnFn: (command, args, options) => {
        const c = new FakeChild(1000 + children.length);
        children.push(c);
        spawnCalls.push({ command, args, options });
        return c as unknown as ChildProcess;
      },
      ...over,
    });
  return { children, spawnCalls, logs, childLogs, clock, signals, start };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("startSupervisor: launching", () => {
  it("spawns the normal mode: same node, the script, child args, supervised env, IPC channel, hidden", () => {
    const r = rig();
    const h = r.start({ execArgv: ["--max-old-space-size=512"], childArgs: ["--foo"] });
    expect(r.spawnCalls).toHaveLength(1);
    const call = r.spawnCalls[0]!;
    expect(call.command).toBe("C:\\Program Files\\EINS-Agent\\node.exe");
    expect(call.args).toEqual([
      "--max-old-space-size=512",
      "C:\\Program Files\\EINS-Agent\\dist\\index.js",
      "--foo",
    ]);
    expect(call.args).not.toContain("--supervise");
    expect(call.options.stdio).toEqual(["ignore", "pipe", "pipe", "ipc"]);
    expect(call.options.windowsHide).toBe(true);
    expect((call.options.env as Record<string, string>).EINS_AGENT_SUPERVISED).toBe("1");
    expect((call.options.env as Record<string, string>).PATH).toBe("x");
    void h.stop("test");
  });

  it("forwards stdout and stderr to the log as whole lines", () => {
    const r = rig();
    const h = r.start();
    const c = r.children[0]!;
    c.stdout.emit("data", Buffer.from("[agent] started\npartial"));
    c.stdout.emit("data", Buffer.from(" line\n"));
    c.stderr.emit("data", Buffer.from("error line\r\n"));
    expect(r.childLogs).toEqual(["[agent] started", "partial line", "error line"]);
    void h.stop("test");
  });
});

describe("startSupervisor: restart with backoff", () => {
  it("restarts after 2 s, then 4 s, then 8 s while the child keeps dying quickly", () => {
    const r = rig();
    const h = r.start();
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = r.children.length;
      r.children[before - 1]!.exit(1);
      // Not restarted yet.
      expect(r.children).toHaveLength(before);
      const expected = [2_000, 4_000, 8_000][i]!;
      vi.advanceTimersByTime(expected - 1);
      expect(r.children).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(r.children).toHaveLength(before + 1);
      delays.push(expected);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000]);
    expect(r.logs.filter((l) => /restarting in/.test(l))).toHaveLength(3);
    void h.stop("test");
  });

  it("caps at 60 s", () => {
    const r = rig();
    const h = r.start();
    for (let i = 0; i < 10; i++) {
      r.children.at(-1)!.exit(1);
      vi.advanceTimersByTime(60_000);
    }
    const last = r.logs.filter((l) => /restarting in/.test(l)).at(-1)!;
    expect(last).toMatch(/restarting in 60s/);
    void h.stop("test");
  });

  it("resets to 2 s after a child that ran 10 minutes", () => {
    const r = rig();
    const h = r.start();
    // Two quick failures push the delay to 4 s.
    r.children[0]!.exit(1);
    vi.advanceTimersByTime(2_000);
    r.children[1]!.exit(1);
    vi.advanceTimersByTime(4_000);
    // The third child runs for ten minutes.
    r.clock.t += BACKOFF_RESET_AFTER_MS;
    r.children[2]!.exit(1);
    expect(r.logs.at(-1)).toMatch(/restarting in 2s/);
    vi.advanceTimersByTime(2_000);
    expect(r.children).toHaveLength(4);
    void h.stop("test");
  });

  it("exit 75 (lock held by another agent) backs off the full 60 s", () => {
    const r = rig();
    const h = r.start();
    r.children[0]!.exit(75);
    expect(r.logs.at(-1)).toMatch(/restarting in 60s/);
    void h.stop("test");
  });

  it("a spawn that throws is logged and retried with backoff, not fatal", () => {
    const r = rig();
    let calls = 0;
    const h = r.start({
      spawnFn: () => {
        calls++;
        if (calls === 1) throw new Error("spawn EACCES");
        const c = new FakeChild(1);
        r.children.push(c);
        return c as unknown as ChildProcess;
      },
    });
    expect(r.logs.some((l) => /could not start the agent: spawn EACCES/.test(l))).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(calls).toBe(2);
    void h.stop("test");
  });

  it("a child that errors without ever getting a pid counts as gone and is retried", () => {
    const r = rig();
    const h = r.start({
      spawnFn: () => {
        const c = new FakeChild(0);
        (c as unknown as { pid: undefined }).pid = undefined;
        r.children.push(c);
        setTimeout(() => c.emit("error", new Error("ENOENT node.exe")), 0);
        return c as unknown as ChildProcess;
      },
    });
    vi.advanceTimersByTime(0);
    expect(r.logs.some((l) => /agent process error: ENOENT/.test(l))).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(r.children.length).toBeGreaterThanOrEqual(2);
    void h.stop("test");
  });

  it("keeps the last words of a dying child: output that arrives after 'exit' is logged before the restart is scheduled", () => {
    const r = rig();
    const h = r.start();
    const c = r.children[0]!;
    c.exitOnly(70);
    // The FATAL line is still in the pipe when "exit" fires.
    c.stderr.emit("data", Buffer.from("[agent] FATAL uncaughtException: boom\n"));
    c.emit("close", 70, null);
    expect(r.childLogs).toEqual(["[agent] FATAL uncaughtException: boom"]);
    expect(r.logs.some((l) => /agent exited \(code 70\)/.test(l))).toBe(true);
    void h.stop("test");
  });

  it("does not wait forever for a pipe that never closes: restarts after the drain timeout", () => {
    const r = rig();
    const h = r.start();
    r.children[0]!.exitOnly(1);
    expect(r.logs.some((l) => /agent exited/.test(l))).toBe(false);
    vi.advanceTimersByTime(STDIO_DRAIN_MS);
    expect(r.logs.some((l) => /agent exited \(code 1\)/.test(l))).toBe(true);
    vi.advanceTimersByTime(2_000);
    expect(r.children).toHaveLength(2);
    void h.stop("test");
  });

  it("'exit' reported twice (exit + error) restarts only once", () => {
    const r = rig();
    const h = r.start();
    r.children[0]!.exit(1);
    r.children[0]!.exit(1);
    vi.advanceTimersByTime(2_000);
    expect(r.children).toHaveLength(2);
    void h.stop("test");
  });
});

describe("startSupervisor: stopping", () => {
  it("asks the child to shut down by IPC message, waits for it, resolves 0 and does not restart", async () => {
    const r = rig();
    const h = r.start();
    const stopping = h.stop("service stop");
    expect(r.children[0]!.sent).toEqual([{ type: SHUTDOWN_MESSAGE_TYPE }]);
    // Windows: no SIGTERM (it would be TerminateProcess and skip the clean shutdown).
    expect(r.children[0]!.killed).toEqual([]);
    r.children[0]!.exit(0);
    await stopping;
    await expect(h.done).resolves.toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(r.children).toHaveLength(1);
  });

  it("on POSIX it also sends SIGTERM", async () => {
    const r = rig();
    const h = r.start({ platform: "linux" });
    const stopping = h.stop("SIGTERM");
    expect(r.children[0]!.killed).toEqual(["SIGTERM"]);
    r.children[0]!.exit(0);
    await stopping;
  });

  it("kills the child after the grace period if it does not exit", async () => {
    const r = rig();
    const h = r.start();
    const stopping = h.stop("service stop");
    vi.advanceTimersByTime(STOP_GRACE_MS - 1);
    expect(r.children[0]!.killed).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(r.children[0]!.killed).toEqual(["SIGKILL"]);
    expect(r.logs.some((l) => /did not stop within 10s; killing it/.test(l))).toBe(true);
    r.children[0]!.exit(null, "SIGKILL");
    await stopping;
    await expect(h.done).resolves.toBe(0);
  });

  it("does not hang forever if even the kill produces no exit event", async () => {
    const r = rig();
    const h = r.start();
    const stopping = h.stop("service stop");
    vi.advanceTimersByTime(STOP_GRACE_MS);
    vi.advanceTimersByTime(3_000);
    await stopping;
    await expect(h.done).resolves.toBe(0);
  });

  it("stopping while waiting to restart ends immediately and never spawns again", async () => {
    const r = rig();
    const h = r.start();
    r.children[0]!.exit(1); // backoff timer armed
    await h.stop("service stop");
    vi.advanceTimersByTime(120_000);
    expect(r.children).toHaveLength(1);
    await expect(h.done).resolves.toBe(0);
  });

  it("is idempotent: a second stop() sends no second message and shares the result", async () => {
    const r = rig();
    const h = r.start();
    const a = h.stop("one");
    const b = h.stop("two");
    expect(r.children[0]!.sent).toHaveLength(1);
    r.children[0]!.exit(0);
    await Promise.all([a, b]);
  });

  it("a closed IPC channel while stopping does not throw", async () => {
    const r = rig();
    const h = r.start();
    r.children[0]!.send = () => {
      throw new Error("channel closed");
    };
    const stopping = h.stop("service stop");
    r.children[0]!.exit(0);
    await expect(stopping).resolves.toBeUndefined();
  });
});

describe("startSupervisor: signals", () => {
  it("SIGINT, SIGTERM and SIGBREAK each stop the supervisor gracefully", async () => {
    for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
      const r = rig();
      const h = r.start();
      r.signals.emit(sig);
      expect(r.children[0]!.sent).toEqual([{ type: SHUTDOWN_MESSAGE_TYPE }]);
      expect(r.logs.some((l) => l.includes(`stopping (${sig})`))).toBe(true);
      r.children[0]!.exit(0);
      await expect(h.done).resolves.toBe(0);
    }
  });

  it("registers exactly those three handlers and removes them when finished", async () => {
    const r = rig();
    const h = r.start();
    expect(r.signals.listenerCount("SIGINT")).toBe(1);
    expect(r.signals.listenerCount("SIGTERM")).toBe(1);
    expect(r.signals.listenerCount("SIGBREAK")).toBe(1);
    const stopping = h.stop("x");
    r.children[0]!.exit(0);
    await stopping;
    expect(r.signals.listenerCount("SIGINT")).toBe(0);
    expect(r.signals.listenerCount("SIGTERM")).toBe(0);
    expect(r.signals.listenerCount("SIGBREAK")).toBe(0);
  });
});

describe("startSupervisor: never gives up on a failing child", () => {
  it("keeps restarting after hundreds of consecutive failures, each logged with its exit code", () => {
    const r = rig();
    const h = r.start();
    const codes = [1, 70, 75, 3221225477, null];
    for (let i = 0; i < 300; i++) {
      r.children.at(-1)!.exit(codes[i % codes.length] as number | null);
      vi.advanceTimersByTime(60_000);
    }
    expect(r.children).toHaveLength(301);
    const restarts = r.logs.filter((l) => /restarting in/.test(l));
    expect(restarts).toHaveLength(300);
    // Every restart line names the exit code of the child that just died.
    expect(restarts[0]).toMatch(/exit code 1\b/);
    expect(restarts[1]).toMatch(/exit code 70\b/);
    expect(restarts[2]).toMatch(/exit code 75\b/);
    expect(restarts[4]).toMatch(/exit code none/);
    expect(restarts[299]).toMatch(/restart #300\b/);
    void h.stop("test");
  });

  it("a spawn that throws every time is retried forever with the capped delay", () => {
    const r = rig();
    const h = r.start({
      spawnFn: () => {
        throw new Error("EACCES node.exe");
      },
    });
    for (let i = 0; i < 100; i++) vi.advanceTimersByTime(60_000);
    const restarts = r.logs.filter((l) => /restarting in/.test(l));
    expect(restarts.length).toBeGreaterThan(90);
    expect(restarts.at(-1)).toMatch(/restarting in 60s/);
    void h.stop("test");
  });
});
