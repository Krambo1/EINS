import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  duplicatePrefixes,
  outOfOrder,
  requiresNoTransaction,
  splitSqlStatements,
} from "./migrate-sql";

const dir = path.join(__dirname, "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

describe("splitSqlStatements", () => {
  it("keeps semicolons inside strings, identifiers, dollar quotes and comments", () => {
    const sql = `
      -- comment; with semicolon
      CREATE TABLE "a;b" (x text DEFAULT 'it''s; fine');
      /* block; comment */
      DO $$ BEGIN PERFORM 1; END $$;
      CREATE FUNCTION f() RETURNS int AS $fn$ SELECT 1; $fn$ LANGUAGE sql;
      ;
    `;
    const parts = splitSqlStatements(sql);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain(`'it''s; fine'`);
    expect(parts[1]).toBe("DO $$ BEGIN PERFORM 1; END $$");
    expect(parts[2]).toContain("$fn$ SELECT 1; $fn$");
  });
});

describe("requiresNoTransaction", () => {
  it("ignores CONCURRENTLY in comments", () => {
    expect(requiresNoTransaction("-- CREATE INDEX CONCURRENTLY x\nALTER TABLE t ADD COLUMN c int;")).toBe(false);
    expect(requiresNoTransaction("CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS i ON t (c);")).toBe(true);
  });

  it("classifies the shipped migrations as before for the CONCURRENTLY files", () => {
    const noTx = files.filter((f) => requiresNoTransaction(readFileSync(path.join(dir, f), "utf8")));
    expect(noTx).toEqual([
      "0005_request_activities_created_idx.sql",
      "0081_audit_log_entity_idx.sql",
    ]);
  });

  it("parses every shipped migration into at least one statement", () => {
    for (const f of files) {
      expect(splitSqlStatements(readFileSync(path.join(dir, f), "utf8")).length, f).toBeGreaterThan(0);
    }
  });
});

describe("ordering guards", () => {
  it("flags pending files older than the newest applied", () => {
    expect(outOfOrder(["0084_x", "0090_y"], ["0083_a", "0087_b"])).toEqual(["0084_x"]);
  });

  it("allows only the known 0015 duplicate prefix", () => {
    const versions = files.map((f) => f.replace(/\.sql$/, ""));
    expect(duplicatePrefixes(versions, new Set(["0015"]))).toEqual([]);
    expect(duplicatePrefixes(["0001_a", "0001_b"], new Set())).toEqual(["0001"]);
  });
});
