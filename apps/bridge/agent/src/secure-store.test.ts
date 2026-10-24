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
let spawnMode: "normal" | "hang" | "exit-nonzero" | "spawn-error" | "exit-nonzero-immediate";
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
      if (spawnMode === "exit-nonzero-immediate") {
        // For callers that never write to stdin (the macOS `security` path).
        setImmediate(() => {
          if (spawnStderr) (child.stderr as Readable).push(spawnStderr);
          (child.stdout as Readable).push(null);
          (child.stderr as Readable).push(null);
          setImmediate(() =>
            child.emit("close", /could not be found/.test(spawnStderr) ? 44 : 36)
          );
        });
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

const fsMock = vi.hoisted(() => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  chmod: vi.fn(),
}));
vi.mock("node:fs/promises", () => fsMock);

// secure-store replaces blobs through atomic-write.ts (its own real-fs tests
// live in atomic-write.test.ts); here we only observe what it is asked to write.
const atomicMock = vi.hoisted(() => ({ atomicWriteFile: vi.fn() }));
vi.mock("./atomic-write.js", () => atomicMock);

let secureStore: typeof import("./secure-store");
let storeSecret: typeof import("./secure-store").storeSecret;
let loadSecret: typeof import("./secure-store").loadSecret;
let storeDbCredential: typeof import("./secure-store").storeDbCredential;

const REAL_PLATFORM = process.platform;

