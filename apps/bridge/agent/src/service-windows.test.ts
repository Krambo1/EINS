import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_STOP_WAIT_MS,
  SERVICE_TASK_NAME,
  assertSafeTaskPath,
  buildSchtasksCreateArgs,
  buildSchtasksDeleteArgs,
  buildSchtasksEndArgs,
  buildSchtasksQueryArgs,
  buildSchtasksRunArgs,
  buildTaskXml,
  checkInstallLocation,
  collectStatus,
  encodeTaskXml,
  formatStatus,
  installService,
  isUnderUserProfile,
  serviceStatus,
  startService,
  stopService,
  uninstallService,
  xmlEscape,
  type ServiceStatus,
} from "./service-windows.js";
import type { ExecFn, ExecResult } from "./win-context.js";

const NODE = "C:\\Program Files\\EINS-Agent\\node.exe";
const SCRIPT = "C:\\Program Files\\EINS-Agent\\dist\\index.js";
const WORKDIR = "C:\\Program Files\\EINS-Agent";
const ENV = { SystemRoot: "C:\\Windows", SystemDrive: "C:" };

describe("buildTaskXml", () => {
  const xml = buildTaskXml({ nodePath: NODE, scriptPath: SCRIPT, workingDir: WORKDIR });

  it("runs as SYSTEM (S-1-5-18) with the highest available run level", () => {
    expect(xml).toContain("<UserId>S-1-5-18</UserId>");
    expect(xml).toContain("<RunLevel>HighestAvailable</RunLevel>");
  });

  it("starts at boot with a one minute delay", () => {
    expect(xml).toMatch(/<BootTrigger>[\s\S]*<Delay>PT1M<\/Delay>[\s\S]*<\/BootTrigger>/);
    expect(xml).toContain("<Enabled>true</Enabled>");
  });

  it("settings: IgnoreNew, runs on battery, no time limit, hidden false, start when available", () => {
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(xml).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
    expect(xml).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(xml).toContain("<Hidden>false</Hidden>");
  });

  it("also starts every 5 minutes (repeating time trigger, no end, start in the past)", () => {
    const m = /<TimeTrigger>([\s\S]*?)<\/TimeTrigger>/.exec(xml);
    expect(m).not.toBeNull();
    const t = m![1]!;
    expect(t).toMatch(
      /<Repetition>\s*<Interval>PT5M<\/Interval>\s*<StopAtDurationEnd>false<\/StopAtDurationEnd>\s*<\/Repetition>/
    );
    expect(t).not.toContain("<Duration>");
    const start = /<StartBoundary>([^<]+)<\/StartBoundary>/.exec(t);
    expect(start).not.toBeNull();
    expect(new Date(start![1]!).getTime()).toBeLessThan(Date.now());
    expect(t).toContain("<Enabled>true</Enabled>");
    // The boot trigger stays, and both sit inside <Triggers>.
    expect(xml).toMatch(/<Triggers>[\s\S]*<BootTrigger>[\s\S]*<TimeTrigger>[\s\S]*<\/Triggers>/);
  });

  it("a repeat tick never duplicates a running agent: IgnoreNew and unlimited run time", () => {
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });

  it("quotes a script path that ends in a backslash so the closing quote survives", () => {
    const x = buildTaskXml({ nodePath: NODE, scriptPath: "C:\\Praxis Pfad\\", workingDir: WORKDIR });
    expect(x).toContain("<Arguments>&quot;C:\\Praxis Pfad\\\\&quot; --supervise</Arguments>");
  });

  it("restarts on failure every minute, 999 times", () => {
    expect(xml).toMatch(
      /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>999<\/Count>\s*<\/RestartOnFailure>/
    );
  });

  it("action: node.exe with the absolute script path in quotes and --supervise, plus a working directory", () => {
    expect(xml).toContain(`<Command>${NODE}</Command>`);
    expect(xml).toContain(`<Arguments>&quot;${SCRIPT}&quot; --supervise</Arguments>`);
    expect(xml).toContain(`<WorkingDirectory>${WORKDIR}</WorkingDirectory>`);
  });

  it("declares the Task Scheduler 1.2 schema and UTF-16", () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"');
    expect(xml).toContain('<Task version="1.2"');
  });

  it("is well formed (every element is closed in order)", () => {
    const stack: string[] = [];
    const tags = xml.replace(/<\?[\s\S]*?\?>/g, "").match(/<[^>]+>/g) ?? [];
    for (const tag of tags) {
      if (tag.endsWith("/>")) continue;
      if (tag.startsWith("</")) {
        expect(stack.pop()).toBe(tag.slice(2, -1).trim());
      } else {
        stack.push(/^<([A-Za-z]+)/.exec(tag)![1]!);
      }
    }
    expect(stack).toEqual([]);
  });

  it("escapes XML special characters in paths", () => {
    const x = buildTaskXml({
      nodePath: "C:\\Praxis & Söhne\\node.exe",
      scriptPath: "C:\\Praxis & Söhne\\dist\\index.js",
      workingDir: "C:\\Praxis & Söhne",
    });
    expect(x).toContain("<Command>C:\\Praxis &amp; Söhne\\node.exe</Command>");
    expect(x).not.toMatch(/Praxis & S/);
  });

  it("refuses paths that Task Scheduler would reinterpret or that are not absolute local paths", () => {
    const bad = [
      "node.exe",
      "..\\node.exe",
      "\\\\server\\share\\node.exe",
      "C:\\%TEMP%\\node.exe",
      'C:\\a"b\\node.exe',
      "C:\\a\r\nb\\node.exe",
      "C:\\a<b\\node.exe",
      "C:\\a|b\\node.exe",
      "C:\\a\0b\\node.exe",
    ];
    for (const p of bad) {
      expect(() => buildTaskXml({ nodePath: p, scriptPath: SCRIPT, workingDir: WORKDIR }), p).toThrow();
      expect(() => buildTaskXml({ nodePath: NODE, scriptPath: p, workingDir: WORKDIR }), p).toThrow();
      expect(() => buildTaskXml({ nodePath: NODE, scriptPath: SCRIPT, workingDir: p }), p).toThrow();
    }
  });
});

