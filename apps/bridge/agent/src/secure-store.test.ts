import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Writable, Readable } from "node:stream";

/**
 * P0-3 contract test.
 *
 * The plaintext HMAC secret must NEVER appear on the powershell.exe
 * command line. On Windows, every process's command line is readable by
 * any other process running under the same user (and by admin tools across
 * users), so anything on argv is "secret-equivalent to public" while the
 * child runs. The fix moves the payload to stdin and uses
 * `-EncodedCommand <fixed-stub>` on the command line.
 *
 * This test runs on every platform because the code shape — what gets
 * passed to `child_process.spawn` — is platform-independent. The actual
 * DPAPI roundtrip is verified manually on a Windows host (see commit
 * notes); we'd need a Windows CI runner to gate it in CI.
 */

interface SpawnCall {
  command: string;
  args: string[];
  stdinChunks: Buffer[];
  killed: boolean;
  killSignals: string[];
}

let spawnCalls: SpawnCall[];

/**
 * Controls how the fake child behaves so we can exercise the M-A4 failure
 * paths without a real powershell/security binary:
 *
 *   "normal"       emit close(0) with a stable roundtrip output (default).
 *   "hang"         never emit close (simulates an AV/EDR stall) so the
 *                  psDpapi timeout can fire.
 *   "exit-nonzero" emit close(1) with stderr (simulates a DPAPI decrypt
 *                  failure, e.g. user-scope mismatch).
 *   "spawn-error"  emit an "error" event instead of running (simulates a
 *                  missing binary / EACCES on spawn).
 */
let spawnMode: "normal" | "hang" | "exit-nonzero" | "spawn-error";
let spawnErrorToEmit: Error | null;
let spawnStderr: string;

vi.mock("node:child_process", () => {
  return {
    spawn: (command: string, args: string[]) => {
      const call: SpawnCall = {
        command,
        args,
        stdinChunks: [],
        killed: false,
        killSignals: [],
      };
      spawnCalls.push(call);

      const child = new EventEmitter() as EventEmitter & {
        stdin: Writable;
        stdout: Readable;
        stderr: Readable;
        kill: (signal?: string) => boolean;
      };
      child.kill = (signal?: string) => {
        call.killed = true;
        call.killSignals.push(signal ?? "SIGTERM");
        return true;
      };

      const emitClose = (code: number) => {
        if (spawnStderr) (child.stderr as Readable).push(spawnStderr);
        (child.stdout as Readable).push(null);
        (child.stderr as Readable).push(null);
        setImmediate(() => child.emit("close", code));
      };

      child.stdin = new Writable({
        write(chunk, _enc, cb) {
          call.stdinChunks.push(Buffer.from(chunk));
          cb();
        },
        final(cb) {
          // "close" is emitted here (after end()) so the test can inspect
          // stdin chunks. The Windows accessors write to stdin and end();
          // the macOS `spawn1` path never touches stdin, so its behaviour
          // is driven from the spawn-error branch below instead.
          if (spawnMode === "hang") {
            // Never resolve: leave the child pending so the timeout fires.
            cb();
            return;
          }
          if (spawnMode === "exit-nonzero") {
            emitClose(1);
            cb();
            return;
          }
          // "normal": simulate the stub successfully protecting/unprotecting
          // by writing a stable output. The test cares about argv hygiene
          // and control flow, not the actual DPAPI output.
          const action = call.stdinChunks[0]?.toString().split("\n")[0] ?? "";
          const out =
            action === "protect"
              ? "BASE64-CIPHERTEXT-NOT-REAL"
              : "ROUNDTRIPPED-SECRET";
          (child.stdout as Readable).push(out);
          emitClose(0);
          cb();
        },
      });
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });

      if (spawnMode === "spawn-error") {
        // Emit "error" independent of stdin so the macOS `spawn1` path
        // (which never writes to stdin) is covered too.
        const err = spawnErrorToEmit ?? new Error("spawn ENOENT");
        setImmediate(() => child.emit("error", err));
      }
      return child;
    },
  };
});

vi.mock("./config.js", () => ({
  configDir: () =>
    process.platform === "win32"
      ? "C:\\Temp\\eins-agent-test"
      : "/tmp/eins-agent-test",
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => void 0),
  readFile: vi.fn(async () => "BASE64-CIPHERTEXT-NOT-REAL"),
  mkdir: vi.fn(async () => void 0),
  chmod: vi.fn(async () => void 0),
}));

let storeSecret: typeof import("./secure-store").storeSecret;
let loadSecret: typeof import("./secure-store").loadSecret;
let storeDbCredential: typeof import("./secure-store").storeDbCredential;

