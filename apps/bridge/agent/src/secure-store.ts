import { spawn } from "node:child_process";
import { writeFile, readFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";

/**
 * Cross-platform secure secret storage.
 *
 *   Windows: DPAPI via PowerShell ProtectedData (CurrentUser scope).
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
 */

const SERVICE = "EINS-Agent";
const ACCOUNT = "pvs-hmac-secret";
const OUTBOX_MASTER_ACCOUNT = "outbox-master-key";

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
  const loaded =
    process.platform === "win32"
      ? await loadWindowsFile("secret.dpapi")
      : process.platform === "darwin"
      ? await loadMacOsKeychain(ACCOUNT)
      : await loadLinuxFile("secret.txt");
  if (loaded) secretCache = loaded;
  return loaded;
}

/** Test-only: clear the in-process secret cache between cases. */
export function _resetSecretCacheForTests(): void {
  secretCache = null;
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
    return loadWindowsFile(`db-cred.${id}.dpapi`);
  }
  if (process.platform === "darwin") {
    return loadMacOsKeychain(`db-cred:${id}`);
  }
  return loadLinuxFile(`db-cred.${id}.txt`);
}

function assertCredentialId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(
      `invalid credentialId '${id}': must match [A-Za-z0-9_-]{1,64}`
    );
  }
}

// ---------- Windows: DPAPI via PowerShell ---------------------------------

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
 *   • First line: action verb ("protect" or "unprotect").
 *   • Remainder:  the payload — plaintext to protect, or base64 ciphertext
 *                 to unprotect. Trailing whitespace is trimmed.
 *
 * stdout receives the result (base64 ciphertext for protect, plaintext for
 * unprotect). On unknown action the stub exits 2.
 */
const DPAPI_STUB = `
Add-Type -AssemblyName System.Security
$reader = [Console]::In
$action = $reader.ReadLine()
$payload = $reader.ReadToEnd()
if ($payload -ne $null) { $payload = $payload.Trim() }
if ($action -eq 'protect') {
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
  [Convert]::ToBase64String($protected) | Write-Output
}
elseif ($action -eq 'unprotect') {
  $bytes = [Convert]::FromBase64String($payload)
  $unprotected = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
  [Text.Encoding]::UTF8.GetString($unprotected) | Write-Output
}
else {
  Write-Error "unknown action"
  exit 2
}
`.trim();

async function storeWindowsFile(secret: string, filename: string): Promise<void> {
  const blob = await psDpapi("protect", secret);
  await mkdir(configDir(), { recursive: true });
  const path = join(configDir(), filename);
  await writeFile(path, blob.trim(), "utf8");
}

async function loadWindowsFile(filename: string): Promise<string | null> {
  try {
    const path = join(configDir(), filename);
    const blob = (await readFile(path, "utf8")).trim();
    const out = await psDpapi("unprotect", blob);
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Run the DPAPI stub. Command-line arguments are:
 *
 *   powershell.exe -NoProfile -NonInteractive -EncodedCommand <b64>
 *
 * The `<b64>` is UTF-16-LE-encoded base64 of the FIXED stub script. It
 * does NOT contain any secret material; the secret travels via stdin.
 * That distinction is the whole point: even when the Windows process
 * listing exposes the command line of every running powershell.exe, the
 * sensitive bytes are not visible to other processes.
 */
function psDpapi(action: "protect" | "unprotect", payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const encodedScript = Buffer.from(DPAPI_STUB, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedScript,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`powershell ${code}: ${stderr.trim()}`));
      else resolve(stdout);
    });

    if (!child.stdin) {
      reject(new Error("powershell stdin unavailable"));
      return;
    }
    // Stdin contract: action newline payload, then EOF.
    child.stdin.write(`${action}\n`);
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

async function loadMacOsKeychain(account: string): Promise<string | null> {
  try {
    const out = await spawn1("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      account,
      "-w",
    ]);
    return out.trim() || null;
  } catch {
    return null;
  }
}

function spawn1(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
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

async function loadLinuxFile(filename: string): Promise<string | null> {
  try {
    const path = join(configDir(), filename);
    const s = await readFile(path, "utf8");
    return s.trim() || null;
  } catch {
    return null;
  }
}
