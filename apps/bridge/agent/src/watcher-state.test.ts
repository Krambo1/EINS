import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getWatcherCursor,
  setWatcherCursor,
  _setStateDbForTesting,
} from "./watcher-state.js";

/**
 * P1-5 cursor tests. In production the cursor lives on the agent's single
 * SQLCipher-keyed outbox connection (see outbox.ts:outboxConnection). Here
 * we inject a standalone, file-backed SQLite handle so the cursor logic
 * (and the restart/persistence case) can be exercised without standing up
 * the encrypted outbox + key. The point of routing through the shared
 * connection in prod is precisely that watcher-state must NOT open the
 * outbox file with its own plaintext driver.
 */

let tmpDir: string;
let dbPath: string;
let handle: Database.Database;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "eins-watcher-state-"));
  dbPath = join(tmpDir, "state.sqlite");
  handle = new Database(dbPath);
  _setStateDbForTesting(handle);
});

afterEach(() => {
  handle.close();
  _setStateDbForTesting(null);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("watcher-state cursor (P1-5)", () => {
  const FOLDER_A = "C:/GDT-Out";
  const FOLDER_B = "C:/Honorar";

  it("returns 0 for a fresh watch path that's never been seen", () => {
    expect(getWatcherCursor(FOLDER_A)).toBe(0);
  });

  it("setWatcherCursor persists then reads back the value", () => {
    setWatcherCursor(FOLDER_A, 1_700_000_000_000);
    expect(getWatcherCursor(FOLDER_A)).toBe(1_700_000_000_000);
  });

  it("multiple watch paths are independent", () => {
    setWatcherCursor(FOLDER_A, 1000);
    setWatcherCursor(FOLDER_B, 2000);
    expect(getWatcherCursor(FOLDER_A)).toBe(1000);
    expect(getWatcherCursor(FOLDER_B)).toBe(2000);
  });

  it("cursor advances monotonically: a backward set is a no-op", () => {
    setWatcherCursor(FOLDER_A, 5000);
    setWatcherCursor(FOLDER_A, 3000); // attempt to move backward
    expect(getWatcherCursor(FOLDER_A)).toBe(5000);
  });

  it("an equal-value set is fine and doesn't go backward", () => {
    setWatcherCursor(FOLDER_A, 5000);
    setWatcherCursor(FOLDER_A, 5000);
    expect(getWatcherCursor(FOLDER_A)).toBe(5000);
  });

  it("sequential forward advances each persist", () => {
    setWatcherCursor(FOLDER_A, 100);
    setWatcherCursor(FOLDER_A, 200);
    setWatcherCursor(FOLDER_A, 300);
    expect(getWatcherCursor(FOLDER_A)).toBe(300);
  });

  it("simulates a restart: persisted cursor survives a reopen of the file", () => {
    setWatcherCursor(FOLDER_A, 42_000);
    // Simulate process restart: close the handle and reopen the SAME file.
    // The on-disk rows survive, so the fresh handle sees the persisted value
    // (a fresh connection is not in the table-ensured set, so db() re-runs
    // the idempotent CREATE TABLE IF NOT EXISTS — a no-op against the
    // existing table — then reads the row).
    handle.close();
    handle = new Database(dbPath);
    _setStateDbForTesting(handle);
    expect(getWatcherCursor(FOLDER_A)).toBe(42_000);
  });
});