describe("assertSafeTaskPath / xmlEscape", () => {
  it("accepts a normal drive path", () => {
    expect(() => assertSafeTaskPath("D:\\Apps\\EINS\\dist\\index.js", "p")).not.toThrow();
  });

  it("xmlEscape covers the five predefined entities", () => {
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
  });
});

describe("encodeTaskXml", () => {
  it("is UTF-16LE with a byte order mark (what schtasks /XML requires)", () => {
    const buf = encodeTaskXml("<a>ä</a>");
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xfe);
    expect(buf.subarray(2).toString("utf16le")).toBe("<a>ä</a>");
    expect(buf.length).toBe(2 + "<a>ä</a>".length * 2);
  });
});

describe("schtasks argument builders", () => {
  it("create: /Create /XML <file> /TN EINS-Agent /F", () => {
    expect(buildSchtasksCreateArgs("C:\\x\\t.xml")).toEqual([
      "/Create",
      "/XML",
      "C:\\x\\t.xml",
      "/TN",
      "EINS-Agent",
      "/F",
    ]);
  });

  it("run / end / delete / query", () => {
    expect(buildSchtasksRunArgs()).toEqual(["/Run", "/TN", "EINS-Agent"]);
    expect(buildSchtasksEndArgs()).toEqual(["/End", "/TN", "EINS-Agent"]);
    expect(buildSchtasksDeleteArgs()).toEqual(["/Delete", "/TN", "EINS-Agent", "/F"]);
    expect(buildSchtasksQueryArgs()).toEqual(["/Query", "/TN", "EINS-Agent"]);
    expect(SERVICE_TASK_NAME).toBe("EINS-Agent");
  });

  it("the task name is a separate argv element, never joined into a shell string", () => {
    for (const args of [
      buildSchtasksCreateArgs("x.xml", "My Task"),
      buildSchtasksRunArgs("My Task"),
    ]) {
      expect(args).toContain("My Task");
    }
  });
});

