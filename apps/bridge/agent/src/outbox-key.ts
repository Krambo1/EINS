import { randomBytes } from "node:crypto";
import {
  loadOutboxMasterKey,
  storeOutboxMasterKey,
} from "./secure-store.js";

/**
 * P3-4: SQLCipher master-key lifecycle for the outbox.
 *
 * The outbox SQLite file at `%APPDATA%\EINS-Agent\outbox.sqlite` (or the
 * platform-equivalent) is encrypted with SQLCipher. The key that unlocks
 * it lives in DPAPI (Windows) / Keychain (macOS) / a 0600 file (Linux),
 * minted on first boot. This module is the one place that:
 *
 *   1. Generates a fresh 256-bit key when none exists.
 *   2. Persists it via secure-store.
 *   3. Returns the canonical hex form for the outbox driver.
 *
 * Threat model:
 *   • Cold-disk theft: workstation drive is imaged offline; without the
 *     master key (which lives in DPAPI / Keychain) the SQLite file is
 *     unreadable. P3-4's primary goal.
 *   • Live-malware-as-same-user: out of scope. Malware running under
 *     the agent's user can call our DPAPI unwrap path itself; SQLCipher
 *     does not defend against that. Mitigations belong at the
 *     workstation-hardening layer (EDR, application allowlist).
 *
 * Wire format: 64-char lowercase hex (32 random bytes). The outbox driver
 * translates to the SQLCipher pragma syntax `"x'HEX'"` at open time.
 *
 * Concurrency: `getOrCreateOutboxKey` is called once at agent startup
 * before any watcher or flush loop is wired up. We do not protect against
 * concurrent first-boot calls because there is exactly one agent process
 * per workstation and it is single-process by design.
 */

const KEY_BYTES = 32;

export async function getOrCreateOutboxKey(): Promise<string> {
  const existing = await loadOutboxMasterKey();
  if (existing) {
    if (!isValidKeyHex(existing)) {
      throw new Error(
        `outbox master key in secure-store is malformed (expected ${KEY_BYTES * 2}-char hex); manual recovery required; DO NOT delete the outbox file, contact support`
      );
    }
    return existing;
  }
  const fresh = randomBytes(KEY_BYTES).toString("hex");
  await storeOutboxMasterKey(fresh);
  return fresh;
}

/**
 * Validate a key string: must be exactly `KEY_BYTES * 2` hex chars, all
 * lowercase a-f or digits. We never trust a key blob that came from disk
 * without a shape check; a corrupted secure-store would otherwise cascade
 * into an inscrutable SQLCipher error.
 */
export function isValidKeyHex(s: string): boolean {
  return new RegExp(`^[0-9a-f]{${KEY_BYTES * 2}}$`).test(s);
}

/**
 * Test-only: generate a key without touching secure-store. The encryption
 * tests need a stable key shape but never want to leak the agent's real
 * production key into the test database file.
 */
export function _generateKeyForTests(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}
