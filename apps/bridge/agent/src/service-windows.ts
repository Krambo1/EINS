import { randomBytes } from "node:crypto";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, win32 } from "node:path";
import {
  broadWriteAces,
  decodeIcaclsSave,
  parseAces,
  parseIcaclsSave,
} from "./sddl.js";
import {
  defaultExec,
  isElevated,
  quoteWindowsArg,
  systemDrive,
  systemTool,
  type ExecFn,
} from "./win-context.js";
import { inspectLock, type LockEnv, type LockState } from "./instance-lock.js";

/**
 * Windows background service for the agent, as a Scheduled Task.
 *
 * node.exe is not a service binary (it never answers the Service Control
 * Manager), and shipping a third-party wrapper is out of scope, so the agent
 * runs as a task:
 *
 *   principal   SYSTEM (S-1-5-18), RunLevel HighestAvailable
 *   triggers    at boot, 1 minute delay (network and disks are up by then), and
 *               every 5 minutes after that (a no-op while the agent runs)
 *   action      <node.exe> "<dist\index.js>" --supervise   (see supervisor.ts)
 *   settings    no time limit, one instance only, runs on battery,
 *               restarts the task every minute (up to 999 times) if it fails to
 *               launch; the 5 minute trigger covers an exit after a good launch
 *
 * "nobody logged in" works because a boot-triggered SYSTEM task needs no
 * interactive session.
 *
 * SECURITY: the task runs node.exe and the agent's JavaScript as SYSTEM. If a
 * non-admin user can modify any of those files (or the directories holding
 * them) that user gets SYSTEM code execution. installService therefore refuses
 * locations that sit in a user profile, on a network share, or that grant
 * write access to Users / Everyone / Authenticated Users, unless the operator
 * passes --allow-writable-install knowingly.
 *
 * All process execution goes through the injected `exec` seam; tests never
 * call schtasks or icacls.
 */

export const SERVICE_TASK_NAME = "EINS-Agent";
export const TASK_XML_FILENAME = "EINS-Agent.task.xml";

// ---------- pure builders ---------------------------------------------------

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Reject paths that could break out of the quoted argument or be reinterpreted
 * by Task Scheduler (it expands %VAR% in Command/Arguments), and anything that
 * is not an absolute local drive path.
 */
