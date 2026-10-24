import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * C-34 / F-11: after an intake-secret rotation the previous secret is
 * accepted for 24 h, so a Zielseite still signing with the old secret keeps
 * working. A-18: a cached "no row" lives 2 s, and a mismatch on a cached
 * secret re-reads the row once (another instance may have rotated).
 */
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: limitMock }) }) }) },
  schema: {
    platformCredentials: {
      accessTokenEnc: {},
      previousAccessTokenEnc: {},
      previousValidUntil: {},
      clinicId: {},
      platform: {},
      id: {},
    },
  },
}));
// Stored "ciphertext" in these tests is the plaintext as a Buffer.
vi.mock("@/lib/crypto", () => ({ decryptString: (b: Buffer) => b.toString("utf8") }));

import {
  invalidateSignatureSecretCache,
  signatureMatchesSecretSet,
  verifyClinicSignature,
} from "./clinic-signature";

const body = JSON.stringify({ name: "Test", phone: "000" });
const mac = (secret: string) => createHmac("sha256", secret).update(body).digest();
const header = (secret: string) => `sha256=${mac(secret).toString("hex")}`;
const NOW = Date.parse("2026-10-07T10:00:00Z");

describe("signatureMatchesSecretSet", () => {
  const set = { current: "new-secret", previous: "old-secret", previousValidUntil: NOW + 1000 };

  it("accepts the current secret", () => {
    expect(signatureMatchesSecretSet(set, body, mac("new-secret"), NOW)).toBe(true);
  });

  it("accepts the previous secret only inside the grace window", () => {
    expect(signatureMatchesSecretSet(set, body, mac("old-secret"), NOW)).toBe(true);
    expect(signatureMatchesSecretSet(set, body, mac("old-secret"), NOW + 1000)).toBe(false);
    expect(
      signatureMatchesSecretSet({ ...set, previousValidUntil: null }, body, mac("old-secret"), NOW)
    ).toBe(false);
  });

  it("rejects other secrets, a tampered body and wrong-length input", () => {
    expect(signatureMatchesSecretSet(set, body, mac("guess"), NOW)).toBe(false);
    expect(
      signatureMatchesSecretSet(set, `${body} `, mac("new-secret"), NOW)
    ).toBe(false);
    expect(signatureMatchesSecretSet(set, body, Buffer.alloc(16), NOW)).toBe(false);
  });

  it("rejects everything when no secret exists", () => {
    expect(
      signatureMatchesSecretSet({ current: null, previous: null, previousValidUntil: null }, body, mac(""), NOW)
    ).toBe(false);
  });
});

describe("verifyClinicSignature", () => {
  const clinic = "00000000-0000-4000-8000-0000000000c1";
  const row = (current: string, previous?: string, validUntil?: Date) => ({
    accessTokenEnc: Buffer.from(current),
    previousAccessTokenEnc: previous ? Buffer.from(previous) : null,
    previousValidUntil: validUntil ?? null,
  });

  beforeEach(() => {
    limitMock.mockReset();
    invalidateSignatureSecretCache(clinic, "intake");
    vi.useRealTimers();
  });

  it("rejects malformed headers without a DB read", async () => {
    for (const h of [null, "", "sha1=abcd", "sha256=zz", `sha256=${"ab".repeat(16)}`]) {
      expect(await verifyClinicSignature(clinic, body, h, "leads")).toBe(false);
    }
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("accepts old and new secret during the grace window, only the new one after it", async () => {
    const inGrace = new Date(Date.now() + 60 * 60 * 1000);
    limitMock.mockResolvedValueOnce([row("new-secret", "old-secret", inGrace)]);
    expect(await verifyClinicSignature(clinic, body, header("new-secret"), "leads")).toBe(true);
    expect(await verifyClinicSignature(clinic, body, header("old-secret"), "leads")).toBe(true);

    invalidateSignatureSecretCache(clinic, "intake");
    const expired = new Date(Date.now() - 1000);
    limitMock.mockResolvedValue([row("new-secret", "old-secret", expired)]);
    expect(await verifyClinicSignature(clinic, body, header("old-secret"), "leads")).toBe(false);
    expect(await verifyClinicSignature(clinic, body, header("new-secret"), "leads")).toBe(true);
  });

  it("re-reads a stale cached secret once on mismatch (rotation on another instance)", async () => {
    vi.useFakeTimers({ now: NOW });
    limitMock.mockResolvedValueOnce([row("secret-a")]);
    expect(await verifyClinicSignature(clinic, body, header("secret-a"), "leads")).toBe(true);
    // Another instance rotates to secret-b; our cache still holds secret-a.
    vi.setSystemTime(NOW + 1500);
    limitMock.mockResolvedValueOnce([row("secret-b")]);
    expect(await verifyClinicSignature(clinic, body, header("secret-b"), "leads")).toBe(true);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it("throttles re-reads so wrong signatures cannot hammer the DB", async () => {
    vi.useFakeTimers({ now: NOW });
    limitMock.mockResolvedValue([row("secret-a")]);
    await verifyClinicSignature(clinic, body, header("secret-a"), "leads");
    for (let i = 0; i < 5; i++) {
      expect(await verifyClinicSignature(clinic, body, header("wrong"), "leads")).toBe(false);
    }
    // Initial load only: all mismatches came within the 1 s throttle.
    expect(limitMock).toHaveBeenCalledTimes(1);
  });

  it("caches a missing row only briefly", async () => {
    vi.useFakeTimers({ now: NOW });
    limitMock.mockResolvedValueOnce([]);
    expect(await verifyClinicSignature(clinic, body, header("fresh"), "leads")).toBe(false);
    vi.setSystemTime(NOW + 2500);
    limitMock.mockResolvedValueOnce([row("fresh")]);
    expect(await verifyClinicSignature(clinic, body, header("fresh"), "leads")).toBe(true);
  });
});
