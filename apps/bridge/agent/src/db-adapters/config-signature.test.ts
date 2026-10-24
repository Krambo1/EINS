import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  CONFIG_BUNDLE_SCHEMA,
  canonicalJson,
  compareVersions,
  isSafeVendorId,
  parseBundle,
  sha256Hex,
  signingInput,
  verifyBundle,
  type SignedBundleCore,
  type TrustedConfigKey,
  type VendorConfigBundle,
} from "./config-signature.js";

/**
 * The signature is the only thing standing between "the portal was compromised"
 * and "arbitrary SQL runs against thirty Praxis patient databases", so these
 * tests are written as attacks: each one takes a bundle that verifies and
 * changes exactly one thing an attacker would want to change.
 */

function makeKey(keyId: string): {
  trusted: TrustedConfigKey;
  sign: (core: SignedBundleCore) => string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(
    12
  );
  return {
    trusted: { keyId, publicKey: raw.toString("base64") },
    sign: (core) =>
      cryptoSign(null, Buffer.from(signingInput(core), "utf8"), privateKey).toString(
        "base64"
      ),
  };
}

const YAML = "vendor: tomedo-db\ndriver: postgres\n";

function makeBundle(
  signer: ReturnType<typeof makeKey>,
  overrides: Partial<SignedBundleCore> = {},
  yaml = YAML
): VendorConfigBundle {
  const core: SignedBundleCore = {
    schema: CONFIG_BUNDLE_SCHEMA,
    vendor: "tomedo-db",
    version: 4,
    bridgeSource: "tomedo",
    driver: "postgres",
    streams: ["AppointmentCreated"],
    minAgentVersion: "0.3.0",
    notes: "Tomedo 1.152",
    signedAt: 1_753_000_000_000,
    sha256: sha256Hex(yaml),
    keyId: signer.trusted.keyId,
    ...overrides,
  };
  return { ...core, yaml, signature: signer.sign(core) };
}

describe("canonicalJson", () => {
  it("is insensitive to key order so signer and verifier agree byte-for-byte", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("drops undefined but keeps null, which are different states on the wire", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([2, 1])).toBe("[2,1]");
  });
});

describe("verifyBundle", () => {
  it("accepts a correctly signed bundle", () => {
    const signer = makeKey("k1");
    const res = verifyBundle(makeBundle(signer), [signer.trusted]);
    expect(res.ok).toBe(true);
  });

  it("fails closed when no key is compiled in", () => {
    const signer = makeKey("k1");
    const res = verifyBundle(makeBundle(signer), []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/no trusted config signing key/);
  });

  it("rejects a bundle signed by an untrusted key", () => {
    const real = makeKey("k1");
    const attacker = makeKey("k1"); // same id, different key material
    const res = verifyBundle(makeBundle(attacker), [real.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signature does not verify/);
  });

  it("rejects an unknown key id", () => {
    const signer = makeKey("rotated-out");
    const other = makeKey("current");
    const res = verifyBundle(makeBundle(signer), [other.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unknown key/);
  });

  it("rejects swapped YAML even though the header is untouched", () => {
    const signer = makeKey("k1");
    const bundle = makeBundle(signer);
    const tampered = {
      ...bundle,
      yaml: "vendor: tomedo-db\nquery: SELECT * FROM patient\n",
    };
    const res = verifyBundle(tampered, [signer.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/digest mismatch/);
  });

  it("rejects a re-labelled vendor (serving one PVS's SQL under another's name)", () => {
    const signer = makeKey("k1");
    const bundle = makeBundle(signer);
    const res = verifyBundle({ ...bundle, vendor: "medatixx-db" }, [signer.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signature does not verify/);
  });

  it("rejects a version bumped after signing (replay dressed as an upgrade)", () => {
    const signer = makeKey("k1");
    const bundle = makeBundle(signer);
    const res = verifyBundle({ ...bundle, version: 99 }, [signer.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/signature does not verify/);
  });

  it("rejects a lowered minAgentVersion", () => {
    const signer = makeKey("k1");
    const bundle = makeBundle(signer);
    const res = verifyBundle({ ...bundle, minAgentVersion: "0.0.1" }, [
      signer.trusted,
    ]);
    expect(res.ok).toBe(false);
  });

  it("rejects a malformed signature instead of throwing", () => {
    const signer = makeKey("k1");
    const bundle = makeBundle(signer);
    const res = verifyBundle({ ...bundle, signature: "AAAA" }, [signer.trusted]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/64 bytes/);
  });

  it("rejects an unusable trusted key instead of throwing", () => {
    const signer = makeKey("k1");
    const res = verifyBundle(makeBundle(signer), [
      { keyId: "k1", publicKey: "c2hvcnQ=" },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/unusable/);
  });
});

describe("parseBundle", () => {
  it("rejects a foreign schema string", () => {
    const res = parseBundle({ schema: "something-else" });
    expect(res.ok).toBe(false);
  });

  it("rejects non-object input without throwing", () => {
    for (const bad of [null, 42, "x", []]) {
      expect(parseBundle(bad).ok).toBe(false);
    }
  });

  it("rejects a non-integer version", () => {
    const signer = makeKey("k1");
    const res = parseBundle({ ...makeBundle(signer), version: 1.5 });
    expect(res.ok).toBe(false);
  });

  it("rejects a digest that is not 64 hex chars", () => {
    const signer = makeKey("k1");
    const res = parseBundle({ ...makeBundle(signer), sha256: "abc" });
    expect(res.ok).toBe(false);
  });
});

describe("isSafeVendorId", () => {
  it("accepts the ids the YAML validator allows", () => {
    expect(isSafeVendorId("tomedo-db")).toBe(true);
    expect(isSafeVendorId("cgm_m1pro_oracle")).toBe(true);
  });

  it("refuses anything that could escape the config cache directory", () => {
    for (const bad of [
      "../../etc/passwd",
      "..",
      "a/b",
      "a\\b",
      "",
      "1leading-digit",
      null,
      42,
    ]) {
      expect(isSafeVendorId(bad)).toBe(false);
    }
  });
});

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("0.3", "0.3.0")).toBe(0);
  });

  it("degrades a malformed version to the lowest rather than throwing", () => {
    expect(compareVersions("wat", "0.0.1")).toBeLessThan(0);
  });
});
