import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { userInfo } from "node:os";
import { join, win32 } from "node:path";
import { atomicWriteFile } from "./atomic-write.js";
import { getDpapiBackend, type DpapiBackend } from "./secure-store.js";
import { envGet, systemDrive } from "./win-context.js";
import { inspectLock } from "./instance-lock.js";

/**
 * One-time move of the agent's data from the legacy PER-USER directory
 * (%APPDATA%\EINS-Agent of the Windows user who ran `--enroll`) to the
 * machine-wide %ProgramData%\EINS-Agent that the service uses.
 *
 * Trigger: Windows only; the new dir has no config.json AND the legacy dir of
 * the CURRENT user has one. It must run as that user because the legacy DPAPI
 * blobs are bound to that user's account: they are decrypted here and
 * re-protected with machine scope. That is why it runs in the admin's own
 * session, as the first step of `--install-service` and on any normal start
 * made as that user.
 *
 * What moves:
 *   *.dpapi                       decrypted (user scope) and re-protected
 *                                 (machine scope), including db-cred.<id>.dpapi
 *   outbox.sqlite (+ -wal/-shm)   the encrypted queue, with the watcher cursor
 *                                 and adapter state that live inside it
 *   vendor-configs/, logs/ and any other regular file or folder
 *   config.json.bak               then, LAST, config.json
 * Not moved: MIGRATED.txt, lock files, temp files, and the plaintext
 * `outbox.sqlite.legacy-<ts>` forensic copies (they should not spread).
 *
 * Crash safety and idempotence. Every file is copied to a temp name next to its
 * destination, fsynced, then renamed into place. config.json is committed LAST:
 * its existence in the new dir is the "migration complete" marker, so a crash
 * at any earlier point leaves the new dir without config.json and the next run
 * redoes the whole thing over the partial result. Once config.json exists the
 * function is a no-op.
 *
 * The legacy dir is left in place (the operator removes it) with a
 * MIGRATED.txt note. Stop an agent that still runs from the legacy dir BEFORE
 * migrating: its live outbox cannot be copied consistently.
 *
 * When the agent runs as SYSTEM it cannot decrypt another user's blobs. If it
 * finds legacy data under C:\Users\<name>\AppData\Roaming\EINS-Agent it says
 * exactly what to do instead of failing mysteriously on the first DPAPI call.
 */

export type MigrationResult =
  | { status: "not_applicable" }
  | {
      status: "migrated";
      legacyDir: string;
      newDir: string;
      copied: string[];
      reprotected: string[];
    }
  | { status: "unreachable"; legacyDirs: string[]; message: string }
  /** More than one legacy dir exists: nothing was chosen, nothing was copied. */
  | { status: "ambiguous"; legacyDirs: string[]; message: string }
  /** The old agent may still be running: nothing was copied. */
  | { status: "blocked"; message: string }
  | { status: "failed"; error: string };

export interface MigrationOptions {
  newDir: string;
  /** From legacyUserDataDir(); null on non-Windows. */
  legacyDir: string | null;
  /** The process runs as LocalSystem. */
  isSystem: boolean;
  dpapi?: DpapiBackend;
  listOtherUserLegacyDirs?: () => Promise<string[]>;
  /**
   * Also look under every user profile for legacy data (set when running as
   * SYSTEM or elevated). Defaults to `isSystem`.
   */
  scanAllProfiles?: boolean;
  /** Root of the user profiles (default <SystemDrive>\Users); injectable for tests. */
  profilesRoot?: string;
  /** Process liveness probe for lock and temp-file checks (test seam). */
  isPidAlive?: (pid: number) => boolean;
  now?: () => Date;
  log?: (msg: string) => void;
  platform?: NodeJS.Platform;
  userName?: string;
}

const SKIP_NAME = [
  /^MIGRATED\.txt$/i,
  /\.tmp-\d+$/,
  /\.migrating(-\d+)?$/,
  /\.legacy-\d+/,
  /\.lock$/i,
];
const OUTBOX_MAIN = "outbox.sqlite";
const OUTBOX_SIDECARS = ["outbox.sqlite-wal", "outbox.sqlite-shm"];
const RECOVERY_JOURNAL = "enroll-recovery.json";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function skipped(name: string): boolean {
  return SKIP_NAME.some((re) => re.test(name));
}

