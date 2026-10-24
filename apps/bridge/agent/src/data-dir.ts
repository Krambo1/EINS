import { access, constants, lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir, dataDirIsOverridden } from "./config.js";
import {
  SID_ADMINS,
  SID_SYSTEM,
  decodeIcaclsSave,
  parseAces,
  parseIcaclsSave,
  unexpectedTrustees,
} from "./sddl.js";
import {
  defaultExec,
  isElevated,
  systemTool,
  type ExecFn,
} from "./win-context.js";

/**
 * Creation and lock-down of the machine-wide data directory.
 *
 * Why this matters. The agent keeps patient events (outbox.sqlite), the portal
 * HMAC secret and DB credentials (DPAPI blobs) in %ProgramData%\EINS-Agent.
 * ProgramData grants BUILTIN\Users read access by default and lets any user
 * create folders in it, so a plain mkdir leaves all of this readable by every
 * Windows account on the PC. Secrets are DPAPI-protected with LocalMachine
 * scope (secure-store.ts), which ANY process on the machine that can read the
 * blob can decrypt. The directory ACL is therefore the real protection
 * boundary, and it is applied here:
 *
 *   - inheritance removed, full control for SYSTEM (S-1-5-18) and
 *     Administrators (S-1-5-32-544) only. SIDs, not account names, so it works
 *     on any Windows language;
 *   - owner set to Administrators, children's explicit ACEs reset. This closes
 *     the pre-creation attack: a non-admin user may create
 *     C:\ProgramData\EINS-Agent before the installer does and would otherwise
 *     keep owning it (an owner can always rewrite the DACL);
 *   - a junction or symlink at the data dir path is refused;
 *   - the result is verified by reading the DACL back (SDDL), because icacls
 *     reports success for operations that only partly applied.
 *
 * Every external call goes through the injected `exec` (execFile, no shell),
 * so tests never touch a real ACL.
 */

export class DataDirError extends Error {
  readonly code: "NOT_ELEVATED" | "NO_ACCESS" | "UNSAFE_PATH" | "MKDIR_FAILED";
  constructor(code: DataDirError["code"], message: string) {
    super(message);
    this.name = "DataDirError";
    this.code = code;
  }
}

export interface HardenStep {
  label: string;
  /** icacls arguments (the tool path is added by the runner). */
  args: string[];
  /** Skip when the directory has no children (icacls errors on an empty glob). */
  onlyWithChildren?: boolean;
}

/**
 * The lock-down sequence. Order matters: the grant comes FIRST so the
 * directory is closed to ordinary users as early as possible; owner and
 * children are fixed up afterwards.
 *
 * `/C` is deliberately NOT used: with /C icacls swallows per-file errors and
 * still exits 0 (verified on Windows 11), which would make the exit-code check
 * meaningless.
 */
export function buildHardenSteps(dir: string): HardenStep[] {
  return [
    {
      label: "restrict-dacl",
      args: [
        dir,
        "/inheritance:r",
        "/grant:r",
        `*${SID_SYSTEM}:(OI)(CI)F`,
        `*${SID_ADMINS}:(OI)(CI)F`,
        "/Q",
      ],
    },
    {
      label: "set-owner",
      args: [dir, "/setowner", `*${SID_ADMINS}`, "/T", "/Q"],
    },
    {
      label: "reset-children",
      args: [join(dir, "*"), "/reset", "/T", "/Q"],
      onlyWithChildren: true,
    },
  ];
}

export interface AclVerification {
  ok: boolean;
  problems: string[];
}

/**
 * Read the DACL of `dir` and everything below it back and check that nobody
 * but SYSTEM and Administrators holds an allow ACE.
 */
