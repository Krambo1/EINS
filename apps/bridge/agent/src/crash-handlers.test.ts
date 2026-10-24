import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  EXIT_CODE_CRASH,
  formatCrashLine,
  installCrashHandlers,
} from "./crash-handlers.js";

const FIXED = new Date("2026-10-07T01:02:03.004Z");

function setup(over: Partial<Parameters<typeof installCrashHandlers>[0]> = {}) {
  const emitter = new EventEmitter();
  const target = emitter as unknown as NodeJS.Process;
  const lines: string[] = [];
  const order: string[] = [];
  const exit = vi.fn((code: number) => void order.push(`exit:${code}`));
  const closeOutbox = vi.fn(() => void order.push("closeOutbox"));
  const releaseLock = vi.fn(() => void order.push("releaseLock"));
  const uninstall = installCrashHandlers({
    target,
    now: () => FIXED,
    writeLine: (l) => {
      lines.push(l);
      order.push("log");
    },
    exit,
    closeOutbox,
    releaseLock,
    ...over,
  });
  return { target: emitter, lines, order, exit, closeOutbox, releaseLock, uninstall };
}

describe("exit code", () => {
  it("is 70", () => {
    expect(EXIT_CODE_CRASH).toBe(70);
  });
});

describe("installCrashHandlers", () => {
  it("uncaughtException: logs the STACK with a timestamp, closes the outbox, releases the lock, exits 70, in that order", () => {
    const h = setup();
    const err = new Error("kaboom");
    h.target.emit("uncaughtException", err);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toContain("2026-10-07T01:02:03.004Z");
    expect(h.lines[0]).toContain("uncaughtException");
    expect(h.lines[0]).toContain("kaboom");
    expect(h.lines[0]).toContain(err.stack!.split("\n")[1]!.trim()); // a real stack frame
    expect(h.order).toEqual(["log", "closeOutbox", "releaseLock", "exit:70"]);
  });

  it("unhandledRejection with an Error: same path", () => {
    const h = setup();
    h.target.emit("unhandledRejection", new TypeError("bad promise"));
    expect(h.lines[0]).toContain("unhandledRejection");
    expect(h.lines[0]).toContain("bad promise");
    expect(h.exit).toHaveBeenCalledWith(70);
  });

  it("unhandledRejection with a non-Error reason (string, object, null) is still logged", () => {
    for (const reason of ["just a string", { code: 42 }, null, undefined]) {
      const h = setup();
      h.target.emit("unhandledRejection", reason);
      expect(h.lines[0]).toContain("unhandledRejection");
      expect(h.exit).toHaveBeenCalledWith(70);
    }
    const h = setup();
    h.target.emit("unhandledRejection", "just a string");
    expect(h.lines[0]).toContain("just a string");
  });

  it("a circular object as reason does not break the handler", () => {
    const h = setup();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    h.target.emit("unhandledRejection", circular);
    expect(h.exit).toHaveBeenCalledWith(70);
    expect(h.lines).toHaveLength(1);
  });

  it("a throwing closeOutbox is logged and the process still exits 70 with the lock released", () => {
    const h = setup({
      closeOutbox: () => {
        throw new Error("db locked");
      },
    });
    h.target.emit("uncaughtException", new Error("first"));
    expect(h.lines).toHaveLength(2);
    expect(h.lines[1]).toMatch(/error closing outbox during crash: .*db locked/);
    expect(h.releaseLock).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(70);
  });

  it("a throwing logger or lock release cannot prevent the exit", () => {
    const h = setup({
      writeLine: () => {
        throw new Error("stderr closed");
      },
      releaseLock: () => {
        throw new Error("EPERM");
      },
    });
    h.target.emit("uncaughtException", new Error("x"));
    expect(h.closeOutbox).toHaveBeenCalledTimes(1);
    expect(h.exit).toHaveBeenCalledWith(70);
  });

  it("a second crash while crashing exits immediately without re-running the cleanup", () => {
    const h = setup({
      exit: vi.fn(),
    });
    // exit is a no-op here, so the first handler returns and a second event arrives.
    h.target.emit("uncaughtException", new Error("one"));
    h.target.emit("unhandledRejection", new Error("two"));
    expect(h.lines).toHaveLength(1);
    expect(h.closeOutbox).toHaveBeenCalledTimes(1);
  });

  it("timestamp:false omits the prefix (the supervisor stamps child lines itself)", () => {
    const h = setup({ timestamp: false });
    h.target.emit("uncaughtException", new Error("quiet"));
    expect(h.lines[0]).toMatch(/^\[agent\] FATAL uncaughtException/);
  });

  it("works without optional collaborators", () => {
    const target = new EventEmitter();
    const exit = vi.fn();
    installCrashHandlers({ target: target as unknown as NodeJS.Process, exit, writeLine: () => {} });
    target.emit("uncaughtException", new Error("x"));
    expect(exit).toHaveBeenCalledWith(70);
  });

  it("the returned function removes both handlers", () => {
    const h = setup();
    expect(h.target.listenerCount("uncaughtException")).toBe(1);
    expect(h.target.listenerCount("unhandledRejection")).toBe(1);
    h.uninstall();
    expect(h.target.listenerCount("uncaughtException")).toBe(0);
    expect(h.target.listenerCount("unhandledRejection")).toBe(0);
  });
});

describe("formatCrashLine", () => {
  it("states the exit code and the restart intent", () => {
    const line = formatCrashLine("uncaughtException", new Error("x"), FIXED, true);
    expect(line).toContain("exiting with code 70");
    expect(line).toContain("supervisor restarts");
  });

  it("an Error without a stack falls back to name: message", () => {
    const e = new Error("no stack");
    e.stack = undefined;
    expect(formatCrashLine("unhandledRejection", e, FIXED, false)).toContain("Error: no stack");
  });
});
