import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkFolders,
  describeFolderProblem,
  findMissingFolders,
} from "./folder-check.js";

describe("findMissingFolders (H13.1)", () => {
  it("reports a configured folder that does not exist on disk", async () => {
    const real = mkdtempSync(join(tmpdir(), "eins-folder-test-"));
    const bogus = join(real, "does-not-exist");
    try {
      const missing = await findMissingFolders([real, bogus]);
      expect(missing).toEqual([bogus]);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("returns empty when every folder exists", async () => {
    const real = mkdtempSync(join(tmpdir(), "eins-folder-test-"));
    try {
      expect(await findMissingFolders([real])).toEqual([]);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("skips empty / falsy entries and uses the injected stat", async () => {
    const calls: string[] = [];
    const statFn = async (p: string) => {
      calls.push(p);
      if (p === "/missing") throw new Error("ENOENT");
      return {};
    };
    const missing = await findMissingFolders(
      ["/present", "", "/missing"],
      statFn
    );
    expect(missing).toEqual(["/missing"]);
    expect(calls).toEqual(["/present", "/missing"]); // "" skipped
  });
});

// ---------------------------------------------------------------------------
// Structured reasons (item H): a stat error must not always read "missing".
// ---------------------------------------------------------------------------

function errnoStat(codes: Record<string, string>): (p: string) => Promise<unknown> {
  return async (p: string) => {
    const code = codes[p];
    if (code) throw Object.assign(new Error(`${code}: ${p}`), { code });
    return { isDirectory: () => true };
  };
}

describe("checkFolders: reasons", () => {
  it("ENOENT and ENOTDIR are 'missing'", async () => {
    const problems = await checkFolders(["/a", "/b"], {
      statFn: errnoStat({ "/a": "ENOENT", "/b": "ENOTDIR" }),
      platform: "linux",
    });
    expect(problems).toEqual([
      { path: "/a", reason: "missing", code: "ENOENT" },
      { path: "/b", reason: "missing", code: "ENOTDIR" },
    ]);
  });

  it("EACCES and EPERM are 'no_access', NOT 'missing'", async () => {
    const problems = await checkFolders(["/a", "/b"], {
      statFn: errnoStat({ "/a": "EACCES", "/b": "EPERM" }),
      platform: "linux",
    });
    expect(problems.map((p) => p.reason)).toEqual(["no_access", "no_access"]);
    expect(problems.map((p) => p.code)).toEqual(["EACCES", "EPERM"]);
  });

  it("any other errno is 'unreachable'", async () => {
    const problems = await checkFolders(["/a"], {
      statFn: errnoStat({ "/a": "EIO" }),
      platform: "linux",
    });
    expect(problems).toEqual([{ path: "/a", reason: "unreachable", code: "EIO" }]);
  });

  it("an existing FILE is 'not_a_directory'", async () => {
    const problems = await checkFolders(["/file.txt"], {
      statFn: async () => ({ isDirectory: () => false }),
      platform: "linux",
    });
    expect(problems).toEqual([{ path: "/file.txt", reason: "not_a_directory" }]);
  });

  it("a stat error without an errno code keeps the old 'missing' meaning", async () => {
    const problems = await checkFolders(["/x"], {
      statFn: async () => {
        throw new Error("ENOENT");
      },
      platform: "linux",
    });
    expect(problems).toEqual([{ path: "/x", reason: "missing" }]);
  });

  it("real filesystem: a directory is fine, a regular file is not_a_directory, a gone path is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eins-folder-reason-"));
    try {
      const file = join(dir, "plain.txt");
      writeFileSync(file, "x");
      const gone = join(dir, "gone");
      const problems = await checkFolders([dir, file, gone]);
      expect(problems.map((p) => [p.path, p.reason])).toEqual([
        [file, "not_a_directory"],
        [gone, "missing"],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkFolders: hints when running as SYSTEM on Windows", () => {
  const asSystem = {
    platform: "win32" as const,
    runningAsSystem: true,
    env: { SystemDrive: "C:", SystemRoot: "C:\\Windows" },
  };

  it("a missing non-system drive letter gets the mapped_drive hint", async () => {
    const [p] = await checkFolders(["Z:\\GDT-Export"], {
      ...asSystem,
      statFn: errnoStat({ "Z:\\GDT-Export": "ENOENT" }),
    });
    expect(p).toMatchObject({ reason: "missing", hint: "mapped_drive" });
  });

  it("drive letter match is case-insensitive and also catches a bare drive root", async () => {
    const [a, b] = await checkFolders(["z:/export", "Y:"], {
      ...asSystem,
      statFn: errnoStat({ "z:/export": "ENOENT", "Y:": "ENOENT" }),
    });
    expect(a!.hint).toBe("mapped_drive");
    expect(b!.hint).toBe("mapped_drive");
  });

  it("a missing folder on the SYSTEM drive gets NO mapped_drive hint (it is just missing)", async () => {
    const [p] = await checkFolders(["C:\\Praxis\\GDT"], {
      ...asSystem,
      statFn: errnoStat({ "C:\\Praxis\\GDT": "ENOENT" }),
    });
    expect(p!.reason).toBe("missing");
    expect(p!.hint).toBeUndefined();
  });

  it("no hint for a mapped-drive path when NOT running as SYSTEM", async () => {
    const [p] = await checkFolders(["Z:\\GDT-Export"], {
      ...asSystem,
      runningAsSystem: false,
      statFn: errnoStat({ "Z:\\GDT-Export": "ENOENT" }),
    });
    expect(p!.hint).toBeUndefined();
  });

  it("no hint on macOS / Linux, whatever the path looks like", async () => {
    const [p] = await checkFolders(["Z:\\GDT-Export"], {
      platform: "linux",
      runningAsSystem: true,
      statFn: errnoStat({ "Z:\\GDT-Export": "ENOENT" }),
    });
    expect(p!.hint).toBeUndefined();
  });

  it("a refused UNC share gets the unc_as_system hint", async () => {
    const [p] = await checkFolders(["\\\\SRV\\gdt"], {
      ...asSystem,
      statFn: errnoStat({ "\\\\SRV\\gdt": "EACCES" }),
    });
    expect(p).toMatchObject({ reason: "no_access", hint: "unc_as_system" });
  });

  it("an existing mapped-drive path (not a problem) produces nothing", async () => {
    const problems = await checkFolders(["Z:\\GDT-Export"], {
      ...asSystem,
      statFn: async () => ({ isDirectory: () => true }),
    });
    expect(problems).toEqual([]);
  });
});

describe("describeFolderProblem", () => {
  it("names the path and the reason, German first", () => {
    expect(describeFolderProblem({ path: "C:\\x", reason: "missing" })).toBe(
      "C:\\x: Ordner nicht gefunden / folder does not exist"
    );
    expect(
      describeFolderProblem({ path: "C:\\x", reason: "no_access", code: "EPERM" })
    ).toMatch(/kein Zugriff \(EPERM\) \/ access denied/);
    expect(describeFolderProblem({ path: "C:\\x", reason: "not_a_directory" })).toMatch(
      /ist kein Ordner/
    );
    expect(
      describeFolderProblem({ path: "C:\\x", reason: "unreachable", code: "EIO" })
    ).toMatch(/nicht erreichbar \(EIO\)/);
  });

  it("the mapped_drive hint explains SYSTEM cannot see drive letters and says what to do", () => {
    const line = describeFolderProblem({
      path: "Z:\\GDT",
      reason: "missing",
      hint: "mapped_drive",
    });
    expect(line).toMatch(/SYSTEM/);
    expect(line).toMatch(/Netzlaufwerk/);
    expect(line).toMatch(/UNC/);
    expect(line).toMatch(/mapped drive letters/);
  });

  it("the unc_as_system hint explains the credential problem", () => {
    const line = describeFolderProblem({
      path: "\\\\SRV\\gdt",
      reason: "no_access",
      code: "EACCES",
      hint: "unc_as_system",
    });
    expect(line).toMatch(/Computerkonto/);
    expect(line).toMatch(/computer account/);
  });
});
