import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadAllVendorConfigs,
  loadVendorConfigFile,
} from "./vendor-config.js";

/**
 * Bucket A coverage check.
 *
 * Confirms every shipped vendor YAML loads cleanly through the validator
 * (so a typo in a Praxis-IT-distributed config doesn't sneak in via PR
 * review), and that each one covers the five worker-critical event
 * kinds. Without these streams the portal cannot derive status.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = join(HERE, "configs");

const REQUIRED_KINDS = [
  "PatientUpserted",
  "AppointmentCreated",
  "AppointmentStatusChanged",
  "EncounterCompleted",
  "InvoicePaid",
  "RecallScheduled",
];

const BUCKET_A_VENDORS = [
  { file: "tomedo.yaml", id: "tomedo-db", driver: "postgres", source: "tomedo" },
  { file: "medatixx.yaml", id: "medatixx-db", driver: "firebird", source: "gdt_agent" },
  { file: "cgm-albis.yaml", id: "cgm-albis-db", driver: "postgres", source: "gdt_agent" },
  { file: "cgm-turbomed.yaml", id: "cgm-turbomed-db", driver: "firebird", source: "gdt_agent" },
  { file: "cgm-m1pro.yaml", id: "cgm-m1pro-db", driver: "mssql", source: "gdt_agent" },
  // CGM M1 PRO Oracle variant (dominant install base per CGM SystemHaus docs);
  // sibling of cgm-m1pro.yaml, ships in the same agent binary so the operator
  // can enable either flavour against the same Praxis without re-deploying.
  { file: "cgm-m1pro-oracle.yaml", id: "cgm-m1pro-oracle-db", driver: "oracle", source: "gdt_agent" },
  { file: "indamed.yaml", id: "indamed-db", driver: "mysql", source: "gdt_agent" },
  { file: "quincy.yaml", id: "quincy-db", driver: "firebird", source: "gdt_agent" },
  { file: "pixelmedics.yaml", id: "pixelmedics-db", driver: "sqlite", source: "gdt_agent" },
] as const;

describe("Bucket A vendor configs load and validate", () => {
  it.each(BUCKET_A_VENDORS)(
    "$file: validates and declares $id with driver=$driver",
    async ({ file, id, driver, source }) => {
      const cfg = await loadVendorConfigFile(join(CONFIGS_DIR, file));
      expect(cfg.vendor).toBe(id);
      expect(cfg.driver).toBe(driver);
      expect(cfg.bridgeSource).toBe(source);
      expect(cfg.connection.credentialId).toMatch(/^[a-z0-9-]+-default$/);
      expect(cfg.streams.length).toBeGreaterThanOrEqual(5);
    }
  );

  it.each(BUCKET_A_VENDORS)(
    "$file: covers every worker-critical event kind",
    async ({ file }) => {
      const cfg = await loadVendorConfigFile(join(CONFIGS_DIR, file));
      const declared = new Set(cfg.streams.map((s) => s.kind));
      for (const kind of REQUIRED_KINDS) {
        expect(declared.has(kind as never), `missing kind=${kind}`).toBe(true);
      }
    }
  );

  it.each(BUCKET_A_VENDORS)(
    "$file: every stream binds :cursor in its query",
    async ({ file }) => {
      const cfg = await loadVendorConfigFile(join(CONFIGS_DIR, file));
      for (const s of cfg.streams) {
        expect(s.query, `${s.kind} query missing :cursor`).toMatch(/:cursor\b/);
      }
    }
  );

  it("loadAllVendorConfigs ingests all shipped files without a duplicate-vendor clash", async () => {
    const map = await loadAllVendorConfigs(CONFIGS_DIR);
    const ids = Array.from(map.keys()).sort();
    expect(ids).toEqual(
      [...BUCKET_A_VENDORS.map((v) => v.id)].sort()
    );
  });
});
