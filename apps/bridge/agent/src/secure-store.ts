import { spawn } from "node:child_process";
import { readFile, mkdir, chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";
import { atomicWriteFile } from "./atomic-write.js";
import { makeRateLimiter } from "./log-throttle.js";
import { powershellExe } from "./win-context.js";

/**
 * Cross-platform secure secret storage.
 *
 *   Windows: DPAPI via PowerShell ProtectedData, MACHINE scope (LocalMachine).
 *   macOS:   Keychain via `security add-generic-password` / `find-generic-password`.
 *   Linux:   $XDG_CONFIG_HOME/eins-agent/*.txt with 0600. Best-effort fallback.
 *
 * Two kinds of secret live here:
 *
 *   1. The per-clinic PVS HMAC secret (64-char hex) minted by the portal at
 *      enrollment time. Used by portal-client to sign event POSTs.
 *      Accessor: storeSecret / loadSecret.
 *
 *   2. Named DB credentials (passwords) for the SQL-introspection db-adapters
 *      framework. One credential per (vendor, install) tuple, addressed by
 *      a stable id chosen at --enable-db-adapter time. Used by the postgres /
 *      firebird / mssql drivers to authenticate read-only DB accounts that
 *      the Praxis (or their PVS vendor's support team) provisioned.
 *      Accessors: storeDbCredential(id, password) / loadDbCredential(id).
 *
 * Neither leaves the host once stored. The PVS HMAC secret rotation flow is
 * handled by the enrollment flow; DB credentials are rotated via
 * `eins-agent --rotate-db-credential <id>` (interactive).
 *
 * WINDOWS SCOPE TRADE-OFF (read this before changing the scope).
 * New blobs use DPAPI scope LocalMachine, not CurrentUser, because the agent
 * runs as a LocalSystem scheduled task with nobody logged in and must keep
 * reading the same blobs after reboots, after the installing admin's password
 * is reset, and when a different admin runs a maintenance command. A
 * CurrentUser blob is bound to one account's master key and is undecryptable
 * by SYSTEM.
 * The price: a LocalMachine blob can be decrypted by ANY process on this
 * machine that can read the file. DPAPI no longer separates the Praxis's
 * Windows users from the secret. The protection boundary is therefore the NTFS
 * ACL of the data directory (SYSTEM + Administrators only, applied and
 * verified by data-dir.ts). What DPAPI still gives us is at-rest protection of
 * a copied/stolen disk image or backup: the blob is useless without the
 * machine's DPAPI keys.
 *
 * Verified on Windows 11: the `scope` argument of ProtectedData.Unprotect is
 * IGNORED when decrypting (CryptUnprotectData reads the scope from the blob
 * header), so "try LocalMachine, then CurrentUser" is two calls with the same
 * effect, and whether a blob is legacy can only be told from its header
 * (blobProtectionScope), not from which attempt succeeded.
 */

const SERVICE = "EINS-Agent";
const ACCOUNT = "pvs-hmac-secret";
const OUTBOX_MASTER_ACCOUNT = "outbox-master-key";

/** Outcome of reading one stored secret. */
export type SecretLoad =
  | { status: "ok"; value: string }
  /** Nothing stored (never enrolled / never created). Expected on first boot. */
  | { status: "absent" }
  /** Something IS stored but could not be read or decrypted. Do not overwrite it. */
  | { status: "error"; reason: string };

function valueOrNull(r: SecretLoad): string | null {
  return r.status === "ok" ? r.value : null;
}

// ---------- PVS HMAC secret ------------------------------------------------

// In-process cache for the PVS HMAC secret. loadSecret() is called once per
// event POST by the outbox flush loop; without this, flushing N due rows
// spawned N powershell.exe (Windows DPAPI) / `security` (macOS) children, so
// an initial-sync burst of thousands of events spawned thousands of
// subprocesses serially on the Praxis workstation (review finding 5). The
// secret only changes on rotation, which already requires an agent restart, so
// a process-lifetime cache is safe. We cache ONLY a successful (non-null)
// load: a transient read failure (a flaky subprocess) must not pin `null` and
// wedge the agent into permanently dropping events.
let secretCache: string | null = null;

export async function storeSecret(secret: string): Promise<void> {
  secretCache = null; // rotation / re-enroll: drop any cached value
  if (process.platform === "win32") return storeWindowsFile(secret, "secret.dpapi");
  if (process.platform === "darwin") return storeMacOsKeychain(secret, ACCOUNT);
  return storeLinuxFile(secret, "secret.txt");
}

export async function loadSecret(): Promise<string | null> {
  if (secretCache !== null) return secretCache;
  const loaded = valueOrNull(await loadSecretDetailed());
  if (loaded) secretCache = loaded;
  return loaded;
}

async function loadSecretDetailed(): Promise<SecretLoad> {
  if (process.platform === "win32") return loadWindowsFile("secret.dpapi");
  if (process.platform === "darwin") return loadMacOsKeychain(ACCOUNT);
  return loadLinuxFile("secret.txt");
}

/** Test-only: clear the in-process secret cache between cases. */
export function _resetSecretCacheForTests(): void {
  secretCache = null;
  decryptFailures.clear();
}

// ---------- SQLCipher master key for the outbox ----------------------------

// P3-4: the agent's outbox SQLite file is encrypted with SQLCipher. The
// master key is a 256-bit random value generated once at first startup and
// stored using the same DPAPI/Keychain/file machinery as the PVS HMAC
// secret. The key never leaves the host; the SQLite file at rest is
// unreadable without it (defends against cold-disk theft of a Praxis
// workstation).
//
// Wire format: 64-char lowercase hex (32 bytes). The outbox driver
// converts to the SQLCipher pragma form ("x'HEX'") at open time.

export async function storeOutboxMasterKey(keyHex: string): Promise<void> {
  if (process.platform === "win32") {
    return storeWindowsFile(keyHex, "outbox-master.dpapi");
  }
  if (process.platform === "darwin") {
    return storeMacOsKeychain(keyHex, OUTBOX_MASTER_ACCOUNT);
  }
  return storeLinuxFile(keyHex, "outbox-master.key");
}

export async function loadOutboxMasterKey(): Promise<string | null> {
  return valueOrNull(await loadOutboxMasterKeyDetailed());
}

/**
 * Like loadOutboxMasterKey, but tells "nothing stored" (safe to mint a key)
 * apart from "stored but unreadable" (MUST NOT mint: overwriting it would
 * destroy the only copy of the key an existing outbox.sqlite needs).
 */
export async function loadOutboxMasterKeyDetailed(): Promise<SecretLoad> {
  if (process.platform === "win32") {
    return loadWindowsFile("outbox-master.dpapi");
  }
  if (process.platform === "darwin") {
    return loadMacOsKeychain(OUTBOX_MASTER_ACCOUNT);
  }
  return loadLinuxFile("outbox-master.key");
}

// ---------- Named DB credentials ------------------------------------------

/**
 * Persist a DB-credential password under a caller-chosen id. The id is the
 * `credentialId` referenced from the vendor YAML config; commonly the vendor
 * slug ("tomedo-db-default") but the framework treats it as an opaque token,
 * so a Praxis with two PVS installs can stash separate credentials under
 * distinct ids.
 *
 * Validation: ids are restricted to [a-zA-Z0-9_-]{1,64} so they're safe
 * filename and Keychain-account fragments. Reject upstream rather than
 * sanitise here: silent munging produces hard-to-debug mismatches.
 */
export async function storeDbCredential(
  id: string,
  password: string
): Promise<void> {
  assertCredentialId(id);
  if (process.platform === "win32") {
    return storeWindowsFile(password, `db-cred.${id}.dpapi`);
  }
  if (process.platform === "darwin") {
    return storeMacOsKeychain(password, `db-cred:${id}`);
  }
  return storeLinuxFile(password, `db-cred.${id}.txt`);
}

export async function loadDbCredential(id: string): Promise<string | null> {
  assertCredentialId(id);
  if (process.platform === "win32") {
    return valueOrNull(await loadWindowsFile(`db-cred.${id}.dpapi`));
  }
  if (process.platform === "darwin") {
    return valueOrNull(await loadMacOsKeychain(`db-cred:${id}`));
  }
  return valueOrNull(await loadLinuxFile(`db-cred.${id}.txt`));
}

function assertCredentialId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(
      `invalid credentialId '${id}': must match [A-Za-z0-9_-]{1,64}`
    );
  }
}

