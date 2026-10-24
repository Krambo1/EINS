import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  canonicalJson,
  isSafeVendorId,
  parseBundle,
  parseTrustedKeys,
  sha256Hex,
  verifyBundle,
} = await import("./pvs-config-signature");
const { FIXTURE_PUBLIC_KEY, FIXTURE_SIGNED_BUNDLE } = await import(
  "./__fixtures__/pvs-signed-config"
);

const TRUSTED = [FIXTURE_PUBLIC_KEY];

/**
 * The load-bearing test here is the first one: a bundle the AGENT'S signer
 * produced, verified by the PORTAL'S verifier. The two implementations are
 * duplicated on purpose (the agent has no monorepo runtime deps), so this
 * fixture is what stops them drifting apart silently.
 *
 * The rest are attacks: each takes that same bundle and changes exactly one
 * thing someone would want to change.
 */
describe("cross-implementation contract", () => {
  it("verifies a bundle produced by the agent's offline signer", () => {
    const res = verifyBundle(FIXTURE_SIGNED_BUNDLE, TRUSTED);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bundle.vendor).toBe("fixture-db");
      expect(res.bundle.version).toBe(7);
    }
  });

  it("computes the same YAML digest the signer recorded", () => {
    expect(sha256Hex(FIXTURE_SIGNED_BUNDLE.yaml)).toBe(
      FIXTURE_SIGNED_BUNDLE.sha256
    );
  });
});

describe("verifyBundle", () => {
  it("fails closed when no public key is configured", () => {
    const res = verifyBundle(FIXTURE_SIGNED_BUNDLE, []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/kein Signaturschlüssel/);
  });

  it("rejects a bundle whose YAML was swapped after signing", () => {
    const res = verifyBundle(
      { ...FIXTURE_SIGNED_BUNDLE, yaml: "vendor: fixture-db\ndriver: sqlite\n" },
      TRUSTED
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Prüfsumme/);
  });

  it("rejects a re-labelled vendor", () => {
    const res = verifyBundle(
      { ...FIXTURE_SIGNED_BUNDLE, vendor: "tomedo-db" },
      TRUSTED
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Signatur ist ungültig/);
  });

  it("rejects a version bumped after signing", () => {
    const res = verifyBundle({ ...FIXTURE_SIGNED_BUNDLE, version: 99 }, TRUSTED);
    expect(res.ok).toBe(false);
  });

  it("rejects an unknown key id", () => {
    const res = verifyBundle(FIXTURE_SIGNED_BUNDLE, [
      { keyId: "some-other-key", publicKey: FIXTURE_PUBLIC_KEY.publicKey },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unbekannten Schlüssel/);
  });

  it("rejects a wrong public key under the right key id", () => {
    const res = verifyBundle(FIXTURE_SIGNED_BUNDLE, [
      {
        keyId: FIXTURE_PUBLIC_KEY.keyId,
        // Same length, different material.
        publicKey: Buffer.alloc(32, 7).toString("base64"),
      },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Signatur ist ungültig/);
  });

  it("rejects an unusable configured key without throwing", () => {
    const res = verifyBundle(FIXTURE_SIGNED_BUNDLE, [
      { keyId: FIXTURE_PUBLIC_KEY.keyId, publicKey: "dG9vLXNob3J0" },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unbrauchbar/);
  });
});

describe("parseBundle", () => {
  it("rejects a foreign schema string", () => {
    expect(parseBundle({ ...FIXTURE_SIGNED_BUNDLE, schema: "other" }).ok).toBe(
      false
    );
  });

  it("rejects non-object input without throwing", () => {
    for (const bad of [null, 42, "x", []]) {
      expect(parseBundle(bad).ok).toBe(false);
    }
  });

  it("rejects a malformed digest", () => {
    expect(parseBundle({ ...FIXTURE_SIGNED_BUNDLE, sha256: "abc" }).ok).toBe(
      false
    );
  });
});

describe("parseTrustedKeys", () => {
  it("reads the documented env shape", () => {
    expect(
      parseTrustedKeys('[{"keyId":"a","publicKey":"b"}]')
    ).toEqual([{ keyId: "a", publicKey: "b" }]);
  });

  it("returns nothing for unset, malformed or wrongly-shaped values", () => {
    expect(parseTrustedKeys(undefined)).toEqual([]);
    expect(parseTrustedKeys("not json")).toEqual([]);
    expect(parseTrustedKeys('{"keyId":"a"}')).toEqual([]);
    expect(parseTrustedKeys('[{"keyId":"a"}]')).toEqual([]);
  });
});

describe("canonicalJson", () => {
  it("is insensitive to key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps null but drops undefined", () => {
    expect(canonicalJson({ a: null, b: undefined })).toBe('{"a":null}');
  });
});

describe("isSafeVendorId", () => {
  it("refuses anything that could escape a directory", () => {
    for (const bad of ["../x", "a/b", "a\\b", "", "1abc"]) {
      expect(isSafeVendorId(bad)).toBe(false);
    }
    expect(isSafeVendorId("tomedo-db")).toBe(true);
  });
});
