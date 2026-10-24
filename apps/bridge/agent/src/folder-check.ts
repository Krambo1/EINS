import { stat } from "node:fs/promises";
import { isRunningAsSystem, systemDrive } from "./win-context.js";

/**
 * H13.1: find the configured watch folders the agent cannot actually read.
 *
 * A wrong or not-yet-created watch folder otherwise makes chokidar watch
 * nothing, the catch-up readdir swallow its error, and the agent stay green
 * while zero events flow forever. The agent stats every configured folder at
 * boot (and hourly after) and warns loudly, by exact path, on any miss.
 *
 * The REASON matters as much as the miss. As a LocalSystem service a mapped
 * drive letter (Z:\) simply does not exist, and an SMB share can answer
 * EACCES/EPERM because SYSTEM carries no network credentials; "folder missing"
 * for those sends the operator checking a path that is perfectly fine for
 * their own login. So each problem folder comes back with a structured reason
 * and, where we can tell, a hint.
 *
 * Pure but for the injected `statFn`, which defaults to node:fs stat and is
 * overridable in tests.
 */

export type FolderProblemReason =
  /** ENOENT / ENOTDIR: the path does not exist. */
  | "missing"
  /** EACCES / EPERM: it may exist, but this account may not look at it. */
  | "no_access"
  /** The path exists but is a file, not a directory. */
  | "not_a_directory"
  /** Any other stat failure (I/O error, unreachable network share, ...). */
  | "unreachable";

export type FolderHint =
  /** Running as SYSTEM and the path uses a non-system drive letter. */
  | "mapped_drive"
  /** Running as SYSTEM and a UNC share was refused: SYSTEM has no network login. */
  | "unc_as_system";

export interface FolderProblem {
  path: string;
  reason: FolderProblemReason;
  /** errno code when there was one, e.g. "ENOENT". */
  code?: string;
  hint?: FolderHint;
}

export interface FolderCheckOptions {
  statFn?: (p: string) => Promise<unknown>;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  /** Test seam; defaults to isRunningAsSystem(env). */
  runningAsSystem?: boolean;
  /** Per-folder stat budget in ms (default 10 s). */
  timeoutMs?: number;
}

/**
 * An offline UNC share can make stat() hang for the OS network timeout (minutes).
 * The agent awaits this at start, so an unbounded stat held back the flush loop
 * and the first heartbeat. A folder that does not answer in time is reported as
 * unreachable; the hourly re-check picks it up when the share is back.
 */
const FOLDER_STAT_TIMEOUT_MS = 10_000;

function statWithTimeout(
  statFn: (p: string) => Promise<unknown>,
  folder: string,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(new Error(`stat of ${folder} timed out after ${timeoutMs}ms`), {
          code: "ETIMEDOUT",
        })
      );
    }, timeoutMs);
    // A pending timer must never keep the process alive.
    timer.unref?.();
    statFn(folder).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

const MISSING_CODES = new Set(["ENOENT", "ENOTDIR"]);
const NO_ACCESS_CODES = new Set(["EACCES", "EPERM"]);

function classify(err: unknown): { reason: FolderProblemReason; code?: string } {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string") {
    if (MISSING_CODES.has(code)) return { reason: "missing", code };
    if (NO_ACCESS_CODES.has(code)) return { reason: "no_access", code };
    return { reason: "unreachable", code };
  }
  // No errno code at all (an injected stub that throws a bare Error): the old
  // contract treated every stat failure as "missing", keep that.
  return { reason: "missing" };
}

function hintFor(
  path: string,
  reason: FolderProblemReason,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  asSystem: boolean
): FolderHint | undefined {
  if (platform !== "win32" || !asSystem) return undefined;
  const drive = /^([A-Za-z]):[\\/]/.exec(path) ?? /^([A-Za-z]):$/.exec(path);
  if (
    drive &&
    reason === "missing" &&
    `${drive[1]!.toUpperCase()}:` !== systemDrive(env)
  ) {
    return "mapped_drive";
  }
  if (
    /^\\\\[^\\]/.test(path) &&
    (reason === "no_access" || reason === "missing" || reason === "unreachable")
  ) {
    return "unc_as_system";
  }
  return undefined;
}

