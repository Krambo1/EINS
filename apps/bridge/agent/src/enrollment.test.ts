import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * enrollment tests.
 *
 * Covers the reliability-review findings:
 *   L15 — the enrollment request is bounded by a timeout (installer never hangs).
 *   L16 — enrollment is crash-resumable: a crash after the portal spends the
 *         one-time token but before local persistence is completed without a
 *         new token, via a recovery journal.
 *   L17 — the response shape is validated up front (captive-portal HTML / a
 *         missing pvsSecretHex produce operator-readable errors, no side effects).
 *   L19 — the machine fingerprint is deterministic (enumeration-order- and
 *         VPN/dock-adapter-independent) and reused from config on re-enroll.
 *
 * ./config.js and ./secure-store.js are mocked so saveConfig / storeSecret are
 * observable spies; configDir() is redirected to a per-test temp dir so the
 * REAL recovery-journal file operations round-trip through disk there.
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

vi.mock("./secure-store.js", () => ({
  storeSecret: storeSecretMock,
}));

import {
  enroll,
  completePendingEnrollment,
  machineFingerprint,
} from "./enrollment.js";

const RECOVERY_FILE = "enroll-recovery.json";
const SECRET = "a".repeat(64);

function validInput() {
  return {
    token: "tok-" + "x".repeat(40),
    clinicId: "11111111-2222-3333-4444-555555555555",
    portalBaseUrl: "https://portal.example",
    watchFolder: "C:/GDT-Out",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function recoveryFilePath(): string {
  return join(tempDir.current, RECOVERY_FILE);
}

beforeEach(() => {
  tempDir.current = mkdtempSync(join(tmpdir(), "eins-enroll-test-"));
  loadConfigMock.mockReset();
  loadConfigMock.mockResolvedValue(null); // default: not yet enrolled
  saveConfigMock.mockReset();
  saveConfigMock.mockResolvedValue(undefined);
  storeSecretMock.mockReset();
  storeSecretMock.mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(tempDir.current, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("enroll — happy path (L16 persistence order)", () => {
  it("stores the secret, writes config, and leaves no recovery journal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        pvsSecretHex: SECRET,
        vendor: "gdt_agent",
        endpoint: "/api/pvs/events",
      })
    );

    const res = await enroll(validInput());
    expect(res.ok).toBe(true);
    expect(storeSecretMock).toHaveBeenCalledWith(SECRET);
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const savedConfig = saveConfigMock.mock.calls[0]![0];
    expect(savedConfig).toMatchObject({
      clinicId: validInput().clinicId,
      portalBaseUrl: "https://portal.example",
      watchFolder: "C:/GDT-Out",
    });
    expect(typeof savedConfig.machineFingerprint).toBe("string");
    // Recovery journal cleaned up on success (secret no longer in plaintext).
    expect(existsSync(recoveryFilePath())).toBe(false);
  });
});

describe("enroll — L15 request timeout", () => {
  it("aborts a hung enrollment request and returns a timeout error", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted") as Error & { name: string };
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const pending = enroll(validInput());
    await vi.advanceTimersByTimeAsync(31_000);
    const res = await pending;

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timed out/i);
    // No side effects on a timeout.
    expect(storeSecretMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(existsSync(recoveryFilePath())).toBe(false);
  });
});

describe("enroll — L17 response validation", () => {
  it("rejects a mistyped clinic id before any network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await enroll({ ...validInput(), clinicId: "not-a-uuid" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/UUID/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON (captive-portal) response with no side effect", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>Please sign in</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );
    const res = await enroll(validInput());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/non-JSON|captive portal/i);
    expect(storeSecretMock).not.toHaveBeenCalled();
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(existsSync(recoveryFilePath())).toBe(false);
  });

  it("rejects a JSON body missing a valid pvsSecretHex", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, vendor: "gdt_agent", endpoint: "/api/pvs/events" })
    );
    const res = await enroll(validInput());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pvsSecretHex/);
    expect(storeSecretMock).not.toHaveBeenCalled();
  });

  it("rejects a pvsSecretHex of the wrong shape (would TypeError deep in DPAPI)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ ok: true, pvsSecretHex: "deadbeef", vendor: "gdt_agent" })
    );
    const res = await enroll(validInput());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pvsSecretHex/);
    expect(storeSecretMock).not.toHaveBeenCalled();
  });
});

