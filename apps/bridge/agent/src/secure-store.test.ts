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
}

let spawnCalls: SpawnCall[];

vi.mock("node:child_process", () => {
  return {
    spawn: (command: string, args: string[]) => {
      const call: SpawnCall = { command, args, stdinChunks: [] };
      spawnCalls.push(call);

      const child = new EventEmitter() as EventEmitter & {
        stdin: Writable;
        stdout: Readable;
        stderr: Readable;
      };
      child.stdin = new Writable({
        write(chunk, _enc, cb) {
          call.stdinChunks.push(Buffer.from(chunk));
          cb();
        },
        final(cb) {
          // Defer the "close" emission so the test can inspect stdin
          // chunks after end() was called. Simulate the script
          // successfully protecting "PAYLOAD" by writing a stable
          // ciphertext to stdout — the test cares about argv hygiene, not
          // the actual DPAPI output.
          const action = call.stdinChunks[0]?.toString().split("\n")[0] ?? "";
          const out =
            action === "protect"
              ? "BASE64-CIPHERTEXT-NOT-REAL"
              : "ROUNDTRIPPED-SECRET";
          (child.stdout as Readable).push(out);
          (child.stdout as Readable).push(null);
          (child.stderr as Readable).push(null);
          // Emit close on next tick so listeners are attached.
          setImmediate(() => child.emit("close", 0));
          cb();
        },
      });
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
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
