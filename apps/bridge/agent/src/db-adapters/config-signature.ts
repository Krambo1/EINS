import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

/**
 * Signed vendor-config bundles: format, canonicalisation and verification.
 *
 * WHY SIGNED, AND WHY THE PORTAL DOES NOT HOLD THE KEY
 * ----------------------------------------------------
 * A vendor config is a set of SQL statements the agent runs against a Praxis
 * PVS database. Whoever can push one has arbitrary read access to patient data
 * on every machine that accepts it. If the signing key lived in the portal's
 * environment, a single compromise of a Next.js app would hand an attacker
 * every connected Praxis database at once.
 *
 * So the private key never touches the portal or this repo. Configs are signed
 * OFFLINE (apps/bridge/agent/scripts/sign-vendor-config.ts) and uploaded as a
 * finished bundle. The portal is a distribution channel that verifies what it
 * stores but cannot mint anything; the agent verifies again before applying.
 * The worst a fully-compromised portal can do is withhold an update or replay
 * an OLD bundle, and the agent's monotonic-version rule refuses the replay.
 *
 * WHAT THE SIGNATURE COVERS
 * -------------------------
 * The signature is Ed25519 over
 *
 *   "eins-pvs-vendor-config/v1\n" + canonicalJson(<bundle minus yaml, minus signature>)
 *
 * The YAML body itself is bound through `sha256`, which IS inside the signed
 * struct: a verifier recomputes SHA-256 over the YAML bytes and compares. That
 * keeps the signed string short while making the binding explicit, and it means
 * `vendor`, `version`, `bridgeSource`, `driver` and `minAgentVersion` are all
 * signed too. Serving tomedo's config under the medatixx name, or replaying
 * v3's bytes under a v9 header, both fail verification.
 */

/** Domain separator. Bump with the bundle schema, never reuse across formats. */
export const CONFIG_SIGNING_CONTEXT = "eins-pvs-vendor-config/v1";
export const CONFIG_BUNDLE_SCHEMA = "eins-pvs-vendor-config/v1";

/**
 * DER prefix for an Ed25519 SubjectPublicKeyInfo. Prepending it to the raw
 * 32-byte public key yields the SPKI form node:crypto wants, which lets keys
 * travel as a short base64 string instead of a multi-line PEM in a YAML/env
 * value where the newlines get mangled.
 */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_PUBLIC_KEY_BYTES = 32;

export interface VendorConfigBundle {
  /** Must equal CONFIG_BUNDLE_SCHEMA. */
  schema: string;
  /** YAML `vendor:` id, e.g. "tomedo-db". */
  vendor: string;
  /** Monotonic per vendor. Never reused, never decreasing. */
  version: number;
  /** Mirror of the YAML `bridgeSource:` so the portal can display it. */
  bridgeSource: string;
  /** Mirror of the YAML `driver:`. */
  driver: string;
  /** Canonical event kinds this config streams (display + change review). */
  streams: string[];
  /** Lowest agent version that may apply this config, e.g. "0.3.0". */
  minAgentVersion: string;
  /** Operator note: what changed and why. Shown in the admin history. */
  notes: string | null;
  /** Epoch-ms the bundle was signed. */
  signedAt: number;
  /** SHA-256 (hex) over the UTF-8 bytes of `yaml`. */
  sha256: string;
  /** Which trusted key signed this. */
  keyId: string;
  /** The config source. NOT in the signed struct; bound via `sha256`. */
  yaml: string;
  /** Base64 Ed25519 signature over the signing input. */
  signature: string;
}

/** The signed struct: everything except the YAML body and the signature. */
export type SignedBundleCore = Omit<VendorConfigBundle, "yaml" | "signature">;

export interface TrustedConfigKey {
  keyId: string;
  /** Base64 of the raw 32-byte Ed25519 public key. */
  publicKey: string;
}

/**
 * Deterministic JSON: object keys sorted, undefined dropped, no whitespace.
 * Both signer and verifier must produce byte-identical output, so this is
 * deliberately tiny and dependency-free rather than a canonical-JSON library.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The exact bytes that get signed / verified. */
export function signingInput(core: SignedBundleCore): string {
  const ordered: SignedBundleCore = {
    schema: core.schema,
    vendor: core.vendor,
    version: core.version,
    bridgeSource: core.bridgeSource,
    driver: core.driver,
    streams: core.streams,
    minAgentVersion: core.minAgentVersion,
    notes: core.notes,
    signedAt: core.signedAt,
    sha256: core.sha256,
    keyId: core.keyId,
  };
  return `${CONFIG_SIGNING_CONTEXT}\n${canonicalJson(ordered)}`;
}

export function publicKeyFromBase64(raw: string): ReturnType<typeof createPublicKey> {
  const key = Buffer.from(raw, "base64");
  if (key.length !== ED25519_RAW_PUBLIC_KEY_BYTES) {
    throw new Error(
      `expected a ${ED25519_RAW_PUBLIC_KEY_BYTES}-byte raw Ed25519 public key, got ${key.length} bytes`
    );
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, key]),
    format: "der",
    type: "spki",
  });
}

export type BundleVerification =
  | { ok: true; bundle: VendorConfigBundle }
  | { ok: false; reason: string };

/**
 * Structural check of an untrusted bundle. Runs BEFORE any crypto so a
 * malformed payload can't reach createPublicKey / Buffer.from with garbage.
 * Every field the agent later trusts is type-checked here.
 */