export function assertSafeTaskPath(path: string, label: string): void {
  if (!/^[A-Za-z]:\\/.test(path)) {
    throw new Error(
      `${label} must be an absolute local path like C:\\...: '${path}'`
    );
  }
  if (/["%\r\n\0<>|]/.test(path)) {
    throw new Error(`${label} contains a character that is not allowed in a task path: '${path}'`);
  }
}

/** Any past moment works; the repetition pattern is anchored on it. */
const REPEAT_START_BOUNDARY = "2020-01-01T00:00:00";

export interface TaskXmlInput {
  nodePath: string;
  scriptPath: string;
  workingDir: string;
}

/** The Task Scheduler definition (schema 1.2). Returns the XML as a JS string. */
export function buildTaskXml(input: TaskXmlInput): string {
  assertSafeTaskPath(input.nodePath, "nodePath");
  assertSafeTaskPath(input.scriptPath, "scriptPath");
  assertSafeTaskPath(input.workingDir, "workingDir");
  const args = `${quoteWindowsArg(input.scriptPath, true)} --supervise`;
  return [
    `<?xml version="1.0" encoding="UTF-16"?>`,
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">`,
    `  <RegistrationInfo>`,
    `    <Author>EINS</Author>`,
    `    <Description>EINS PVS-Agent: liest die Exportordner der Praxis-Software und meldet an das EINS-Portal. Startet beim Hochfahren, ohne dass sich jemand anmelden muss.</Description>`,
    `  </RegistrationInfo>`,
    `  <Triggers>`,
    `    <BootTrigger>`,
    `      <Enabled>true</Enabled>`,
    `      <Delay>PT1M</Delay>`,
    `    </BootTrigger>`,
    // Task Scheduler's RestartOnFailure only fires when the LAUNCH fails. If the
    // supervisor exits later (crash, kill, lock lost), nothing would bring it
    // back until the next reboot. This tick starts the task again every 5
    // minutes; IgnoreNew below makes it a no-op while an instance runs, and the
    // instance lock is the second guard against a duplicate.
    `    <TimeTrigger>`,
    `      <Repetition>`,
    `        <Interval>PT5M</Interval>`,
    `        <StopAtDurationEnd>false</StopAtDurationEnd>`,
    `      </Repetition>`,
    `      <StartBoundary>${REPEAT_START_BOUNDARY}</StartBoundary>`,
    `      <Enabled>true</Enabled>`,
    `    </TimeTrigger>`,
    `  </Triggers>`,
    `  <Principals>`,
    `    <Principal id="Author">`,
    `      <UserId>S-1-5-18</UserId>`,
    `      <RunLevel>HighestAvailable</RunLevel>`,
    `    </Principal>`,
    `  </Principals>`,
    `  <Settings>`,
    `    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>`,
    `    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>`,
    `    <AllowHardTerminate>true</AllowHardTerminate>`,
    `    <StartWhenAvailable>true</StartWhenAvailable>`,
    `    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>`,
    `    <IdleSettings>`,
    `      <StopOnIdleEnd>false</StopOnIdleEnd>`,
    `      <RestartOnIdle>false</RestartOnIdle>`,
    `    </IdleSettings>`,
    `    <AllowStartOnDemand>true</AllowStartOnDemand>`,
    `    <Enabled>true</Enabled>`,
    `    <Hidden>false</Hidden>`,
    `    <RunOnlyIfIdle>false</RunOnlyIfIdle>`,
    `    <WakeToRun>false</WakeToRun>`,
    `    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>`,
    `    <Priority>7</Priority>`,
    `    <RestartOnFailure>`,
    `      <Interval>PT1M</Interval>`,
    `      <Count>999</Count>`,
    `    </RestartOnFailure>`,
    `  </Settings>`,
    `  <Actions Context="Author">`,
    `    <Exec>`,
    `      <Command>${xmlEscape(input.nodePath)}</Command>`,
    `      <Arguments>${xmlEscape(args)}</Arguments>`,
    `      <WorkingDirectory>${xmlEscape(input.workingDir)}</WorkingDirectory>`,
    `    </Exec>`,
    `  </Actions>`,
    `</Task>`,
    ``,
  ].join("\r\n");
}

/** schtasks /XML needs UTF-16LE with a byte order mark. */
export function encodeTaskXml(xml: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
}

export function buildSchtasksCreateArgs(
  xmlPath: string,
  taskName: string = SERVICE_TASK_NAME
): string[] {
  return ["/Create", "/XML", xmlPath, "/TN", taskName, "/F"];
}
export const buildSchtasksRunArgs = (taskName: string = SERVICE_TASK_NAME): string[] => [
  "/Run",
  "/TN",
  taskName,
];
export const buildSchtasksEndArgs = (taskName: string = SERVICE_TASK_NAME): string[] => [
  "/End",
  "/TN",
  taskName,
];
export const buildSchtasksDeleteArgs = (taskName: string = SERVICE_TASK_NAME): string[] => [
  "/Delete",
  "/TN",
  taskName,
  "/F",
];
export const buildSchtasksChangeArgs = (
  enable: boolean,
  taskName: string = SERVICE_TASK_NAME
): string[] => ["/Change", "/TN", taskName, enable ? "/ENABLE" : "/DISABLE"];
export const buildSchtasksQueryArgs = (taskName: string = SERVICE_TASK_NAME): string[] => [
  "/Query",
  "/TN",
  taskName,
];

// ---------- install location safety -----------------------------------------

/** True when the path is inside any user profile (or the shared Public one). */
export function isUnderUserProfile(
  path: string,
  env: Record<string, string | undefined> = process.env
): boolean {
  const p = win32.normalize(path).toLowerCase();
  const root = `${systemDrive(env).toLowerCase()}\\users\\`;
  return p.startsWith(root);
}

export interface LocationCheck {
  /** Reasons the location is unsafe for a SYSTEM task; empty when fine. */
  problems: string[];
  /** Paths icacls could not read (a note, not a failure). */
  unchecked: string[];
}

/**
 * Read each path's DACL and report allow-ACEs that let ordinary users write.
 * `tmpDirForSave` must not be world-writable when the caller is SYSTEM; the
 * default os.tmpdir() is C:\Windows\TEMP for SYSTEM and the admin's own temp
 * for an elevated user.
 */
export async function checkInstallLocation(
  paths: string[],
  exec: ExecFn,
  env: Record<string, string | undefined> = process.env,
  tmpDirForSave: string = tmpdir()
): Promise<LocationCheck> {
  const problems: string[] = [];
  const unchecked: string[] = [];
  for (const path of [...new Set(paths)]) {
    if (isUnderUserProfile(path, env)) {
      problems.push(
        `${path} liegt in einem Benutzerprofil: ein normaler Benutzer könnte die Datei ändern und so SYSTEM-Rechte erlangen`
      );
      continue;
    }
    const saveFile = join(tmpDirForSave, `eins-acl-${randomBytes(6).toString("hex")}.txt`);
    try {
      const res = await exec(systemTool("icacls.exe", env), [path, "/save", saveFile, "/Q"]);
      if (res.code !== 0) {
        unchecked.push(path);
        continue;
      }
      const text = decodeIcaclsSave(await readFile(saveFile));
      for (const rec of parseIcaclsSave(text)) {
        const bad = broadWriteAces(parseAces(rec.sddl));
        if (bad.length > 0) {
          const who = [...new Set(bad.map((a) => a.trustee))].join(", ");
          problems.push(
            `${path} ist für normale Benutzer beschreibbar (${who}): wer dort schreiben darf, könnte SYSTEM-Code ausführen`
          );
        }
      }
    } catch {
      unchecked.push(path);
    } finally {
      await rm(saveFile, { force: true }).catch(() => {});
    }
  }
  return { problems, unchecked };
}

// ---------- operations ------------------------------------------------------

export interface ServiceOps {
  /** Console output (stdout). */
  out: (line: string) => void;
  /** Console output (stderr). */
  err: (line: string) => void;
  exec?: ExecFn;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Test seam; defaults to the fsutil probe. */
  elevated?: boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Clock for the bounded waits (test seam; default Date.now). */
  now?: () => number;
  /** Test seam for the lock inspection (pid liveness). */
  lockEnv?: LockEnv;
}

/** How long --install-service / --start-service wait for the agent to come up. */
export const AGENT_START_WAIT_MS = 60_000;
/** How long --stop-service waits for the instance locks to be released. */
export const AGENT_STOP_WAIT_MS = 45_000;
const WAIT_POLL_MS = 2_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const NOT_ELEVATED_MESSAGE =
  "Dieser Befehl braucht Administratorrechte. Bitte die Eingabeaufforderung (oder PowerShell) " +
  'per Rechtsklick auf "Als Administrator ausführen" öffnen und den Befehl erneut eingeben. ' +
  "/ This command needs an elevated (Administrator) prompt.";

function schtasks(env: Record<string, string | undefined>): string {
  return systemTool("schtasks.exe", env);
}

export interface InstallServiceOptions extends StatusOptions {
  nodePath: string;
  /** Absolute path of the built dist/index.js. */
  scriptPath: string;
  /** The agent install dir (parent of dist). */
  workingDir: string;
  allowWritableInstall?: boolean;
  /** Test seams. */
  writeXml?: (path: string, data: Buffer) => Promise<void>;
  removeFile?: (path: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
  isEnrolled?: () => Promise<boolean>;
  tmpDirForSave?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Exit codes: 0 ok, 1 failed, 2 precondition not met. */
export async function installService(opts: InstallServiceOptions): Promise<number> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  const sleep = opts.sleep ?? defaultSleep;
  const exists = opts.fileExists ?? pathExists;

  if (platform !== "win32") {
    opts.err(
      "--install-service gibt es nur unter Windows. Unter macOS bitte den LaunchAgent der Installationsanleitung verwenden. " +
        "/ --install-service is Windows-only."
    );
    return 2;
  }
  if (!/\.js$/i.test(opts.scriptPath)) {
    opts.err(
      `--install-service muss aus dem gebauten Agenten laufen (dist\\index.js), nicht aus dem Quellcode: ${opts.scriptPath} ` +
        `/ run it from the built agent, not from TypeScript sources.`
    );
    return 2;
  }
  for (const [label, p] of [
    ["node.exe", opts.nodePath],
    ["Agent-Skript", opts.scriptPath],
  ] as const) {
    if (!(await exists(p))) {
      opts.err(`${label} wurde nicht gefunden: ${p}`);
      return 2;
    }
  }

  const elevated = opts.elevated ?? (await isElevated(exec, env));
  if (!elevated) {
    opts.err(NOT_ELEVATED_MESSAGE);
    return 2;
  }

  let xml: string;
  try {
    xml = buildTaskXml({
      nodePath: opts.nodePath,
      scriptPath: opts.scriptPath,
      workingDir: opts.workingDir,
    });
  } catch (err) {
    opts.err(`Der Dienst kann mit diesen Pfaden nicht eingerichtet werden: ${(err as Error).message}`);
    return 2;
  }

  // SYSTEM will execute these files: make sure ordinary users cannot edit them.
  const location = await checkInstallLocation(
    [
      opts.nodePath,
      dirname(opts.nodePath),
      opts.scriptPath,
      dirname(opts.scriptPath),
      opts.workingDir,
      join(opts.workingDir, "node_modules"),
    ],
    exec,
    env,
    opts.tmpDirForSave
  );
  if (location.problems.length > 0) {
    for (const p of location.problems) opts.err(`SICHERHEIT: ${p}`);
    if (!opts.allowWritableInstall) {
      opts.err(
        "Der Dienst wird NICHT eingerichtet. Bitte den Agenten in einen Ordner nur für Administratoren installieren " +
          "(z. B. C:\\Program Files\\EINS-Agent) oder die Rechte des Ordners auf SYSTEM und Administratoren (Schreiben) " +
          "und Benutzer (nur Lesen) einschränken. Wer das Risiko kennt, kann --allow-writable-install anhängen. " +
          "/ Refusing to register a SYSTEM task that runs files ordinary users can modify (local privilege escalation). " +
          "Install the agent under C:\\Program Files, or pass --allow-writable-install to override."
      );
      return 2;
    }
    opts.err("--allow-writable-install gesetzt: der Dienst wird trotz dieser Warnung eingerichtet.");
  }
  if (location.unchecked.length > 0) {
    opts.out(
      `Hinweis: die Zugriffsrechte folgender Pfade konnten nicht geprüft werden: ${location.unchecked.join(", ")}`
    );
  }

  if (opts.isEnrolled && !(await opts.isEnrolled())) {
    opts.out(
      "Hinweis: Dieser PC ist noch nicht eingerichtet (kein --enroll). Der Dienst wird angelegt, meldet aber nichts, " +
        "bis `eins-agent --enroll ...` ausgeführt wurde."
    );
  }

  // Re-install = replace: stop a running instance so the new definition and
  // the (possibly updated) agent files take effect. Fails harmlessly when the
  // task does not exist yet.
  await exec(schtasks(env), buildSchtasksEndArgs());
  await sleep(1500);

  const xmlPath = join(opts.dataDir, TASK_XML_FILENAME);
  const write = opts.writeXml ?? ((p: string, d: Buffer) => writeFile(p, d));
  const remove = opts.removeFile ?? ((p: string) => rm(p, { force: true }));
  try {
    await write(xmlPath, encodeTaskXml(xml));
    const created = await exec(schtasks(env), buildSchtasksCreateArgs(xmlPath));
    if (created.code !== 0) {
      opts.err(
        `Die geplante Aufgabe "${SERVICE_TASK_NAME}" konnte nicht angelegt werden (Exitcode ${created.code}): ` +
          `${(created.stderr || created.stdout).trim()}`
      );
      return 1;
    }
  } finally {
    await remove(xmlPath).catch(() => {});
  }
  opts.out(`Geplante Aufgabe "${SERVICE_TASK_NAME}" angelegt (läuft als SYSTEM, startet beim Hochfahren).`);

  const now = opts.now ?? Date.now;
  const startedAfter = now();
  const started = await exec(schtasks(env), buildSchtasksRunArgs());
  if (started.code !== 0) {
    opts.err(
      `Die Aufgabe wurde angelegt, konnte aber nicht gestartet werden (Exitcode ${started.code}): ` +
        `${(started.stderr || started.stdout).trim()}. Sie startet spätestens beim nächsten Hochfahren.`
    );
    return 1;
  }
  opts.out("Dienst gestartet.");

  // A started task is not a running agent: node can fail on a missing DLL, a
  // locked data dir, a bad ABI. Wait (bounded) for evidence before saying "ok".
  const up = await waitForAgentUp(opts, startedAfter);
  const status = await collectStatus(opts);
  for (const line of formatStatus(status)) opts.out(line);
  if (!up) {
    opts.err(agentNotUpMessage(opts.dataDir));
    return 1;
  }
  return 0;
}

function agentNotUpMessage(dataDir: string): string {
  const logFile = join(dataDir, "logs", "agent.log");
  return (
    `Der Agent ist nach ${AGENT_START_WAIT_MS / 1000} Sekunden nicht gestartet (die Aufgabe ist angelegt und gestartet, ` +
    `aber es gibt weder eine laufende Instanz noch eine neue Logzeile). Bitte die Logdatei prüfen: ${logFile} ` +
    `/ The agent did not start within ${AGENT_START_WAIT_MS / 1000} s (the task is registered and started, but there is no ` +
    `running instance and no new log line). Check ${logFile} for the reason.`
  );
}

/**
 * Evidence that the agent runs: the instance lock held by a live pid (agent or
 * supervisor), or a log line written since `since`. Polls until `timeoutMs`.
 */
async function waitForAgentUp(
  opts: ServiceOps & { dataDir: string },
  since: number,
  timeoutMs: number = AGENT_START_WAIT_MS
): Promise<boolean> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const logFile = join(opts.dataDir, "logs", "agent.log");
  const begin = now();
  for (;;) {
    if (isAnyLockLive(opts.dataDir, opts.lockEnv)) return true;
    try {
      if (statSync(logFile).mtimeMs >= since) return true;
    } catch {
      // no log yet
    }
    if (now() - begin >= timeoutMs) return false;
    await sleep(WAIT_POLL_MS);
  }
}

function isAnyLockLive(dataDir: string, env?: LockEnv): boolean {
  for (const name of ["agent.lock", "supervisor.lock"]) {
    try {
      if (inspectLock(dataDir, name, env).state === "live") return true;
    } catch {
      // unreadable (not elevated): treat as no evidence
    }
  }
  return false;
}

/**
 * `--stop-service`: for upgrades. Disables the task first (otherwise the 5
 * minute repeat trigger would start it again in the middle of the file swap),
 * ends the running instance and waits until the instance locks are released.
 * Exit codes: 0 stopped, 1 still running after the wait, 2 precondition.
 */
export async function stopService(opts: StatusOptions): Promise<number> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  if (platform !== "win32") {
    opts.err("--stop-service gibt es nur unter Windows. / Windows-only.");
    return 2;
  }
  const elevated = opts.elevated ?? (await isElevated(exec, env));
  if (!elevated) {
    opts.err(NOT_ELEVATED_MESSAGE);
    return 2;
  }
  await exec(schtasks(env), buildSchtasksChangeArgs(false));
  const ended = await exec(schtasks(env), buildSchtasksEndArgs());
  const begin = now();
  while (isAnyLockLive(opts.dataDir, opts.lockEnv)) {
    if (now() - begin >= AGENT_STOP_WAIT_MS) {
      opts.err(
        `Der Agent läuft nach ${AGENT_STOP_WAIT_MS / 1000} Sekunden noch (Aufgabe beenden: Exitcode ${ended.code}). ` +
          `Bitte im Task-Manager den Prozess node.exe beenden, der den EINS-Agent ausführt, bevor Dateien ersetzt werden. ` +
          `/ The agent is still running after ${AGENT_STOP_WAIT_MS / 1000} s. End the node.exe process of the EINS agent ` +
          `in Task Manager before replacing files.`
      );
      return 1;
    }
    await sleep(WAIT_POLL_MS);
  }
  opts.out(
    `Dienst "${SERVICE_TASK_NAME}" angehalten und deaktiviert; der Agent läuft nicht mehr. Jetzt können die Dateien ersetzt werden. ` +
      `Danach: eins-agent --install-service (oder --start-service).`
  );
  return 0;
}

