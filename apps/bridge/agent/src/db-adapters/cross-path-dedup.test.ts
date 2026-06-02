import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadVendorConfigFile } from "./vendor-config.js";
import { normalizeRow } from "./normalizer.js";
import type { StreamConfig, VendorConfig } from "./types.js";

/**
 * Cross-path dedup contract (Phase 11).
 *
 * Tomedo can be fed three ways:
 *   - REST adapter  apps/bridge/src/adapters/tomedo/normalize.ts
 *   - DB-read       apps/bridge/agent/src/db-adapters/configs/tomedo.yaml (this pkg)
 *   - Lua hooks     apps/portal/public/pvs-bridge/tomedo-lua/hooks/*.lua
 *
 * The portal dedups on the UNIQUE index
 *   (clinic_id, bridge_source, pvs_external_event_id, occurred_at).
 *
 * REST and DB-read now CONVERGE: both go through the single identity contract in
 * apps/bridge/src/adapters/tomedo/event-identity.ts, so the same Tomedo row
 * yields a byte-identical (bridge_source, pvs_external_event_id, occurred_at)
 * tuple on either path and the unique index collapses them. The block below
 * proves the DB-read side of that against the REAL tomedo.yaml, using the same
 * fixed fixture and the same literal expectations as the REST-side test
 * (apps/bridge/src/adapters/tomedo/normalize.test.ts -> FIXTURE). If you change
 * an id template or an occurred_at source, update event-identity.ts and BOTH
 * tests together.
 *
 * Lua stays a DELIBERATELY separate provenance ("tomedo-lua:" prefix). A Lua
 * hook fires on a Tomedo workflow trigger and, for a status change, only knows
 * the hook-fire time (os.time()), never the row's modified_at; it cannot
 * reproduce occurred_at for every kind. Aligning only the prefix would dedup
 * invoices but double-count status changes (a partial-dedup bug). So Lua and
 * DB-read must NOT co-run; the second block locks that divergence on purpose.
 */

const here = dirname(fileURLToPath(import.meta.url));
const tomedoYamlPath = join(here, "configs", "tomedo.yaml");
const tomedoYaml = readFileSync(tomedoYamlPath, "utf8");

// The single logical Tomedo row, mirrored byte-for-byte from the REST test's
// FIXTURE so both paths are proven against identical inputs/outputs.
const FIXTURE = {
  modifiedAt: "2026-01-02T03:04:05.000Z",
  scheduledAt: "2026-03-04T09:00:00.000Z",
  completedAt: "2026-03-04T09:30:00.000Z",
  paidAt: "2026-03-05T11:22:33.000Z",
  recallAt: "2026-09-01T08:00:00.000Z",
};

function streamFor(vendor: VendorConfig, kind: string): StreamConfig {
  const s = vendor.streams.find((st) => st.kind === kind);
  if (!s) throw new Error(`tomedo.yaml missing stream ${kind}`);
  return s;
}

