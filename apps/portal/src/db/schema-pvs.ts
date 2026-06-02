/**
 * Drizzle schema for the PVS Bridge tables.
 * Mirrors migrations 0021–0031 verbatim. Re-exported via `schema.ts`.
 *
 * Tenancy: every table (except pvs_sync_status, scoped via pvs_link) has
 * clinic_id and is RLS-enforced by migration 0031_rls_pvs.sql.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  date,
  jsonb,
  unique,
  inet,
  check,
  index,
  boolean,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clinics, clinicUsers, treatments, locations, patients } from "./schema";

// ---------------------------------------------------------------
// PVS_LINK — one row per clinic.
// ---------------------------------------------------------------
export const pvsLink = pgTable(
  "pvs_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsVendor: text("pvs_vendor").notNull(),
    status: text("status").notNull().default("unconfigured"),
    // 'auto' (default) lets the bridge pick; 'rest' forces the cloud scheduler
    // to own the path; 'db_read' forces the on-prem SQL-introspection agent
    // to own it (cloud scheduler skips). Multi-path vendors (Tomedo) are the
    // only case this matters today; single-path vendors leave it on 'auto'.
    preferredPath: text("preferred_path").notNull().default("auto"),
    connectionConfig: jsonb("connection_config")
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqClinic: unique("pvs_link_clinic_unique").on(t.clinicId),
    // Widened by 0055 to add the 7 per-Praxis DB-read vendors (underscores;
    // CGM-M1 Postgres + Oracle both collapse to cgm_m1pro). Keep in sync with
    // pvs_event_log.bridge_source + pvs_link_source.bridge_source and the
    // canonical BRIDGE_SOURCES (apps/bridge/src/canonical/schema-source.ts).
    vendorCheck: check(
      "pvs_link_vendor_check",
      sql`${t.pvsVendor} IN ('tomedo','healthhub','red','pabau','consentz','gdt_agent','csv_upload','n8n_custom','none','medatixx','cgm_albis','cgm_turbomed','cgm_m1pro','indamed','quincy','pixelmedics')`
    ),
    statusCheck: check(
      "pvs_link_status_check",
      sql`${t.status} IN ('unconfigured','akkreditierung','pending','connected','error','disconnected')`
    ),
    preferredPathCheck: check(
      "pvs_link_preferred_path_check",
      sql`${t.preferredPath} IN ('auto', 'rest', 'db_read')`
    ),
    statusIdx: index("pvs_link_status_idx").on(t.status),
    vendorIdx: index("pvs_link_vendor_idx").on(t.pvsVendor),
  })
);

// ---------------------------------------------------------------
// PVS_LINK_SOURCE — the set of bridge_sources a clinic may emit (0055).
// ---------------------------------------------------------------
//
// Phase 7 per-vendor identity. pvs_link stays 1:1 with the clinic; this table
// holds the many provenances a single clinic can legitimately stamp (one GDT
// agent can read several PVS engines). applyPvsEvent treats a missing row as a
// transient "not enrolled yet" state (vendor_mismatch -> 409, retryable), NOT
// a hard 400: the HMAC already proved the clinic, and the agent reports its
// vendors on the next heartbeat. Seeded by enrollment + heartbeat + the 0055
// backfill. RLS-enforced (0055) like every other clinic-scoped PVS table.
export const pvsLinkSource = pgTable(
  "pvs_link_source",
  {
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    bridgeSource: text("bridge_source").notNull(),
    pvsVendor: text("pvs_vendor").notNull(),
    enrolledVia: text("enrolled_via").notNull().default("heartbeat"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.bridgeSource] }),
    // Mirror of pvs_event_log.bridge_source / pvs_link.pvs_vendor + the
    // canonical BRIDGE_SOURCES. Keep all four in sync.
    bridgeSourceCheck: check(
      "pvs_link_source_bridge_source_check",
      sql`${t.bridgeSource} IN ('tomedo','healthhub','red','pabau','consentz','gdt_agent','csv_upload','n8n_custom','medatixx','cgm_albis','cgm_turbomed','cgm_m1pro','indamed','quincy','pixelmedics')`
    ),
    enrolledViaCheck: check(
      "pvs_link_source_enrolled_via_check",
      sql`${t.enrolledVia} IN ('enrollment','heartbeat','backfill','manual')`
    ),
    // No standalone clinic_id index: the composite PK already covers clinic_id
    // as its leftmost prefix, and every query filters by clinic_id or the
    // full PK.
  })
);

// ---------------------------------------------------------------
// PVS_EVENT_LOG — partitioned, append-only event log.
// ---------------------------------------------------------------
//
// Drizzle does not model partitioning declaratively; we declare the parent
// table's shape so the type/query layer works correctly, but the actual
// PARTITION BY RANGE clause lives in 0022_pvs_event_log.sql.
export const pvsEventLog = pgTable(
  "pvs_event_log",
  {
    id: uuid("id").notNull().defaultRandom(),
    clinicId: uuid("clinic_id").notNull(),
    bridgeSource: text("bridge_source").notNull(),
    pvsExternalEventId: text("pvs_external_event_id").notNull(),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * P1-2: immutable snapshot of pvs_link.status at the moment this event
     * was ingested. Set by applyPvsEvent at insert time. Used by the
     * replay query to find events that were quarantined under a pending
     * link and need re-application after the operator confirms.
     */
    linkStatusAtIngest: text("link_status_at_ingest").notNull(),
    /**
     * P1-2: NULL until applyEventEffects ran successfully (linker + derive).
     * Replay selects WHERE applied_at IS NULL AND link_status_at_ingest =
     * 'pending'. Set in the same logical operation that writes the
     * downstream effects so a partial failure leaves applied_at NULL
     * and the row gets replayed next confirmation.
     */
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    /**
     * P2-1: set by the pvs-reconcile CLI when the operator wants the
     * derive worker to re-process this row (typical case: a wrong fuzzy
     * link was undone and downstream effects must be recomputed against
     * the corrected patient map). The `replay-events` subcommand reads
     * WHERE needs_rederive = true, re-enqueues derive, and clears the
     * flag after enqueue succeeds.
     */
    needsRederive: boolean("needs_rederive").notNull().default(false),
  },
  (t) => ({
    // Widened by 0055 (NOT VALID, partitioned) to add the 7 per-Praxis
    // DB-read vendors. Keep in sync with the canonical BRIDGE_SOURCES
    // (apps/bridge/src/canonical/schema-source.ts) + the portal Zod enum.
    bridgeSourceCheck: check(
      "pvs_event_log_bridge_source_check",
      sql`${t.bridgeSource} IN ('tomedo','healthhub','red','pabau','consentz','gdt_agent','csv_upload','n8n_custom','medatixx','cgm_albis','cgm_turbomed','cgm_m1pro','indamed','quincy','pixelmedics')`
    ),
    // 9 canonical kinds. Mirror of the CHECK created in 0022 and widened by
    // 0053 to add InvoiceRefunded (refunds / storni). Keep in sync with the
    // Zod discriminated union in server/pvs-events.ts.
    kindCheck: check(
      "pvs_event_log_kind_check",
      sql`${t.kind} IN ('PatientUpserted','AppointmentCreated','AppointmentStatusChanged','AppointmentCancelled','EncounterCompleted','InvoicePaid','InvoiceRefunded','RecallScheduled','PatientMerged')`
    ),
  })
);