describe("isUnderUserProfile", () => {
  it("flags paths below C:\\Users, case and slash insensitively", () => {
    expect(isUnderUserProfile("C:\\Users\\Anna\\AppData\\Local\\nvm\\node.exe", ENV)).toBe(true);
    expect(isUnderUserProfile("c:/users/public/x.js", ENV)).toBe(true);
    expect(isUnderUserProfile("C:\\Program Files\\nodejs\\node.exe", ENV)).toBe(false);
    expect(isUnderUserProfile("C:\\UsersX\\a", ENV)).toBe(false);
  });

  it("follows a relocated system drive", () => {
    expect(isUnderUserProfile("D:\\Users\\Anna\\node.exe", { SystemDrive: "D:", SystemRoot: "D:\\Windows" })).toBe(true);
    expect(isUnderUserProfile("D:\\Users\\Anna\\node.exe", ENV)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fake process execution
// ---------------------------------------------------------------------------

const READ_ONLY_FOR_USERS = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";
const USERS_CAN_MODIFY = "D:AI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1301bf;;;BU)";

interface Rig {
  exec: ExecFn;
  calls: Array<{ file: string; args: string[] }>;
  /** DACL answered for `icacls <path> /save`, by path; falls back to the default. */
  acl: Map<string, string>;
  defaultAcl: { sddl: string };
  schtasks: { create: number; run: number; end: number; del: number; query: number };
  files: { written: Array<{ path: string; data: Buffer }>; removed: string[] };
  opts: Partial<Parameters<typeof installService>[0]>;
  /** Fake clock for the "wait for the agent" loop; sleep() advances it. */
  clock: { offset: number; sleeps: number[]; onSleep: Array<() => void> };
  /** installService waits for evidence the agent runs: plant a live lock by default. */
  agentUp: boolean;
}

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eins-svc-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function rig(): Rig {
  const calls: Rig["calls"] = [];
  const acl = new Map<string, string>();
  const defaultAcl = { sddl: READ_ONLY_FOR_USERS };
  const schtasks = { create: 0, run: 0, end: 0, del: 0, query: 0 };
  const files: Rig["files"] = { written: [], removed: [] };
  const exec: ExecFn = async (file, args): Promise<ExecResult> => {
    calls.push({ file, args });
    if (/icacls\.exe$/i.test(file)) {
      if (args[1] === "/save") {
        const sddl = acl.get(args[0]!) ?? defaultAcl.sddl;
        writeFileSync(args[2]!, Buffer.from(`${args[0]}\r\n${sddl}\r\n\r\n`, "utf16le"));
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    if (/schtasks\.exe$/i.test(file)) {
      const verb = args[0]!.toLowerCase();
      const code =
        verb === "/create" ? schtasks.create
        : verb === "/run" ? schtasks.run
        : verb === "/end" ? schtasks.end
        : verb === "/delete" ? schtasks.del
        : schtasks.query;
      return { code, stdout: code === 0 ? "OK" : "", stderr: code === 0 ? "" : "FEHLER: Zugriff verweigert" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  const clock: Rig["clock"] = { offset: 0, sleeps: [], onSleep: [] };
  const opts: Rig["opts"] = {
    nodePath: NODE,
    scriptPath: SCRIPT,
    workingDir: WORKDIR,
    dataDir: tmp,
    out: () => {},
    err: () => {},
    exec,
    env: ENV,
    platform: "win32",
    elevated: true,
    sleep: async (ms) => {
      clock.offset += ms;
      clock.sleeps.push(ms);
      for (const f of clock.onSleep) f();
    },
    now: () => Date.now() + clock.offset,
    tmpDirForSave: tmp,
    fileExists: async () => true,
    isEnrolled: async () => true,
    writeXml: async (path, data) => void files.written.push({ path, data }),
    removeFile: async (path) => void files.removed.push(path),
  };
  return { exec, calls, acl, defaultAcl, schtasks, files, opts, clock, agentUp: true };
}

function capture(r: Rig): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  r.opts.out = (l) => out.push(l);
  r.opts.err = (l) => err.push(l);
  return { out, err };
}

const run = (r: Rig) => {
  if (r.agentUp) {
    // Another live PID than our own (inspectLock treats our own as stale).
    writeFileSync(
      join(tmp, "agent.lock"),
      JSON.stringify({ pid: process.ppid || 1, startedAt: "2026-10-07T01:00:00.000Z", token: "t" })
    );
  }
  return installService(r.opts as Parameters<typeof installService>[0]);
};
const schtasksVerbs = (r: Rig): string[] =>
  r.calls.filter((c) => /schtasks\.exe$/i.test(c.file)).map((c) => c.args[0]!);

describe("checkInstallLocation", () => {
  it("clean when users only have read access", async () => {
    const r = rig();
    const res = await checkInstallLocation([NODE, SCRIPT], r.exec, ENV, tmp);
    expect(res).toEqual({ problems: [], unchecked: [] });
  });

  it("flags a directory that Users can modify (SYSTEM would run what they write)", async () => {
    const r = rig();
    r.acl.set(WORKDIR, USERS_CAN_MODIFY);
    const res = await checkInstallLocation([NODE, WORKDIR], r.exec, ENV, tmp);
    expect(res.problems).toHaveLength(1);
    expect(res.problems[0]).toContain(WORKDIR);
    expect(res.problems[0]).toContain("S-1-5-32-545");
  });

  it("flags Authenticated Users with an INHERIT-ONLY modify ACE (the default at C:\\ root)", async () => {
    const r = rig();
    r.acl.set(WORKDIR, "D:AI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICIIO;0x1301bf;;;AU)");
    const res = await checkInstallLocation([WORKDIR], r.exec, ENV, tmp);
    expect(res.problems).toHaveLength(1);
    expect(res.problems[0]).toContain("S-1-5-11");
  });

  it("flags anything under a user profile without even asking icacls", async () => {
    const r = rig();
    const res = await checkInstallLocation(["C:\\Users\\Anna\\AppData\\Local\\nvm\\node.exe"], r.exec, ENV, tmp);
    expect(res.problems).toHaveLength(1);
    expect(res.problems[0]).toMatch(/Benutzerprofil/);
    expect(r.calls).toEqual([]);
  });

  it("a path icacls cannot read is reported as unchecked, not as a problem", async () => {
    const r = rig();
    const failing: ExecFn = async () => ({ code: 5, stdout: "", stderr: "denied" });
    const res = await checkInstallLocation([NODE], failing, ENV, tmp);
    expect(res).toEqual({ problems: [], unchecked: [NODE] });
  });

  it("checks each distinct path once and uses the absolute System32 icacls", async () => {
    const r = rig();
    await checkInstallLocation([NODE, NODE, SCRIPT], r.exec, ENV, tmp);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[0]!.file).toBe("C:\\Windows\\System32\\icacls.exe");
  });
});

describe("installService", () => {
  it("success: end, create (UTF-16 XML with BOM), run, then prints the status; temp XML removed", async () => {
    const r = rig();
    const io = capture(r);
    const code = await run(r);
    expect(code).toBe(0);
    expect(schtasksVerbs(r)).toEqual(["/End", "/Create", "/Run", "/Query"]);

    const create = r.calls.find((c) => c.args[0] === "/Create")!;
    expect(create.file).toBe("C:\\Windows\\System32\\schtasks.exe");
    expect(create.args.slice(0, 2)).toEqual(["/Create", "/XML"]);
    expect(create.args.slice(3)).toEqual(["/TN", "EINS-Agent", "/F"]);

    expect(r.files.written).toHaveLength(1);
    const { path, data } = r.files.written[0]!;
    expect(path).toBe(create.args[2]);
    expect(path.startsWith(tmp)).toBe(true);
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xfe);
    expect(data.subarray(2).toString("utf16le")).toContain("<UserId>S-1-5-18</UserId>");
    expect(r.files.removed).toEqual([path]);

    expect(io.out.join("\n")).toMatch(/angelegt/);
    expect(io.out.join("\n")).toMatch(/Dienst gestartet/);
    expect(io.out.join("\n")).toMatch(/Datenordner:/);
  });

  it("the agent never comes up: waits at most about 60 s, then exits non-zero with a hint to agent.log", async () => {
    const r = rig();
    const io = capture(r);
    r.agentUp = false;
    const code = await run(r);
    expect(code).not.toBe(0);
    const err = io.err.join("\n");
    expect(err).toContain(join(tmp, "logs", "agent.log"));
    expect(err).toMatch(/nicht gestartet|läuft nicht/);
    expect(err).toMatch(/did not (start|come up)/i);
    expect(r.clock.offset).toBeGreaterThanOrEqual(60_000);
    expect(r.clock.offset).toBeLessThan(75_000);
  });

  it("returns as soon as the lock shows a live agent (no full 60 s wait)", async () => {
    const r = rig();
    capture(r);
    const code = await run(r);
    expect(code).toBe(0);
    expect(r.clock.offset).toBeLessThan(10_000);
  });

  it("a fresh log line written after the start counts as evidence too", async () => {
    const r = rig();
    capture(r);
    r.agentUp = false;
    r.clock.onSleep.push(() => {
      if (!r.calls.some((c) => c.args[0] === "/Run")) return;
      mkdirSync(join(tmp, "logs"), { recursive: true });
      writeFileSync(join(tmp, "logs", "agent.log"), "2026-10-07T10:00:00Z [supervisor] starting\n");
      // The fake clock runs ahead of the real one: stamp the file on that clock.
      const t = new Date(Date.now() + r.clock.offset + 1000);
      utimesSync(join(tmp, "logs", "agent.log"), t, t);
    });
    expect(await run(r)).toBe(0);
  });

  it("an old log file from before the start is not evidence", async () => {
    const r = rig();
    const io = capture(r);
    r.agentUp = false;
    mkdirSync(join(tmp, "logs"), { recursive: true });
    const old = join(tmp, "logs", "agent.log");
    writeFileSync(old, "old\n");
    const t = new Date(Date.now() - 3600_000);
    utimesSync(old, t, t);
    expect(await run(r)).not.toBe(0);
    expect(io.err.join("\n")).toContain("agent.log");
  });

  it("refuses to run off-Windows", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.platform = "darwin";
    expect(await run(r)).toBe(2);
    expect(io.err.join(" ")).toMatch(/nur unter Windows/);
    expect(r.calls).toEqual([]);
  });

  it("refuses to run from TypeScript sources (dist\\index.js only)", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.scriptPath = "C:\\Program Files\\EINS-Agent\\src\\index.ts";
    expect(await run(r)).toBe(2);
    expect(io.err.join(" ")).toMatch(/gebauten Agenten/);
    expect(r.calls).toEqual([]);
  });

  it("not elevated: German instruction, exit 2, and NO schtasks / icacls call", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.elevated = false;
    expect(await run(r)).toBe(2);
    expect(io.err.join(" ")).toMatch(/Administratorrechte/);
    expect(io.err.join(" ")).toMatch(/Als Administrator ausführen/);
    expect(r.calls).toEqual([]);
  });

  it("missing node.exe or script: exit 2 before touching anything", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.fileExists = async (p) => p !== NODE;
    expect(await run(r)).toBe(2);
    expect(io.err.join(" ")).toContain(NODE);
    expect(r.calls).toEqual([]);
  });

  it("an install location users can write to is REFUSED (privilege escalation), nothing is registered", async () => {
    const r = rig();
    const io = capture(r);
    r.acl.set(WORKDIR, USERS_CAN_MODIFY);
    expect(await run(r)).toBe(2);
    expect(io.err.join("\n")).toMatch(/SICHERHEIT/);
    expect(io.err.join("\n")).toMatch(/NICHT eingerichtet/);
    expect(io.err.join("\n")).toMatch(/--allow-writable-install/);
    expect(schtasksVerbs(r)).toEqual([]);
    expect(r.files.written).toEqual([]);
  });

  it("a node.exe inside a user profile is refused by default", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.nodePath = "C:\\Users\\Anna\\AppData\\Local\\nvm\\v20\\node.exe";
    expect(await run(r)).toBe(2);
    expect(io.err.join("\n")).toMatch(/Benutzerprofil/);
    expect(schtasksVerbs(r)).toEqual([]);
  });

  it("--allow-writable-install installs anyway, but still prints the warning", async () => {
    const r = rig();
    const io = capture(r);
    r.acl.set(WORKDIR, USERS_CAN_MODIFY);
    r.opts.allowWritableInstall = true;
    expect(await run(r)).toBe(0);
    expect(io.err.join("\n")).toMatch(/SICHERHEIT/);
    expect(io.err.join("\n")).toMatch(/trotz dieser Warnung/);
    expect(schtasksVerbs(r)).toContain("/Create");
  });

  it("not yet enrolled: still installs, with a hint", async () => {
    const r = rig();
    const io = capture(r);
    r.opts.isEnrolled = async () => false;
    expect(await run(r)).toBe(0);
    expect(io.out.join("\n")).toMatch(/noch nicht eingerichtet/);
  });

  it("create fails: exit 1 with schtasks' message, no Run, and the XML is still removed", async () => {
    const r = rig();
    const io = capture(r);
    r.schtasks.create = 1;
    expect(await run(r)).toBe(1);
    expect(io.err.join("\n")).toMatch(/konnte nicht angelegt werden \(Exitcode 1\)/);
    expect(io.err.join("\n")).toMatch(/Zugriff verweigert/);
    expect(schtasksVerbs(r)).not.toContain("/Run");
    expect(r.files.removed).toHaveLength(1);
  });

  it("run fails after a successful create: exit 1, says it will start at the next boot", async () => {
    const r = rig();
    const io = capture(r);
    r.schtasks.run = 1;
    expect(await run(r)).toBe(1);
    expect(io.err.join("\n")).toMatch(/nächsten Hochfahren/);
  });

  it("re-install ends a running instance first (a failing /End on a fresh PC is harmless)", async () => {
    const r = rig();
    capture(r);
    r.schtasks.end = 1;
    expect(await run(r)).toBe(0);
    expect(schtasksVerbs(r).slice(0, 2)).toEqual(["/End", "/Create"]);
  });
});

describe("uninstallService", () => {
  const ops = (r: Rig) => ({
    out: r.opts.out!,
    err: r.opts.err!,
    exec: r.exec,
    env: ENV,
    platform: "win32" as const,
    elevated: true,
  });

  it("ends and deletes the task, and says config and queue are kept", async () => {
    const r = rig();
    const io = capture(r);
    expect(await uninstallService({ ...ops(r), out: (l) => io.out.push(l), err: (l) => io.err.push(l) })).toBe(0);
    expect(schtasksVerbs(r)).toEqual(["/End", "/Delete"]);
    expect(io.out.join("\n")).toMatch(/beendet und entfernt/);
    expect(io.out.join("\n")).toMatch(/bleiben im Datenordner erhalten/);
  });

  it("not elevated: German instruction, exit 2, nothing executed", async () => {
    const r = rig();
    const io = capture(r);
    expect(
      await uninstallService({ ...ops(r), elevated: false, out: (l) => io.out.push(l), err: (l) => io.err.push(l) })
    ).toBe(2);
    expect(io.err.join(" ")).toMatch(/Administratorrechte/);
    expect(r.calls).toEqual([]);
  });

  it("a task that was never installed is a clean no-op (exit 0)", async () => {
    const r = rig();
    const io = capture(r);
    r.schtasks.del = 1;
    r.schtasks.query = 1; // still not there afterwards
    expect(await uninstallService({ ...ops(r), out: (l) => io.out.push(l), err: (l) => io.err.push(l) })).toBe(0);
    expect(io.out.join("\n")).toMatch(/war nicht installiert/);
  });

  it("a delete that fails while the task still exists is an error (exit 1)", async () => {
    const r = rig();
    const io = capture(r);
    r.schtasks.del = 1;
    r.schtasks.query = 0; // still there
    expect(await uninstallService({ ...ops(r), out: (l) => io.out.push(l), err: (l) => io.err.push(l) })).toBe(1);
    expect(io.err.join("\n")).toMatch(/konnte nicht entfernt werden/);
  });

  it("off-Windows: exit 2", async () => {
    const r = rig();
    const io = capture(r);
    expect(
      await uninstallService({ ...ops(r), platform: "linux", out: (l) => io.out.push(l), err: (l) => io.err.push(l) })
    ).toBe(2);
  });
});

describe("service status", () => {
  const statusOpts = (r: Rig, over: Record<string, unknown> = {}) => ({
    dataDir: tmp,
    out: (l: string) => void r.calls.push({ file: "out", args: [l] }),
    err: () => {},
    exec: r.exec,
    env: ENV,
    platform: "win32" as const,
    elevated: true,
    ...over,
  });

  function plantLiveAgent(): void {
    writeFileSync(
      join(tmp, "agent.lock"),
      JSON.stringify({ pid: process.pid, startedAt: "2026-10-07T01:00:00.000Z", token: "t" })
    );
  }

  it("installed + live agent: collects the facts the operator needs", async () => {
    const r = rig();
    plantLiveAgent();
    // process.pid is "ours": inspectLock treats our own PID as stale, so plant another live PID.
    writeFileSync(
      join(tmp, "agent.lock"),
      JSON.stringify({ pid: process.ppid || 1, startedAt: "2026-10-07T01:00:00.000Z", token: "t" })
    );
    mkdirSync(join(tmp, "logs"));
    writeFileSync(join(tmp, "logs", "agent.log"), "a\nb\nc\n");
    const s = await collectStatus({ ...statusOpts(r), readClinicId: async () => "clinic-1" });
    expect(s.installed).toBe(true);
    expect(s.enrolledClinicId).toBe("clinic-1");
    expect(s.logFile).toBe(join(tmp, "logs", "agent.log"));
    expect(s.logTail).toEqual(["a", "b", "c"]);
    expect(s.dataDir).toBe(tmp);
  });

  it("not installed (elevated): installed false -> exit 4", async () => {
    const r = rig();
    r.schtasks.query = 1;
    expect(await serviceStatus(statusOpts(r))).toBe(4);
  });

  it("query fails and we are NOT elevated: 'unknown' -> exit 5, never 'not installed'", async () => {
    const r = rig();
    r.schtasks.query = 1;
    const s = await collectStatus(statusOpts(r, { elevated: false }));
    expect(s.installed).toBe("unknown");
    expect(await serviceStatus(statusOpts(r, { elevated: false }))).toBe(5);
  });

  it("installed but no agent process: exit 3", async () => {
    const r = rig();
    expect(await serviceStatus(statusOpts(r))).toBe(3);
  });

  it("an unreadable lock file (restricted data dir) is 'unknown', not a crash and not 'not running'", async () => {
    const r = rig();
    // A directory named agent.lock makes readFileSync throw EISDIR (non-ENOENT).
    mkdirSync(join(tmp, "agent.lock"));
    const s = await collectStatus(statusOpts(r));
    expect(s.agentRunning).toBe("unknown");
    expect(formatStatus(s).join("\n")).toMatch(/Agent-Prozess: nicht prüfbar/);
    expect(await serviceStatus(statusOpts(r))).toBe(5);
  });

  it("a corrupt config is 'unknown' enrolment, not a crash", async () => {
    const r = rig();
    const s = await collectStatus({
      ...statusOpts(r),
      readClinicId: async () => {
        throw new Error("corrupt");
      },
    });
    expect(s.enrolledClinicId).toBe("unknown");
  });

  it("off-Windows: exit 2", async () => {
    const r = rig();
    expect(await serviceStatus(statusOpts(r, { platform: "linux" }))).toBe(2);
  });

  it("formatStatus is German, names the log file and tails it", () => {
    const base: ServiceStatus = {
      installed: true,
      agentRunning: true,
      agentPid: 4711,
      agentSince: "2026-10-07T01:00:00.000Z",
      enrolledClinicId: "abc",
      dataDir: "C:\\ProgramData\\EINS-Agent",
      logFile: "C:\\ProgramData\\EINS-Agent\\logs\\agent.log",
      logTail: ["line one", "line two"],
    };
    const text = formatStatus(base).join("\n");
    expect(text).toContain('Dienst (geplante Aufgabe "EINS-Agent"): installiert');
    expect(text).toContain("läuft (PID 4711, seit 2026-10-07T01:00:00.000Z)");
    expect(text).toContain("eingerichtet (Praxis-ID abc)");
    expect(text).toContain("Datenordner: C:\\ProgramData\\EINS-Agent");
    expect(text).toContain("Logdatei: C:\\ProgramData\\EINS-Agent\\logs\\agent.log");
    expect(text).toContain("  line two");

    const down = formatStatus({ ...base, installed: false, agentRunning: false, enrolledClinicId: null, logTail: [] }).join("\n");
    expect(down).toContain("NICHT installiert (eins-agent --install-service)");
    expect(down).toContain("läuft nicht");
    expect(down).toContain("noch nicht eingerichtet (eins-agent --enroll)");
    expect(down).not.toContain("Letzte Logzeilen");
  });
});

// A stale lock file must read as "not running" in the status.
describe("service status and stale locks", () => {
  it("a lock older than the stale window is not a running agent", async () => {
    const r = rig();
    const lock = join(tmp, "agent.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.ppid || 1, startedAt: "x", token: "t" }));
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(lock, old, old);
    const s = await collectStatus({
      dataDir: tmp,
      out: () => {},
      err: () => {},
      exec: r.exec,
      env: ENV,
      elevated: true,
    });
    expect(s.agentRunning).toBe(false);
  });
});

describe("stopService / startService (upgrade procedure)", () => {
  const lockPath = (): string => join(tmp, "agent.lock");
  const plantLive = (): void =>
    writeFileSync(
      lockPath(),
      JSON.stringify({ pid: process.ppid || 1, startedAt: "2026-10-07T01:00:00.000Z", token: "t" })
    );

  function opsFor(r: Rig) {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      o: {
        dataDir: tmp,
        out: (l: string) => void out.push(l),
        err: (l: string) => void err.push(l),
        exec: r.exec,
        env: ENV,
        platform: "win32" as const,
        elevated: true,
        sleep: r.opts.sleep!,
        now: r.opts.now!,
      },
    };
  }

  it("disables the task, ends the instance, waits until the lock is released, exit 0", async () => {
    const r = rig();
    const { o, out } = opsFor(r);
    plantLive();
    let polls = 0;
    r.clock.onSleep.push(() => {
      if (++polls === 2) rmSync(lockPath(), { force: true });
    });
    expect(await stopService(o)).toBe(0);
    expect(schtasksVerbs(r)).toEqual(["/Change", "/End"]);
    const change = r.calls.find((c) => c.args[0] === "/Change")!;
    expect(change.args).toEqual(["/Change", "/TN", "EINS-Agent", "/DISABLE"]);
    expect(r.calls.find((c) => c.args[0] === "/End")!.file).toBe("C:\\Windows\\System32\\schtasks.exe");
    expect(polls).toBeGreaterThanOrEqual(2);
    expect(out.join("\n")).toMatch(/--install-service/);
  });

  it("the lock never goes away: exit 1 after a bounded wait, German + English hint", async () => {
    const r = rig();
    const { o, err } = opsFor(r);
    plantLive();
    expect(await stopService(o)).toBe(1);
    expect(r.clock.offset).toBeGreaterThanOrEqual(AGENT_STOP_WAIT_MS);
    expect(r.clock.offset).toBeLessThan(AGENT_STOP_WAIT_MS + 5_000);
    expect(err.join("\n")).toMatch(/läuft .* noch/);
    expect(err.join("\n")).toMatch(/still running/);
  });

  it("nothing running (task missing, no lock): exit 0 without waiting", async () => {
    const r = rig();
    r.schtasks.end = 1;
    const { o } = opsFor(r);
    expect(await stopService(o)).toBe(0);
    expect(r.clock.offset).toBe(0);
  });

  it("not elevated: exit 2 and no schtasks call; off-Windows: exit 2", async () => {
    const r = rig();
    const { o, err } = opsFor(r);
    expect(await stopService({ ...o, elevated: false })).toBe(2);
    expect(await stopService({ ...o, platform: "linux" })).toBe(2);
    expect(schtasksVerbs(r)).toEqual([]);
    expect(err.join("\n")).toMatch(/Administrator/);
  });

  it("start-service: enables the task, runs it, waits for the agent", async () => {
    const r = rig();
    const { o } = opsFor(r);
    r.clock.onSleep.push(() => plantLive());
    expect(await startService(o)).toBe(0);
    expect(schtasksVerbs(r)).toEqual(["/Change", "/Run"]);
    expect(r.calls[0]!.args).toEqual(["/Change", "/TN", "EINS-Agent", "/ENABLE"]);
  });

  it("start-service: agent never appears -> exit 1 with the log hint", async () => {
    const r = rig();
    const { o, err } = opsFor(r);
    expect(await startService(o)).toBe(1);
    expect(err.join("\n")).toContain("agent.log");
  });
});
