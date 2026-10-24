import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  DEFAULT_GDT_RECEIVER_ID,
  MappingFileError,
  configDir,
  configPath,
  dataDirIsOverridden,
  effectiveGdtReceiverId,
  isValidGdtReceiverId,
  legacyUserDataDir,
  loadConfig,
  loadCsvMappingFile,
  loadCsvMappingFileStrict,
  outboxPath,
  parseCsvMappingText,
  resolveDataDir,
  saveConfig,
  type AgentConfig,
} from "./config.js";

/**
 * H13.2 tests: config.json load/save must (a) distinguish "not enrolled"
 * (ENOENT → null) from "corrupt" (throws ConfigError, no re-enroll advice),
 * (b) strip a UTF-8 BOM, and (c) save atomically (temp + rename) with a .bak.
 *
 * configDir() reads platform env vars at call time, so we redirect it to a
 * per-test temp dir by overriding ProgramData + APPDATA (Windows) and
 * XDG_CONFIG_HOME / HOME (POSIX) for the duration of the file. An inherited
 * EINS_AGENT_DATA_DIR from the developer's shell is cleared so it cannot win.
 */

let tempRoot: string;
const ENV_KEYS = ["ProgramData", "APPDATA", "XDG_CONFIG_HOME", "HOME", "EINS_AGENT_DATA_DIR"];
const saved: Record<string, string | undefined> = {};

function sampleConfig(): AgentConfig {
  return {
    clinicId: "11111111-2222-3333-4444-555555555555",
    portalBaseUrl: "https://portal.example",
    watchFolder: "C:/GDT-Out",
    machineFingerprint: "fp123",
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "eins-config-test-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.EINS_AGENT_DATA_DIR;
  process.env.ProgramData = tempRoot;
  process.env.APPDATA = tempRoot;
  process.env.XDG_CONFIG_HOME = tempRoot;
  process.env.HOME = tempRoot;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns null when the config file is absent (not enrolled)", async () => {
    expect(await loadConfig()).toBeNull();
  });

  it("throws ConfigError with fix-don't-re-enroll guidance on invalid JSON", async () => {
    await saveConfig(sampleConfig()); // creates the dir + a good file
    writeFileSync(configPath(), "{ not valid json,,,", "utf8");
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig()).rejects.toThrow(/not valid JSON/);
    await expect(loadConfig()).rejects.toThrow(/Do NOT re-run --enroll/);
    await expect(loadConfig()).rejects.toThrow(/\.bak/);
  });

  it("strips a leading UTF-8 BOM before parsing", async () => {
    await saveConfig(sampleConfig());
    const good = JSON.stringify(sampleConfig(), null, 2);
    writeFileSync(configPath(), "\uFEFF" + good, "utf8");
    const cfg = await loadConfig();
    expect(cfg?.clinicId).toBe(sampleConfig().clinicId);
  });

  it("a config with an illegal gdtReceiverId fails loudly at load time", async () => {
    await saveConfig({ ...sampleConfig(), gdtReceiverId: "TOO-LONG-AND-BAD" });
    await expect(loadConfig()).rejects.toBeInstanceOf(ConfigError);
    await expect(loadConfig()).rejects.toThrow(/gdtReceiverId/);
  });

  it("a config with a valid gdtReceiverId loads", async () => {
    await saveConfig({ ...sampleConfig(), gdtReceiverId: "PRAXIS_1" });
    expect((await loadConfig())?.gdtReceiverId).toBe("PRAXIS_1");
  });
});

