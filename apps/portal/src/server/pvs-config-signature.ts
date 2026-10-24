import "server-only";
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";

/**
 * Verification half of the signed vendor-config format.
 *
 * The signing half lives in apps/bridge/agent/src/db-adapters/config-signature.ts
 * and runs OFFLINE. This module is a deliberate mirror rather than a shared
 * import: the agent ships as a single binary with zero monorepo runtime deps
 * (see the generated-canonical.ts comment for the same trade-off), so the two
 * sides cannot share a package without breaking that.
 *
 * The drift risk that creates is covered by a committed fixture: a bundle the
 * agent's signer really produced, verified here in pvs-config-signature.test.ts.
 * If either side's canonicalisation moves, that test fails.
 *
 * The portal verifies for one reason: so its own view is honest. Without it, an
 * admin could upload a bundle that every agent silently refuses while the
 * dashboard reports the config as deployed. Rejecting at upload is what keeps
 * "published" and "running" the same fact.
 */

export const CONFIG_SIGNING_CONTEXT = "eins-pvs-vendor-config/v1";
export const CONFIG_BUNDLE_SCHEMA = "eins-pvs-vendor-config/v1";

/** Fixed Ed25519 SubjectPublicKeyInfo DER header; see the agent-side twin. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_PUBLIC_KEY_BYTES = 32;

export interface VendorConfigBundle {
  schema: string;
  vendor: string;
  version: number;
  bridgeSource: string;
  driver: string;
  streams: string[];
  minAgentVersion: string;
  notes: string | null;
  signedAt: number;
  sha256: string;
  keyId: string;
  yaml: string;
  signature: string;
}

export type SignedBundleCore = Omit<VendorConfigBundle, "yaml" | "signature">;

export interface TrustedConfigKey {
  keyId: string;
  publicKey: string;
}

/** Deterministic JSON: keys sorted, undefined dropped, no whitespace. */
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

/**
 * Trusted public keys from PVS_CONFIG_PUBLIC_KEYS. A malformed value yields an
 * empty list, which fails every verification closed: better to refuse every
 * upload with "no key configured" than to start accepting things because a JSON
 * comma was in the wrong place.
 */
export function parseTrustedKeys(raw: string | undefined): TrustedConfigKey[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(
      "[pvs-config] PVS_CONFIG_PUBLIC_KEYS is not valid JSON; config uploads are refused."
    );
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TrustedConfigKey[] = [];
  for (const entry of parsed) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as TrustedConfigKey).keyId === "string" &&
      typeof (entry as TrustedConfigKey).publicKey === "string"
    ) {
      out.push({
        keyId: (entry as TrustedConfigKey).keyId,
        publicKey: (entry as TrustedConfigKey).publicKey,
      });
    }
  }
  return out;
}

export type BundleVerification =
  | { ok: true; bundle: VendorConfigBundle }
  | { ok: false; reason: string };

/** Structural check. Runs before any crypto so garbage never reaches it. */
export function parseBundle(input: unknown): BundleVerification {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "Die Datei enthält kein Konfigurations-Paket." };
  }
  const b = input as Record<string, unknown>;
  if (b.schema !== CONFIG_BUNDLE_SCHEMA) {
    return {
      ok: false,
      reason: `Unbekanntes Paket-Format '${String(b.schema)}' (erwartet: ${CONFIG_BUNDLE_SCHEMA}).`,
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
      return { ok: false, reason: `Feld '${field}' fehlt oder ist kein Text.` };
    }
  }
  if (
    typeof b.version !== "number" ||
    !Number.isSafeInteger(b.version) ||
    b.version < 1
  ) {
    return { ok: false, reason: "version muss eine positive ganze Zahl sein." };
  }
  if (
    typeof b.signedAt !== "number" ||
    !Number.isSafeInteger(b.signedAt) ||
    b.signedAt <= 0
  ) {
    return { ok: false, reason: "signedAt muss ein Zeitstempel in Millisekunden sein." };
  }
  if (!Array.isArray(b.streams) || b.streams.some((s) => typeof s !== "string")) {
    return { ok: false, reason: "streams muss eine Liste von Texten sein." };
  }
  if (b.notes !== null && typeof b.notes !== "string") {
    return { ok: false, reason: "notes muss Text oder null sein." };
  }
  if (!/^[0-9a-f]{64}$/.test(b.sha256 as string)) {
    return { ok: false, reason: "sha256 muss 64 Hex-Zeichen in Kleinschreibung sein." };
  }
  return { ok: true, bundle: b as unknown as VendorConfigBundle };
}

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
        "In dieser Umgebung ist kein Signaturschlüssel hinterlegt (PVS_CONFIG_PUBLIC_KEYS). Konfigurationen werden abgelehnt.",
    };
  }
  const trusted = trustedKeys.find((k) => k.keyId === bundle.keyId);
  if (!trusted) {
    return {
      ok: false,
      reason: `Signiert mit dem unbekannten Schlüssel '${bundle.keyId}'. Bekannt sind: ${trustedKeys
        .map((k) => k.keyId)
        .join(", ")}.`,
    };
  }

  const actual = sha256Hex(bundle.yaml);
  if (actual !== bundle.sha256) {
    return {
      ok: false,
      reason:
        "Die YAML-Datei im Paket passt nicht zu ihrer Prüfsumme. Das Paket wurde nach dem Signieren verändert.",
    };
  }

  let key: ReturnType<typeof createPublicKey>;
  try {
    const raw = Buffer.from(trusted.publicKey, "base64");
    if (raw.length !== ED25519_RAW_PUBLIC_KEY_BYTES) {
      return {
        ok: false,
        reason: `Der hinterlegte Schlüssel '${trusted.keyId}' ist unbrauchbar (${raw.length} statt ${ED25519_RAW_PUBLIC_KEY_BYTES} Byte).`,
      };
    }
    key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
  } catch (err) {
    return {
      ok: false,
      reason: `Der hinterlegte Schlüssel '${trusted.keyId}' ist unbrauchbar: ${(err as Error).message}`,
    };
  }

  const sig = Buffer.from(bundle.signature, "base64");
  if (sig.length !== 64) {
    return { ok: false, reason: "Die Signatur hat nicht die erwartete Länge." };
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
    valid = cryptoVerify(null, Buffer.from(signingInput(core), "utf8"), key, sig);
  } catch (err) {
    return {
      ok: false,
      reason: `Die Signaturprüfung ist fehlgeschlagen: ${(err as Error).message}`,
    };
  }
  if (!valid) {
    return {
      ok: false,
      reason:
        "Die Signatur ist ungültig. Das Paket stammt nicht von dem hinterlegten Schlüssel oder wurde verändert.",
    };
  }
  return { ok: true, bundle };
}

/** Same shape the agent enforces before a vendor id becomes a filename. */
export function isSafeVendorId(vendor: unknown): vendor is string {
  return typeof vendor === "string" && /^[a-z][a-z0-9_-]{1,63}$/i.test(vendor);
}