/** `--start-service`: re-enable the task, start it, wait for the agent. */
export async function startService(opts: StatusOptions): Promise<number> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  const now = opts.now ?? Date.now;
  if (platform !== "win32") {
    opts.err("--start-service gibt es nur unter Windows. / Windows-only.");
    return 2;
  }
  const elevated = opts.elevated ?? (await isElevated(exec, env));
  if (!elevated) {
    opts.err(NOT_ELEVATED_MESSAGE);
    return 2;
  }
  const since = now();
  const enabled = await exec(schtasks(env), buildSchtasksChangeArgs(true));
  if (enabled.code !== 0) {
    opts.err(
      `Die Aufgabe "${SERVICE_TASK_NAME}" konnte nicht aktiviert werden (Exitcode ${enabled.code}): ` +
        `${(enabled.stderr || enabled.stdout).trim()}. Ist sie installiert? (eins-agent --install-service) ` +
        `/ could not enable the task; is it installed?`
    );
    return 1;
  }
  const started = await exec(schtasks(env), buildSchtasksRunArgs());
  if (started.code !== 0) {
    opts.err(
      `Die Aufgabe konnte nicht gestartet werden (Exitcode ${started.code}): ${(started.stderr || started.stdout).trim()}`
    );
    return 1;
  }
  const up = await waitForAgentUp(opts, since);
  if (!up) {
    opts.err(agentNotUpMessage(opts.dataDir));
    return 1;
  }
  opts.out("Dienst gestartet, der Agent läuft.");
  return 0;
}