describe("saveConfig: atomic write", () => {
  it("writes the config and leaves no temp file behind", async () => {
    await saveConfig(sampleConfig());
    expect(existsSync(configPath())).toBe(true);
    const loaded = await loadConfig();
    expect(loaded?.clinicId).toBe(sampleConfig().clinicId);
    // No orphaned config.json.tmp-<pid> in the config dir.
    const leftovers = readdirSync(configDir()).filter((f) => f.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("backs up the previous config to .bak on the second save", async () => {
    const first = sampleConfig();
    await saveConfig(first);
    const second = { ...first, watchFolder: "C:/GDT-Out-2" };
    await saveConfig(second);
    // .bak holds the FIRST config; the target holds the second.
    const bak = JSON.parse(readFileSync(`${configPath()}.bak`, "utf8"));
    expect(bak.watchFolder).toBe("C:/GDT-Out");
    const cur = await loadConfig();
    expect(cur?.watchFolder).toBe("C:/GDT-Out-2");
  });
});

describe("resolveDataDir: machine-wide data directory", () => {
  const home = "/home/praxis";

  it("Windows: %ProgramData%\\EINS-Agent, NOT the per-user %APPDATA%", () => {
    const dir = resolveDataDir({
      platform: "win32",
      env: {
        ProgramData: "C:\\ProgramData",
        APPDATA: "C:\\Users\\Dr.Mueller\\AppData\\Roaming",
      },
      home: "C:\\Users\\Dr.Mueller",
    });
    expect(dir).toBe("C:\\ProgramData\\EINS-Agent");
  });

  it("Windows: a relocated ProgramData is honoured", () => {
    expect(
      resolveDataDir({ platform: "win32", env: { ProgramData: "D:\\PD" }, home })
    ).toBe("D:\\PD\\EINS-Agent");
  });

  it("Windows: env names are case-insensitive (PROGRAMDATA)", () => {
    expect(
      resolveDataDir({ platform: "win32", env: { PROGRAMDATA: "E:\\Data" }, home })
    ).toBe("E:\\Data\\EINS-Agent");
  });

  it("Windows: ProgramData unset falls back to <SystemDrive>\\ProgramData", () => {
    expect(
      resolveDataDir({ platform: "win32", env: { SystemDrive: "D:" }, home })
    ).toBe("D:\\ProgramData\\EINS-Agent");
    expect(resolveDataDir({ platform: "win32", env: {}, home })).toBe(
      "C:\\ProgramData\\EINS-Agent"
    );
  });

  it("Windows: a relative or garbage ProgramData is ignored, never used as a path", () => {
    expect(
      resolveDataDir({ platform: "win32", env: { ProgramData: "ProgramData" }, home })
    ).toBe("C:\\ProgramData\\EINS-Agent");
    expect(
      resolveDataDir({ platform: "win32", env: { ProgramData: "  " }, home })
    ).toBe("C:\\ProgramData\\EINS-Agent");
  });

  it("macOS and Linux are unchanged", () => {
    expect(resolveDataDir({ platform: "darwin", env: {}, home })).toBe(
      "/home/praxis/Library/Application Support/EINS-Agent"
    );
    expect(resolveDataDir({ platform: "linux", env: {}, home })).toBe(
      "/home/praxis/.config/eins-agent"
    );
    expect(
      resolveDataDir({ platform: "linux", env: { XDG_CONFIG_HOME: "/xdg" }, home })
    ).toBe("/xdg/eins-agent");
  });

  it("EINS_AGENT_DATA_DIR overrides on every platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(
        resolveDataDir({ platform, env: { EINS_AGENT_DATA_DIR: "X:\\custom" }, home })
      ).toBe("X:\\custom");
    }
  });

  it("an empty EINS_AGENT_DATA_DIR is not an override", () => {
    const ctx = { platform: "win32" as const, env: { EINS_AGENT_DATA_DIR: "   " }, home };
    expect(resolveDataDir(ctx)).toBe("C:\\ProgramData\\EINS-Agent");
    expect(dataDirIsOverridden(ctx)).toBe(false);
    expect(
      dataDirIsOverridden({ ...ctx, env: { EINS_AGENT_DATA_DIR: "D:\\x" } })
    ).toBe(true);
  });

  it("legacyUserDataDir: the per-user dir on Windows only", () => {
    expect(
      legacyUserDataDir({
        platform: "win32",
        env: { APPDATA: "C:\\Users\\Anna\\AppData\\Roaming" },
        home: "C:\\Users\\Anna",
      })
    ).toBe("C:\\Users\\Anna\\AppData\\Roaming\\EINS-Agent");
    expect(
      legacyUserDataDir({ platform: "win32", env: {}, home: "C:\\Users\\Anna" })
    ).toBe("C:\\Users\\Anna\\AppData\\Roaming\\EINS-Agent");
    expect(legacyUserDataDir({ platform: "linux", env: {}, home })).toBeNull();
    expect(legacyUserDataDir({ platform: "darwin", env: {}, home })).toBeNull();
  });

  it("configDir / configPath / outboxPath follow the resolved directory", () => {
    process.env.EINS_AGENT_DATA_DIR = tempRoot;
    expect(configDir()).toBe(tempRoot);
    expect(configPath()).toBe(join(tempRoot, "config.json"));
    expect(outboxPath()).toBe(join(tempRoot, "outbox.sqlite"));
  });

  it.runIf(process.platform === "win32")(
    "on this Windows host configDir() is under ProgramData (the redirected temp root), not APPDATA",
    () => {
      process.env.ProgramData = join(tempRoot, "pd");
      process.env.APPDATA = join(tempRoot, "roaming");
      expect(configDir()).toBe(join(tempRoot, "pd", "EINS-Agent"));
    }
  );
});

