import { describe, it, expect } from "vitest";
import {
  VendorConfigError,
  loadVendorConfigFromString,
} from "./vendor-config.js";

const VALID = `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
  port: 5432
  database: tomedo
streams:
  - kind: PatientUpserted
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, vorname, modified_at
      FROM patient
      WHERE modified_at > :cursor
      LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:patient:{id}:{modified_at}" }
      occurredAt: { from: modified_at, transform: isoDateTime }
      pvsPatientId: id
`;

describe("vendor-config", () => {
  it("parses a valid YAML", async () => {
    const cfg = await loadVendorConfigFromString(VALID, "test.yaml");
    expect(cfg.vendor).toBe("tomedo-db");
    expect(cfg.driver).toBe("postgres");
    expect(cfg.bridgeSource).toBe("tomedo");
    expect(cfg.streams).toHaveLength(1);
    expect(cfg.streams[0].kind).toBe("PatientUpserted");
    expect(cfg.streams[0].cursorType).toBe("timestamp");
    expect(cfg.connection.credentialId).toBe("tomedo-db-default");
  });

  it("rejects unknown driver", async () => {
    const yaml = VALID.replace("driver: postgres", "driver: cockroachdb");
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /unknown driver/
    );
  });

  it("rejects unknown event kind", async () => {
    const yaml = VALID.replace(
      "kind: PatientUpserted",
      "kind: BogusKind"
    );
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /unknown event kind/
    );
  });

  it("rejects missing required field for the kind", async () => {
    // PatientUpserted requires pvsPatientId. Strip it.
    const yaml = VALID.replace("      pvsPatientId: id\n", "");
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /requires `map\.pvsPatientId`/
    );
  });

  it("rejects query without :cursor", async () => {
    const yaml = VALID.replace(/WHERE modified_at > :cursor\n/, "");
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /must reference :cursor/
    );
  });

  it("rejects duplicate kind across streams", async () => {
    const yaml =
      VALID +
      `
  - kind: PatientUpserted
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, modified_at FROM patient
      WHERE modified_at > :cursor
      LIMIT :limit
    map:
      pvsExternalEventId: id
      occurredAt: modified_at
      pvsPatientId: id
`;
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /declared more than once/
    );
  });

  it("rejects unknown transform", async () => {
    const yaml = VALID.replace(
      "transform: isoDateTime",
      "transform: makeItPretty"
    );
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /unknown transform 'makeItPretty'/
    );
  });

  it("rejects field mapping with both from and template", async () => {
    const yaml = VALID.replace(
      "pvsPatientId: id",
      "pvsPatientId: { from: id, template: '{id}' }"
    );
    await expect(loadVendorConfigFromString(yaml, "t.yaml")).rejects.toThrow(
      /from\/template\/literal are mutually exclusive/
    );
  });

  it("VendorConfigError carries vendor + path", async () => {
    try {
      await loadVendorConfigFromString(
        "vendor: tomedo-db\ndriver: oracle",
        "/tmp/x.yaml"
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(VendorConfigError);
      const ve = err as VendorConfigError;
      expect(ve.vendor).toBe("tomedo-db");
      expect(ve.path).toBe("/tmp/x.yaml");
    }
  });
});
