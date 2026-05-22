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

// ---------- PVS HMAC secret ------------------------------------------------

export async function storeSecret(secret: string): Promise<void> {
  if (process.platform === "win32") return storeWindowsFile(secret, "secret.dpapi");
  if (process.platform === "darwin") return storeMacOsKeychain(secret, ACCOUNT);
  return storeLinuxFile(secret, "secret.txt");
}

export async function loadSecret(): Promise<string | null> {
  if (process.platform === "win32") return loadWindowsFile("secret.dpapi");
  if (process.platform === "darwin") return loadMacOsKeychain(ACCOUNT);
  return loadLinuxFile("secret.txt");
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

async function storeWindowsFile(secret: string, filename: string): Promise<void> {
  const blob = await ps(`
    $bytes = [Text.Encoding]::UTF8.GetBytes('${escapePs(secret)}');
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser');
    [Convert]::ToBase64String($protected)
  `);
  await mkdir(configDir(), { recursive: true });
  const path = join(configDir(), filename);
  await writeFile(path, blob.trim(), "utf8");
}

async function loadWindowsFile(filename: string): Promise<string | null> {
  try {
    const path = join(configDir(), filename);
    const blob = (await readFile(path, "utf8")).trim();
    const out = await ps(`
      $bytes = [Convert]::FromBase64String('${escapePs(blob)}');
      $unprotected = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser');
      [Text.Encoding]::UTF8.GetString($unprotected)
    `);
    return out.trim() || null;
  } catch {
    return null;
  }
}

function ps(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Security; ${script}`,
    ]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`powershell ${code}: ${stderr}`));
      else resolve(stdout);
    });
  });
}

function escapePs(s: string): string {
  return s.replace(/'/g, "''");
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
