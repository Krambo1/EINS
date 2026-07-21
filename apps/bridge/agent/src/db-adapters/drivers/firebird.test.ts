import { describe, expect, it } from "vitest";
import {
  resolveFirebirdEncoding,
  translateNamedToPositional,
} from "./firebird.js";

describe("firebird driver: named-to-positional translation", () => {
  it("translates :cursor and :limit to ? placeholders", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT FIRST :limit ID FROM PAT WHERE MODIFIED_AT > :cursor`,
      { cursor: "2026-05-20T10:00:00.000Z", limit: 500 }
    );
    expect(translated).toBe(`SELECT FIRST ? ID FROM PAT WHERE MODIFIED_AT > ?`);
    expect(values).toEqual([500, "2026-05-20T10:00:00.000Z"]);
  });

  it("emits one slot per occurrence of a repeated placeholder", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT :cursor AS a, :cursor AS b FROM RDB$DATABASE`,
      { cursor: "x" }
    );
    expect(translated).toBe(`SELECT ? AS a, ? AS b FROM RDB$DATABASE`);
    expect(values).toEqual(["x", "x"]);
  });

  it("throws on a placeholder without a bound value", () => {
    expect(() => translateNamedToPositional(`SELECT :missing`, {})).toThrow(
      /placeholder :missing/
    );
  });

  it("leaves SQL without placeholders untouched", () => {
    const { translated, values } = translateNamedToPositional(
      `SELECT 1 FROM RDB$DATABASE`,
      {}
    );
    expect(translated).toBe(`SELECT 1 FROM RDB$DATABASE`);
    expect(values).toEqual([]);
  });
});

describe("firebird driver: connection charset (M-D3)", () => {
  it("defaults to UTF8 (undefined) when no charset/encoding option is set", () => {
    expect(resolveFirebirdEncoding(undefined)).toBeUndefined();
    expect(resolveFirebirdEncoding({})).toBeUndefined();
    expect(resolveFirebirdEncoding({ role: "READONLY" })).toBeUndefined();
  });

  it("plumbs an explicit charset for legacy WIN1252 / NONE databases", () => {
    expect(resolveFirebirdEncoding({ charset: "WIN1252" })).toBe("WIN1252");
    expect(resolveFirebirdEncoding({ charset: "NONE" })).toBe("NONE");
  });

  it("accepts `encoding` as an alias and lets `charset` win", () => {
    expect(resolveFirebirdEncoding({ encoding: "ISO8859_1" })).toBe("ISO8859_1");
    expect(
      resolveFirebirdEncoding({ charset: "WIN1252", encoding: "UTF8" })
    ).toBe("WIN1252");
  });

  it("ignores blank / non-string values so the driver keeps its UTF8 default", () => {
    expect(resolveFirebirdEncoding({ charset: "   " })).toBeUndefined();
    expect(resolveFirebirdEncoding({ charset: 1252 as unknown as string })).toBeUndefined();
  });
});
