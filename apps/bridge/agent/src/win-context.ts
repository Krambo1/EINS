import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import { win32 } from "node:path";
import iconv from "iconv-lite";

/**
 * Small Windows-context helpers shared by the data-dir hardening, the
 * scheduled-task installer and the folder checks:
 *
 *   - an injectable `ExecFn` (execFile, never a shell) so every test drives the
 *     icacls / schtasks / fsutil invocations through a fake, never a real tool;
 *   - absolute paths to the System32 tools. The agent runs as SYSTEM, and a
 *     bare "icacls" would be resolved through PATH / the working directory;
 *   - "am I elevated" and "am I SYSTEM" probes.
 */

export interface ExecResult {
  /** Process exit code; -1 when the process could not be started or timed out. */
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  file: string,
  args: string[],
  opts?: { timeoutMs?: number }
) => Promise<ExecResult>;

type EnvLike = Record<string, string | undefined>;

/** Case-insensitive env lookup that also works on plain objects (tests). */
export function envGet(env: EnvLike, name: string): string | undefined {
  if (env[name] !== undefined) return env[name];
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower) return env[key];
  }
  return undefined;
}

export function systemRoot(env: EnvLike = process.env): string {
  return envGet(env, "SystemRoot") || envGet(env, "windir") || "C:\\Windows";
}

/** Absolute path of a System32 tool, e.g. systemTool("icacls.exe"). */
export function systemTool(name: string, env: EnvLike = process.env): string {
  return win32.join(systemRoot(env), "System32", name);
}

/**
 * Absolute path of Windows PowerShell 5.1. The DPAPI stub runs as SYSTEM, and a
 * bare "powershell.exe" would be resolved through the working directory and PATH.
 */
export function powershellExe(env: EnvLike = process.env): string {
  return win32.join(
    systemRoot(env),
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
}

/** The system drive with colon and no trailing slash, upper-cased: "C:". */
export function systemDrive(env: EnvLike = process.env): string {
  const raw = envGet(env, "SystemDrive") || win32.parse(systemRoot(env)).root;
  const m = /^([A-Za-z]):/.exec(raw);
  return m ? `${m[1]!.toUpperCase()}:` : "C:";
}

/**
 * Windows console tools print in the OEM code page (850 on a German system),
 * not UTF-8. Decode accordingly so umlauts in schtasks / icacls messages are
 * not mangled when we echo them to the operator.
 */
export function decodeOem(buf: Buffer): string {
  try {
    return iconv.decode(buf, "cp850");
  } catch {
    return buf.toString("utf8");
  }
}

export const defaultExec: ExecFn = (file, args, opts) =>
  new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        {
          windowsHide: true,
          timeout: opts?.timeoutMs ?? 60_000,
          encoding: "buffer",
          maxBuffer: 8 * 1024 * 1024,
        },
        (err, stdout, stderr) => {
          const out = decodeOem(Buffer.from(stdout ?? []));
          const errOut = decodeOem(Buffer.from(stderr ?? []));
          if (!err) {
            resolve({ code: 0, stdout: out, stderr: errOut });
            return;
          }
          const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
          resolve({
            code: typeof code === "number" ? code : -1,
            stdout: out,
            stderr: errOut || err.message,
          });
        }
      );
    } catch (err) {
      resolve({ code: -1, stdout: "", stderr: (err as Error).message });
    }
  });

/**
 * True when the current process holds an elevated token (or is SYSTEM).
 *
 * `fsutil dirty query <systemdrive>` needs elevation and, unlike `net session`,
 * does not depend on the Server service being enabled (it is often disabled on
 * hardened Praxis PCs). Exit 0 = elevated. Anything else (access denied,
 * fsutil missing) = not elevated.
 */
export async function isElevated(
  exec: ExecFn = defaultExec,
  env: EnvLike = process.env
): Promise<boolean> {
  const res = await exec(systemTool("fsutil.exe", env), [
    "dirty",
    "query",
    systemDrive(env),
  ]);
  return res.code === 0;
}

/**
 * True when the process runs as the LocalSystem account (a scheduled task or
 * service principal S-1-5-18). SYSTEM's profile lives under
 * ...\config\systemprofile, which is the second signal in case the user name is
 * ever reported differently.
 */
export function isRunningAsSystem(
  env: EnvLike = process.env,
  userInfoFn: () => { username: string } = userInfo
): boolean {
  try {
    if (userInfoFn().username.toUpperCase() === "SYSTEM") return true;
  } catch {
    // userInfo() can throw when the account has no passwd entry; fall through
    // to the profile-path signal.
  }
  const profile = envGet(env, "USERPROFILE") ?? "";
  return /systemprofile/i.test(profile);
}

/**
 * Quote one argument for a Windows command line so that CommandLineToArgvW
 * (and the C runtime) parse it back to exactly `arg`: backslashes are literal
 * except directly before a double quote, so a run of backslashes that precedes
 * an embedded quote, or the closing quote, is doubled. Without this a path such
 * as "C:\Pfad\" swallows its closing quote and the rest of the command line.
 * `force` quotes even when no quoting is needed.
 */
export function quoteWindowsArg(arg: string, force = false): string {
  if (!force && arg !== "" && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === "\\") {
      backslashes++;
    } else if (ch === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
    } else {
      out += "\\".repeat(backslashes) + ch;
      backslashes = 0;
    }
  }
  return out + "\\".repeat(backslashes * 2) + '"';
}

/** Join arguments into one Windows command line (each quoted only when needed). */
export function buildWindowsCommandLine(args: string[]): string {
  return args.map((a) => quoteWindowsArg(a)).join(" ");
}
