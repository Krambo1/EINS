import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDriver } from "./sqlite.js";

describe("sqlite driver: end-to-end against a real on-disk db", () => {
  let tmp: string;
  let dbPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "eins-sqlite-test-"));
    dbPath = join(tmp, "pixelmedics.sqlite");
    const seed = new BetterSqlite3(dbPath);
    seed.exec(`
      CREATE TABLE patients (
        id INTEGER PRIMARY KEY,
        full_name TEXT NOT NULL,
        modified_at TEXT NOT NULL
      );
      INSERT INTO patients (id, full_name, modified_at) VALUES
        (1, 'Anna Beispiel', '2026-05-19T12:00:00.000Z'),
        (2, 'Bernd Test',    '2026-05-20T08:00:00.000Z');
    `);
    seed.close();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("connects, returns rows with named binds, advances cursor-style", async () => {
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });
    const result = await driver.query(
      `SELECT id, full_name, modified_at
       FROM patients
       WHERE modified_at > :cursor
       ORDER BY modified_at ASC
       LIMIT :limit`,
      { cursor: "2026-05-19T00:00:00.000Z", limit: 100 }
    );
    expect(result.columns).toEqual(["id", "full_name", "modified_at"]);
    expect(result.rows).toEqual([
      { id: 1, full_name: "Anna Beispiel", modified_at: "2026-05-19T12:00:00.000Z" },
      { id: 2, full_name: "Bernd Test", modified_at: "2026-05-20T08:00:00.000Z" },
    ]);
    const empty = await driver.query(
      `SELECT id FROM patients WHERE modified_at > :cursor LIMIT :limit`,
      { cursor: "2099-01-01T00:00:00.000Z", limit: 10 }
    );
    expect(empty.rows).toEqual([]);
    const health = await driver.healthCheck();
    expect(health.ok).toBe(true);
    await driver.close();
  });

  it("binds a Date cursor by converting it to ISO text (Phase 3)", async () => {
    // The framework binds a timestamp cursor as a native Date so the server
    // engines coerce it. better-sqlite3 cannot bind a Date directly (it throws
    // "SQLite3 can only bind ..."), so the driver converts it to ISO-8601 text
    // first. This proves the conversion happens and compares correctly against
    // the ISO-8601 text the seed stores.
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });
    const result = await driver.query(
      `SELECT id, full_name, modified_at
       FROM patients
       WHERE modified_at > :cursor
       ORDER BY modified_at ASC
       LIMIT :limit`,
      { cursor: new Date("2026-05-19T18:00:00.000Z"), limit: 100 }
    );
    // Only Bernd (2026-05-20T08:00:00Z) is strictly after the Date cursor;
    // Anna (2026-05-19T12:00:00Z) precedes it.
    expect(result.rows).toEqual([
      { id: 2, full_name: "Bernd Test", modified_at: "2026-05-20T08:00:00.000Z" },
    ]);
    await driver.close();
  });

  it("refuses to open a non-existent file rather than silently creating one", async () => {
    const driver = new SqliteDriver();
    await expect(
      driver.connect({
        host: "",
        port: 0,
        database: join(tmp, "does-not-exist.sqlite"),
        username: "",
        password: "",
      })
    ).rejects.toThrow();
  });

  it("opens read-only (writes against the vendor DB throw)", async () => {
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });
    await expect(
      driver.query(`INSERT INTO patients (id, full_name, modified_at) VALUES (3, 'X', :ts)`, {
        ts: "2026-05-20T09:00:00.000Z",
      })
    ).rejects.toThrow(/readonly|attempt to write|does not return data/i);
    await driver.close();
  });
});