// ---------- Windows: DPAPI via PowerShell ---------------------------------

export type DpapiScope = "LocalMachine" | "CurrentUser";

/**
 * The DPAPI primitive the Windows code path runs on. Production uses the
 * PowerShell stub below; tests (and data-dir-migration's tests) inject a fake
 * so no powershell.exe is ever started.
 */
export interface DpapiBackend {
  /** Returns base64 ciphertext. */
  protect(plaintext: string, scope: DpapiScope): Promise<string>;
  /** Returns the plaintext. Rejects when the blob cannot be decrypted. */
  unprotect(blobBase64: string, scope: DpapiScope): Promise<string>;
}

const powershellBackend: DpapiBackend = {
  protect: (plaintext, scope) => psDpapi("protect", scope, plaintext),
  unprotect: (blob, scope) => psDpapi("unprotect", scope, blob),
};

let dpapi: DpapiBackend = powershellBackend;

export function getDpapiBackend(): DpapiBackend {
  return dpapi;
}

/** Test-only: swap the DPAPI primitive (null restores PowerShell). */
export function _setDpapiBackendForTests(backend: DpapiBackend | null): void {
  dpapi = backend ?? powershellBackend;
}

// DPAPI blob header: dwVersion(4) | guidProvider(16) | dwMasterKeyVersion(4) |
// guidMasterKey(16) | dwFlags(4) ...  CRYPTPROTECT_LOCAL_MACHINE = 0x4.
const DPAPI_PROVIDER_GUID = Buffer.from(
  "d08c9ddf0115d1118c7a00c04fc297eb",
  "hex"
);
const DPAPI_FLAGS_OFFSET = 40;
const CRYPTPROTECT_LOCAL_MACHINE = 0x4;

