import { describe, expect, it } from "vitest";
import { FirebirdDriver } from "./drivers/firebird.js";
import { MssqlDriver } from "./drivers/mssql.js";
import { MysqlDriver } from "./drivers/mysql.js";
import { OracleDriver } from "./drivers/oracle.js";
import { PostgresDriver } from "./drivers/postgres.js";
import { SqliteDriver } from "./drivers/sqlite.js";
import { defaultDriverFactory, defaultPortForEngine } from "./runner.js";
import type { VendorConfig } from "./types.js";

function vendorWith(driver: VendorConfig["driver"]): VendorConfig {
  return {
    vendor: `t-${driver}`,
    driver,
    bridgeSource: "gdt_agent",
    connection: { credentialId: "x" },
    defaultIntervalSeconds: 60,
    batchSize: 100,
    streams: [],
  };
}

describe("runner: defaultDriverFactory wires every supported engine", () => {
  it("postgres → PostgresDriver", () => {
    expect(defaultDriverFactory(vendorWith("postgres"))).toBeInstanceOf(PostgresDriver);
  });
  it("firebird → FirebirdDriver", () => {
    expect(defaultDriverFactory(vendorWith("firebird"))).toBeInstanceOf(FirebirdDriver);
  });
  it("mssql → MssqlDriver", () => {
    expect(defaultDriverFactory(vendorWith("mssql"))).toBeInstanceOf(MssqlDriver);
  });
  it("sqlite → SqliteDriver", () => {
    expect(defaultDriverFactory(vendorWith("sqlite"))).toBeInstanceOf(SqliteDriver);
  });
  it("mysql → MysqlDriver", () => {
    expect(defaultDriverFactory(vendorWith("mysql"))).toBeInstanceOf(MysqlDriver);
  });
  it("oracle → OracleDriver", () => {
    expect(defaultDriverFactory(vendorWith("oracle"))).toBeInstanceOf(OracleDriver);
  });
});

describe("runner: defaultPortForEngine maps each engine to its canonical default", () => {
  it("postgres → 5432", () => {
    expect(defaultPortForEngine("postgres")).toBe(5432);
  });
  it("mysql → 3306", () => {
    expect(defaultPortForEngine("mysql")).toBe(3306);
  });
  it("firebird → 3050", () => {
    expect(defaultPortForEngine("firebird")).toBe(3050);
  });
  it("mssql → 1433", () => {
    expect(defaultPortForEngine("mssql")).toBe(1433);
  });
  it("oracle → 1521", () => {
    expect(defaultPortForEngine("oracle")).toBe(1521);
  });
  it("sqlite → 0 (file-based)", () => {
    expect(defaultPortForEngine("sqlite")).toBe(0);
  });
});