export function parseBundle(input: unknown): BundleVerification {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "bundle is not an object" };
  }
  const b = input as Record<string, unknown>;
  if (b.schema !== CONFIG_BUNDLE_SCHEMA) {
    return {
      ok: false,
      reason: `unknown bundle schema '${String(b.schema)}' (expected ${CONFIG_BUNDLE_SCHEMA})`,
    };
  }
  for (const field of [
    "vendor",
    "bridgeSource",
    "driver",
    "minAgentVersion",
    "sha256",
    "keyId",
    "yaml",
    "signature",
  ]) {
    if (typeof b[field] !== "string" || (b[field] as string).length === 0) {
      return { ok: false, reason: `missing or non-string field '${field}'` };
    }
  }
  if (
    typeof b.version !== "number" ||
    !Number.isSafeInteger(b.version) ||
    b.version < 1
  ) {
    return { ok: false, reason: "version must be a positive integer" };
  }
  if (
    typeof b.signedAt !== "number" ||
    !Number.isSafeInteger(b.signedAt) ||
    b.signedAt <= 0
  ) {
    return { ok: false, reason: "signedAt must be a positive epoch-ms integer" };
  }
  if (
    !Array.isArray(b.streams) ||
    b.streams.some((s) => typeof s !== "string")
  ) {
    return { ok: false, reason: "streams must be an array of strings" };
  }
  if (b.notes !== null && typeof b.notes !== "string") {
    return { ok: false, reason: "notes must be a string or null" };
  }
  if (!/^[0-9a-f]{64}$/.test(b.sha256 as string)) {
    return { ok: false, reason: "sha256 must be 64 lowercase hex chars" };
  }
  return { ok: true, bundle: b as unknown as VendorConfigBundle };
}

/**
 * Full verification: structure, then YAML digest, then signature against a
 * trusted key. Returns a reason string rather than throwing so every caller
 * can report the failure instead of crashing a poll loop.
 *
 * An empty `trustedKeys` fails closed: no key means no remote config, never
 * "accept anything".
 */
export function verifyBundle(
  input: unknown,
  trustedKeys: ReadonlyArray<TrustedConfigKey>
): BundleVerification {
  const parsed = parseBundle(input);
  if (!parsed.ok) return parsed;
  const bundle = parsed.bundle;

  if (trustedKeys.length === 0) {
    return {
      ok: false,
      reason:
        "no trusted config signing key is compiled into this build; remote configs are refused",
    };
  }
  const trusted = trustedKeys.find((k) => k.keyId === bundle.keyId);
  if (!trusted) {
    return {
      ok: false,
      reason: `signed by unknown key '${bundle.keyId}' (trusted: ${trustedKeys
        .map((k) => k.keyId)
        .join(", ")})`,
    };
  }

  // Digest first: it is cheap, and it is what binds the YAML body to the
  // signed header. A mismatch means the payload was swapped in transit.
  const actual = sha256Hex(bundle.yaml);
  if (actual !== bundle.sha256) {
    return {
      ok: false,
      reason: `yaml digest mismatch (signed ${bundle.sha256}, got ${actual})`,
    };
  }

  let key: ReturnType<typeof createPublicKey>;
  try {
    key = publicKeyFromBase64(trusted.publicKey);
  } catch (err) {
    return {
      ok: false,
      reason: `trusted key '${trusted.keyId}' is unusable: ${(err as Error).message}`,
    };
  }

  let sig: Buffer;
  try {
    sig = Buffer.from(bundle.signature, "base64");
  } catch {
    return { ok: false, reason: "signature is not valid base64" };
  }
  // Ed25519 signatures are exactly 64 bytes; anything else is malformed and
  // node would throw rather than return false.
  if (sig.length !== 64) {
    return { ok: false, reason: `signature must be 64 bytes, got ${sig.length}` };
  }

  const core: SignedBundleCore = {
    schema: bundle.schema,
    vendor: bundle.vendor,
    version: bundle.version,
    bridgeSource: bundle.bridgeSource,
    driver: bundle.driver,
    streams: bundle.streams,
    minAgentVersion: bundle.minAgentVersion,
    notes: bundle.notes,
    signedAt: bundle.signedAt,
    sha256: bundle.sha256,
    keyId: bundle.keyId,
  };

  let valid = false;
  try {
    valid = cryptoVerify(
      null,
      Buffer.from(signingInput(core), "utf8"),
      key,
      sig
    );
  } catch (err) {
    return { ok: false, reason: `signature check threw: ${(err as Error).message}` };
  }
  if (!valid) return { ok: false, reason: "signature does not verify" };

  return { ok: true, bundle };
}

/**
 * A vendor id becomes a filename in the local config cache, and it arrives
 * from the network. Anything outside this shape is refused BEFORE it reaches
 * a path join, so a manifest entry like `../../config` cannot escape the cache
 * directory. Same shape the YAML validator enforces on `vendor:`.
 */
export function isSafeVendorId(vendor: unknown): vendor is string {
  return typeof vendor === "string" && /^[a-z][a-z0-9_-]{1,63}$/i.test(vendor);
}

/**
 * Compare dotted numeric versions ("0.3.0"). Returns <0, 0 or >0. Non-numeric
 * or missing segments count as 0, so "0.3" and "0.3.0" compare equal and a
 * malformed value degrades to the lowest possible version rather than throwing
 * inside the sync loop.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    const va = Number.isFinite(na) ? na : 0;
    const vb = Number.isFinite(nb) ? nb : 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}
