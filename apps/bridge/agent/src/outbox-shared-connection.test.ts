import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regression guard for the first-boot outbox brick (PVS bridge review).
 *
 * Bug: `watcher-state.ts` and `db-adapters/framework.ts` each opened
 * `outboxPath()` with their OWN plaintext `better-sqlite3` handle to store
 * a cursor / adapter-state. On a fresh install one of them won the race to
 * create the file as plaintext; the SQLCipher outbox driver then either
 * mis-detected it as a "legacy plaintext outbox" and failed to migrate (no
 * `outbox` table) or saw ciphertext it could not read — bricking the agent
 * at first boot AND leaving patient-event rows in an unencrypted file.
 *
 * Fix: all three state stores share the single SQLCipher-keyed connection
 * from `outbox.ts:outboxConnection()`. These tests exercise the REAL
 * shared-connection path (no `_setStateDbForTesting` injection) so a
 * re-introduction of `new Database(outboxPath())` fails here.
 */

const KEY_HEX = "ab".repeat(32); // 64-char hex

let tmpDir: string;

vi.mock("./config.js", () => ({
  // Arrow reads tmpDir at call time, so the per-test reassignment is seen
  // even though the vi.mock factory itself runs once.
  outboxPath: () => join(tmpDir, "outbox.sqlite"),
}));

type OutboxMod = typeof import("./outbox.js");
type WatcherStateMod = typeof import("./watcher-state.js");
type FrameworkMod = typeof import("./db-adapters/framework.js");

let outbox: OutboxMod;
let watcherState: WatcherStateMod;
let framework: FrameworkMod;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "eins-shared-conn-"));
  vi.resetModules();
  outbox = await import("./outbox.js");
  watcherState = await import("./watcher-state.js");
  framework = await import("./db-adapters/framework.js");
  outbox.setOutboxKey(KEY_HEX);
});

afterEach(() => {
  outbox._closeForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

function outboxIsEncryptedOnDisk(): boolean {
  const buf = readFileSync(join(tmpDir, "outbox.sqlite"));
  return !buf.subarray(0, 16).toString("latin1").startsWith("SQLite format 3");
}

describe("shared SQLCipher connection (review: first-boot outbox brick)", () => {
  it("touching the watcher cursor first still yields an ENCRYPTED, working outbox", () => {
    // This is the exact first-boot order that used to brick: the watcher's
    // startup catch-up reads the cursor before the heartbeat opens the outbox.
    expect(watcherState.getWatcherCursor("C:/GDT-Out")).toBe(0);
    outbox.enqueue('{"x":1}', "hash-1");
    expect(outbox.dueRows(10)).toHaveLength(1);
    expect(outboxIsEncryptedOnDisk()).toBe(true);
  });

  it("touching db-adapter state first still yields an ENCRYPTED, working outbox", () => {
    framework.loadState("tomedo-db", "AppointmentCreated");
    outbox.enqueue('{"y":2}', "hash-2");
    expect(outbox.dueRows(10)).toHaveLength(1);
    expect(outboxIsEncryptedOnDisk()).toBe(true);
  });

  it("creates exactly one sqlite file (no second plaintext state file)", () => {
    watcherState.setWatcherCursor("C:/GDT-Out", 1234);
    framework.loadState("tomedo-db", "AppointmentCreated");
    outbox.enqueue('{"z":3}', "hash-3");
    const sqliteFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".sqlite"));
    expect(sqliteFiles).toEqual(["outbox.sqlite"]);
  });

  it("outbox + watcher_state + db_adapter_state coexist on the one keyed connection", () => {
    watcherState.setWatcherCursor("C:/GDT-Out", 5000);
    framework.loadState("tomedo-db", "AppointmentCreated");
    outbox.enqueue('{"w":4}', "hash-4");
    const conn = outbox.outboxConnection();
    const tables = (
      conn
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toContain("outbox");
    expect(tables).toContain("watcher_state");
    expect(tables).toContain("db_adapter_state");
  });

  it("cursor persists across a simulated restart of the encrypted file", async () => {
    watcherState.setWatcherCursor("C:/GDT-Out", 9999);
    outbox._closeForTests();
    vi.resetModules();
    const outbox2 = await import("./outbox.js");
    const ws2 = await import("./watcher-state.js");
    outbox2.setOutboxKey(KEY_HEX);
    expect(ws2.getWatcherCursor("C:/GDT-Out")).toBe(9999);
    outbox2._closeForTests();
  });
});