/**
 * Which scope protected this base64 DPAPI blob, read from its header. null when
 * the text is not a recognisable DPAPI blob. This is how legacy per-user blobs
 * are detected (see the scope note at the top of this file).
 */
export function blobProtectionScope(blobBase64: string): DpapiScope | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(blobBase64.trim(), "base64");
  } catch {
    return null;
  }
  if (buf.length < DPAPI_FLAGS_OFFSET + 4) return null;
  if (buf.readUInt32LE(0) !== 1) return null;
  if (!buf.subarray(4, 20).equals(DPAPI_PROVIDER_GUID)) return null;
  const flags = buf.readUInt32LE(DPAPI_FLAGS_OFFSET);
  return (flags & CRYPTPROTECT_LOCAL_MACHINE) !== 0
    ? "LocalMachine"
    : "CurrentUser";
}

// P0-3: secrets are piped to PowerShell via stdin, NEVER interpolated into
// the command line.
//
// On Windows, every process's command line is readable by any other process
// running under the same user (and by admin tools across users):
//
//   Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine
//
// The previous implementation interpolated the plaintext HMAC secret into
// a PowerShell script that was passed via `-Command`, so during every
// store and every load the secret sat in plaintext in the command line of
// the spawned powershell.exe child — defeating the whole point of DPAPI,
// which is "the secret is never readable by unrelated processes."
//
// We now use `-EncodedCommand <base64>` where the script itself is on the
// command line (visible, but contains no secrets — it's a fixed stub) and
// the secret travels via stdin. `[Console]::In.ReadToEnd()` reads the
// payload at runtime. Stdin contents do not appear in Win32_Process.
//
// `-EncodedCommand` requires the script to be base64 of UTF-16 LE text,
// which is what Windows uses for its WCHAR strings internally.

