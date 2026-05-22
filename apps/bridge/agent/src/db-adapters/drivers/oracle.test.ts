import { describe, expect, it } from "vitest";
import { buildConnectString } from "./oracle.js";

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