export async function verifyDirAcl(
  dir: string,
  exec: ExecFn,
  env: Record<string, string | undefined> = process.env
): Promise<AclVerification> {
  const saveFile = join(
    tmpdir(),
    `eins-acl-${randomBytes(6).toString("hex")}.txt`
  );
  try {
    const res = await exec(systemTool("icacls.exe", env), [
      dir,
      "/save",
      saveFile,
      "/T",
      "/Q",
    ]);
    if (res.code !== 0) {
      return {
        ok: false,
        problems: [
          `icacls /save failed (exit ${res.code}): ${(res.stderr || res.stdout).trim()}`,
        ],
      };
    }
    let text: string;
    try {
      text = decodeIcaclsSave(await readFile(saveFile));
    } catch (err) {
      return {
        ok: false,
        problems: [`could not read the saved ACL: ${(err as Error).message}`],
      };
    }
    const records = parseIcaclsSave(text);
    if (records.length === 0) {
      return { ok: false, problems: ["icacls /save produced no ACL records"] };
    }
    const problems: string[] = [];
    const [root, ...rest] = records;
    const rootAces = parseAces(root!.sddl);
    const holders = new Set(
      rootAces.filter((a) => a.type === "A").map((a) => a.trustee)
    );
    if (!holders.has(SID_SYSTEM) || !holders.has(SID_ADMINS)) {
      problems.push("the data dir DACL lacks a grant for SYSTEM and/or Administrators");
    }
    for (const rec of [root!, ...rest]) {
      const extra = unexpectedTrustees(parseAces(rec.sddl), [
        SID_SYSTEM,
        SID_ADMINS,
      ]);
      if (extra.length > 0) {
        problems.push(
          `${rec.name || "(data dir)"} is accessible to: ${extra.join(", ")}`
        );
      }
    }
    return { ok: problems.length === 0, problems };
  } finally {
    await rm(saveFile, { force: true }).catch(() => {});
  }
}

export interface EnsureDataDirOptions {
  /** Directory to prepare. Defaults to configDir(). */
  dir?: string;
  /**
   * Apply / verify the Windows ACL. Defaults to true on win32 for the default
   * location, false for an EINS_AGENT_DATA_DIR override and on other
   * platforms.
   */
  harden?: boolean;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  exec?: ExecFn;
  /** Test seam: skip the fsutil probe. */
  elevated?: boolean;
  warn?: (msg: string) => void;
}

export interface EnsureDataDirResult {
  dir: string;
  created: boolean;
  /** The ACL was verified tight (applied now or already in place). */
  aclVerified: boolean;
  warnings: string[];
}

/**
 * Make sure the data dir exists and (on Windows, default location) is locked
 * down. Never crashes on an ACL problem that leaves the agent usable: those
 * become loud warnings. It DOES throw DataDirError when the directory cannot
 * be used safely or at all (symlink at the path, no elevation to create it,
 * no access).
 */
