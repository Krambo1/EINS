import { describe, it, expect } from "vitest";
import { sslOptionFromMode, translateNamedToPositional } from "./postgres.js";

describe("postgres driver: named-to-positional translation", () => {
  it("translates a single :cursor and :limit", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT id FROM patient WHERE modified_at > :cursor LIMIT :limit`,
      { cursor: "2026-05-20T10:00:00.000Z", limit: 500 }
    );
    expect(translated).toBe(
      `SELECT id FROM patient WHERE modified_at > $1 LIMIT $2`
    );
    expect(values).toEqual(["2026-05-20T10:00:00.000Z", 500]);
  });

  it("handles repeated placeholders", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT 1 WHERE :cursor IS NOT NULL AND :cursor > '1970-01-01'`,
      { cursor: "2026-01-01T00:00:00Z" }
    );
    expect(translated).toBe(
      `SELECT 1 WHERE $1 IS NOT NULL AND $2 > '1970-01-01'`
    );
    expect(values).toEqual([
      "2026-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    ]);
  });

  it("throws when a placeholder has no bound value", () => {
    expect(() =>
      translateNamedToPositional(`SELECT :foo`, {})
    ).toThrow(/placeholder :foo/);
  });

  it("passes through SQL without placeholders unchanged", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT 1`,
      {}
    );
    expect(translated).toBe(`SELECT 1`);
    expect(values).toEqual([]);
  });
});

describe("postgres driver: sslmode → pg ssl option (finding L9)", () => {
  it("returns no ssl when sslmode is unset / null / empty / disable", () => {
    expect(sslOptionFromMode(undefined)).toBeUndefined();
    expect(sslOptionFromMode(null)).toBeUndefined();
    expect(sslOptionFromMode("")).toBeUndefined();
    expect(sslOptionFromMode("disable")).toBeUndefined();
  });

  it("encrypts without cert verification for prefer / require", () => {
    expect(sslOptionFromMode("prefer")).toEqual({ rejectUnauthorized: false });
    expect(sslOptionFromMode("require")).toEqual({ rejectUnauthorized: false });
  });

  it("encrypts AND verifies the cert for verify-ca / verify-full", () => {
    expect(sslOptionFromMode("verify-ca")).toEqual({ rejectUnauthorized: true });
    expect(sslOptionFromMode("verify-full")).toEqual({
      rejectUnauthorized: true,
    });
  });

  it("throws on an unknown sslmode instead of silently doing nothing", () => {
    expect(() => sslOptionFromMode("bogus")).toThrow(/unknown sslmode 'bogus'/);
  });
});