beforeEach(async () => {
  spawnCalls = [];
  spawnMode = "normal";
  spawnErrorToEmit = null;
  spawnStderr = "";
  fsMock.writeFile.mockReset().mockResolvedValue(undefined);
  fsMock.readFile.mockReset().mockResolvedValue("BASE64-CIPHERTEXT-NOT-REAL");
  fsMock.mkdir.mockReset().mockResolvedValue(undefined);
  fsMock.chmod.mockReset().mockResolvedValue(undefined);
  atomicMock.atomicWriteFile.mockReset().mockResolvedValue(undefined);
  vi.resetModules();
  secureStore = await import("./secure-store.js");
  storeSecret = secureStore.storeSecret;
  loadSecret = secureStore.loadSecret;
  storeDbCredential = secureStore.storeDbCredential;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  Object.defineProperty(process, "platform", {
    value: REAL_PLATFORM,
    configurable: true,
  });
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
    // Absolute path (this runs as SYSTEM: no PATH / working-directory lookup).
    expect(command).toMatch(
      /[\\/]System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/i
    );

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
    // Protocol: action line, scope line, then the payload. New blobs are
    // machine-scoped so the SYSTEM service can read them.
    expect(stdinJoined).toBe(`protect\nLocalMachine\n${SECRET}`);

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
    expect(stdinJoined).toBe(
      "unprotect\nLocalMachine\nBASE64-CIPHERTEXT-NOT-REAL"
    );
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
    // Machine scope first, then the legacy per-user scope.
    expect(spawnCalls).toHaveLength(2);
    expect(Buffer.concat(spawnCalls[0]!.stdinChunks).toString("utf8")).toMatch(
      /^unprotect\nLocalMachine\n/
    );
    expect(Buffer.concat(spawnCalls[1]!.stdinChunks).toString("utf8")).toMatch(
      /^unprotect\nCurrentUser\n/
    );
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

/**
 * Machine-wide DPAPI scope, legacy per-user blob handling and the "never turn a
 * read failure into 'absent'" rule. These run against a fake DPAPI backend, so
 * no powershell.exe is involved; the real stdin protocol is covered above.
 */

/** A syntactically valid DPAPI blob header with the given flags word. */
function fakeDpapiBlob(flags: number, filler = "x"): string {
  const buf = Buffer.alloc(64);
  buf.writeUInt32LE(1, 0); // dwVersion
  Buffer.from("d08c9ddf0115d1118c7a00c04fc297eb", "hex").copy(buf, 4); // provider GUID
  buf.writeUInt32LE(1, 20); // master key version
  buf.writeUInt32LE(flags, 40); // dwFlags: 0x4 = CRYPTPROTECT_LOCAL_MACHINE
  buf.write(filler.padEnd(8, "x").slice(0, 8), 44, "ascii");
  return buf.toString("base64");
}

const MACHINE_BLOB = fakeDpapiBlob(0x4, "machine");
const USER_BLOB = fakeDpapiBlob(0x0, "legacy");

interface FakeDpapi {
  backend: import("./secure-store").DpapiBackend;
  protectCalls: Array<{ plaintext: string; scope: string }>;
  unprotectCalls: Array<{ blob: string; scope: string }>;
}

function fakeDpapi(
  unprotect: (blob: string, scope: string) => string | Error
): FakeDpapi {
  const protectCalls: FakeDpapi["protectCalls"] = [];
  const unprotectCalls: FakeDpapi["unprotectCalls"] = [];
  return {
    protectCalls,
    unprotectCalls,
    backend: {
      protect: async (plaintext, scope) => {
        protectCalls.push({ plaintext, scope });
        return MACHINE_BLOB;
      },
      unprotect: async (blob, scope) => {
        unprotectCalls.push({ blob, scope });
        const r = unprotect(blob, scope);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

describe("secure-store · blobProtectionScope", () => {
  it("reads the scope from the DPAPI header flags", () => {
    expect(secureStore.blobProtectionScope(MACHINE_BLOB)).toBe("LocalMachine");
    expect(secureStore.blobProtectionScope(USER_BLOB)).toBe("CurrentUser");
  });

  it("null for text that is not a DPAPI blob", () => {
    expect(secureStore.blobProtectionScope("")).toBeNull();
    expect(secureStore.blobProtectionScope("BASE64-CIPHERTEXT-NOT-REAL")).toBeNull();
    expect(secureStore.blobProtectionScope(Buffer.alloc(80).toString("base64"))).toBeNull();
  });
});

describe("secure-store · machine scope, legacy blobs (Windows)", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
  });

  afterEach(() => {
    secureStore._setDpapiBackendForTests(null);
  });

  it("stores new blobs with LocalMachine scope through the atomic writer", async () => {
    const dp = fakeDpapi(() => "unused");
    secureStore._setDpapiBackendForTests(dp.backend);
    await secureStore.storeSecret("the-secret");
    expect(dp.protectCalls).toEqual([{ plaintext: "the-secret", scope: "LocalMachine" }]);
    expect(atomicMock.atomicWriteFile).toHaveBeenCalledTimes(1);
    const [path, data] = atomicMock.atomicWriteFile.mock.calls[0]!;
    expect(String(path)).toMatch(/secret\.dpapi$/);
    expect(data).toBe(MACHINE_BLOB);
    // No plain writeFile: a torn write must not replace a good key blob.
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });

  it("a machine-scoped blob is read with LocalMachine first and is not rewritten", async () => {
    fsMock.readFile.mockResolvedValue(MACHINE_BLOB + "\r\n");
    const dp = fakeDpapi(() => "plain-secret\r\n");
    secureStore._setDpapiBackendForTests(dp.backend);
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r).toEqual({ status: "ok", value: "plain-secret" });
    expect(dp.unprotectCalls.map((c) => c.scope)).toEqual(["LocalMachine"]);
    expect(dp.protectCalls).toEqual([]);
    expect(atomicMock.atomicWriteFile).not.toHaveBeenCalled();
  });

  it("a legacy per-user blob is read, then re-protected as LocalMachine in place", async () => {
    fsMock.readFile.mockResolvedValue(USER_BLOB);
    const dp = fakeDpapi(() => "legacy-secret");
    secureStore._setDpapiBackendForTests(dp.backend);
    vi.spyOn(console, "log").mockImplementation(() => void 0);
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r).toEqual({ status: "ok", value: "legacy-secret" });
    expect(dp.protectCalls).toEqual([{ plaintext: "legacy-secret", scope: "LocalMachine" }]);
    expect(atomicMock.atomicWriteFile).toHaveBeenCalledTimes(1);
    const [path, data] = atomicMock.atomicWriteFile.mock.calls[0]!;
    expect(String(path)).toMatch(/outbox-master\.dpapi$/);
    expect(data).toBe(MACHINE_BLOB);
  });

  it("failed re-protect still returns the secret and keeps the old blob (no write)", async () => {
    fsMock.readFile.mockResolvedValue(USER_BLOB);
    const dp = fakeDpapi(() => "legacy-secret");
    dp.backend.protect = async () => {
      throw new Error("protect failed");
    };
    secureStore._setDpapiBackendForTests(dp.backend);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => void 0);
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r).toEqual({ status: "ok", value: "legacy-secret" });
    expect(atomicMock.atomicWriteFile).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toContain("could not re-protect");
  });

  it("falls back from LocalMachine to CurrentUser when the first attempt fails", async () => {
    fsMock.readFile.mockResolvedValue(MACHINE_BLOB);
    const dp = fakeDpapi((_b, scope) =>
      scope === "LocalMachine" ? new Error("first attempt fails") : "second-attempt"
    );
    secureStore._setDpapiBackendForTests(dp.backend);
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r).toEqual({ status: "ok", value: "second-attempt" });
    expect(dp.unprotectCalls.map((c) => c.scope)).toEqual(["LocalMachine", "CurrentUser"]);
  });

  it("missing file is 'absent' (safe to mint), not an error", async () => {
    fsMock.readFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    secureStore._setDpapiBackendForTests(fakeDpapi(() => "x").backend);
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "absent" });
  });

  it("an unreadable file (EACCES) is an ERROR, never 'absent': the key must not be re-minted", async () => {
    fsMock.readFile.mockRejectedValue(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    secureStore._setDpapiBackendForTests(fakeDpapi(() => "x").backend);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => void 0);
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r.status).toBe("error");
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]![0])).toMatch(/SYSTEM or an Administrator/);
  });

  it("an undecryptable blob is an ERROR with a reason, logged once, then cached for a minute", async () => {
    vi.useFakeTimers();
    fsMock.readFile.mockResolvedValue(MACHINE_BLOB);
    const dp = fakeDpapi(() => new Error("Key not valid for use in specified state."));
    secureStore._setDpapiBackendForTests(dp.backend);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => void 0);

    const first = await secureStore.loadOutboxMasterKeyDetailed();
    expect(first.status).toBe("error");
    if (first.status === "error") expect(first.reason).toMatch(/could not decrypt outbox-master\.dpapi/);
    expect(dp.unprotectCalls).toHaveLength(2); // LocalMachine + CurrentUser

    // Within the negative-cache window: no new DPAPI work, no log spam.
    await vi.advanceTimersByTimeAsync(30_000);
    const second = await secureStore.loadOutboxMasterKeyDetailed();
    expect(second.status).toBe("error");
    expect(dp.unprotectCalls).toHaveLength(2);
    expect(errSpy).toHaveBeenCalledTimes(1);

    // After the window a fixed key blob is picked up without a restart.
    await vi.advanceTimersByTimeAsync(31_000);
    dp.backend.unprotect = async () => "recovered";
    const third = await secureStore.loadOutboxMasterKeyDetailed();
    expect(third).toEqual({ status: "ok", value: "recovered" });
  });

  it("storing a new blob clears a cached failure for that file", async () => {
    fsMock.readFile.mockResolvedValue(MACHINE_BLOB);
    let fail = true;
    const dp = fakeDpapi(() => (fail ? new Error("nope") : "fresh"));
    secureStore._setDpapiBackendForTests(dp.backend);
    vi.spyOn(console, "error").mockImplementation(() => void 0);
    expect((await secureStore.loadOutboxMasterKeyDetailed()).status).toBe("error");
    fail = false;
    await secureStore.storeOutboxMasterKey("a".repeat(64));
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "ok", value: "fresh" });
  });

  it("an empty blob file is 'absent'", async () => {
    fsMock.readFile.mockResolvedValue("  \r\n");
    secureStore._setDpapiBackendForTests(fakeDpapi(() => "x").backend);
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "absent" });
  });
});

describe("secure-store · Linux file store distinguishes absent from error", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
  });

  it("ENOENT is absent; EACCES is an error", async () => {
    fsMock.readFile.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "absent" });
    fsMock.readFile.mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r.status).toBe("error");
  });

  it("returns the trimmed value when present", async () => {
    fsMock.readFile.mockResolvedValueOnce("abc123\n");
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "ok", value: "abc123" });
  });
});

describe("secure-store · macOS keychain distinguishes absent from error", () => {
  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  it("'could not be found' (exit 44) is absent; any other failure is an error", async () => {
    spawnMode = "exit-nonzero-immediate";
    spawnStderr = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.";
    expect(await secureStore.loadOutboxMasterKeyDetailed()).toEqual({ status: "absent" });

    spawnStderr = "User interaction is not allowed.";
    const r = await secureStore.loadOutboxMasterKeyDetailed();
    expect(r.status).toBe("error");
  });
});