export async function uninstallService(opts: ServiceOps): Promise<number> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  if (platform !== "win32") {
    opts.err("--uninstall-service gibt es nur unter Windows. / Windows-only.");
    return 2;
  }
  const elevated = opts.elevated ?? (await isElevated(exec, env));
  if (!elevated) {
    opts.err(NOT_ELEVATED_MESSAGE);
    return 2;
  }
  // /End first so the running supervisor + agent stop; ignore "not running".
  await exec(schtasks(env), buildSchtasksEndArgs());
  const del = await exec(schtasks(env), buildSchtasksDeleteArgs());
  if (del.code !== 0) {
    // Distinguish "was never installed" from a real failure by asking again.
    const still = await exec(schtasks(env), buildSchtasksQueryArgs());
    if (still.code !== 0) {
      opts.out(`Die Aufgabe "${SERVICE_TASK_NAME}" war nicht installiert. Nichts zu tun.`);
      return 0;
    }
    opts.err(
      `Die Aufgabe "${SERVICE_TASK_NAME}" konnte nicht entfernt werden (Exitcode ${del.code}): ` +
        `${(del.stderr || del.stdout).trim()}`
    );
    return 1;
  }
  opts.out(
    `Dienst "${SERVICE_TASK_NAME}" beendet und entfernt. Konfiguration, Schlüssel und Warteschlange bleiben im Datenordner erhalten.`
  );
  return 0;
}

