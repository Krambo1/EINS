// GENERATED - DO NOT EDIT.
// Source: apps/bridge/src/canonical/schema-source.ts
// Regenerate: node apps/bridge/scripts/gen-canonical.mjs
//
// Agent-local mirror of the canonical schema sets. The agent ships as a
// single binary with zero monorepo runtime deps, so the shared definition
// in the source above is generated into the agent tree and committed. Edit
// the source, then regenerate; never edit this file by hand (a staleness
// test byte-compares it against a fresh generation).

export const BRIDGE_SOURCES = [
  "tomedo",
  "healthhub",
  "red",
  "pabau",
  "consentz",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
  "medatixx",
  "cgm_albis",
  "cgm_turbomed",
  "cgm_m1pro",
  "indamed",
  "quincy",
  "pixelmedics",
] as const;
export type BridgeSource = (typeof BRIDGE_SOURCES)[number];

export const EVENT_KINDS = [
  "PatientUpserted",
  "AppointmentCreated",
  "AppointmentStatusChanged",
  "AppointmentCancelled",
  "EncounterCompleted",
  "InvoicePaid",
  "InvoiceRefunded",
  "RecallScheduled",
  "PatientMerged",
] as const;
export type CanonicalEventKind = (typeof EVENT_KINDS)[number];

export const CURRENCIES = [
  "EUR",
  "CHF",
] as const;
export type Currency = (typeof CURRENCIES)[number];