describe("enroll — L16 crash resumability", () => {
  it("completes an enrollment that crashed between token redemption and local persistence, without a new token", async () => {
    // First attempt: the response is valid (token is spent server-side) but
    // storeSecret fails mid-finalize, simulating a crash before config lands.
    storeSecretMock.mockRejectedValueOnce(new Error("DPAPI busy"));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        pvsSecretHex: SECRET,
        vendor: "gdt_agent",
        endpoint: "/api/pvs/events",
      })
    );

    const first = await enroll(validInput());
    expect(first.ok).toBe(false);
    expect(first.error).toMatch(/local persistence failed/i);
    // The recovery journal is on disk; config was NOT written.
    expect(existsSync(recoveryFilePath())).toBe(true);
    expect(saveConfigMock).not.toHaveBeenCalled();

    // Restart: completePendingEnrollment finishes it from the journal. No new
    // token, no new network call.
    const recovered = await completePendingEnrollment();
    expect(recovered?.clinicId).toBe(validInput().clinicId);
    expect(storeSecretMock).toHaveBeenLastCalledWith(SECRET);
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    // Journal cleaned up; the plaintext secret no longer sits on disk.
    expect(existsSync(recoveryFilePath())).toBe(false);
    // Only the original enroll made a request; recovery made none.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("completePendingEnrollment is a no-op when there is nothing to recover", async () => {
    expect(await completePendingEnrollment()).toBeNull();
    expect(saveConfigMock).not.toHaveBeenCalled();
  });
});

describe("machineFingerprint — L19 stability", () => {
  it("does not depend on interface enumeration order", () => {
    const eth = [{ mac: "aa:bb:cc:dd:ee:01", internal: false }];
    const wifi = [{ mac: "aa:bb:cc:dd:ee:02", internal: false }];
    const orderA = { Ethernet: eth, "Wi-Fi": wifi } as never;
    const orderB = { "Wi-Fi": wifi, Ethernet: eth } as never;
    expect(machineFingerprint(orderA, "host")).toBe(
      machineFingerprint(orderB, "host")
    );
  });

  it("skips VPN / virtual adapters whose MAC would otherwise sort first", () => {
    const physicalOnly = {
      Ethernet: [{ mac: "aa:bb:cc:dd:ee:01", internal: false }],
    } as never;
    const withVirtual = {
      Ethernet: [{ mac: "aa:bb:cc:dd:ee:01", internal: false }],
      // These MACs sort BEFORE the real NIC, so if they were NOT skipped the
      // fingerprint would change when the dock / VPN / WSL adapter appears.
      "VMware Network Adapter VMnet1": [
        { mac: "00:50:56:c0:00:01", internal: false },
      ],
      "vEthernet (WSL)": [{ mac: "00:15:5d:00:00:01", internal: false }],
    } as never;
    expect(machineFingerprint(withVirtual, "host")).toBe(
      machineFingerprint(physicalOnly, "host")
    );
  });

  it("produces a 24-char hex digest", () => {
    const ifaces = {
      Ethernet: [{ mac: "aa:bb:cc:dd:ee:01", internal: false }],
    } as never;
    expect(machineFingerprint(ifaces, "host")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("reuses the persisted fingerprint on re-enrollment", async () => {
    loadConfigMock.mockResolvedValue({
      clinicId: validInput().clinicId,
      portalBaseUrl: "https://portal.example",
      watchFolder: "C:/GDT-Out",
      machineFingerprint: "PERSISTED_FP_VALUE",
    });
    let sentFingerprint: string | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_url: string | URL | Request, init?: RequestInit) => {
        sentFingerprint = JSON.parse(String(init?.body)).machineFingerprint;
        return jsonResponse({
          ok: true,
          pvsSecretHex: SECRET,
          vendor: "gdt_agent",
          endpoint: "/api/pvs/events",
        });
      }
    );

    const res = await enroll(validInput());
    expect(res.ok).toBe(true);
    expect(sentFingerprint).toBe("PERSISTED_FP_VALUE");
    expect(saveConfigMock.mock.calls[0]![0].machineFingerprint).toBe(
      "PERSISTED_FP_VALUE"
    );
  });
});
