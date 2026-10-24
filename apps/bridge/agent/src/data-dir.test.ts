import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DataDirError,
  buildHardenSteps,
  ensureDataDir,
  verifyDirAcl,
} from "./data-dir.js";
import type { ExecFn, ExecResult } from "./win-context.js";

/**
 * data-dir.ts never touches a real ACL in these tests: every icacls / fsutil
 * call goes through a fake exec. The fake keeps a tiny model of the root
 * directory's DACL, answers `icacls <dir> /save <file>` by writing the SDDL in
 * UTF-16LE exactly like the real tool, and applies the lock-down when it sees
 * `/inheritance:r`.
 */

const TIGHT = "D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)";
const LOOSE = "D:AI(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";
const ENV = { SystemRoot: "C:\\Windows", SystemDrive: "C:" };

interface FakeIcacls {
  exec: ExecFn;
  calls: Array<{ file: string; args: string[] }>;
  state: { sddl: string; children: string[]; childSddl: string };
  /** icacls apply steps (not /save) that should fail, by flag. */
  failOn: Set<string>;
  saveExit: { code: number };
}

function fakeIcacls(initial: string, children: string[] = []): FakeIcacls {
  const calls: FakeIcacls["calls"] = [];
  const state = { sddl: initial, children, childSddl: "D:AI(A;;FA;;;SY)" };
  const failOn = new Set<string>();
  const saveExit = { code: 0 };
  const exec: ExecFn = async (file, args): Promise<ExecResult> => {
    calls.push({ file, args });
    if (!/icacls\.exe$/i.test(file)) return { code: 0, stdout: "", stderr: "" };
    if (args[1] === "/save") {
      if (saveExit.code !== 0) return { code: saveExit.code, stdout: "", stderr: "denied" };
      let text = `EINS-Agent\r\n${state.sddl}\r\n\r\n`;
      for (const c of state.children) text += `${c}\r\n${state.childSddl}\r\n\r\n`;
      writeFileSync(args[2]!, Buffer.from(text, "utf16le"));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("/inheritance:r")) {
      if (failOn.has("/inheritance:r")) return { code: 5, stdout: "", stderr: "Zugriff verweigert" };
      state.sddl = TIGHT;
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("/setowner")) {
      if (failOn.has("/setowner")) return { code: 1, stdout: "", stderr: "owner failed" };
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("/reset")) {
      if (failOn.has("/reset")) return { code: 1, stdout: "", stderr: "reset failed" };
      state.childSddl = "D:AI(A;;FA;;;SY)";
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };
  return { exec, calls, state, failOn, saveExit };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eins-datadir-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("buildHardenSteps", () => {
  it("restricts to SYSTEM and Administrators by SID, drops inheritance, fixes owner and children", () => {
    const steps = buildHardenSteps("C:\\ProgramData\\EINS-Agent");
    expect(steps.map((s) => s.label)).toEqual(["restrict-dacl", "set-owner", "reset-children"]);
    expect(steps[0]!.args).toEqual([
      "C:\\ProgramData\\EINS-Agent",
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-18:(OI)(CI)F",
      "*S-1-5-32-544:(OI)(CI)F",
      "/Q",
    ]);
    expect(steps[1]!.args).toEqual([
      "C:\\ProgramData\\EINS-Agent",
      "/setowner",
      "*S-1-5-32-544",
      "/T",
      "/Q",
    ]);
    expect(steps[2]!.onlyWithChildren).toBe(true);
  });

  it("never uses /C (it would hide failures behind exit 0) and never an account NAME", () => {
    const all = buildHardenSteps("D:\\x").flatMap((s) => s.args);
    expect(all).not.toContain("/C");
    for (const a of all) {
      expect(a).not.toMatch(/Users|Benutzer|Administrators|Administratoren|SYSTEM|Everyone|Jeder/);
    }
  });
});

describe("verifyDirAcl", () => {
  it("ok for SYSTEM + Administrators only (root and children)", async () => {
    const fake = fakeIcacls(TIGHT, ["config.json", "outbox.sqlite"]);
    const v = await verifyDirAcl(join(root, "d"), fake.exec, ENV);
    expect(v).toEqual({ ok: true, problems: [] });
    // Absolute System32 path; /save with /T.
    expect(fake.calls[0]!.file).toBe("C:\\Windows\\System32\\icacls.exe");
    expect(fake.calls[0]!.args).toEqual([join(root, "d"), "/save", expect.any(String), "/T", "/Q"]);
  });

  it("not ok when Users hold an ACE", async () => {
    const v = await verifyDirAcl(join(root, "d"), fakeIcacls(LOOSE).exec, ENV);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("S-1-5-32-545");
  });

  it("not ok when a CHILD has a broad ACE even if the root is tight", async () => {
    const fake = fakeIcacls(TIGHT, ["outbox.sqlite"]);
    fake.state.childSddl = "D:(A;;FA;;;SY)(A;;FR;;;WD)";
    const v = await verifyDirAcl(join(root, "d"), fake.exec, ENV);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("outbox.sqlite");
  });

  it("not ok when SYSTEM or Administrators are missing (the agent would lock itself out)", async () => {
    const v = await verifyDirAcl(join(root, "d"), fakeIcacls("D:PAI(A;OICI;FA;;;BA)").exec, ENV);
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toMatch(/lacks a grant/);
  });

  it("not ok when icacls /save itself fails", async () => {
    const fake = fakeIcacls(TIGHT);
    fake.saveExit.code = 5;
    const v = await verifyDirAcl(join(root, "d"), fake.exec, ENV);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toMatch(/icacls \/save failed \(exit 5\)/);
  });
});

describe("ensureDataDir (Windows path, fake icacls)", () => {
  const base = () => ({
    platform: "win32" as const,
    env: ENV,
    elevated: true,
    harden: true,
  });

  it("creates the directory and locks it down when it is loose", async () => {
    const dir = join(root, "EINS-Agent");
    const fake = fakeIcacls(LOOSE);
    const res = await ensureDataDir({ ...base(), dir, exec: fake.exec, warn: () => {} });
    expect(res).toMatchObject({ dir, created: true, aclVerified: true, warnings: [] });
    const applied = fake.calls.filter((c) => c.args[1] !== "/save").map((c) => c.args[1]);
    expect(applied).toEqual(["/inheritance:r", "/setowner"]); // empty dir: no reset step
    expect(fake.calls.every((c) => /System32\\icacls\.exe$/i.test(c.file))).toBe(true);
  });

  it("runs the reset step only when the directory has children", async () => {
    const dir = join(root, "EINS-Agent");
    mkdirSync(dir);
    writeFileSync(join(dir, "config.json"), "{}");
    const fake = fakeIcacls(LOOSE, ["config.json"]);
    const res = await ensureDataDir({ ...base(), dir, exec: fake.exec, warn: () => {} });
    expect(res.created).toBe(false);
    const applied = fake.calls.filter((c) => c.args[1] !== "/save").map((c) => c.args.join(" "));
    expect(applied[0]).toContain("/inheritance:r");
    expect(applied[1]).toContain("/setowner");
    expect(applied[2]).toContain("/reset");
    expect(res.aclVerified).toBe(true);
  });

  it("changes NOTHING when the ACL is already tight (every restart)", async () => {
    const dir = join(root, "EINS-Agent");
    mkdirSync(dir);
    const fake = fakeIcacls(TIGHT);
    const res = await ensureDataDir({ ...base(), dir, exec: fake.exec, warn: () => {} });
    expect(res.aclVerified).toBe(true);
    expect(fake.calls).toHaveLength(1); // the /save verification only
    expect(fake.calls[0]!.args[1]).toBe("/save");
  });

  it("a failing icacls step is a LOUD warning, not a crash, and aclVerified is false", async () => {
    const dir = join(root, "EINS-Agent");
    const fake = fakeIcacls(LOOSE);
    fake.failOn.add("/inheritance:r");
    // The failed step leaves the DACL loose, so re-verification fails too.
    const warnings: string[] = [];
    const res = await ensureDataDir({
      ...base(),
      dir,
      exec: fake.exec,
      warn: (m) => warnings.push(m),
    });
    expect(res.aclVerified).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/WARNUNG \/ WARNING/);
    expect(warnings[0]).toMatch(/restrict-dacl \(exit 5\)/);
    expect(warnings[0]).toContain("*S-1-5-18:(OI)(CI)F");
    expect(res.warnings).toEqual(warnings);
  });

  it("exit code 0 is not trusted: if the DACL is still loose afterwards it warns", async () => {
    const dir = join(root, "EINS-Agent");
    const fake = fakeIcacls(LOOSE);
    // Pretend the inheritance step "succeeds" but changes nothing.
    const real = fake.exec;
    const lying: ExecFn = async (file, args) => {
      if (args.includes("/inheritance:r")) {
        fake.calls.push({ file, args });
        return { code: 0, stdout: "", stderr: "" };
      }
      return real(file, args);
    };
    const warnings: string[] = [];
    const res = await ensureDataDir({ ...base(), dir, exec: lying, warn: (m) => warnings.push(m) });
    expect(res.aclVerified).toBe(false);
    expect(warnings[0]).toContain("S-1-5-32-545");
  });

  it("not elevated and the directory does not exist: refuses with NOT_ELEVATED and a German hint", async () => {
    const dir = join(root, "EINS-Agent");
    const fake = fakeIcacls(TIGHT);
    const err = await ensureDataDir({
      ...base(),
      elevated: false,
      dir,
      exec: fake.exec,
      warn: () => {},
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DataDirError);
    expect((err as DataDirError).code).toBe("NOT_ELEVATED");
    expect((err as DataDirError).message).toMatch(/Administrator/);
    expect(fake.calls).toEqual([]);
  });

  it("not elevated but the directory exists and is readable: continues with a note, no ACL change", async () => {
    const dir = join(root, "EINS-Agent");
    mkdirSync(dir);
    const fake = fakeIcacls(LOOSE);
    const warnings: string[] = [];
    const res = await ensureDataDir({
      ...base(),
      elevated: false,
      dir,
      exec: fake.exec,
      warn: (m) => warnings.push(m),
    });
    expect(res.aclVerified).toBe(false);
    expect(fake.calls).toEqual([]);
    expect(warnings[0]).toMatch(/not elevated/);
  });

  it("refuses a symlink / junction at the data dir path", async () => {
    const target = join(root, "elsewhere");
    mkdirSync(target);
    const link = join(root, "EINS-Agent");
    try {
      symlinkSync(target, link, "junction");
    } catch {
      return; // symlinks not permitted on this host: nothing to assert
    }
    const fake = fakeIcacls(TIGHT);
    const err = await ensureDataDir({ ...base(), dir: link, exec: fake.exec, warn: () => {} }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(DataDirError);
    expect((err as DataDirError).code).toBe("UNSAFE_PATH");
    expect(fake.calls).toEqual([]);
  });

  it("refuses a regular file at the data dir path", async () => {
    const file = join(root, "EINS-Agent");
    writeFileSync(file, "x");
    const err = await ensureDataDir({
      ...base(),
      dir: file,
      exec: fakeIcacls(TIGHT).exec,
      warn: () => {},
    }).catch((e: unknown) => e);
    expect((err as DataDirError).code).toBe("UNSAFE_PATH");
  });
});

describe("ensureDataDir (no ACL management)", () => {
  it("an EINS_AGENT_DATA_DIR override on Windows is created but never hardened, with a loud note", async () => {
    const dir = join(root, "custom");
    const fake = fakeIcacls(LOOSE);
    const warnings: string[] = [];
    const res = await ensureDataDir({
      platform: "win32",
      env: { ...ENV, EINS_AGENT_DATA_DIR: dir },
      dir,
      exec: fake.exec,
      warn: (m) => warnings.push(m),
    });
    expect(res).toMatchObject({ dir, created: true, aclVerified: false });
    expect(fake.calls).toEqual([]);
    expect(warnings.join(" ")).toMatch(/EINS_AGENT_DATA_DIR/);
  });

  it("macOS / Linux: plain mkdir, no icacls, no warning", async () => {
    for (const platform of ["darwin", "linux"] as const) {
      const dir = join(root, platform, "data");
      const fake = fakeIcacls(LOOSE);
      const warnings: string[] = [];
      const res = await ensureDataDir({
        platform,
        env: {},
        dir,
        exec: fake.exec,
        warn: (m) => warnings.push(m),
      });
      expect(res).toMatchObject({ dir, created: true, aclVerified: false, warnings: [] });
      expect(fake.calls).toEqual([]);
      expect(warnings).toEqual([]);
    }
  });

  it("is idempotent: a second call finds the directory and creates nothing", async () => {
    const dir = join(root, "again");
    const first = await ensureDataDir({ platform: "linux", env: {}, dir });
    const second = await ensureDataDir({ platform: "linux", env: {}, dir });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});
