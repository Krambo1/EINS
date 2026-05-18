import { spawn } from "node:child_process";
import { writeFile, readFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { configDir } from "./config.js";

/**
 * Cross-platform secure secret storage for the per-clinic PVS HMAC secret.
 *
 *   Windows: DPAPI via PowerShell ProtectedData (CurrentUser scope).
 *   macOS:   Keychain via `security add-generic-password` / `find-generic-password`.
 *   Linux:   $XDG_RUNTIME_DIR/eins-agent/secret with 0600 — best-effort fallback.
 *
 * The secret is a 64-char hex string (32 bytes) minted by the portal at
 * enrollment time. It never leaves the host once stored.
 */

const SERVICE = "EINS-Agent";
const ACCOUNT = "pvs-hmac-secret";

export async function storeSecret(secret: string): Promise<void> {
  if (process.platform === "win32") return storeWindows(secret);
  if (process.platform === "darwin") return storeMacOs(secret);
  return storeLinux(secret);
}

export async function loadSecret(): Promise<string | null> {
  if (process.platform === "win32") return loadWindows();
  if (process.platform === "darwin") return loadMacOs();
  return loadLinux();
}

// ----- Windows: DPAPI via PowerShell --------------------------------

async function storeWindows(secret: string): Promise<void> {
  const blob = await ps(`
    $bytes = [Text.Encoding]::UTF8.GetBytes('${escapePs(secret)}');
    $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser');
    [Convert]::ToBase64String($protected)
  `);
  await mkdir(configDir(), { recursive: true });
  const path = join(configDir(), "secret.dpapi");
  await writeFile(path, blob.trim(), "utf8");
}

async function loadWindows(): Promise<string | null> {
  try {
    const path = join(configDir(), "secret.dpapi");
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

// ----- macOS: Keychain ----------------------------------------------

async function storeMacOs(secret: string): Promise<void> {
  // Remove existing entry, then add fresh (idempotent rotation).
  await spawn1("security", [
    "delete-generic-password",
    "-s",
    SERVICE,
    "-a",
    ACCOUNT,
  ]).catch(() => void 0);
  await spawn1("security", [
    "add-generic-password",
    "-s",
    SERVICE,
    "-a",
    ACCOUNT,
    "-w",
    secret,
  ]);
}

async function loadMacOs(): Promise<string | null> {
  try {
    const out = await spawn1("security", [
      "find-generic-password",
      "-s",
      SERVICE,
      "-a",
      ACCOUNT,
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

// ----- Linux fallback (dev) -----------------------------------------

async function storeLinux(secret: string): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  const path = join(configDir(), "secret.txt");
  await writeFile(path, secret, "utf8");
  await chmod(path, 0o600);
  console.warn(
    "[secure-store] linux: secret written to plaintext file with 0600 — install on a managed host"
  );
}

async function loadLinux(): Promise<string | null> {
  try {
    const path = join(configDir(), "secret.txt");
    const s = await readFile(path, "utf8");
    return s.trim() || null;
  } catch {
    return null;
  }
}