describe("tomedo cross-path dedup: REST and DB-read produce identical tuples", () => {
  it("DB-read derives the canonical tuple for every shared kind", async () => {
    const vendor = await loadVendorConfigFile(tomedoYamlPath);
    const ctx = (kind: string) => ({
      clinicId: "c",
      vendor,
      stream: streamFor(vendor, kind),
    });

    // Timestamps arrive from the pg driver as Date objects; the framework's
    // template coercion (coerceScalar) and the isoDateTime transform both emit
    // Date.prototype.toISOString(), the exact string the REST path emits.
    const patient = normalizeRow(
      {
        id: "P1",
        vorname: "Anna",
        nachname: "Beispiel",
        email: "anna@example.de",
        telefon_mobil: "+49 170 0000000",
        telefon_privat: null,
        geburtsdatum: null,
        geschlecht: null,
        bemerkung: null,
        modified_at: new Date(FIXTURE.modifiedAt),
      },
      ctx("PatientUpserted")
    );
    expect(patient?.bridgeSource).toBe("tomedo");
    expect(patient?.pvsExternalEventId).toBe(
      `tomedo:patient:P1:${FIXTURE.modifiedAt}`
    );
    expect(patient?.occurredAt).toBe(FIXTURE.modifiedAt);

    const appt = normalizeRow(
      {
        id: "A1",
        patient_id: "P1",
        termin_zeit: new Date(FIXTURE.scheduledAt),
        behandlung_code: null,
        behandlung_name: null,
        raum_id: null,
        raum_name: null,
        kommentar: null,
        modified_at: new Date(FIXTURE.modifiedAt),
      },
      ctx("AppointmentCreated")
    );
    expect(appt?.pvsExternalEventId).toBe("tomedo:appointment:A1");
    expect(appt?.occurredAt).toBe(FIXTURE.scheduledAt);

    const enc = normalizeRow(
      {
        id: "E1",
        patient_id: "P1",
        termin_id: "A1",
        behandlung_zeit: new Date(FIXTURE.completedAt),
        behandlung_code: null,
        behandlung_name: null,
        behandler_name: null,
        modified_at: new Date(FIXTURE.modifiedAt),
      },
      ctx("EncounterCompleted")
    );
    expect(enc?.pvsExternalEventId).toBe("tomedo:encounter:E1");
    expect(enc?.occurredAt).toBe(FIXTURE.completedAt);

    const invoice = normalizeRow(
      {
        id: "R1",
        patient_id: "P1",
        termin_id: "A1",
        behandlung_id: "E1",
        betrag: 125,
        bezahlt_am: new Date(FIXTURE.paidAt),
        status: "bezahlt",
        modified_at: new Date(FIXTURE.modifiedAt),
      },
      ctx("InvoicePaid")
    );
    expect(invoice?.pvsExternalEventId).toBe("tomedo:invoice:R1");
    expect(invoice?.occurredAt).toBe(FIXTURE.paidAt);

    const recall = normalizeRow(
      {
        id: "RC1",
        patient_id: "P1",
        recall_zeit: new Date(FIXTURE.recallAt),
        behandlung_code: null,
        behandlung_name: null,
        modified_at: new Date(FIXTURE.modifiedAt),
      },
      ctx("RecallScheduled")
    );
    expect(recall?.pvsExternalEventId).toBe("tomedo:recall:RC1");
    // occurredAt is the scheduling moment (modified_at), matching the REST path;
    // a regression to recall_zeit would flip this to FIXTURE.recallAt.
    expect(recall?.occurredAt).toBe(FIXTURE.modifiedAt);
  });

  it("the YAML pins the dedup-relevant id templates", () => {
    // Structural quick-check; the recall occurredAt source (modified_at, not
    // recall_zeit) is proven behaviourally by the normalizeRow assertion above.
    expect(tomedoYaml).toContain("bridgeSource: tomedo");
    expect(tomedoYaml).toMatch(
      /pvsExternalEventId:\s*\{\s*template:\s*"tomedo:invoice:\{id\}"/
    );
    expect(tomedoYaml).toMatch(
      /pvsExternalEventId:\s*\{\s*template:\s*"tomedo:recall:\{id\}"/
    );
  });
});

const luaInvoice = readFileSync(
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "portal",
    "public",
    "pvs-bridge",
    "tomedo-lua",
    "hooks",
    "invoice_paid.lua"
  ),
  "utf8"
);

describe("tomedo cross-path: Lua stays a separate provenance (do NOT co-run with DB-read)", () => {
  it("Lua keeps the distinct tomedo-lua: id prefix while DB-read uses tomedo:", () => {
    // DB-read: "tomedo:invoice:{id}".
    expect(tomedoYaml).toMatch(
      /pvsExternalEventId:\s*\{\s*template:\s*"tomedo:invoice:\{id\}"/
    );
    // Lua: "tomedo-lua:invoice:" .. inv_id. Distinct on purpose; see the file
    // header and event-identity.ts for why Lua cannot dedup against DB-read.
    expect(luaInvoice).toMatch(/pvsExternalEventId\s*=\s*"tomedo-lua:invoice:"/);
  });

  it("both stamp bridge_source = tomedo, so the prefix is the only divergence guard", () => {
    expect(tomedoYaml).toContain("bridgeSource: tomedo");
    expect(luaInvoice).toContain('bridgeSource       = "tomedo"');
  });
});