// ---------------------------------------------------------------
// PVS_PATIENT_MAP — PVS patient ↔ portal patient with link method.
// ---------------------------------------------------------------
export const pvsPatientMap = pgTable(
  "pvs_patient_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsPatientId: text("pvs_patient_id").notNull(),
    portalPatientId: uuid("portal_patient_id")
      .notNull()
      .references(() => patients.id, { onDelete: "cascade" }),
    linkMethod: text("link_method").notNull(),
    confidenceScore: numeric("confidence_score", { precision: 3, scale: 2 }),
    linkedAt: timestamp("linked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    linkedBy: uuid("linked_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
  },
  (t) => ({
    uniq: unique("pvs_patient_map_unique").on(t.clinicId, t.pvsPatientId),
    methodCheck: check(
      "pvs_patient_map_method_check",
      sql`${t.linkMethod} IN ('external_id','bemerkung_token','fuzzy','manual')`
    ),
    portalIdx: index("pvs_patient_map_portal_idx").on(
      t.clinicId,
      t.portalPatientId
    ),
  })
);

// ---------------------------------------------------------------
// PVS_TREATMENT_MAPPING — PVS treatment code ↔ portal treatment.
// ---------------------------------------------------------------
export const pvsTreatmentMapping = pgTable(
  "pvs_treatment_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsTreatmentCode: text("pvs_treatment_code").notNull(),
    pvsLabel: text("pvs_label"),
    portalTreatmentId: uuid("portal_treatment_id").references(
      (): AnyPgColumn => treatments.id,
      { onDelete: "set null" }
    ),
    status: text("status").notNull().default("unmapped"),
    suggestedTreatmentId: uuid("suggested_treatment_id").references(
      (): AnyPgColumn => treatments.id,
      { onDelete: "set null" }
    ),
    suggestedScore: numeric("suggested_score", { precision: 3, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    mappedBy: uuid("mapped_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: unique("pvs_treatment_mapping_unique").on(
      t.clinicId,
      t.pvsTreatmentCode
    ),
    statusCheck: check(
      "pvs_treatment_mapping_status_check",
      sql`${t.status} IN ('unmapped','mapped','ignored')`
    ),
    clinicIdx: index("pvs_treatment_mapping_clinic_idx").on(
      t.clinicId,
      t.status
    ),
  })
);

