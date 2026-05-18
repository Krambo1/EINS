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
    vendorCheck: check(
      "pvs_link_vendor_check",
      sql`${t.pvsVendor} IN ('tomedo','healthhub','red','gdt_agent','csv_upload','n8n_custom','none')`
    ),
    statusCheck: check(
      "pvs_link_status_check",
      sql`${t.status} IN ('unconfigured','akkreditierung','pending','connected','error','disconnected')`
    ),
    statusIdx: index("pvs_link_status_idx").on(t.status),
    vendorIdx: index("pvs_link_vendor_idx").on(t.pvsVendor),
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
  },
  (t) => ({
    bridgeSourceCheck: check(
      "pvs_event_log_bridge_source_check",
      sql`${t.bridgeSource} IN ('tomedo','healthhub','red','gdt_agent','csv_upload','n8n_custom')`
    ),
    kindCheck: check(
      "pvs_event_log_kind_check",
      sql`${t.kind} IN ('PatientUpserted','AppointmentCreated','AppointmentStatusChanged','AppointmentCancelled','EncounterCompleted','InvoicePaid','RecallScheduled','PatientMerged')`
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
  },
  (t) => ({
    clinicIdx: index("pvs_agent_enrollment_tokens_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
  })
);
