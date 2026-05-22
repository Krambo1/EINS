import { describe, expect, it } from "vitest";
import { translateNamedToPositional } from "./firebird.js";

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