// ---------------------------------------------------------------
// PVS_LOCATION_MAPPING — PVS location id ↔ portal location.
// ---------------------------------------------------------------
export const pvsLocationMapping = pgTable(
  "pvs_location_mapping",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsLocationId: text("pvs_location_id").notNull(),
    pvsLabel: text("pvs_label"),
    portalLocationId: uuid("portal_location_id").references(
      (): AnyPgColumn => locations.id,
      { onDelete: "set null" }
    ),
    status: text("status").notNull().default("unmapped"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    mappedBy: uuid("mapped_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    mappedAt: timestamp("mapped_at", { withTimezone: true }),
  },
  (t) => ({
    uniq: unique("pvs_location_mapping_unique").on(t.clinicId, t.pvsLocationId),
    statusCheck: check(
      "pvs_location_mapping_status_check",
      sql`${t.status} IN ('unmapped','mapped','ignored')`
    ),
    clinicIdx: index("pvs_location_mapping_clinic_idx").on(
      t.clinicId,
      t.status
    ),
  })
);

// ---------------------------------------------------------------
// PVS_SYNC_STATUS — bridge bookkeeping per pvs_link.
// ---------------------------------------------------------------
export const pvsSyncStatus = pgTable("pvs_sync_status", {
  pvsLinkId: uuid("pvs_link_id")
    .primaryKey()
    .references(() => pvsLink.id, { onDelete: "cascade" }),
  lastInitialSyncStartedAt: timestamp("last_initial_sync_started_at", {
    withTimezone: true,
  }),
  lastInitialSyncCompletedAt: timestamp("last_initial_sync_completed_at", {
    withTimezone: true,
  }),
  lastIncrementalAt: timestamp("last_incremental_at", { withTimezone: true }),
  lastIncrementalCursor: text("last_incremental_cursor"),
  consecutiveFailureCount: integer("consecutive_failure_count")
    .notNull()
    .default(0),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
  totalEventsIngested: bigint("total_events_ingested", { mode: "number" })
    .notNull()
    .default(0),
  totalEventsLast24h: integer("total_events_last_24h").notNull().default(0),
});

// ---------------------------------------------------------------
// LINKING_FAILURES — unlinked-event inbox.
// ---------------------------------------------------------------
export const linkingFailures = pgTable(
  "linking_failures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsEventLogId: uuid("pvs_event_log_id").notNull(),
    pvsEventOccurredAt: timestamp("pvs_event_occurred_at", {
      withTimezone: true,
    }).notNull(),
    pvsPatientId: text("pvs_patient_id").notNull(),
    pvsPatientSnapshot: jsonb("pvs_patient_snapshot").notNull(),
    candidates: jsonb("candidates").notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("open"),
    resolvedToPatientId: uuid("resolved_to_patient_id").references(
      (): AnyPgColumn => patients.id,
      { onDelete: "set null" }
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    resolutionMethod: text("resolution_method"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "linking_failures_status_check",
      sql`${t.status} IN ('open','resolved','ignored')`
    ),
    resolutionCheck: check(
      "linking_failures_resolution_check",
      sql`${t.resolutionMethod} IS NULL OR ${t.resolutionMethod} IN ('candidate_pick','manual_search','new_patient','ignored')`
    ),
    inboxIdx: index("linking_failures_inbox_idx").on(
      t.clinicId,
      t.status,
      t.createdAt.desc()
    ),
    pvsPatientIdx: index("linking_failures_pvs_patient_idx").on(
      t.clinicId,
      t.pvsPatientId,
      t.status
    ),
  })
);

