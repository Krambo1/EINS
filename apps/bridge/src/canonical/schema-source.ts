/**
 * Canonical schema: the SINGLE source of truth for the three sets that the
 * PVS bridge shares across package boundaries:
 *
 *   1. The portal Zod schema      (apps/portal/src/server/pvs-events.ts)
 *   2. The bridge TypeScript types (apps/bridge/src/canonical/types.ts)
 *   3. The agent-local mirror      (apps/bridge/agent/src/db-adapters/
 *                                   generated-canonical.ts, GENERATED)
 *
 * These three used to drift independently (a new event kind or bridge source
 * landed in one copy but not the others, which is how InvoiceRefunded ended
 * up un-ingestable and how pabau/consentz went missing from the agent's
 * bridge-source validator). This file collapses them.
 *
 * Wiring:
 *   - The agent mirror is GENERATED from this file by
 *     apps/bridge/scripts/gen-canonical.mjs (committed; the agent ships as a
 *     single binary with zero monorepo runtime deps, so it cannot import this
 *     file at runtime). A staleness test byte-compares the committed mirror
 *     against a fresh generation.
 *   - The bridge types and the portal Zod are hand-maintained mirrors that are
 *     CHECKED against this file by conformance tests (bridge
 *     types.conformance.test.ts and portal pvs-events.canonical.test.ts).
 *     Editing any one copy without updating this source fails CI.
 *
 * Keep this file pure and dependency-free: the generator parses it as text and
 * the test suites import it directly. No imports, no computed values; just the
 * three `as const` arrays below.
 */

/**
 * Provenance labels an adapter may stamp on an emitted event. Mirrors the
 * portal Zod `BridgeSource` enum exactly (conformance-pinned by
 * apps/portal/src/server/pvs-events.canonical.test.ts).
 *
 * The first 8 are the cloud REST adapters + universal sources. The last 7 are
 * the per-Praxis on-prem DB-read engines (Phase 7 per-vendor identity;
 * underscores, with CGM-M1 Postgres + Oracle both collapsing to cgm_m1pro).
 * The agent stamps these from Phase 8 on; the portal accepts them from Phase 7
 * (this set) so the agent upgrade never races the enum.
 */
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

/**
 * The canonical event kinds. Order matches the portal's discriminated union.
 * All 9 kinds, including InvoiceRefunded (refunds / Gutschriften) and
 * AppointmentCancelled (patient-vs-Praxis cancel signal).
 */
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

/**
 * Supported invoice currencies (the DACH set: DE/AT bill in EUR, CH in CHF).
 * Captured as integer cents on the event; downstream EUR assumptions are a
 * tracked follow-up (see pvs-events.ts InvoicePaid comment).
 */
export const CURRENCIES = ["EUR", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];
