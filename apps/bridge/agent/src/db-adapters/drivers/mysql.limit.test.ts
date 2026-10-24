import { describe, expect, it, vi } from "vitest";
import { MysqlDriver } from "./mysql.js";

/** Finding 9: LIMIT ? bound as DOUBLE through execute() is rejected by MySQL
 *  >= 8.0.22 (ER_WRONG_ARGUMENTS), so the validated integer is inlined. */

const h = vi.hoisted(() => ({
  executed: [] as Array<{ sql: string; values: unknown }>,
}));

vi.mock("mysql2/promise", () => {
  const conn = {
    async query() {
      return [[], []];
    },
    async execute(o: { sql: string; values: unknown }) {
      h.executed.push({ sql: o.sql, values: o.values });
      return [[], []];
    },
    async ping() {},
    async end() {},
  };
  const createConnection = async () => conn;
  return { default: { createConnection }, createConnection };
});

const P = { host: "h", port: 3306, database: "d", username: "u", password: "p" };
const SQL = "SELECT id FROM t WHERE modified_at > :cursor ORDER BY modified_at LIMIT :limit";

describe("mysql driver: LIMIT is inlined (finding 9)", () => {
  it("does not bind :limit and writes it as an integer literal", async () => {
    h.executed.length = 0;
    const d = new MysqlDriver();
    await d.connect(P);
    await d.query(SQL, { cursor: new Date("2026-05-20T10:00:00Z"), limit: 500 });
    expect(h.executed).toHaveLength(1);
    const { sql, values } = h.executed[0];
    expect(sql).toMatch(/LIMIT 500$/);
    expect(sql).not.toContain(":limit");
    expect(Object.keys(values as Record<string, unknown>)).not.toContain("limit");
    expect(Object.keys(values as Record<string, unknown>)).toContain("cursor");
  });

  it("refuses a limit that is not an integer in 1..5000", async () => {
    const d = new MysqlDriver();
    await d.connect(P);
    for (const bad of [0, -1, 5001, 1.5, Number.NaN]) {
      await expect(d.query(SQL, { cursor: "x", limit: bad })).rejects.toThrow(/limit/i);
    }
  });
});