// ---------------------------------------------------------------
// PVS_CSV_UPLOADS — CSV upload bookkeeping.
// ---------------------------------------------------------------
export const pvsCsvUploads = pgTable(
  "pvs_csv_uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    stream: text("stream").notNull(),
    mappingJson: jsonb("mapping_json").notNull(),
    status: text("status").notNull().default("pending"),
    totalRows: integer("total_rows"),
    processedRows: integer("processed_rows").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    errorSummary: jsonb("error_summary"),
    uploadGroupId: uuid("upload_group_id"),
    createdBy: uuid("created_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => ({
    streamCheck: check(
      "pvs_csv_uploads_stream_check",
      sql`${t.stream} IN ('patients','appointments','encounters','invoices')`
    ),
    statusCheck: check(
      "pvs_csv_uploads_status_check",
      sql`${t.status} IN ('pending','processing','completed','failed','cancelled')`
    ),
    clinicIdx: index("pvs_csv_uploads_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
    statusIdx: index("pvs_csv_uploads_status_idx").on(t.status, t.createdAt),
    groupIdx: index("pvs_csv_uploads_group_idx").on(t.uploadGroupId),
  })
);

// ---------------------------------------------------------------
// PVS_AGENT_ENROLLMENT_TOKENS — one-time tokens for GDT-Agent install.
// ---------------------------------------------------------------
export const pvsAgentEnrollmentTokens = pgTable(
  "pvs_agent_enrollment_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expectedFingerprint: text("expected_fingerprint"),
    createdBy: uuid("created_by").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedFingerprint: text("consumed_fingerprint"),
    consumedIp: inet("consumed_ip"),
    /**
     * P1-3: explicit operator opt-in to switch the clinic's PVS vendor
     * during redemption. Default false — a token issued for a fresh
     * install MUST NOT silently re-point a clinic that was previously
     * on Tomedo / Pabau / RED to gdt_agent. Operator sets this true
     * when creating the token only if they're intentionally migrating.
     */
    allowVendorSwitch: boolean("allow_vendor_switch")
      .notNull()
      .default(false),
  },
  (t) => ({
    clinicIdx: index("pvs_agent_enrollment_tokens_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
  })
);

/**
 * pvs_reconcile_audit — append-only trail of operator CLI actions
 * (apps/portal/scripts/pvs-reconcile.ts). Every applied subcommand
 * (unlink, recompute-lifetime, replay-events, manual-repair) writes a
 * row with before/after snapshots so an operator can review what was
 * changed and, if needed, recover state. Dry-run invocations are also
 * recorded so a "I ran dry-run first" trail is visible to the next
 * operator who looks at the praxis.
 */
export const pvsReconcileAudit = pgTable(
  "pvs_reconcile_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    actor: text("actor"),
    reason: text("reason"),
    beforeState: jsonb("before_state")
      .notNull()
      .default(sql`'{}'::jsonb`),
    afterState: jsonb("after_state")
      .notNull()
      .default(sql`'{}'::jsonb`),
    dryRun: boolean("dry_run").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("pvs_reconcile_audit_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
    kindIdx: index("pvs_reconcile_audit_kind_idx").on(t.kind, t.createdAt.desc()),
  })
);

/**
 * pvs_link_audit — append-only history of pvs_link state changes.
 * Surfaces vendor switches, status transitions, and rotation events for
 * the admin clinic-detail page and the Phase 2 reconciliation tooling.
 */
