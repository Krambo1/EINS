import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * WP-C A1: re-enrollment (secret rotation after an auth pause) must MERGE into
 * the existing config. It used to rebuild the config from scratch, which
 * dropped dbAdapters and gdtReceiverId and reset watchFolder, so the PVS data
 * of that Praxis silently stopped flowing.
 */

const { loadConfigMock, saveConfigMock, storeSecretMock, tempDir } = vi.hoisted(
  () => ({
    loadConfigMock: vi.fn(),
    saveConfigMock: vi.fn(),
    storeSecretMock: vi.fn(),
    tempDir: { current: "" },
  })
);

vi.mock("./config.js", () => ({
  loadConfig: loadConfigMock,
  saveConfig: saveConfigMock,
  configDir: () => tempDir.current,
}));
vi.mock("./secure-store.js", () => ({ storeSecret: storeSecretMock }));

import { enroll } from "./enrollment.js";

const SECRET = "b".repeat(64);
const CLINIC = "11111111-2222-3333-4444-555555555555";

const EXISTING = {
  clinicId: CLINIC,
  portalBaseUrl: "https://portal.old",
  watchFolder: "D:/PVS/GDT",
  machineFingerprint: "fp-original",
  honorarCsvFolder: "D:/PVS/Honorar",
  honorarCsvMapping: { stream: "invoices", columns: { pvsPatientId: "PatNr" } },
  dbAdapters: [
    {
      vendor: "medatixx",
      credentialId: "medatixx-default",
      host: "srv",
      username: "ro",
    },
  ],
  gdtReceiverId: "EINS2",
};

function ok(): Response {
  return new Response(
    JSON.stringify({ ok: true, pvsSecretHex: SECRET, vendor: "gdt_agent", endpoint: "/api/pvs/events" }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

beforeEach(() => {
  tempDir.current = mkdtempSync(join(tmpdir(), "eins-enroll-merge-"));
  loadConfigMock.mockReset().mockResolvedValue({ ...EXISTING });
  saveConfigMock.mockReset().mockResolvedValue(undefined);
  storeSecretMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  rmSync(tempDir.current, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("enroll merges into the existing config (A1)", () => {
  it("keeps dbAdapters, gdtReceiverId, honorar fields and watchFolder when none are passed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const res = await enroll({
      clinicId: CLINIC,
      token: "tok",
      portalBaseUrl: "https://portal.new",
    });
    expect(res.ok).toBe(true);
    const saved = saveConfigMock.mock.calls[0]![0];
    expect(saved.dbAdapters).toEqual(EXISTING.dbAdapters);
    expect(saved.gdtReceiverId).toBe("EINS2");
    expect(saved.watchFolder).toBe("D:/PVS/GDT");
    expect(saved.honorarCsvFolder).toBe("D:/PVS/Honorar");
    expect(saved.honorarCsvMapping).toEqual(EXISTING.honorarCsvMapping);
    expect(saved.machineFingerprint).toBe("fp-original");
    expect(saved.portalBaseUrl).toBe("https://portal.new");
  });

  it("overwrites watchFolder and honorar fields only when passed explicitly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const mapping = { stream: "invoices", columns: { pvsPatientId: "X" } } as never;
    const res = await enroll({
      clinicId: CLINIC,
      token: "tok",
      portalBaseUrl: "https://portal.old",
      watchFolder: "E:/NEW/GDT",
      honorarCsvFolder: "E:/NEW/Honorar",
      honorarCsvMapping: mapping,
    });
    expect(res.ok).toBe(true);
    const saved = saveConfigMock.mock.calls[0]![0];
    expect(saved.watchFolder).toBe("E:/NEW/GDT");
    expect(saved.honorarCsvFolder).toBe("E:/NEW/Honorar");
    expect(saved.honorarCsvMapping).toEqual(mapping);
    expect(saved.dbAdapters).toEqual(EXISTING.dbAdapters);
  });

  it("a fresh install without --folder falls back to the default GDT folder", async () => {
    loadConfigMock.mockResolvedValue(null);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const res = await enroll({ clinicId: CLINIC, token: "tok", portalBaseUrl: "https://p.example" });
    expect(res.ok).toBe(true);
    expect(typeof saveConfigMock.mock.calls[0]![0].watchFolder).toBe("string");
    expect(saveConfigMock.mock.calls[0]![0].watchFolder.length).toBeGreaterThan(0);
  });
});

describe("enroll rejects identical GDT and CSV folders before spending the token", () => {
  it("rejects when both are passed and equal", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const res = await enroll({
      clinicId: CLINIC,
      token: "tok",
      portalBaseUrl: "https://p.example",
      watchFolder: "C:\\Export",
      honorarCsvFolder: "c:\\export\\",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/GDT/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });

  it("rejects when the new watchFolder collides with the stored honorar folder", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok());
    const res = await enroll({
      clinicId: CLINIC,
      token: "tok",
      portalBaseUrl: "https://p.example",
      watchFolder: "D:/PVS/Honorar",
    });
    expect(res.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
