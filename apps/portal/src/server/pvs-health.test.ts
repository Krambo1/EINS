import { describe, it, expect } from "vitest";
import { PvsHealthEventSchema } from "./pvs-health";

/**
 * Zod-shape tests only. The applier (applyPvsHealth) reaches the DB and
 * is covered by an integration test scenario; unit-testing it here would
 * require a Postgres test container that the rest of the portal test
 * suite doesn't depend on.
 */

describe("pvs-health Zod schema", () => {
  const base = {
    clinicId: "11111111-2222-3333-4444-555555555555",
    pvsVendor: "tomedo-db",
    bridgeSource: "tomedo" as const,
    streamKind: "AppointmentCreated" as const,
    eventKind: "schema_drift" as const,
    severity: "warn" as const,
    message: "Schema-Drift in tomedo-db/AppointmentCreated",
    detail: {
      expected: ["id", "patient_id", "termin_zeit", "modified_at"],
      observed: ["id", "patient_id", "appointment_time", "modified_at"],
      missing: ["termin_zeit"],
      added: ["appointment_time"],
    },
    detectedAt: "2026-05-21T10:00:00.000Z",
  };

  it("accepts a valid schema_drift envelope", () => {
    const r = PvsHealthEventSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("accepts a vendor-scoped (stream='vendor') signal for auth_expired", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      streamKind: "vendor",
      eventKind: "auth_expired",
      severity: "error",
      message: "Pabau API token expired",
      detail: { reason: "401 from /clients" },
    });
    expect(r.success).toBe(true);
  });

  it("accepts a recovery envelope", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      eventKind: "schema_recovered",
      message: "Spalten wieder vollständig",
      detail: {},
    });
    expect(r.success).toBe(true);
  });

  it("accepts a config_invalid envelope with first-poll detail (Phase 5)", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      pvsVendor: "medatixx",
      bridgeSource: "gdt_agent",
      streamKind: "AppointmentStatusChanged",
      eventKind: "config_invalid",
      severity: "error",
      message:
        "Konfiguration prüfen in medatixx/AppointmentStatusChanged: Felder newStatus lieferten unerwartete Werte (Stichprobe: 0/5 Zeilen gültig).",
      detail: {
        sampleSize: 5,
        passingRows: 0,
        threshold: 0.8,
        issues: [
          {
            field: "newStatus",
            reason:
              "Transformation 'appointmentStatus' ergab in 5/5 Stichproben-Zeilen keinen gültigen Wert",
            sampleRawValues: ["FANTASIE", "Z99"],
          },
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown eventKind", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      eventKind: "exploded_violently",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown streamKind", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      streamKind: "TableTennisCompleted",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an invalid clinicId UUID", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      clinicId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects detectedAt without timezone offset", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      detectedAt: "2026-05-21T10:00:00",
    });
    expect(r.success).toBe(false);
  });

  it("rejects extra unexpected top-level fields (strict mode)", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      // The agent must not smuggle extra top-level keys past the schema.
      somethingExtra: "x",
    });
    expect(r.success).toBe(false);
  });

  it("defaults severity to warn when omitted", () => {
    // Build a base envelope without severity.
    const { severity: _drop, ...withoutSeverity } = base;
    const r = PvsHealthEventSchema.safeParse(withoutSeverity);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.severity).toBe("warn");
  });

  it("caps message at 500 chars", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      message: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("accepts ±HH:mm offset on detectedAt", () => {
    const r = PvsHealthEventSchema.safeParse({
      ...base,
      detectedAt: "2026-05-21T12:00:00+02:00",
    });
    expect(r.success).toBe(true);
  });
});
