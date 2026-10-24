import type { TrustedConfigKey } from "./config-signature.js";

/**
 * TRUST ANCHOR for remotely delivered vendor configs.
 *
 * This list is the ONLY thing that decides whose SQL the agent will run
 * against a Praxis database. It lives in source, is compiled into the binary,
 * and is deliberately NOT readable from config.json, an env var or the
 * enrollment response: every one of those is writable by whoever controls the
 * portal or the machine's config directory, which would collapse the whole
 * point of signing the configs in the first place.
 *
 * Populate it with:
 *
 *   pnpm --filter eins-agent config:keygen -- --install
 *
 * which generates an Ed25519 keypair, writes the private half to a path you
 * choose (keep it OFFLINE, e.g. a password manager or an encrypted USB key)
 * and rewrites the array below with the public half.
 *
 * ROTATION: add the new key alongside the old one, ship that agent build, wait
 * until every Praxis reports the new version, then sign with the new key and
 * drop the old entry in a later build. Two entries at once is the supported
 * overlap state.
 *
 * EMPTY = REMOTE CONFIG OFF. An agent with no trusted key refuses every bundle
 * and keeps running its bundled configs, which is the correct failure mode for
 * a build that was never given a key.
 */
export const TRUSTED_CONFIG_KEYS: ReadonlyArray<TrustedConfigKey> = [
  // { keyId: "eins-pvs-2026a", publicKey: "<base64 raw Ed25519 public key>" },
];

/**
 * Test seam. Production code always reads TRUSTED_CONFIG_KEYS; the tests need
 * to install an ephemeral keypair without touching the shipped anchor, and
 * doing it through an explicit setter (rather than an env var) keeps the
 * override impossible to reach from outside the process.
 */
let overrideKeys: ReadonlyArray<TrustedConfigKey> | null = null;

export function trustedConfigKeys(): ReadonlyArray<TrustedConfigKey> {
  return overrideKeys ?? TRUSTED_CONFIG_KEYS;
}

/** Test-only: install (or with `null`, clear) an ephemeral trust anchor. */
export function _setTrustedConfigKeysForTests(
  keys: ReadonlyArray<TrustedConfigKey> | null
): void {
  overrideKeys = keys;
}