/** Copy to a temp name beside the destination, fsync, then rename into place. */
async function copyFileAtomic(src: string, dst: string): Promise<void> {
  const tmp = `${dst}.migrating-${process.pid}`;
  try {
    await copyFile(src, tmp);
    const fh = await open(tmp, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const [a, b] = await Promise.all([stat(src), stat(tmp)]);
    if (a.size !== b.size) {
      throw new Error(`copy of ${src} is incomplete (${b.size} of ${a.size} bytes)`);
    }
    await renameWithRetry(tmp, dst);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      lastErr = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
  throw lastErr;
}

async function copyTree(
  srcDir: string,
  dstDir: string,
  copied: string[],
  rel = ""
): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  for (const e of await readdir(srcDir, { withFileTypes: true })) {
    if (skipped(e.name)) continue;
    const src = join(srcDir, e.name);
    const dst = join(dstDir, e.name);
    if (e.isSymbolicLink()) continue; // never follow links out of the legacy dir
    if (e.isDirectory()) {
      await copyTree(src, dst, copied, `${rel}${e.name}/`);
    } else if (e.isFile()) {
      await copyFileAtomic(src, dst);
      copied.push(`${rel}${e.name}`);
    }
  }
}

/** C:\Users\<name>\AppData\Roaming\EINS-Agent dirs that hold a config.json. */
export async function listOtherUserLegacyDirs(
  env: Record<string, string | undefined> = process.env,
  profilesRoot?: string
): Promise<string[]> {
  const usersRoot = profilesRoot ?? win32.join(`${systemDrive(env)}\\`, "Users");
  const found: string[] = [];
  let names: string[];
  try {
    names = await readdir(usersRoot);
  } catch {
    return [];
  }
  for (const name of names) {
    if (/^(public|default|default user|all users)$/i.test(name)) continue;
    const dir = join(usersRoot, name, "AppData", "Roaming", "EINS-Agent");
    if (await exists(join(dir, "config.json"))) found.push(dir);
  }
  return found;
}

const TEMP_COPY = /\.migrating-(\d+)$/;
const STALE_TEMP_MS = 60 * 60_000;
/** A WAL younger than this means a writer was active a moment ago. */
const ACTIVE_WAL_MS = 2 * 60_000;

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Remove `*.migrating-<pid>` temp copies that an interrupted migration left
 * behind: the owning process is gone, or the file is older than an hour. With
 * `includeOwn` the current process's temp files go too (after a failure).
 * Never throws.
 */
export async function cleanupMigrationTemps(
  dir: string,
  opts: { isPidAlive?: (pid: number) => boolean; now?: () => Date; includeOwn?: boolean } = {}
): Promise<string[]> {
  const alive = opts.isPidAlive ?? defaultPidAlive;
  const nowMs = (opts.now ?? (() => new Date()))().getTime();
  const removed: string[] = [];
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) {
        await walk(full);
        continue;
      }
      const m = TEMP_COPY.exec(e.name);
      if (!m || !e.isFile()) continue;
      const pid = Number(m[1]);
      try {
        const own = pid === process.pid;
        const age = nowMs - (await stat(full)).mtimeMs;
        const stale = !alive(pid) || age >= STALE_TEMP_MS;
        if ((own && opts.includeOwn) || (!own && stale) || (own && stale)) {
          await rm(full, { force: true });
          removed.push(full);
        }
      } catch {
        // leave it for the next run
      }
    }
  };
  await walk(dir);
  return removed;
}

/** Why the old agent in `dir` may still be running; null when it surely is not. */
async function oldAgentActivity(
  dir: string,
  alive: (pid: number) => boolean,
  nowMs: number
): Promise<string | null> {
  for (const name of ["agent.lock", "supervisor.lock"]) {
    let state;
    try {
      state = inspectLock(dir, name, { isPidAlive: alive, now: () => nowMs });
    } catch {
      continue;
    }
    if (state.state === "live") {
      return state.holder.pid !== null ? `PID ${state.holder.pid} (${name})` : `${name}`;
    }
  }
  for (const wal of OUTBOX_SIDECARS.slice(0, 1)) {
    try {
      const st = await stat(join(dir, wal));
      if (nowMs - st.mtimeMs < ACTIVE_WAL_MS) return `${wal} wurde gerade beschrieben / was just written`;
    } catch {
      // no WAL: nothing writes
    }
  }
  return null;
}