/**
 * Check every folder; returns one FolderProblem per folder that is not a
 * readable directory. Empty / falsy entries are skipped.
 */
export async function checkFolders(
  folders: string[],
  opts: FolderCheckOptions = {}
): Promise<FolderProblem[]> {
  const statFn = opts.statFn ?? ((p: string) => stat(p));
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const asSystem =
    opts.runningAsSystem ??
    (platform === "win32" ? isRunningAsSystem(env) : false);
  const timeoutMs = opts.timeoutMs ?? FOLDER_STAT_TIMEOUT_MS;
  // All folders in parallel: two dead shares cost one timeout, not two.
  const results = await Promise.all(
    folders.map(async (folder): Promise<FolderProblem | null> => {
      if (!folder) return null;
      try {
        const st = (await statWithTimeout(statFn, folder, timeoutMs)) as
          | { isDirectory?: () => boolean }
          | undefined;
        if (st && typeof st.isDirectory === "function" && !st.isDirectory()) {
          return { path: folder, reason: "not_a_directory" };
        }
        return null;
      } catch (err) {
        const { reason, code } = classify(err);
        const hint = hintFor(folder, reason, platform, env, asSystem);
        return {
          path: folder,
          reason,
          ...(code ? { code } : {}),
          ...(hint ? { hint } : {}),
        };
      }
    })
  );
  const problems: FolderProblem[] = results.filter(
    (p): p is FolderProblem => p !== null
  );
  return problems;
}

/**
 * Back-compat export: the paths of every folder with ANY problem, in the order
 * given. Heartbeat code only needs the list of paths; the log line uses
 * `checkFolders` + `describeFolderProblem` for the reason.
 */
export async function findMissingFolders(
  folders: string[],
  statFn: (p: string) => Promise<unknown> = (p) => stat(p)
): Promise<string[]> {
  return (await checkFolders(folders, { statFn })).map((p) => p.path);
}

/** One operator-readable line (German first, English after) per problem. */
export function describeFolderProblem(p: FolderProblem): string {
  let base: string;
  switch (p.reason) {
    case "missing":
      base =
        `${p.path}: Ordner nicht gefunden / folder does not exist`;
      break;
    case "no_access":
      base =
        `${p.path}: kein Zugriff (${p.code ?? "EACCES"}) / access denied`;
      break;
    case "not_a_directory":
      base = `${p.path}: ist kein Ordner / is not a directory`;
      break;
    default:
      base =
        `${p.path}: nicht erreichbar (${p.code ?? "Fehler"}) / cannot be reached`;
  }
  if (p.hint === "mapped_drive") {
    return (
      `${base}. Der Agent läuft unter dem SYSTEM-Konto und sieht keine verbundenen ` +
      `Netzlaufwerke (Buchstabe ${p.path.slice(0, 2)}). Falls es ein Netzlaufwerk ist, ` +
      `bitte den UNC-Pfad (\\\\server\\freigabe\\ordner) als Ordner einrichten. ` +
      `/ The agent runs as the SYSTEM account, which cannot see mapped drive letters; ` +
      `configure the UNC path (\\\\server\\share\\folder) instead.`
    );
  }
  if (p.hint === "unc_as_system") {
    return (
      `${base}. Das SYSTEM-Konto meldet sich an Netzfreigaben als Computerkonto ` +
      `(Arbeitsgruppe: anonym) an. Bitte der Freigabe Lesezugriff für das Computerkonto ` +
      `(DOMÄNE\\PCNAME$) bzw. "Jeder" geben, oder den Ordner lokal bereitstellen. ` +
      `/ The SYSTEM account authenticates to network shares as the computer account ` +
      `(anonymous in a workgroup); grant that account read access to the share.`
    );
  }
  return base;
}
