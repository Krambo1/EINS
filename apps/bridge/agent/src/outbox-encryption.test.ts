import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import PlaintextDatabase from "better-sqlite3";

/**
 * P3-4: at-rest encryption + legacy-migration contract.
 *
 * The plan's promise is twofold:
 *
 *   1. After P3-4, the outbox SQLite file on disk is unreadable without
 *      the master key. We prove this by opening the file with the stock
 *      better-sqlite3 driver (which has no SQLCipher support) and
 *      asserting reads fail.
 *
 *   2. A workstation upgrading from a pre-P3-4 agent has a plaintext
 *      outbox.sqlite on disk with queued events. The first encrypted
 *      open must detect the legacy file, copy every row into a new
 *      encrypted file, and preserve the legacy file under a timestamped
 *      backup name so the operator can verify the migration.
 *
 * Both tests run against real on-disk SQLite files in a per-test
 * tmpdir. better-sqlite3-multiple-ciphers (the production driver) IS a
 * real driver here; we are not mocking it.
 */

let tempDir: string;
const TEST_KEY_HEX = "b".repeat(64);

vi.mock("./config.js", () => ({
  outboxPath: () => join(tempDir, "outbox.sqlite"),
}));

let outbox: typeof import("./outbox");

/** Seed a pre-P3-4 plaintext outbox at `path` with one 'pending' row (h-1). */
function seedLegacyOutbox(path: string): void {
  const legacy = new PlaintextDatabase(path);
  legacy.exec(`
    CREATE TABLE outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(content_hash)
    );
  `);
  legacy
    .prepare(
      `INSERT INTO outbox (payload, content_hash, status, attempt_count, last_error, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      '{"kind":"PatientUpserted","pvsPatientId":"P-1"}',
      "h-1",
      "pending",
      0,
      null,
      1_000,
      1_000
    );
  legacy.close();
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "eins-outbox-enc-"));
  vi.resetModules();
  outbox = await import("./outbox.js");
});

afterEach(() => {
  outbox._closeForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("outbox at-rest encryption (P3-4)", () => {
  it("fresh outbox file is not readable as plaintext SQLite", () => {
    outbox.setOutboxKey(TEST_KEY_HEX);
    outbox.enqueue(
      JSON.stringify({ kind: "PatientUpserted", pvsPatientId: "P-1" }),
      "hash-1"
    );
    outbox._closeForTests();

    const path = join(tempDir, "outbox.sqlite");
    expect(existsSync(path)).toBe(true);

    // Probe with stock better-sqlite3 (no SQLCipher). The file header
    // looks like SQLite, the open itself succeeds, but the first read
    // hits an encrypted page and throws "file is not a database" or
    // "file is encrypted or is not a database".
    const probe = new PlaintextDatabase(path);
    let probeErr: Error | null = null;
    try {
      probe.prepare("SELECT count(*) FROM sqlite_master").get();
    } catch (err) {
      probeErr = err as Error;
    } finally {
      probe.close();
    }
    expect(probeErr).not.toBeNull();
    expect(probeErr!.message).toMatch(/(file is encrypted|not a database)/i);
  });

  it("payload bytes do not appear in cleartext anywhere in the file", () => {
    outbox.setOutboxKey(TEST_KEY_HEX);
    const PII = "Maria Müller geb. Schmidt, geb. 1985-03-12, 0176-12345678";
    outbox.enqueue(
      JSON.stringify({
        kind: "PatientUpserted",
        pvsPatientId: "P-42",
        fullName: PII,
      }),
      "hash-pii-1"
    );
    outbox._closeForTests();

    const bytes = readFileSync(join(tempDir, "outbox.sqlite"));
    // A plaintext SQLite would contain "Maria Müller" verbatim. The
    // encrypted file must not.
    expect(bytes.includes(Buffer.from("Maria Müller", "utf8"))).toBe(false);
    expect(bytes.includes(Buffer.from("0176-12345678", "ascii"))).toBe(false);
    expect(bytes.includes(Buffer.from("P-42", "ascii"))).toBe(false);
  });

  it("wrong key on a previously-encrypted file refuses to open and does not migrate", async () => {
    // Seed with key A, close, then re-open with key B.
    outbox.setOutboxKey(TEST_KEY_HEX);
    outbox.enqueue(JSON.stringify({ kind: "PatientUpserted" }), "hash-A");
    outbox._closeForTests();

    vi.resetModules();
    const outbox2 = await import("./outbox.js");
    outbox2.setOutboxKey("c".repeat(64));
    expect(() => outbox2.dueRows(10)).toThrow(
      /stored key does not unlock/i
    );
    // Critically, the legacy-migration path MUST NOT fire; that would
    // overwrite the encrypted file with whatever a "plaintext read" of
    // an encrypted file looks like, irrecoverably destroying the rows.
    const legacyFiles = readdirSync(tempDir).filter((n) =>
      n.includes(".legacy-")
    );
    expect(legacyFiles).toEqual([]);
  });

  it("rejects setOutboxKey changes after the database is open", () => {
    outbox.setOutboxKey(TEST_KEY_HEX);
    outbox.enqueue(JSON.stringify({ x: 1 }), "hash-1");
    expect(() => outbox.setOutboxKey("d".repeat(64))).toThrow(
      /cannot be changed after the database has been opened/i
    );
  });

  it("throws a clear error if no key was set before the first DB call", () => {
    expect(() => outbox.dueRows(10)).toThrow(/key not initialised/i);
  });
});

describe("legacy plaintext migration (P3-4)", () => {
  it("migrates a pre-P3-4 plaintext outbox into an encrypted file", () => {
    const path = join(tempDir, "outbox.sqlite");

    // Step 1: simulate the pre-P3-4 state. Create a plaintext outbox
    // file directly with the stock driver and populate it.
    const legacy = new PlaintextDatabase(path);
    legacy.exec(`
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(content_hash)
      );
    `);
    const insert = legacy.prepare(
      `INSERT INTO outbox (payload, content_hash, status, attempt_count, last_error, next_attempt_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      '{"kind":"PatientUpserted","pvsPatientId":"P-1"}',
      "h-1",
      "pending",
      0,
      null,
      1_000,
      1_000
    );
    insert.run(
      '{"kind":"InvoicePaid","pvsInvoiceId":"R-9"}',
      "h-2",
      "failed",
      3,
      "http 400",
      2_000,
      2_000
    );
    insert.run(
      '{"kind":"AppointmentCreated","pvsAppointmentId":"A-7"}',
      "h-3",
      "sent",
      1,
      null,
      3_000,
      3_000
    );
    legacy.close();

    // Sanity: the seeded file IS readable as plaintext (no encryption).
    {
      const verify = new PlaintextDatabase(path);
      const n = verify.prepare("SELECT count(*) AS n FROM outbox").get() as {
        n: number;
      };
      expect(n.n).toBe(3);
      verify.close();
    }

    // Step 2: open via the encrypted driver; this should detect the
    // legacy file and migrate.
    outbox.setOutboxKey(TEST_KEY_HEX);
    const rows = outbox.dueRows(10);
    // The 'pending' row should land in dueRows; failed + sent are
    // filtered out by the WHERE status='pending' clause.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contentHash).toBe("h-1");

    // Failure summary should reflect the migrated 'failed' row.
    const summary = outbox.getFailureSummary();
    expect(summary.failedCount).toBe(1);
    expect(summary.lastFailureReason).toBe("http 400");

    outbox._closeForTests();

    // Step 3: the file at the canonical path must now be ENCRYPTED.
    const probe = new PlaintextDatabase(path);
    let probeErr: Error | null = null;
    try {
      probe.prepare("SELECT count(*) FROM outbox").get();
    } catch (err) {
      probeErr = err as Error;
    } finally {
      probe.close();
    }
    expect(probeErr).not.toBeNull();

    // Step 4: a `.legacy-<timestamp>` backup must exist next to the
    // encrypted file so the operator can verify integrity.
    const siblings = readdirSync(tempDir);
    const legacyBackup = siblings.find((n) =>
      /^outbox\.sqlite\.legacy-\d+$/.test(n)
    );
    expect(legacyBackup).toBeTruthy();
    // The backup must be plaintext-readable (so the operator can grep
    // it during forensics).
    const backupHandle = new PlaintextDatabase(
      join(tempDir, legacyBackup!)
    );
    const backupRows = backupHandle
      .prepare("SELECT count(*) AS n FROM outbox")
      .get() as { n: number };
    backupHandle.close();
    expect(backupRows.n).toBe(3);
  });

  it("no-op migration when the file does not exist yet (fresh install)", () => {
    outbox.setOutboxKey(TEST_KEY_HEX);
    // Fresh install: dueRows on an empty outbox returns an empty array
    // and creates the file with the schema.
    expect(outbox.dueRows(10)).toEqual([]);
    expect(existsSync(join(tempDir, "outbox.sqlite"))).toBe(true);
    // No `.legacy-` backup gets created on the fresh-install path.
    const siblings = readdirSync(tempDir);
    expect(siblings.some((n) => n.includes(".legacy-"))).toBe(false);
  });

  it("migration preserves row ids so existing send-state tracking is unaffected", () => {
    const path = join(tempDir, "outbox.sqlite");
    const legacy = new PlaintextDatabase(path);
    legacy.exec(`
      CREATE TABLE outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        next_attempt_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(content_hash)
      );
    `);
    // Insert with explicit ids to assert preservation across migration.
    legacy
      .prepare(
        `INSERT INTO outbox (id, payload, content_hash, status, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(100, '{"x":1}', "h-100", "pending", 1_000, 1_000);
    legacy
      .prepare(
        `INSERT INTO outbox (id, payload, content_hash, status, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(101, '{"x":2}', "h-101", "pending", 2_000, 2_000);
    legacy.close();

    outbox.setOutboxKey(TEST_KEY_HEX);
    const rows = outbox.dueRows(10);
    expect(rows.map((r) => r.id).sort((a, b) => a - b)).toEqual([100, 101]);
  });

  it("leaves no .migrating temp file behind after a successful migration", () => {
    const path = join(tempDir, "outbox.sqlite");
    seedLegacyOutbox(path);

    outbox.setOutboxKey(TEST_KEY_HEX);
    expect(outbox.dueRows(10)).toHaveLength(1); // triggers the migration

    // The atomic rename consumes the temp file; nothing matching *.migrating
    // should remain next to the canonical outbox.
    const siblings = readdirSync(tempDir);
    expect(siblings.some((n) => n.includes(".migrating"))).toBe(false);
  });

  it("clears a stale .migrating temp from a crashed attempt and still migrates", () => {
    const path = join(tempDir, "outbox.sqlite");
    seedLegacyOutbox(path);

    // Simulate a half-written temp left by a process that died mid-migration.
    // Without the pre-rebuild cleanup, the keyed open of this non-SQLite junk
    // would throw, bricking the retry. The temp suffix is an internal detail of
    // migrateLegacyToEncrypted.
    writeFileSync(`${path}.migrating`, "not a database, leftover junk");

    outbox.setOutboxKey(TEST_KEY_HEX);
    const rows = outbox.dueRows(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contentHash).toBe("h-1");

    // Final state: encrypted canonical file (not plaintext-readable), a legacy
    // backup, and no lingering temp.
    const probe = new PlaintextDatabase(path);
    let probeErr: Error | null = null;
    try {
      probe.prepare("SELECT count(*) FROM outbox").get();
    } catch (err) {
      probeErr = err as Error;
    } finally {
      probe.close();
    }
    expect(probeErr).not.toBeNull();

    const siblings = readdirSync(tempDir);
    expect(siblings.some((n) => /\.legacy-\d+$/.test(n))).toBe(true);
    expect(siblings.some((n) => n.includes(".migrating"))).toBe(false);
  });
});