function migratedNote(newDir: string, when: Date): string {
  return (
    "\uFEFF" +
    [
      `EINS-Agent: Datenübernahme am ${when.toISOString()}`,
      ``,
      `Die Daten des Agenten (Konfiguration, Schlüssel, Warteschlange) wurden in den`,
      `gemeinsamen Datenordner für den Hintergrunddienst kopiert:`,
      `  ${newDir}`,
      ``,
      `Dieser alte Ordner wird nicht mehr benutzt. Falls noch ein Agent als normales Programm`,
      `unter diesem Windows-Benutzer läuft, bitte beenden: zwei Agenten für dieselbe Praxis`,
      `würden Dateien doppelt verarbeiten. Nach erfolgreicher Prüfung des Dienstes darf dieser`,
      `Ordner gelöscht werden. Er enthält weiterhin die alte Warteschlange und die für diesen`,
      `Windows-Benutzer verschlüsselten Schlüssel.`,
      ``,
      `The agent's data (config, keys, queue) was copied to the machine-wide data folder used by`,
      `the background service: ${newDir}`,
      `This old folder is no longer used and may be deleted once the service is verified.`,
      ``,
    ].join("\r\n")
  );
}

export async function migrateLegacyData(
  opts: MigrationOptions
): Promise<MigrationResult> {
  const platform = opts.platform ?? process.platform;
  const log = opts.log ?? ((m: string) => console.log(m));
  if (platform !== "win32" || !opts.legacyDir) return { status: "not_applicable" };
  const legacyDir = opts.legacyDir;
  const newDir = opts.newDir;
  if (win32.resolve(legacyDir).toLowerCase() === win32.resolve(newDir).toLowerCase()) {
    return { status: "not_applicable" };
  }

  if (await exists(join(newDir, "config.json"))) return { status: "not_applicable" };

  const sameDir = (a: string, b: string): boolean =>
    win32.resolve(a).toLowerCase() === win32.resolve(b).toLowerCase();
  const scanAll = opts.scanAllProfiles ?? opts.isSystem;
  const listOthers =
    opts.listOtherUserLegacyDirs ?? (() => listOtherUserLegacyDirs(undefined, opts.profilesRoot));
  const ownHasData = await exists(join(legacyDir, "config.json"));
  const others = scanAll
    ? (await listOthers()).filter((d) => !sameDir(d, legacyDir))
    : [];

  if (ownHasData && others.length > 0) {
    const all = [legacyDir, ...others];
    return {
      status: "ambiguous",
      legacyDirs: all,
      message:
        `Es gibt mehrere Ordner mit Agent-Daten einer älteren Version: ${all.join(", ")}. ` +
        `Es wurde nichts übernommen, weil nicht klar ist, welcher der richtige ist. ` +
        `Bitte nur den Ordner der aktuellen Praxis behalten (die anderen umbenennen oder löschen) ` +
        `und --install-service als der Windows-Benutzer dieses Ordners erneut ausführen. ` +
        `/ Several legacy agent data folders exist: ${all.join(", ")}. Nothing was migrated because ` +
        `it is not clear which one is right. Keep only the folder of this Praxis (rename or delete the ` +
        `others) and run --install-service again as the Windows user who owns it.`,
    };
  }

  if (!ownHasData) {
    if (scanAll) {
      if (others.length > 0) {
        return {
          status: "unreachable",
          legacyDirs: others,
          message:
            `Daten einer älteren Agent-Version liegen im Benutzerprofil (${others.join(", ")}). ` +
            `Der Hintergrunddienst läuft als SYSTEM und kann diese Schlüssel nicht lesen. ` +
            `Bitte einmal als der Windows-Benutzer, der die Einrichtung gemacht hat, ` +
            `\`eins-agent --install-service\` ausführen (als Administrator). ` +
            `/ Legacy per-user agent data was found (${others.join(", ")}) that the SYSTEM service ` +
            `cannot decrypt. Run \`eins-agent --install-service\` once, elevated, as the Windows user ` +
            `who did the setup.`,
        };
      }
    }
    return { status: "not_applicable" };
  }

  const now = opts.now ?? (() => new Date());
  const alive = opts.isPidAlive ?? defaultPidAlive;

  // An old agent that still runs holds the outbox open and keeps writing: a
  // copy taken now would be inconsistent and the old agent would go on
  // processing the same GDT files next to the new service.
  const active = await oldAgentActivity(legacyDir, alive, now().getTime());
  if (active) {
    return {
      status: "blocked",
      message:
        `Der alte Agent läuft noch (${active}) und nutzt ${legacyDir}. Es wurde nichts übernommen. ` +
        `Bitte den alten Agent beenden (Fenster schließen oder in Task-Manager den Prozess node.exe beenden) ` +
        `und --install-service erneut ausführen. ` +
        `/ The old agent is still running (${active}) against ${legacyDir}. Nothing was migrated. ` +
        `Stop the old agent (close its window, or end its node.exe in Task Manager) and run --install-service again.`,
    };
  }

  // Leftovers of an interrupted earlier attempt.
  await cleanupMigrationTemps(newDir, { isPidAlive: alive, now });

  const dpapi = opts.dpapi ?? getDpapiBackend();
  let who = opts.userName;
  if (!who) {
    try {
      who = userInfo().username;
    } catch {
      who = "?";
    }
  }
  const copied: string[] = [];
  const reprotected: string[] = [];

  try {
    log(`[migration] moving agent data from ${legacyDir} to ${newDir}`);
    await mkdir(newDir, { recursive: true });
    const entries = await readdir(legacyDir, { withFileTypes: true });

    // 1. DPAPI blobs: user scope in, machine scope out. Any blob that cannot be
    //    decrypted aborts the migration before config.json is committed.
    for (const e of entries) {
      if (!e.isFile() || !/\.dpapi$/i.test(e.name) || skipped(e.name)) continue;
      const blob = (await readFile(join(legacyDir, e.name), "utf8")).trim();
      if (!blob) continue;
      let plain: string;
      try {
        plain = await dpapi.unprotect(blob, "CurrentUser");
      } catch (err) {
        throw new Error(
          `${e.name} cannot be decrypted by the current Windows user '${who}' ` +
            `(${(err as Error).message}). Run the command as the Windows user who did the ` +
            `setup (Bitte als der Windows-Benutzer ausführen, der die Einrichtung gemacht hat).`
        );
      }
      const fresh = await dpapi.protect(plain.trim(), "LocalMachine");
      await atomicWriteFile(join(newDir, e.name), fresh.trim());
      reprotected.push(e.name);
    }

    // 2. The encrypted outbox. Remove any sidecar left by an earlier partial
    //    run first: a stale -wal next to a different main file would be
    //    replayed into it. No agent can be running against newDir here (no
    //    config.json yet).
    if (await exists(join(legacyDir, OUTBOX_MAIN))) {
      for (const side of OUTBOX_SIDECARS) await rm(join(newDir, side), { force: true });
      await copyFileAtomic(join(legacyDir, OUTBOX_MAIN), join(newDir, OUTBOX_MAIN));
      copied.push(OUTBOX_MAIN);
      for (const side of OUTBOX_SIDECARS) {
        if (await exists(join(legacyDir, side))) {
          await copyFileAtomic(join(legacyDir, side), join(newDir, side));
          copied.push(side);
        }
      }
    }

    // 3. Everything else (vendor-configs/, logs/, recovery journal, ...), except
    //    what is handled separately or must not move.
    const handled = new Set<string>([
      OUTBOX_MAIN,
      ...OUTBOX_SIDECARS,
      "config.json",
      "config.json.bak",
    ]);
    for (const e of entries) {
      if (handled.has(e.name) || skipped(e.name)) continue;
      if (e.isFile() && /\.dpapi$/i.test(e.name)) continue;
      if (e.isSymbolicLink()) continue;
      const src = join(legacyDir, e.name);
      const dst = join(newDir, e.name);
      if (e.isDirectory()) {
        await copyTree(src, dst, copied, `${e.name}/`);
      } else if (e.isFile()) {
        await copyFileAtomic(src, dst);
        copied.push(e.name);
      }
    }

    // 4. Backup config, then the migration note, then config.json LAST.
    if (await exists(join(legacyDir, "config.json.bak"))) {
      await copyFileAtomic(join(legacyDir, "config.json.bak"), join(newDir, "config.json.bak"));
      copied.push("config.json.bak");
    }
    await atomicWriteFile(join(legacyDir, "MIGRATED.txt"), migratedNote(newDir, now())).catch(
      (err) => log(`[migration] could not write MIGRATED.txt: ${(err as Error).message}`)
    );
    await atomicWriteFile(
      join(newDir, "config.json"),
      await readFile(join(legacyDir, "config.json"))
    );
    copied.push("config.json");

    // The recovery journal holds a plaintext secret; it now lives in newDir
    // (behind the ACL), so do not leave a second copy in the user profile.
    if (copied.includes(RECOVERY_JOURNAL)) {
      await rm(join(legacyDir, RECOVERY_JOURNAL), { force: true }).catch(() => {});
    }
  } catch (err) {
    await cleanupMigrationTemps(newDir, { isPidAlive: alive, now, includeOwn: true });
    return { status: "failed", error: (err as Error).message };
  }

  log(
    `[migration] done: ${reprotected.length} secret(s) re-protected, ${copied.length} file(s) copied. ` +
      `The old folder ${legacyDir} was left in place (see MIGRATED.txt).`
  );
  return { status: "migrated", legacyDir, newDir, copied, reprotected };
}

/** Convenience wrapper with the process's real environment. */
export function currentUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return envGet(process.env, "USERNAME") ?? "?";
  }
}