beforeEach(async () => {
  spawnCalls = [];
  spawnMode = "normal";
  spawnErrorToEmit = null;
  spawnStderr = "";
  vi.resetModules();
  const mod = await import("./secure-store.js");
  storeSecret = mod.storeSecret;
  loadSecret = mod.loadSecret;
  storeDbCredential = mod.storeDbCredential;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("secure-store · Windows DPAPI argv hygiene (P0-3)", () => {
  // Force the Windows code path regardless of host platform. We restore
  // process.platform in afterEach via vi.restoreAllMocks (Object.defineProperty
  // doesn't survive between tests in vitest's module reset).
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  const SECRET = "deadbeef".repeat(8); // 64-char hex, looks like a real PVS secret

  it("storeSecret: spawn argv contains no secret material; payload is on stdin", async () => {
    await storeSecret(SECRET);
    expect(spawnCalls).toHaveLength(1);
    const { command, args, stdinChunks } = spawnCalls[0]!;
    expect(command).toBe("powershell.exe");

    // The Windows process listing exposes argv. Assert NONE of the argv
    // entries contain any substring of the secret. The encoded stub is
    // base64 of the FIXED PowerShell script — the secret cannot be
    // there because the secret is provided at runtime via stdin.
    for (const arg of args) {
      expect(arg).not.toContain(SECRET);
      // Also rule out partial leakage (e.g. accidentally embedding the
      // first half via misuse of template literals).
      expect(arg).not.toContain(SECRET.slice(0, 16));
    }

    // Sanity-check that the secret IS in stdin (i.e. the test is not
    // tautological — we did actually feed it somewhere).
    const stdinJoined = Buffer.concat(stdinChunks).toString("utf8");
    expect(stdinJoined).toContain("protect\n");
    expect(stdinJoined).toContain(SECRET);

    // Argv shape: -NoProfile -NonInteractive -EncodedCommand <base64>
    expect(args.slice(0, 3)).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
    ]);
    // The base64 stub is reasonably short (the script itself is <2 KB
    // and base64 of UTF-16 LE is ~4× that). Reject if it gets weirdly
    // long — that's a smell that the secret leaked in.
    expect(args[3]!.length).toBeLessThan(8_000);
    expect(args[3]!).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("loadSecret: spawn argv contains no ciphertext; ciphertext is on stdin", async () => {
    const result = await loadSecret();
    expect(result).toBe("ROUNDTRIPPED-SECRET");
    expect(spawnCalls).toHaveLength(1);
    const { args, stdinChunks } = spawnCalls[0]!;
    // The on-disk ciphertext is also sensitive — anyone watching the
    // command line could fingerprint installations or correlate hosts.
    const stdinJoined = Buffer.concat(stdinChunks).toString("utf8");
    expect(stdinJoined).toContain("unprotect\n");
    expect(stdinJoined).toContain("BASE64-CIPHERTEXT-NOT-REAL");
    // argv has no ciphertext.
    for (const arg of args) {
      expect(arg).not.toContain("BASE64-CIPHERTEXT-NOT-REAL");
    }
  });

  it("storeDbCredential: same argv hygiene applies to DB passwords", async () => {
    const PW = "PraxisDbPassword#42";
    await storeDbCredential("tomedo-default", PW);
    expect(spawnCalls).toHaveLength(1);
    const { args, stdinChunks } = spawnCalls[0]!;
    for (const arg of args) {
      expect(arg).not.toContain(PW);
    }
    expect(Buffer.concat(stdinChunks).toString("utf8")).toContain(PW);
  });

  it("a secret containing single quotes does NOT crash and is not interpolated", async () => {
    // The previous PowerShell-via-Command implementation escape-doubled
    // single quotes (`'` → `''`) and interpolated the result into a $bytes
    // literal. A secret with single quotes anywhere was a parser-error
    // tinderbox. With the stdin-based approach the secret is just bytes,
    // no escaping concerns.
    const NASTY = `it's '"; rm -rf --no-preserve-root /'; #'`;
    await storeSecret(NASTY);
    const { args, stdinChunks } = spawnCalls[0]!;
    for (const arg of args) {
      expect(arg).not.toContain(NASTY);
      expect(arg).not.toContain("''"); // no escape doubling artefact in argv
    }
    expect(Buffer.concat(stdinChunks).toString("utf8")).toContain(NASTY);
  });

  it("loadSecret caches after first load: two loads, one subprocess (review finding 5)", async () => {
    const first = await loadSecret();
    const second = await loadSecret();
    expect(first).toBe("ROUNDTRIPPED-SECRET");
    expect(second).toBe("ROUNDTRIPPED-SECRET");
    // The flush loop calls loadSecret() once per event. Without the cache,
    // flushing a 50-row batch spawned 50 powershell.exe children; with it,
    // exactly one for the life of the process.
    expect(spawnCalls).toHaveLength(1);
  });
});

/**
 * M-A4 reliability finding. The child-process handling in secure-store could
 * silently wedge the agent (a hung powershell.exe pins the outbox
 * flushInFlight guard forever) or crash it (a macOS spawn failure with no
 * "error" listener throws an uncaught exception). These tests exercise the
 * three remediation paths without a real powershell/security binary.
 */
describe("secure-store · M-A4 powershell child timeout (Windows)", () => {
  // Mirror of the private PS_DPAPI_TIMEOUT_MS in secure-store.ts. Keep in
  // sync if the source ceiling changes.
  const PS_DPAPI_TIMEOUT_MS = 30_000;
  const SECRET = "deadbeef".repeat(8);

  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects and kills the child when powershell.exe hangs; no secret in the error", async () => {
    vi.useFakeTimers();
    spawnMode = "hang";

    const p = storeSecret(SECRET);
    // Capture the outcome now so the eventual rejection is always handled,
    // even before we advance the clock (avoids an unhandled-rejection warning).
    const settled = p.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );

    // Just before the ceiling: still pending, child not yet killed.
    await vi.advanceTimersByTimeAsync(PS_DPAPI_TIMEOUT_MS - 1);
    expect(spawnCalls[0]!.killed).toBe(false);

    // Cross the boundary: the timeout fires, kills the child, and rejects.
    await vi.advanceTimersByTimeAsync(2);
    const result = await settled;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = String((result.err as Error).message);
      expect(msg).toMatch(/timed out/i);
      // The timeout/kill path must never leak the secret into the message.
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(SECRET.slice(0, 16));
    }
    expect(spawnCalls[0]!.killed).toBe(true);
    expect(spawnCalls[0]!.killSignals).toContain("SIGKILL");
  });
});

