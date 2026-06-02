import { describe, expect, it } from "vitest";
import {
  BRIDGE_SOURCES,
  CURRENCIES,
  EVENT_KINDS,
} from "./schema-source.js";
import type {
  BridgeSource as SourceBridgeSource,
  CanonicalEventKind as SourceEventKind,
  Currency as SourceCurrency,
} from "./schema-source.js";
import type { BridgeSource, CanonicalEvent } from "./types.js";

/**
 * Conformance gate for the hand-maintained bridge TypeScript mirror
 * (apps/bridge/src/canonical/types.ts) against the single source of truth
 * (schema-source.ts).
 *
 * The bridge types are TS-only (no runtime values to assert), so the binding is
 * enforced at COMPILE time: the `satisfies` assignments below stop compiling if
 * either union gains or loses a member relative to the source. `tsc` runs them
 * (the bridge build and `pnpm typecheck` both compile src/**\/*.ts including
 * this file), so editing types.ts without the source fails CI.
 *
 * Bidirectional assignability == set equality for string-literal unions: A
 * satisfies B proves A is a subset of B; doing it both ways proves equality.
 */
type BridgeEventKind = CanonicalEvent["kind"];
// Currency on the bridge side lives on the invoice events as ("EUR"|"CHF"|undefined).
type BridgeCurrency = NonNullable<
  Extract<CanonicalEvent, { kind: "InvoicePaid" }>["currency"]
>;

// Exported so the assertions are "used" and unambiguously evaluated by tsc.
export const _compileTimeSetEquality = {
  // bridge BridgeSource == source BridgeSource
  sourceSourcesSubsetOfBridge: ("tomedo" as SourceBridgeSource) satisfies BridgeSource,
  bridgeSourcesSubsetOfSource: ("tomedo" as BridgeSource) satisfies SourceBridgeSource,
  // bridge CanonicalEvent["kind"] == source CanonicalEventKind
  sourceKindsSubsetOfBridge: ("PatientUpserted" as SourceEventKind) satisfies BridgeEventKind,
  bridgeKindsSubsetOfSource: ("PatientUpserted" as BridgeEventKind) satisfies SourceEventKind,
  // bridge invoice currency == source Currency
  sourceCurrencySubsetOfBridge: ("EUR" as SourceCurrency) satisfies BridgeCurrency,
  bridgeCurrencySubsetOfSource: ("EUR" as BridgeCurrency) satisfies SourceCurrency,
} as const;

describe("canonical schema-source arrays", () => {
  it("BRIDGE_SOURCES has no duplicates", () => {
    expect(new Set(BRIDGE_SOURCES).size).toBe(BRIDGE_SOURCES.length);
  });

  it("EVENT_KINDS is the full canonical set (9 kinds, incl. refund + cancel)", () => {
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
    expect(EVENT_KINDS).toContain("InvoiceRefunded");
    expect(EVENT_KINDS).toContain("AppointmentCancelled");
    expect(EVENT_KINDS.length).toBe(9);
  });

  it("CURRENCIES is exactly EUR, CHF", () => {
    expect([...CURRENCIES]).toEqual(["EUR", "CHF"]);
  });

  it("references the compile-time guards so they are not tree-shaken", () => {
    expect(Object.keys(_compileTimeSetEquality)).toHaveLength(6);
  });
});