export async function ensureDataDir(
  opts: EnsureDataDirOptions = {}
): Promise<EnsureDataDirResult> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const dir = opts.dir ?? configDir();
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
    (opts.warn ?? ((m: string) => console.warn(m)))(msg);
  };
  const harden =
    opts.harden ?? (platform === "win32" && !dataDirIsOverridden({ platform, env, home: "" }));

  if (platform === "win32" && !harden && dataDirIsOverridden({ platform, env, home: "" })) {
    warn(
      `[data-dir] WARNUNG / WARNING: EINS_AGENT_DATA_DIR is set (${dir}). ` +
        `The agent does not manage the ACL of a custom data directory. ` +
        `Patient data and DPAPI machine-scope secrets there must be restricted ` +
        `to SYSTEM and Administrators by you.`
    );
  }

  // Refuse a symlink/junction at the data dir path: it would redirect every
  // secret and the outbox to wherever the link points.
  let existed = false;
  try {
    const st = await lstat(dir);
    existed = true;
    if (st.isSymbolicLink()) {
      throw new DataDirError(
        "UNSAFE_PATH",
        `Das Datenverzeichnis ${dir} ist ein Symlink/eine Junction und wird nicht verwendet. ` +
          `Bitte entfernen und neu starten. / The data directory ${dir} is a symlink or ` +
          `junction and is refused; remove it and start again.`
      );
    }
    if (!st.isDirectory()) {
      throw new DataDirError(
        "UNSAFE_PATH",
        `${dir} existiert, ist aber kein Verzeichnis. / ${dir} exists but is not a directory.`
      );
    }
  } catch (err) {
    if (err instanceof DataDirError) throw err;
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new DataDirError(
        "NO_ACCESS",
        `Kein Zugriff auf ${dir}: ${(err as Error).message}. Bitte als Administrator ausführen. / ` +
          `Cannot access ${dir}: ${(err as Error).message}. Run from an elevated prompt.`
      );
    }
  }

  if (!harden) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      throw new DataDirError(
        "MKDIR_FAILED",
        `Datenverzeichnis ${dir} konnte nicht angelegt werden: ${(err as Error).message} / ` +
          `could not create the data directory.`
      );
    }
    return { dir, created: !existed, aclVerified: false, warnings };
  }

  const exec = opts.exec ?? defaultExec;
  const elevated = opts.elevated ?? (await isElevated(exec, env));

  if (!elevated) {
    if (!existed) {
      throw new DataDirError(
        "NOT_ELEVATED",
        `Das Datenverzeichnis ${dir} existiert noch nicht und kann nur mit Administratorrechten ` +
          `angelegt werden. Bitte die Eingabeaufforderung per Rechtsklick "Als Administrator ausführen" ` +
          `öffnen und den Befehl erneut starten. / The data directory ${dir} does not exist yet and ` +
          `needs an elevated (Administrator) prompt to be created and locked down. ` +
          `For development set EINS_AGENT_DATA_DIR to a writable folder.`
      );
    }
    try {
      await access(dir, constants.R_OK | constants.W_OK);
    } catch {
      throw new DataDirError(
        "NO_ACCESS",
        `Kein Zugriff auf ${dir}. Das Verzeichnis ist nur für SYSTEM und Administratoren lesbar. ` +
          `Bitte als Administrator ausführen. / No access to ${dir}: it is restricted to SYSTEM ` +
          `and Administrators. Run from an elevated prompt.`
      );
    }
    warn(
      `[data-dir] Hinweis / note: not elevated, the ACL of ${dir} was not verified.`
    );
    return { dir, created: false, aclVerified: false, warnings };
  }

  try {
    await mkdir(dir, { recursive: true });
  } catch (err) {
    throw new DataDirError(
      "MKDIR_FAILED",
      `Datenverzeichnis ${dir} konnte nicht angelegt werden: ${(err as Error).message} / ` +
        `could not create the data directory.`
    );
  }

  // Already tight (the normal case on every restart)? Then change nothing:
  // re-running /reset would briefly re-expose the directory to Users.
  let verification = await verifyDirAcl(dir, exec, env);
  if (!verification.ok) {
    const failures: string[] = [];
    let hasChildren = true;
    try {
      hasChildren = (await readdir(dir)).length > 0;
    } catch {
      // Treat unreadable as "has children": the reset step reports its own error.
    }
    for (const step of buildHardenSteps(dir)) {
      if (step.onlyWithChildren && !hasChildren) continue;
      const res = await exec(systemTool("icacls.exe", env), step.args);
      if (res.code !== 0) {
        failures.push(
          `${step.label} (exit ${res.code}): ${(res.stderr || res.stdout).trim()}`
        );
      }
    }
    verification = await verifyDirAcl(dir, exec, env);
    if (failures.length > 0 || !verification.ok) {
      warn(
        `[data-dir] WARNUNG / WARNING: the ACL of ${dir} could NOT be fully locked down to ` +
          `SYSTEM and Administrators. Patient data and machine-scope secrets there may be ` +
          `readable by other Windows users on this PC. ` +
          [...failures, ...verification.problems].join(" | ") +
          ` Fix manually: icacls "${dir}" /inheritance:r /grant:r *${SID_SYSTEM}:(OI)(CI)F ` +
          `*${SID_ADMINS}:(OI)(CI)F`
      );
    }
  }
  return { dir, created: !existed, aclVerified: verification.ok, warnings };
}
