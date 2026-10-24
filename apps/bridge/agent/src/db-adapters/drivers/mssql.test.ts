import { describe, expect, it, vi } from "vitest";
import { MssqlDriver, translateNamedToAt } from "./mssql.js";

/** A stand-in for mssql's DateTime2 type marker so the test can assert the
 *  driver bound with it. */
const DATETIME2 = Symbol("DateTime2");
/** ... and for legacy `datetime` (1/300 s ticks). */
const DATETIME = Symbol("DateTime");

interface RecordedInput {
  name: string;
  /** The explicit SQL type, when the three-arg input() form was used. */
  type: unknown;
  value: unknown;
}

const h = vi.hoisted(() => ({ inputs: [] as RecordedInput[] }));

vi.mock("mssql", () => {
  class FakeRequest {
    input(name: string, typeOrValue: unknown, maybeValue?: unknown): FakeRequest {
      if (arguments.length === 3) {
        h.inputs.push({ name, type: typeOrValue, value: maybeValue });
      } else {
        h.inputs.push({ name, type: undefined, value: typeOrValue });
      }
      return this;
    }
    async query(): Promise<{ recordset: Array<Record<string, unknown>> }> {
      const recordset = [] as Array<Record<string, unknown>>;
      return { recordset };
    }
  }
  class FakeConnectionPool {
    async connect(): Promise<void> {}
    async close(): Promise<void> {}
    request(): FakeRequest {
      return new FakeRequest();
    }
  }
  return {
    default: {
      ConnectionPool: FakeConnectionPool,
      DateTime2: DATETIME2,
      DateTime: DATETIME,
    },
  };
});

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

describe("mssql driver: cursor type (finding 2)", () => {
  const params = {
    host: "h",
    port: 1433,
    database: "db",
    username: "u",
    password: "p",
  };
  const SQL = `SELECT TOP (:limit) id FROM patient WHERE modified_at > :cursor`;

  it("binds a Date cursor as legacy DateTime by default (PVS columns are mostly `datetime`, 1/300 s ticks)", async () => {
    h.inputs.length = 0;
    const driver = new MssqlDriver();
    await driver.connect(params);
    const cursor = new Date("2026-05-20T10:00:00.123Z");
    await driver.query(SQL, { limit: 500, cursor });

    const limitBind = h.inputs.find((i) => i.name === "limit");
    const cursorBind = h.inputs.find((i) => i.name === "cursor");
    // Widening a ms-rounded JS Date to datetime2 never equals the stored
    // datetime tick, so the keyset equality arm re-reads or skips rows.
    expect(cursorBind?.type).toBe(DATETIME);
    expect(cursorBind?.value).toBe(cursor);
    // A plain number keeps mssql's default inference (two-arg input, no type).
    expect(limitBind?.type).toBeUndefined();
    expect(limitBind?.value).toBe(500);
  });

  it("binds DateTime2 only when the stream declares cursorSqlType: datetime2", async () => {
    h.inputs.length = 0;
    const driver = new MssqlDriver();
    await driver.connect(params);
    const cursor = new Date("2026-05-20T10:00:00.123Z");
    await driver.query(SQL, { limit: 500, cursor }, { cursorSqlType: "datetime2" });
    expect(h.inputs.find((i) => i.name === "cursor")?.type).toBe(DATETIME2);

    h.inputs.length = 0;
    await driver.query(SQL, { limit: 500, cursor }, { cursorSqlType: "datetime" });
    expect(h.inputs.find((i) => i.name === "cursor")?.type).toBe(DATETIME);
  });
});
