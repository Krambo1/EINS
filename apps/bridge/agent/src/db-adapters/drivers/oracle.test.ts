import { describe, expect, it, vi } from "vitest";
import { buildConnectString, OracleDriver } from "./oracle.js";

interface FakeConn {
  callTimeout?: number;
  calls: string[];
  commits: number;
  closed: number;
  execute(
    sql: string,
    binds: Record<string, unknown>,
    opts: unknown
  ): Promise<{ rows: Array<Record<string, unknown>>; metaData?: Array<{ name: string }> }>;
  commit(): Promise<void>;
  close(): Promise<void>;
  ping(): Promise<void>;
}

const h = vi.hoisted(() => ({ conns: [] as unknown[] }));

vi.mock("oracledb", () => ({
  default: {
    OUT_FORMAT_OBJECT: 4002,
    getConnection: async () => {
      const conn: FakeConn = {
        callTimeout: undefined,
        calls: [],
        commits: 0,
        closed: 0,
        async execute(sql: string) {
          conn.calls.push(sql);
          if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
          return {
            rows: [{ ID: "APPT-1", BETRAG: 100 }],
            metaData: [{ name: "ID" }, { name: "BETRAG" }],
          };
        },
        async commit() {
          conn.commits++;
        },
        async close() {
          conn.closed++;
        },
        async ping() {},
      };
      h.conns.push(conn);
      return conn;
    },
  },
}));

describe("oracle driver: buildConnectString", () => {
  it("composes host:port/service from DbConnectionParams", () => {
    expect(
      buildConnectString({
        host: "praxis-srv.local",
        port: 1521,
        database: "M1PROSVC",
        username: "eins_readonly",
        password: "x",
      })
    ).toBe("praxis-srv.local:1521/M1PROSVC");
  });

  it("defaults port to 1521 when params.port is 0 / unset", () => {
    expect(
      buildConnectString({
        host: "10.0.0.5",
        port: 0,
        database: "ORCL",
        username: "u",
        password: "p",
      })
    ).toBe("10.0.0.5:1521/ORCL");
  });

  it("honors an explicit options.connectString override (TNS alias / SID form)", () => {
    expect(
      buildConnectString({
        host: "ignored.example",
        port: 1521,
        database: "ignored",
        username: "u",
        password: "p",
        options: {
          connectString:
            "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=praxis)(PORT=1521))(CONNECT_DATA=(SID=M1PRO)))",
        },
      })
    ).toBe(
      "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=praxis)(PORT=1521))(CONNECT_DATA=(SID=M1PRO)))"
    );
  });

  it("emits host:port/ with empty trailing path when database is unset (operator misconfig surfaces as Oracle ORA-12504)", () => {
    expect(
      buildConnectString({
        host: "praxis-srv.local",
        port: 1521,
        database: "",
        username: "u",
        password: "p",
      })
    ).toBe("praxis-srv.local:1521/");
  });
});

describe("oracle driver: per-query read-only transaction (reliability review C3)", () => {
  const params = {
    host: "h",
    port: 1521,
    database: "SVC",
    username: "u",
    password: "p",
  };

  it("does NOT pin a transaction at connect, opens a fresh READ ONLY txn per query, and commits it", async () => {
    const driver = new OracleDriver();
    await driver.connect(params);
    const conn = h.conns.at(-1) as FakeConn;

    // Connect must not open a transaction: a connect-time SET TRANSACTION
    // freezes the read snapshot for the connection's whole life (C3).
    expect(conn.calls).toHaveLength(0);
    // Hung-call bound (C4) is applied at connect.
    expect(conn.callTimeout).toBe(120_000);

    const r1 = await driver.query("SELECT id AS id FROM termin", {});
    expect(conn.calls).toEqual([
      "SET TRANSACTION READ ONLY",
      "SELECT id AS id FROM termin",
    ]);
    // The txn is ENDED after the query so the next poll gets a new snapshot.
    expect(conn.commits).toBe(1);
    // Column/row keys lower-cased (Oracle uppercases unquoted identifiers).
    expect(r1.columns).toEqual(["id", "betrag"]);
    expect(r1.rows[0].id).toBe("APPT-1");

    await driver.query("SELECT id AS id FROM termin", {});
    expect(
      conn.calls.filter((c) => c === "SET TRANSACTION READ ONLY")
    ).toHaveLength(2);
    expect(conn.commits).toBe(2);
  });

  it("commits (ends the txn) even when the query throws", async () => {
    const driver = new OracleDriver();
    await driver.connect(params);
    const conn = h.conns.at(-1) as FakeConn;
    const originalExecute = conn.execute.bind(conn);
    conn.execute = async (sql: string) => {
      conn.calls.push(sql);
      if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
      throw new Error("ORA-00942: table or view does not exist");
    };
    await expect(driver.query("SELECT 1 FROM missing", {})).rejects.toThrow(
      /ORA-00942/
    );
    // Without the finally-commit the next SET TRANSACTION would raise
    // ORA-01453 and the snapshot would stay frozen.
    expect(conn.commits).toBe(1);
    conn.execute = originalExecute;
  });
});