/**
 * Stub that DPAPI-protects the secret it reads from stdin.
 *
 * Protocol on stdin:
 *   • Line 1: action verb ("protect" or "unprotect").
 *   • Line 2: DataProtectionScope ("LocalMachine" or "CurrentUser").
 *   • Remainder: the payload — plaintext to protect, or base64 ciphertext
 *                to unprotect. Trailing whitespace is trimmed.
 *
 * stdout receives the result (base64 ciphertext for protect, plaintext for
 * unprotect). On unknown action or scope the stub exits 2.
 */
const DPAPI_STUB = `
Add-Type -AssemblyName System.Security
$reader = [Console]::In
$action = $reader.ReadLine()
$scope = $reader.ReadLine()
$payload = $reader.ReadToEnd()
if ($payload -ne $null) { $payload = $payload.Trim() }
if ($scope -ne 'LocalMachine' -and $scope -ne 'CurrentUser') {
  Write-Error "unknown scope"
  exit 2
}
if ($action -eq 'protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  [Convert]::ToBase64String($protected) | Write-Output
}
elseif ($action -eq 'unprotect') {
  $bytes = [Convert]::FromBase64String($payload)
  $unprotected = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  [Text.Encoding]::UTF8.GetString($unprotected) | Write-Output
}
else {
  Write-Error "unknown action"
  exit 2
}
`.trim();

async function storeWindowsFile(secret: string, filename: string): Promise<void> {
  // LocalMachine: see the scope trade-off note at the top of this file.
  const blob = await dpapi.protect(secret, "LocalMachine");
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  // Crash-safe replace (fsync + rename): an interrupted write must never leave
  // an empty or torn key blob that has replaced the good one.
  await atomicWriteFile(join(dir, filename), blob.trim());
  decryptFailures.delete(filename);
}

// After a failed decrypt, do not re-spawn powershell for the same file on every
// call: the flush loop reads the secret once per cycle, and a permanently
// undecryptable blob would otherwise cost two powershell starts every few
// seconds forever. A minute is short enough that a fix (migration, re-enroll) is
// picked up without a restart.
const DECRYPT_RETRY_AFTER_MS = 60_000;
const decryptFailures = new Map<string, { until: number; reason: string }>();
const decryptLogGate = new Map<string, (now: number) => boolean>();

function shouldLogDecryptFailure(filename: string): boolean {
  let gate = decryptLogGate.get(filename);
  if (!gate) {
    gate = makeRateLimiter(10 * 60_000);
    decryptLogGate.set(filename, gate);
  }
  return gate(Date.now());
}