describe("secure-store · M-A4 DPAPI decrypt-failure logging (Windows)", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  it("loadSecret logs an actionable user-scope hint and returns null when DPAPI cannot decrypt", async () => {
    spawnMode = "exit-nonzero";
    // DPAPI's own failure reason for a cross-user blob. Never contains the
    // plaintext secret (the secret is the output it failed to produce).
    spawnStderr = "Key not valid for use in specified state.";
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => void 0);

    const result = await loadSecret();

    expect(result).toBeNull();
    // Loud: a single, explicit error line rather than a silent null.
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = String(errSpy.mock.calls[0]![0]);
    // Actionable: names the likely cause and the fix.
    expect(logged).toMatch(/different Windows user account/i);
    expect(logged).toMatch(/re-enroll/i);
    // Must not leak the on-disk ciphertext (what the readFile mock returns).
    expect(logged).not.toContain("BASE64-CIPHERTEXT-NOT-REAL");

    errSpy.mockRestore();
  });
});

describe("secure-store · M-A4 macOS spawn error handling", () => {
  const SECRET = "deadbeef".repeat(8);

  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  it("storeSecret rejects (does not crash the process) when `security` fails to spawn", async () => {
    spawnMode = "spawn-error";
    spawnErrorToEmit = new Error("spawn security ENOENT");
    // Without an "error" listener on the child, this spawn failure would
    // surface as an uncaught exception and take the agent down. The handler
    // converts it into a normal promise rejection the caller can handle.
    await expect(storeSecret(SECRET)).rejects.toThrow(/ENOENT/);
  });

  it("loadSecret returns null (does not crash the process) when `security` fails to spawn", async () => {
    spawnMode = "spawn-error";
    spawnErrorToEmit = new Error("spawn security ENOENT");
    const result = await loadSecret();
    expect(result).toBeNull();
  });
});

describe("secure-store · M-A4 macOS security child timeout", () => {
  // Mirror of the private SECURITY_TIMEOUT_MS in secure-store.ts. Keep in
  // sync if the source ceiling changes.
  const SECURITY_TIMEOUT_MS = 30_000;
  const SECRET = "deadbeef".repeat(8);

  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects and kills the child when `security` hangs; no secret in the error", async () => {
    vi.useFakeTimers();
    spawnMode = "hang";

    const p = storeSecret(SECRET);
    // Capture the outcome now so the eventual rejection is always handled,
    // even before we advance the clock (avoids an unhandled-rejection warning).
    const settled = p.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err })
    );

    // storeMacOsKeychain runs `security delete-generic-password` (its
    // rejection is swallowed) then `security add-generic-password`, each
    // guarded by its own 30s ceiling. Fire the delete timeout first, which
    // lets the add spawn happen, then fire the add timeout.
    await vi.advanceTimersByTimeAsync(SECURITY_TIMEOUT_MS + 1);
    await vi.advanceTimersByTimeAsync(SECURITY_TIMEOUT_MS + 1);

    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const msg = String((result.err as Error).message);
      expect(msg).toMatch(/timed out/i);
      // The store path passes the secret via `security -w <secret>` on argv,
      // so it IS present in spawnCalls args, but must NEVER reach the error.
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(SECRET.slice(0, 16));
    }

    // The add call carries the secret on argv; find it and assert the wedged
    // child was force-killed.
    const addCall = spawnCalls.find((c) =>
      c.args.includes("add-generic-password")
    );
    expect(addCall).toBeDefined();
    // Sanity: the secret really is on this call's argv, so the no-leak
    // assertion above is meaningful rather than vacuous.
    expect(addCall!.args).toContain(SECRET);
    expect(addCall!.killed).toBe(true);
    expect(addCall!.killSignals).toContain("SIGKILL");
  });
});