describe("oracle driver: unsafe-integer NUMBER guard (finding L12)", () => {
  const params = {
    host: "h",
    port: 1521,
    database: "SVC",
    username: "u",
    password: "p",
  };

  it("throws loudly when a NUMBER id exceeds JS safe-integer range (would silently corrupt)", async () => {
    const driver = new OracleDriver();
    await driver.connect(params);
    const conn = h.conns.at(-1) as FakeConn;
    // A big NUMBER surrogate key the config forgot to TO_CHAR: node-oracledb
    // returns it as a JS number already rounded past 2^53. The guard must fail
    // rather than pass a mangled id through.
    conn.execute = async (sql: string) => {
      conn.calls.push(sql);
      if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
      return {
        rows: [{ ID: 9007199254740993, BETRAG: 100.5 }],
        metaData: [{ name: "ID" }, { name: "BETRAG" }],
      };
    };
    await expect(driver.query("SELECT id, betrag FROM r", {})).rejects.toThrow(
      /beyond JavaScript's safe integer range/
    );
    // The read-only transaction is still ended on the throw path.
    expect(conn.commits).toBe(1);
  });

  it("passes a non-integer NUMBER (money amount) through untouched", async () => {
    const driver = new OracleDriver();
    await driver.connect(params);
    const conn = h.conns.at(-1) as FakeConn;
    conn.execute = async (sql: string) => {
      conn.calls.push(sql);
      if (sql.startsWith("SET TRANSACTION")) return { rows: [] };
      return {
        rows: [{ ID: "APPT-1", BETRAG: 100.5 }],
        metaData: [{ name: "ID" }, { name: "BETRAG" }],
      };
    };
    const r = await driver.query("SELECT id, betrag FROM r", {});
    expect(r.rows[0].betrag).toBe(100.5);
    expect(r.rows[0].id).toBe("APPT-1");
  });
});

describe("oracle driver: reconnect closes the previous connection (M-D5)", () => {
  const params = {
    host: "h",
    port: 1521,
    database: "SVC",
    username: "u",
    password: "p",
  };

  it("closes the stale connection before building a fresh one on reconnect", async () => {
    const driver = new OracleDriver();
    await driver.connect(params);
    const conn1 = h.conns.at(-1) as FakeConn;

    // Drive the connection unhealthy WITHOUT nulling `this.conn`: a commit that
    // throws in query()'s finally flips healthy=false while conn1 stays set,
    // the exact flapping-LAN shape that used to leak the previous connection.
    conn1.commit = async () => {
      throw new Error("ORA-03113: end-of-file on communication channel");
    };
    await driver.query("SELECT id AS id FROM termin", {});
    // query() itself does NOT close on a commit failure; it only marks unhealthy.
    expect(conn1.closed).toBe(0);

    // Reconnecting must detach conn1 before opening conn2 (M-D5).
    await driver.connect(params);
    const conn2 = h.conns.at(-1) as FakeConn;
    expect(conn2).not.toBe(conn1);
    // Fire-and-forget close; let any pending microtask settle.
    await Promise.resolve();
    expect(conn1.closed).toBe(1);
    // The fresh connection is the live one and never got closed.
    expect(conn2.closed).toBe(0);
  });
});
