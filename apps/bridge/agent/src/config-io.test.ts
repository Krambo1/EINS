import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  loadConfig,
  saveConfig,
  configPath,
  configDir,
  type AgentConfig,
} from "./config.js";

/**
 * H13.2 tests: config.json load/save must (a) distinguish "not enrolled"
 * (ENOENT → null) from "corrupt" (throws ConfigError, no re-enroll advice),
 * (b) strip a UTF-8 BOM, and (c) save atomically (temp + rename) with a .bak.
 *
 * configDir() reads platform env vars at call time, so we redirect it to a
 * per-test temp dir by overriding APPDATA (Windows) and XDG_CONFIG_HOME /
 * HOME (POSIX) for the duration of the file.
 */

let tempRoot: string;
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
  for (const k of ["APPDATA", "XDG_CONFIG_HOME", "HOME"]) saved[k] = process.env[k];
  process.env.APPDATA = tempRoot;
  process.env.XDG_CONFIG_HOME = tempRoot;
  process.env.HOME = tempRoot;
});

afterEach(() => {
  for (const k of ["APPDATA", "XDG_CONFIG_HOME", "HOME"]) {
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
    writeFileSync(configPath(), "﻿" + good, "utf8");
    const cfg = await loadConfig();
    expect(cfg?.clinicId).toBe(sampleConfig().clinicId);
  });
});

describe("saveConfig — atomic write", () => {
  it("writes the config and leaves no temp file behind", async () => {
    await saveConfig(sampleConfig());
    expect(existsSync(configPath())).toBe(true);
    const loaded = await loadConfig();
    expect(loaded?.clinicId).toBe(sampleConfig().clinicId);
    // No orphaned config.json.tmp-<pid> in the config dir.
    const leftovers = readdirSync(configDir()).filter((f) => f.startsWith("config.json.tmp-"));
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