describe("gdtReceiverId", () => {
  it("accepts 1-8 characters of [A-Za-z0-9_]", () => {
    for (const ok of ["E", "EINS", "PRAXIS_1", "a_B_c_9_", "12345678"]) {
      expect(isValidGdtReceiverId(ok), ok).toBe(true);
    }
  });

  it("rejects empty, too long, and illegal characters", () => {
    for (const bad of ["", "123456789", "EINS-1", "EI NS", "EINS!", "ÄÖÜ", "EINS\n", 5, null, undefined]) {
      expect(isValidGdtReceiverId(bad), String(bad)).toBe(false);
    }
  });

  it("effectiveGdtReceiverId defaults to EINS when absent", () => {
    expect(effectiveGdtReceiverId({})).toBe("EINS");
    expect(effectiveGdtReceiverId({ gdtReceiverId: undefined })).toBe(DEFAULT_GDT_RECEIVER_ID);
  });

  it("effectiveGdtReceiverId returns the configured id", () => {
    expect(effectiveGdtReceiverId({ gdtReceiverId: "MEDX" })).toBe("MEDX");
  });

  it("effectiveGdtReceiverId throws on a present-but-illegal id instead of defaulting", () => {
    expect(() => effectiveGdtReceiverId({ gdtReceiverId: "bad id" })).toThrow(ConfigError);
    expect(() => effectiveGdtReceiverId({ gdtReceiverId: "" })).toThrow(ConfigError);
  });
});

describe("honorar mapping file (item 6: no silent fallback)", () => {
  const MAPPING = {
    stream: "invoices",
    columns: { pvsPatientId: "PatNr", amount: "Betrag" },
  };

  function writeMapping(name: string, text: string): string {
    const p = join(tempRoot, name);
    writeFileSync(p, text, "utf8");
    return p;
  }

  it("loads a plain valid mapping", async () => {
    const p = writeMapping("ok.json", JSON.stringify(MAPPING));
    const m = await loadCsvMappingFileStrict(p);
    expect(m.stream).toBe("invoices");
  });

  it("loads a mapping saved by Notepad with a UTF-8 BOM (the field defect)", async () => {
    const p = writeMapping("bom.json", "\uFEFF" + JSON.stringify(MAPPING, null, 2));
    const m = await loadCsvMappingFileStrict(p);
    expect(m.stream).toBe("invoices");
    // The lenient wrapper must agree.
    expect((await loadCsvMappingFile(p))?.stream).toBe("invoices");
  });

  it("invalid JSON throws MappingFileError naming the file; no fallback", async () => {
    const p = writeMapping("bad.json", '{ "stream": "invoices", ');
    const err = await loadCsvMappingFileStrict(p).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MappingFileError);
    expect((err as Error).message).toContain("bad.json");
    expect((err as Error).message).toMatch(/not valid JSON/);
    expect((err as Error).message).toMatch(/No fallback to auto-detection/);
    // The old lenient behaviour is still available, but only by asking for it.
    expect(await loadCsvMappingFile(p)).toBeNull();
  });

  it("a missing file throws MappingFileError (not ENOENT, not null)", async () => {
    const err = await loadCsvMappingFileStrict(join(tempRoot, "nope.json")).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(MappingFileError);
    expect((err as Error).message).toMatch(/could not be read/);
  });

  it("rejects an unknown stream", () => {
    expect(() =>
      parseCsvMappingText(JSON.stringify({ stream: "bogus", columns: { pvsPatientId: "x" } }), "m.json")
    ).toThrow(/no valid "stream"/);
  });

  it("rejects a mapping without columns.pvsPatientId", () => {
    expect(() =>
      parseCsvMappingText(JSON.stringify({ stream: "invoices", columns: {} }), "m.json")
    ).toThrow(/pvsPatientId/);
    expect(() =>
      parseCsvMappingText(JSON.stringify({ stream: "invoices" }), "m.json")
    ).toThrow(/pvsPatientId/);
  });

  it("rejects JSON that is not an object", () => {
    for (const text of ["null", "42", '"str"', "[]"]) {
      expect(() => parseCsvMappingText(text, "m.json"), text).toThrow(MappingFileError);
    }
  });

  it("an empty file is invalid JSON, not 'no mapping'", () => {
    expect(() => parseCsvMappingText("", "empty.json")).toThrow(/not valid JSON/);
    expect(() => parseCsvMappingText("\uFEFF", "empty.json")).toThrow(/not valid JSON/);
  });
});
