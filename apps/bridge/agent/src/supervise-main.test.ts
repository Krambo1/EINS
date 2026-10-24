import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { superviseMain } from "./supervisor.js";

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "eins-supmain-"));
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const logText = (): string => {
  const p = join(dataDir, "logs", "agent.log");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

class FakeChild extends EventEmitter {
  pid = 4242;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  send(): boolean {
    return true;
  }
  kill(): boolean {
    return true;
  }
  exit(code: number): void {
    this.emit("exit", code, null);
    this.emit("close", code, null);
  }
}

function base() {
  const signals = new EventEmitter();
  const crash = new EventEmitter();
  const children: FakeChild[] = [];
  const exits: number[] = [];
  return {
    signals,
    crash,
    children,
    exits,
    opts: {
      dataDir,
      scriptPath: "C:\Program Files\EINS-Agent\dist\index.js",
      argv: ["--supervise"],
      nodePath: "C:\Program Files\EINS-Agent\node.exe",
      execArgv: [],
      signalTarget: signals as unknown as NodeJS.Process,
      crashTarget: crash as unknown as NodeJS.Process,
      crashExit: (code: number) => void exits.push(code),
      spawnFn: () => {
        const c = new FakeChild();
        children.push(c);
        return c as unknown as ChildProcess;
      },
    },
  };
}

describe("superviseMain: startup failures leave a trace in agent.log", () => {
  it("a failing preflight is written to agent.log and ends with exit code 2, without starting the agent", async () => {
    const b = base();
    const code = await superviseMain({
      ...b.opts,
      prepare: async () => {
        throw new Error("Laufzeit passt nicht (ABI)");
      },
    });
    expect(code).toBe(2);
    expect(b.children).toHaveLength(0);
    expect(logText()).toMatch(/\[supervisor\] startup failed: .*Laufzeit passt nicht/);
  });

  it("an uncaught exception in supervise mode is logged to agent.log before exit 70", async () => {
    const b = base();
    const running = superviseMain({ ...b.opts });
    await vi.waitFor(() => expect(b.crash.listenerCount("uncaughtException")).toBe(1));
    b.crash.emit("uncaughtException", new Error("boom in supervisor"));
    expect(b.exits).toEqual([70]);
    expect(logText()).toMatch(/FATAL uncaughtException/);
    expect(logText()).toMatch(/boom in supervisor/);
    b.signals.emit("SIGTERM");
    b.children[0]!.exit(0);
    await running;
  });

  it("an unhandled rejection in supervise mode is logged to agent.log before exit 70", async () => {
    const b = base();
    const running = superviseMain({ ...b.opts });
    await vi.waitFor(() => expect(b.crash.listenerCount("unhandledRejection")).toBe(1));
    b.crash.emit("unhandledRejection", new Error("rejected in supervisor"));
    expect(b.exits).toEqual([70]);
    expect(logText()).toMatch(/FATAL unhandledRejection/);
    b.signals.emit("SIGTERM");
    b.children[0]!.exit(0);
    await running;
  });

  it("the crash handlers are removed again once the supervisor stopped", async () => {
    const b = base();
    const running = superviseMain({ ...b.opts });
    await vi.waitFor(() => expect(b.children).toHaveLength(1));
    b.signals.emit("SIGTERM");
    b.children[0]!.exit(0);
    await running;
    expect(b.crash.listenerCount("uncaughtException")).toBe(0);
    expect(b.crash.listenerCount("unhandledRejection")).toBe(0);
  });
});
