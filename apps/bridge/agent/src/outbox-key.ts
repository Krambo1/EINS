import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import {
  loadOutboxMasterKeyDetailed,
  storeOutboxMasterKey,
  type SecretLoad,
} from "./secure-store.js";
import { outboxPath } from "./config.js";

/**
 * P3-4: SQLCipher master-key lifecycle for the outbox.
 *
 * The outbox SQLite file at `<dataDir>\outbox.sqlite` (see config.ts: on
 * Windows %ProgramData%\EINS-Agent) is encrypted with SQLCipher. The key that
 * unlocks it lives in DPAPI (Windows) / Keychain (macOS) / a 0600 file
 * (Linux), minted on first boot. This module is the one place that:
 *
 *   1. Generates a fresh 256-bit key when none exists AND no outbox exists.
 *   2. Persists it via secure-store and reads it back before trusting it.
 *   3. Returns the canonical hex form for the outbox driver.
 *
 * THE RULE THAT MATTERS: a new key is minted only on a machine that has no
 * outbox data. Once outbox.sqlite exists, an unreadable or missing key is a
 * fatal, loud error. Minting a replacement there would either leave the agent
 * looping on "file is not a database" or, worse, let a fresh outbox shadow the
 * old one and silently lose every queued patient event (and overwriting an
 * unreadable key blob would destroy the only copy of the real key).
 *
 * Threat model:
 *   • Cold-disk theft: workstation drive is imaged offline; without the
 *     master key (which lives in DPAPI / Keychain) the SQLite file is
 *     unreadable. P3-4's primary goal.
 *   • Live-malware-as-same-user: out of scope. Malware running under
 *     the agent's user can call our DPAPI unwrap path itself; SQLCipher
 *     does not defend against that. Mitigations belong at the
 *     workstation-hardening layer (EDR, application allowlist). On Windows the
 *     DPAPI scope is LocalMachine (see secure-store.ts), so the data
 *     directory ACL (SYSTEM + Administrators) is what stops other local users.
 *
 * Wire format: 64-char lowercase hex (32 random bytes). The outbox driver
 * translates to the SQLCipher pragma syntax `"x'HEX'"` at open time.
 *
 * Concurrency: `getOrCreateOutboxKey` is called once at agent startup
 * before any watcher or flush loop is wired up, after instance-lock.ts has
 * guaranteed exactly one agent process per data directory.
 */

const KEY_BYTES = 32;

export class OutboxKeyError extends Error {
  readonly code: "KEY_UNREADABLE" | "KEY_MISSING_WITH_OUTBOX" | "KEY_NOT_PERSISTED";
  constructor(code: OutboxKeyError["code"], message: string) {
    super(message);
    this.name = "OutboxKeyError";
    this.code = code;
  }
}

/** Collaborators, injectable so the never-mint rule is testable without disk. */
export interface OutboxKeyDeps {
  load: () => Promise<SecretLoad>;
  store: (keyHex: string) => Promise<void>;
  /** True when a non-empty outbox database file already exists. */
  outboxExists: () => boolean;
  outboxFile: () => string;
  mint: () => string;
}

/**
 * Conservative existence check: a non-empty outbox.sqlite means queued events
 * may live in it. A stat error other than "not found" (permissions, I/O) is
 * treated as "exists": we must not mint a key when we cannot even look.
 */
