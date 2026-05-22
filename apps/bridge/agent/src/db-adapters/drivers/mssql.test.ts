import { describe, expect, it } from "vitest";
import { translateNamedToAt } from "./mssql.js";

describe("mssql driver: named-to-@ translation", () => {
  it("translates :cursor and :limit to @cursor / @limit and binds once each", () => {
    const { translated, bindings } = translateNamedToAt(
      `SELECT TOP (:limit) id FROM patient WHERE modified_at > :cursor`,
      { cursor: "2026-05-20T10:00:00.000Z", limit: 500 }
    );
    expect(translated).toBe(
      `SELECT TOP (@limit) id FROM patient WHERE modified_at > @cursor`
    );
    expect(bindings).toEqual([
      ["limit", 500],
      ["cursor", "2026-05-20T10:00:00.000Z"],
    ]);
  });

  it("dedupes repeated placeholders (mssql named bind requires unique names)", () => {
    const { translated, bindings } = translateNamedToAt(
      `SELECT 1 WHERE :cursor IS NOT NULL AND :cursor > '1970-01-01'`,
      { cursor: "2026-01-01T00:00:00Z" }
    );
    expect(translated).toBe(
      `SELECT 1 WHERE @cursor IS NOT NULL AND @cursor > '1970-01-01'`
    );
    expect(bindings).toEqual([["cursor", "2026-01-01T00:00:00Z"]]);
  });

  it("throws on unbound placeholder", () => {
    expect(() => translateNamedToAt(`SELECT :foo`, {})).toThrow(
      /placeholder :foo/
    );
  });

  it("leaves SQL without placeholders untouched", () => {
    const { translated, bindings } = translateNamedToAt(`SELECT 1`, {});
    expect(translated).toBe(`SELECT 1`);
    expect(bindings).toEqual([]);
  });
});
