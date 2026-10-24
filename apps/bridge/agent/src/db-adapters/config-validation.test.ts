import { describe, expect, it } from "vitest";
import { loadVendorConfigFromString } from "./vendor-config.js";
import {
  baseTable,
  selectOutputColumns,
  validateSingleSelect,
} from "./sql-analysis.js";
import {
  describeAuthError,
  extractMissingTable,
  isAuthError,
  isEnvironmentError,
  isTableMissingError,
} from "./error-classes.js";
import { berlinWallClockMs, formatCursorBind, parseCursorValue } from "./time-utils.js";
import { resolveFirebirdDecodeCharset } from "./drivers/firebird.js";

/** P1-8: configuration mistakes are refused at load time, not on a customer PC. */

function yaml(streamExtra = "", query?: string, top = ""): string {
  return `
vendor: v-db
driver: postgres
bridgeSource: tomedo
${top}
connection:
  credentialId: v-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
${streamExtra}
    query: |
      ${query ?? "SELECT id, patient_id, termin_zeit, modified_at FROM termin WHERE modified_at > :cursor LIMIT :limit"}
    map:
      pvsExternalEventId: { template: "v:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;
}

describe("vendor-config load-time validation (P1-8)", () => {
  it("accepts a well-formed config", async () => {
    await expect(loadVendorConfigFromString(yaml(), "t.yaml")).resolves.toBeDefined();
  });

  it("rejects a cursorColumn that the SELECT does not output", async () => {
    await expect(
      loadVendorConfigFromString(
        yaml("", "SELECT id, patient_id, termin_zeit FROM termin WHERE modified_at > :cursor LIMIT :limit"),
        "t.yaml"
      )
    ).rejects.toThrow(/cursorColumn/);
  });

  it("rejects a second statement", async () => {
    await expect(
      loadVendorConfigFromString(
        yaml("", "SELECT id, patient_id, termin_zeit, modified_at FROM termin WHERE modified_at > :cursor LIMIT :limit; DELETE FROM termin"),
        "t.yaml"
      )
    ).rejects.toThrow(/single|statement|SELECT/i);
  });

  it("rejects a non-SELECT query", async () => {
    await expect(
      loadVendorConfigFromString(yaml("", "UPDATE termin SET x = 1 WHERE y > :cursor"), "t.yaml")
    ).rejects.toThrow();
  });

  it.each([0, 5001, -3])("rejects batchSize %i", async (n) => {
    await expect(loadVendorConfigFromString(yaml("", undefined, `batchSize: ${n}`), "t.yaml")).rejects.toThrow(/batchSize/);
  });

  it("accepts batchSize at both ends of 1..5000", async () => {
    await loadVendorConfigFromString(yaml("", undefined, "batchSize: 1"), "t.yaml");
    await loadVendorConfigFromString(yaml("", undefined, "batchSize: 5000"), "t.yaml");
  });

  it("applies defaults and validates the new settings", async () => {
    const v = await loadVendorConfigFromString(yaml(), "t.yaml");
    expect(v.timezone).toBe("Europe/Berlin");
    await expect(
      loadVendorConfigFromString(yaml("", undefined, "timezone: Mars/Olympus"), "t.yaml")
    ).rejects.toThrow(/timezone/);
    await expect(
      loadVendorConfigFromString(yaml("", undefined, "cursorFormat: banana"), "t.yaml")
    ).rejects.toThrow(/cursorFormat/);
    await expect(
      loadVendorConfigFromString(yaml("", undefined, "initialHorizonDays: -1"), "t.yaml")
    ).rejects.toThrow(/initialHorizonDays/);
    await expect(
      loadVendorConfigFromString(yaml("", undefined, "lookbackMinutes: 99999"), "t.yaml")
    ).rejects.toThrow(/lookbackMinutes/);
  });
});

describe("sql-analysis", () => {
  it("ignores keywords and semicolons inside strings and comments", () => {
    expect(validateSingleSelect("SELECT ';' AS x -- ; DROP\nFROM t")).toBeNull();
  });
  it("lists output columns and the base table", () => {
    const sql = "SELECT t.id::text AS id, patient_id, modified_at FROM termin t WHERE 1=1";
    expect(selectOutputColumns(sql)).toEqual(["id", "patient_id", "modified_at"]);
    expect(baseTable(sql)).toBe("termin");
  });
});

describe("error classification", () => {
  it("recognises credential rejections across engines", () => {
    expect(isAuthError(Object.assign(new Error("x"), { code: "28P01" }))).toBe(true);
    expect(isAuthError(Object.assign(new Error("x"), { errno: 1045 }))).toBe(true);
    expect(isAuthError(new Error("ORA-01017: invalid username/password"))).toBe(true);
    expect(isAuthError(new Error("connect ECONNREFUSED"))).toBe(false);
  });

  it("gives the Firebird Srp256 hint", () => {
    const msg = describeAuthError("firebird", new Error("Your user name and password are not defined"));
    expect(msg).toContain("Legacy_Auth");
    expect(msg).toContain("Srp256");
  });

  it("extracts the missing table name", () => {
    const pg = Object.assign(new Error('relation "praxis.termin" does not exist'), { code: "42P01" });
    expect(isTableMissingError(pg)).toBe(true);
    expect(extractMissingTable(pg)?.toLowerCase()).toContain("termin");
  });

  it("treats auth and network errors as environmental", () => {
    expect(isEnvironmentError(new Error("connect ETIMEDOUT"))).toBe(true);
    expect(isEnvironmentError(new Error('column "x" does not exist'))).toBe(false);
  });
});

describe("cursor formats", () => {
  const ms = Date.parse("2026-06-10T12:34:56Z");
  it("round-trips every storage format", () => {
    expect(formatCursorBind(ms, "iso_text")).toBe("2026-06-10 12:34:56");
    expect(formatCursorBind(ms, "iso_t_text")).toMatch(/^2026-06-10T12:34:56/);
    expect(formatCursorBind(ms, "epoch_s")).toBe(ms / 1000);
    expect(formatCursorBind(ms, "epoch_ms")).toBe(ms);
    for (const fmt of ["iso_text", "iso_t_text", "epoch_s", "epoch_ms", "julian"] as const) {
      expect(parseCursorValue(formatCursorBind(ms, fmt), fmt)).toBe(ms);
    }
  });

  it("berlinWallClockMs differs by 2 h in summer and 1 h in winter", () => {
    const summer = Date.parse("2026-07-01T10:00:00Z");
    const winter = Date.parse("2026-01-15T10:00:00Z");
    expect(berlinWallClockMs(summer) - summer).toBe(2 * 3_600_000);
    expect(berlinWallClockMs(winter) - winter).toBe(3_600_000);
  });
});

describe("firebird charset handling", () => {
  it("defaults to win1252 and honours decodeAs / charset", () => {
    expect(resolveFirebirdDecodeCharset(undefined)).toBe("win1252");
    expect(resolveFirebirdDecodeCharset({ decodeAs: "iso-8859-15" })).toBe("iso-8859-15");
    expect(resolveFirebirdDecodeCharset({ charset: "WIN1252" })).toBe("win1252");
  });
});