export function outboxFileHasData(
  path: string,
  statFn: (p: string) => { size: number } = statSync
): boolean {
  try {
    return statFn(path).size > 0;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

const defaultDeps: OutboxKeyDeps = {
  load: loadOutboxMasterKeyDetailed,
  store: storeOutboxMasterKey,
  outboxExists: () => outboxFileHasData(outboxPath()),
  outboxFile: outboxPath,
  mint: () => randomBytes(KEY_BYTES).toString("hex"),
};

export async function getOrCreateOutboxKey(
  deps: OutboxKeyDeps = defaultDeps
): Promise<string> {
  const existing = await deps.load();

  if (existing.status === "ok") {
    if (!isValidKeyHex(existing.value)) {
      throw new Error(
        `outbox master key in secure-store is malformed (expected ${KEY_BYTES * 2}-char hex); manual recovery required; DO NOT delete the outbox file, contact support`
      );
    }
    return existing.value;
  }

  const outbox = deps.outboxFile();

  if (existing.status === "error") {
    // A key IS stored but cannot be read (wrong Windows account, DPAPI failure,
    // locked keychain). Never replace it.
    throw new OutboxKeyError(
      "KEY_UNREADABLE",
      `Der Schlüssel für die verschlüsselte Warteschlange konnte nicht gelesen werden ` +
        `(${existing.reason}). Der Agent startet NICHT und erzeugt KEINEN neuen Schlüssel, ` +
        `weil sonst ungesendete Ereignisse in ${outbox} unlesbar würden. ` +
        `Bitte den Agenten unter dem Windows-Konto starten, das die Einrichtung gemacht hat ` +
        `(einmal \`eins-agent --install-service\` als dieser Benutzer ausführen), oder den ` +
        `Datenordner vom ursprünglichen PC wiederherstellen. ` +
        `/ The outbox encryption key exists but cannot be read (${existing.reason}). ` +
        `The agent refuses to start and will NOT mint a new key: that would make queued events ` +
        `in ${outbox} unreadable. Run \`eins-agent --install-service\` once as the Windows user ` +
        `who did the setup, or restore the data folder from the original PC. ` +
        `DO NOT delete the key file or ${outbox}.`
    );
  }

  // status === "absent": nothing stored.
  if (deps.outboxExists()) {
    throw new OutboxKeyError(
      "KEY_MISSING_WITH_OUTBOX",
      `Die Datei ${outbox} existiert, aber der zugehörige Schlüssel fehlt. Der Agent startet NICHT ` +
        `und erzeugt KEINEN neuen Schlüssel: ein neuer Schlüssel kann die vorhandene Datei nicht ` +
        `öffnen, und ein neuer Ausgang würde ungesendete Ereignisse verdecken. Bitte den Schlüssel ` +
        `aus einer Sicherung wiederherstellen (Windows: Datei outbox-master.dpapi im Datenordner; macOS: Schlüsselbund; Linux: Datei outbox-master.key im Datenordner) oder den ` +
        `Support kontaktieren. Die Datei NICHT löschen. ` +
        `/ ${outbox} exists but its encryption key is missing. The agent refuses to start and ` +
        `will NOT mint a new key: a new key cannot open the existing file, and a fresh outbox ` +
        `would shadow it and lose queued patient events. Restore the key (Windows: outbox-master.dpapi ` +
        `in the data folder) from a backup or contact support. DO NOT delete the outbox file.`
    );
  }

  const fresh = deps.mint();
  await deps.store(fresh);

  // Read it back before any outbox file is created with this key. If the store
  // call "succeeded" but the key cannot be read, we would create an outbox that
  // the next boot could never open.
  const back = await deps.load();
  if (back.status !== "ok") {
    throw new OutboxKeyError(
      "KEY_NOT_PERSISTED",
      `Der neu erzeugte Schlüssel konnte nach dem Speichern nicht gelesen werden ` +
        `(${back.status === "error" ? back.reason : "nicht gefunden"}). Der Agent startet nicht. ` +
        `/ The newly minted outbox key could not be read back after storing it ` +
        `(${back.status === "error" ? back.reason : "not found"}); refusing to start.`
    );
  }
  if (!isValidKeyHex(back.value)) {
    throw new OutboxKeyError(
      "KEY_NOT_PERSISTED",
      `outbox master key read back from secure-store is malformed; refusing to start.`
    );
  }
  // Another process may have won a first-boot race; the persisted key is the
  // one any outbox file will be created with, so it is the one we use.
  return back.value;
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