// ---------- status ------------------------------------------------------------

export interface ServiceStatus {
  installed: boolean | "unknown";
  /** "unknown" when the lock file cannot be read (not elevated). */
  agentRunning: boolean | "unknown";
  agentPid: number | null;
  agentSince: string | null;
  enrolledClinicId: string | null | "unknown";
  dataDir: string;
  logFile: string;
  logTail: string[];
}

export interface StatusOptions extends ServiceOps {
  dataDir: string;
  /** Returns the clinic id when enrolled, null when not, throws on a corrupt config. */
  readClinicId?: () => Promise<string | null>;
}

async function tailFile(path: string, maxLines: number): Promise<string[]> {
  try {
    const buf = await readFile(path);
    const text = buf.subarray(Math.max(0, buf.length - 16 * 1024)).toString("utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch {
    return [];
  }
}

export async function collectStatus(opts: StatusOptions): Promise<ServiceStatus> {
  const env = opts.env ?? process.env;
  const exec = opts.exec ?? defaultExec;
  const query = await exec(schtasks(env), buildSchtasksQueryArgs());
  let installed: boolean | "unknown" = query.code === 0;
  if (!installed) {
    // "not found" and "access denied" both exit 1 and the text is localized.
    const elevated = opts.elevated ?? (await isElevated(exec, env));
    if (!elevated) installed = "unknown";
  }
  // The data dir is restricted to SYSTEM + Administrators, so from an ordinary
  // prompt the lock file cannot even be read: say "unknown", do not crash and
  // do not claim "not running".
  let lock: LockState | null = null;
  try {
    lock = inspectLock(opts.dataDir);
  } catch {
    lock = null;
  }
  const live = lock !== null && lock.state === "live" ? lock : null;
  let enrolled: string | null | "unknown" = "unknown";
  if (opts.readClinicId) {
    try {
      enrolled = await opts.readClinicId();
    } catch {
      enrolled = "unknown";
    }
  }
  const logFile = join(opts.dataDir, "logs", "agent.log");
  return {
    installed,
    agentRunning: lock === null ? "unknown" : live !== null,
    agentPid: live ? live.holder.pid : null,
    agentSince: live ? live.holder.startedAt : null,
    enrolledClinicId: enrolled,
    dataDir: opts.dataDir,
    logFile,
    logTail: await tailFile(logFile, 6),
  };
}

export function formatStatus(s: ServiceStatus): string[] {
  const lines: string[] = [];
  lines.push(
    `Dienst (geplante Aufgabe "${SERVICE_TASK_NAME}"): ` +
      (s.installed === "unknown"
        ? "nicht prüfbar ohne Administratorrechte"
        : s.installed
          ? "installiert"
          : "NICHT installiert (eins-agent --install-service)")
  );
  lines.push(
    `Agent-Prozess: ` +
      (s.agentRunning === "unknown"
        ? "nicht prüfbar ohne Administratorrechte"
        : s.agentRunning
          ? `läuft (PID ${s.agentPid ?? "unbekannt"}${s.agentSince ? `, seit ${s.agentSince}` : ""})`
          : "läuft nicht")
  );
  lines.push(
    `Einrichtung: ` +
      (s.enrolledClinicId === "unknown"
        ? "unbekannt"
        : s.enrolledClinicId
          ? `eingerichtet (Praxis-ID ${s.enrolledClinicId})`
          : "noch nicht eingerichtet (eins-agent --enroll)")
  );
  lines.push(`Datenordner: ${s.dataDir}`);
  lines.push(`Logdatei: ${s.logFile}`);
  if (s.logTail.length > 0) {
    lines.push("Letzte Logzeilen:");
    for (const l of s.logTail) lines.push(`  ${l}`);
  }
  return lines;
}

/**
 * Exit codes: 0 installed and the agent runs, 3 installed but the agent is not
 * running, 4 not installed, 5 installation state unknown (not elevated).
 */
export async function serviceStatus(opts: StatusOptions): Promise<number> {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") {
    opts.err("--service-status gibt es nur unter Windows. / Windows-only.");
    return 2;
  }
  const status = await collectStatus(opts);
  for (const line of formatStatus(status)) opts.out(line);
  if (status.installed === "unknown") return 5;
  if (!status.installed) return 4;
  if (status.agentRunning === "unknown") return 5;
  return status.agentRunning ? 0 : 3;
}
