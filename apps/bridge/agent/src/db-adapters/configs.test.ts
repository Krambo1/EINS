import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadAllVendorConfigs,
  loadVendorConfigFile,
} from "./vendor-config.js";
import { bridgeSourceForVendor } from "./drift-publisher.js";

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

// Phase 8 per-vendor identity: every on-prem DB-read config now stamps its own
// bridge_source (was all gdt_agent). tomedo stays "tomedo" (REST sibling owns
// it); both CGM-M1 engine variants collapse to "cgm_m1pro".
const BUCKET_A_VENDORS = [
  { file: "tomedo.yaml", id: "tomedo-db", driver: "postgres", source: "tomedo" },
  { file: "medatixx.yaml", id: "medatixx-db", driver: "firebird", source: "medatixx" },
  { file: "cgm-albis.yaml", id: "cgm-albis-db", driver: "postgres", source: "cgm_albis" },
  { file: "cgm-turbomed.yaml", id: "cgm-turbomed-db", driver: "firebird", source: "cgm_turbomed" },
  { file: "cgm-m1pro.yaml", id: "cgm-m1pro-db", driver: "mssql", source: "cgm_m1pro" },
  // CGM M1 PRO Oracle variant (dominant install base per CGM SystemHaus docs);
  // sibling of cgm-m1pro.yaml, ships in the same agent binary so the operator
  // can enable either flavour against the same Praxis without re-deploying.
  // Both variants intentionally share the cgm_m1pro bridge_source.
  { file: "cgm-m1pro-oracle.yaml", id: "cgm-m1pro-oracle-db", driver: "oracle", source: "cgm_m1pro" },
  { file: "indamed.yaml", id: "indamed-db", driver: "mysql", source: "indamed" },
  { file: "quincy.yaml", id: "quincy-db", driver: "firebird", source: "quincy" },
  { file: "pixelmedics.yaml", id: "pixelmedics-db", driver: "sqlite", source: "pixelmedics" },
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

  // Phase 9: every config now declares an InvoiceRefunded stream so refunds /
  // Storno / Gutschrift net revenue down end-to-end. Pin the contract: the
  // stream exists, maps refundedAmountCents through the absAmountToCents
  // transform (amountToCents rejects negatives, so the magnitude must be made
  // positive; doing it in the transform layer instead of a SQL ABS() keeps the
  // query engine-agnostic), carries a keyset tiebreak (inherits Phase 4), and
  // maps the refund-required canonical fields.
  const REFUND_REQUIRED_FIELDS = [
    "pvsExternalEventId",
    "occurredAt",
    "pvsPatientId",
    "pvsInvoiceId",
    "refundedAmountCents",
    "refundedAt",
  ];
  it.each(BUCKET_A_VENDORS)(
    "$file: declares an InvoiceRefunded stream with a positive-magnitude amount",
    async ({ file }) => {
      const cfg = await loadVendorConfigFile(join(CONFIGS_DIR, file));
      const refund = cfg.streams.find((s) => s.kind === "InvoiceRefunded");
      expect(refund, "missing InvoiceRefunded stream").toBeTruthy();
      const amountMapping = refund!.map.refundedAmountCents;
      const transform =
        typeof amountMapping === "object" ? amountMapping?.transform : undefined;
      expect(
        transform,
        "refundedAmountCents must map through absAmountToCents (positive magnitude)"
      ).toBe("absAmountToCents");
      expect(
        refund!.tiebreakColumn,
        "refund stream needs a keyset tiebreak"
      ).toBeTruthy();
      const mapped = Object.keys(refund!.map);
      for (const f of REFUND_REQUIRED_FIELDS) {
        expect(mapped, `refund map missing ${f}`).toContain(f);
      }
    }
  );

  it.each(BUCKET_A_VENDORS)(
    "$file: bridgeSourceForVendor($id) agrees with the YAML bridgeSource (no map drift)",
    async ({ file, id, source }) => {
      const cfg = await loadVendorConfigFile(join(CONFIGS_DIR, file));
      // Two code paths stamp a bridge_source for the same vendor: canonical
      // events read cfg.bridgeSource directly (normalizer), while drift /
      // config-invalid health reports and the heartbeat's pvs_link_source
      // seeding derive it from the vendor id via bridgeSourceForVendor. If they
      // disagree, a clinic's health card would name a different PVS than its
      // events, and the heartbeat would seed the wrong allowed-source row. Pin
      // all three (the YAML field, the static map, and the expected value)
      // together so neither can drift unnoticed.
      expect(cfg.bridgeSource).toBe(source);
      expect(bridgeSourceForVendor(id)).toBe(source);
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