async function loadWindowsFile(filename: string): Promise<SecretLoad> {
  const failed = decryptFailures.get(filename);
  if (failed && Date.now() < failed.until) {
    return { status: "error", reason: failed.reason };
  }

  const path = join(configDir(), filename);
  let blob: string;
  try {
    blob = (await readFile(path, "utf8")).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No blob on disk yet: the agent has not been enrolled, or this
      // credential was never stored. Expected at first boot, so stay quiet.
      return { status: "absent" };
    }
    const reason = `cannot read ${path}: ${(err as Error).message}`;
    if (shouldLogDecryptFailure(filename)) {
      console.error(
        `[secure-store] windows: ${filename} exists but could not be read ` +
          `(${(err as Error).message}). Check that the agent runs as SYSTEM or an ` +
          `Administrator: the data directory is restricted to those accounts.`
      );
    }
    decryptFailures.set(filename, {
      until: Date.now() + DECRYPT_RETRY_AFTER_MS,
      reason,
    });
    return { status: "error", reason };
  }
  if (!blob) return { status: "absent" };

  // Machine scope first (all new blobs), then the legacy per-user scope.
  let plaintext: string | null = null;
  let lastErr: unknown;
  for (const scope of ["LocalMachine", "CurrentUser"] as const) {
    try {
      plaintext = await dpapi.unprotect(blob, scope);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (plaintext === null) {
    // The blob exists on disk but DPAPI could not decrypt it. Causes on a Praxis
    // workstation: (a) a legacy per-user blob created under a different Windows
    // account than the one now running the agent, e.g. the interactive admin
    // that ran an older `--enroll`, while the agent now runs as SYSTEM;
    // (b) the data directory was copied from another PC or Windows
    // installation, where the machine-scope key does not exist. Log loudly and
    // actionably instead of silently returning null and shipping nothing
    // (review finding M-A4). The error text is DPAPI's own failure reason and
    // never contains the protected secret: the secret is the plaintext DPAPI
    // failed to produce, not the ciphertext it was given.
    const reason = `DPAPI could not decrypt ${filename}: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`;
    if (shouldLogDecryptFailure(filename)) {
      console.error(
        `[secure-store] windows: ${filename} exists on disk but DPAPI could ` +
          `not decrypt it. Most likely it was stored under a different Windows ` +
          `user account than the one now running the agent (legacy per-user ` +
          `blob): run \`eins-agent --install-service\` once as the Windows user ` +
          `who did the setup (Bitte einmal als der Windows-Benutzer, der die ` +
          `Einrichtung gemacht hat, \`eins-agent --install-service\` ausführen). ` +
          `Or the data directory was copied from another PC or Windows ` +
          `installation, where machine keys do not transfer: re-enroll the ` +
          `agent. DPAPI error: ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`
      );
    }
    decryptFailures.set(filename, {
      until: Date.now() + DECRYPT_RETRY_AFTER_MS,
      reason,
    });
    return { status: "error", reason };
  }
  const value = plaintext.trim();
  if (!value) return { status: "absent" };

  // Legacy per-user blob that we CAN read (we run as the user that made it):
  // re-protect it as LocalMachine in place so SYSTEM can read it from now on.
  if (blobProtectionScope(blob) === "CurrentUser") {
    try {
      const fresh = await dpapi.protect(value, "LocalMachine");
      await atomicWriteFile(path, fresh.trim());
      console.log(
        `[secure-store] windows: re-protected legacy per-user ${filename} with machine scope.`
      );
    } catch (err) {
      console.warn(
        `[secure-store] windows: could not re-protect legacy ${filename} with machine ` +
          `scope (${err instanceof Error ? err.message : String(err)}); it stays readable ` +
          `only by the current Windows user.`
      );
    }
  }
  return { status: "ok", value };
}

// Hard ceiling on how long we wait for the DPAPI powershell child. Without
// it, a hung powershell.exe (an AV/EDR scan stalling process start, or a
// wedged console host) leaves this promise pending forever. The outbox flush
// loop awaits loadSecret() under a flushInFlight guard, so a single hung
// child wedges the whole agent: it keeps running but ships nothing and logs
// nothing (review finding M-A4). On expiry we kill the child and reject so
// the caller's failure path runs instead of hanging.
const PS_DPAPI_TIMEOUT_MS = 30_000;

/**
 * Run the DPAPI stub. Command-line arguments are:
 *
 *   <SystemRoot>/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -EncodedCommand <b64>
 *
 * The executable is addressed by absolute path: this runs as SYSTEM, and a bare
 * name would be resolved through the working directory and PATH.
 *
 * The `<b64>` is UTF-16-LE-encoded base64 of the FIXED stub script. It
 * does NOT contain any secret material; the secret travels via stdin.
 * That distinction is the whole point: even when the Windows process
 * listing exposes the command line of every running powershell.exe, the
 * sensitive bytes are not visible to other processes.
 *
 * The child is bounded by PS_DPAPI_TIMEOUT_MS: on expiry it is killed and
 * the promise rejects, so a stalled powershell.exe can never wedge the
 * caller. Neither the timeout nor the kill path puts the payload in the
 * error message (only the fixed action verb), so no secret can leak.
 */
function psDpapi(
  action: "protect" | "unprotect",
  scope: DpapiScope,
  payload: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const encodedScript = Buffer.from(DPAPI_STUB, "utf16le").toString("base64");
    const child = spawn(powershellExe(), [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedScript,
    ]);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Force-terminate the wedged child so it does not linger. The error
      // names only the fixed action verb ("protect"/"unprotect"), never the
      // payload, so no secret material can leak into logs.
      try {
        child.kill("SIGKILL");
      } catch {
        // Child already gone; nothing to kill.
      }
      reject(
        new Error(
          `powershell DPAPI '${action}' timed out after ` +
            `${PS_DPAPI_TIMEOUT_MS}ms; killed the child process`
        )
      );
    }, PS_DPAPI_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error(`powershell ${code}: ${stderr.trim()}`));
      else resolve(stdout);
    });

    if (!child.stdin) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error("powershell stdin unavailable"));
      }
      return;
    }
    // Stdin contract: action newline scope newline payload, then EOF.
    child.stdin.write(`${action}\n`);
    child.stdin.write(`${scope}\n`);
    child.stdin.write(payload);
    child.stdin.end();
  });
}