export const pvsLinkAudit = pgTable(
  "pvs_link_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    /**
     * One of: 'vendor_switch', 'status_change', 'secret_rotated',
     * 'enrollment_redeemed', 'manual_override'. Free-text rather than a
     * CHECK constraint so new event kinds don't need a migration.
     */
    kind: text("kind").notNull(),
    fromValue: text("from_value"),
    toValue: text("to_value"),
    context: jsonb("context")
      .notNull()
      .default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id").references(
      (): AnyPgColumn => clinicUsers.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("pvs_link_audit_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
    kindIdx: index("pvs_link_audit_kind_idx").on(t.kind, t.createdAt.desc()),
  })
);

// ---------------------------------------------------------------
// PVS_AGENT_STATUS: GDT-Agent heartbeat surface (P2-2).
// ---------------------------------------------------------------
// One row per clinic, upserted on every heartbeat. The admin clinic
// detail page reads this to show "agent healthy / N failed events".
export const pvsAgentStatus = pgTable("pvs_agent_status", {
  clinicId: uuid("clinic_id")
    .primaryKey()
    .references(() => clinics.id, { onDelete: "cascade" }),
  agentVersion: text("agent_version"),
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  failedEvents: integer("failed_events").notNull().default(0),
  oldestFailedAt: timestamp("oldest_failed_at", { withTimezone: true }),
  lastFailureReason: text("last_failure_reason"),
  recentReasons: jsonb("recent_reasons")
    .notNull()
    .default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------
// PVS_AGENT_FAILURE_SUMMARY: append-only dead-letter prune log (P2-2).
// ---------------------------------------------------------------
export const pvsAgentFailureSummary = pgTable(
  "pvs_agent_failure_summary",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    prunedCount: integer("pruned_count").notNull(),
    prunedOldestAt: timestamp("pruned_oldest_at", { withTimezone: true }),
    prunedNewestAt: timestamp("pruned_newest_at", { withTimezone: true }),
    reasons: jsonb("reasons").notNull().default(sql`'[]'::jsonb`),
    reportedAt: timestamp("reported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("pvs_agent_failure_summary_clinic_idx").on(
      t.clinicId,
      t.reportedAt.desc()
    ),
  })
);

// ---------------------------------------------------------------
// PVS_LINK_HEALTH: per-stream operational signals from the bridge.
// ---------------------------------------------------------------
// Schema-drift reports + transient stream errors that the SQL-introspection
// agent (apps/bridge/agent/src/db-adapters/framework.ts) or a cloud adapter
// flags as actionable. One row per (clinic, vendor, stream, event_kind,
// detected_at) tuple. The agent retries POSTs to /api/pvs/health until 2xx;
// the dedup index makes that retry safe.
//
// The integrations UI reads `resolved_at IS NULL` rows to render the per-
// stream warning card the Phase 4 brief requires.
//
// Schema mirrors migration 0040_pvs_link_health.sql verbatim.
export const pvsLinkHealth = pgTable(
  "pvs_link_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    pvsVendor: text("pvs_vendor").notNull(),
    bridgeSource: text("bridge_source").notNull(),
    streamKind: text("stream_kind").notNull(),
    eventKind: text("event_kind").notNull(),
    severity: text("severity").notNull().default("warn"),
    message: text("message").notNull(),
    detail: jsonb("detail").notNull().default(sql`'{}'::jsonb`),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedup: unique("pvs_link_health_dedup_idx").on(
      t.clinicId,
      t.pvsVendor,
      t.streamKind,
      t.eventKind,
      t.detectedAt
    ),
    // Mirror of 0040, widened by 0054 to add 'config_invalid' (first-poll
    // value validation halts a stream whose data does not match its YAML map).
    eventKindCheck: check(
      "pvs_link_health_event_kind_check",
      sql`${t.eventKind} IN (
        'schema_drift',
        'schema_recovered',
        'stream_error',
        'stream_recovered',
        'auth_expired',
        'connection_lost',
        'rate_limited',
        'config_invalid'
      )`
    ),
    severityCheck: check(
      "pvs_link_health_severity_check",
      sql`${t.severity} IN ('info','warn','error')`
    ),
    openIdx: index("pvs_link_health_open_idx").on(
      t.clinicId,
      t.resolvedAt,
      t.detectedAt.desc()
    ),
  })
);