// ---------- macOS: Keychain -----------------------------------------------

async function storeMacOsKeychain(secret: string, account: string): Promise<void> {
  await spawn1("security", [
    "delete-generic-password",
    "-s",
    SERVICE,
    "-a",
    account,
  ]).catch(() => void 0);
  await spawn1("security", [
    "add-generic-password",
    "-s",
    SERVICE,
    "-a",
    account,
    "-w",
    secret,
  ]);
}

async function loadMacOsKeychain(account: string): Promise<SecretLoad> {
  try {
    const out = await spawn1("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      account,
      "-w",
    ]);
    const value = out.trim();
    return value ? { status: "ok", value } : { status: "absent" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // `security` exits 44 and says "could not be found" when the item does not
    // exist; every other failure (locked keychain, spawn error, timeout) means
    // the item may well exist and must not be treated as absent.
    if (/ 44:|could not be found/i.test(msg)) return { status: "absent" };
    return { status: "error", reason: msg };
  }
}

// Hard ceiling on how long we wait for a `security` child, mirroring the
// Windows psDpapi timeout. macOS is a supported deployment target, so a hung
// `security` process (a stuck Keychain unlock prompt, an MDM/EDR stall) is
// the same M-A4 failure mode: loadMacOsKeychain never resolves, the outbox
// flush loop stays pinned under its flushInFlight guard, and the agent runs
// but ships nothing. On expiry we kill the child and reject.
const SECURITY_TIMEOUT_MS = 30_000;

function spawn1(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Force-terminate the wedged child so it cannot linger. The message
      // names only the binary (`cmd`), never `args`: the store path passes
      // the secret via `security add-generic-password -w <secret>` on argv,
      // so `args` must never reach a log or error string.
      try {
        child.kill("SIGKILL");
      } catch {
        // Child already gone; nothing to kill.
      }
      reject(
        new Error(
          `${cmd} timed out after ${SECURITY_TIMEOUT_MS}ms; killed the child process`
        )
      );
    }, SECURITY_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    // Without this handler a spawn failure (binary missing, EACCES, fork
    // limit) emits an "error" event with no listener, which Node re-throws
    // as an uncaught exception and takes the whole agent down. Reject so the
    // caller's failure path runs instead. The rejection carries only the
    // spawn error (e.g. ENOENT), never any secret.
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${cmd} ${code}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

// ---------- Linux: plaintext fallback -------------------------------------

async function storeLinuxFile(secret: string, filename: string): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  const path = join(configDir(), filename);
  await writeFile(path, secret, "utf8");
  await chmod(path, 0o600);
  console.warn(
    `[secure-store] linux: ${filename} written to plaintext with 0600. Install on a managed host.`
  );
}

async function loadLinuxFile(filename: string): Promise<SecretLoad> {
  const path = join(configDir(), filename);
  try {
    const s = (await readFile(path, "utf8")).trim();
    return s ? { status: "ok", value: s } : { status: "absent" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent" };
    }
    return { status: "error", reason: (err as Error).message };
  }
}
