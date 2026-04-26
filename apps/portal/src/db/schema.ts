/**
 * Drizzle schema for the EINS Portal.
 * Mirrors the DDL in EINS_PORTAL_PLAN_v0.2.md §5 verbatim in intent.
 *
 * Tenancy model: every user-facing table carries `clinic_id` and is
 * enforced via Postgres RLS policies (see migrations/0002_rls.sql).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  numeric,
  date,
  jsonb,
  primaryKey,
  unique,
  inet,
  check,
  index,
  customType,
  pgEnum,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------
// Custom types
// ---------------------------------------------------------------
const bytea = customType<{ data: Buffer; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

const citext = customType<{ data: string; notNull: true; default: false }>({
  dataType() {
    return "citext";
  },
});

// ---------------------------------------------------------------
// Enums (expressed as CHECK constraints in DDL for flexibility)
// ---------------------------------------------------------------

// We use text + check constraints instead of pg enums so evolution (plan adds
// a new source, status, etc.) doesn't require ALTER TYPE dance.

// ---------------------------------------------------------------
// CLINICS
// ---------------------------------------------------------------
export const clinics = pgTable(
  "clinics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: text("plan").notNull(),
    planStartedAt: timestamp("plan_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    defaultDoctorEmail: text("default_doctor_email"),
    billingAddress: jsonb("billing_address"),
    hwgContactName: text("hwg_contact_name"),
    hwgContactEmail: text("hwg_contact_email"),
    locations: jsonb("locations").default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    planCheck: check("clinics_plan_check", sql`${t.plan} IN ('standard','erweitert')`),
  })
);

// ---------------------------------------------------------------
// CLINIC_USERS
// ---------------------------------------------------------------
export const clinicUsers = pgTable(
  "clinic_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    fullName: text("full_name"),
    role: text("role").notNull(),
    mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
    mfaSecretEnc: bytea("mfa_secret_enc"),
    // Backup codes are stored as argon2-hashed tokens in a jsonb array.
    mfaBackupCodes: jsonb("mfa_backup_codes").default(sql`'[]'::jsonb`),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitationTokenHash: text("invitation_token_hash"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    uiMode: text("ui_mode").notNull().default("einfach"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqEmailPerClinic: unique("clinic_users_email_unique").on(
      t.clinicId,
      t.email
    ),
    roleCheck: check(
      "clinic_users_role_check",
      sql`${t.role} IN ('inhaber','marketing','frontdesk')`
    ),
    uiModeCheck: check(
      "clinic_users_ui_mode_check",
      sql`${t.uiMode} IN ('einfach','detail')`
    ),
    clinicIdx: index("clinic_users_clinic_idx").on(t.clinicId),
  })
);

// ---------------------------------------------------------------
// SESSIONS (server-side session store for magic-link flow)
// ---------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    /** Set when an admin "View as user" session opened this row. */
    impersonatedByAdminId: uuid("impersonated_by_admin_id").references(
      (): AnyPgColumn => adminUsers.id,
      { onDelete: "set null" }
    ),
    userAgent: text("user_agent"),
    ipAddress: inet("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    expiryIdx: index("sessions_expiry_idx").on(t.expiresAt),
  })
);

// ---------------------------------------------------------------
// MAGIC LINKS
// ---------------------------------------------------------------
export const magicLinks = pgTable(
  "magic_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: citext("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** If this magic-link is for an existing user. */
    userId: uuid("user_id").references(() => clinicUsers.id, {
      onDelete: "set null",
    }),
    /** Intent — 'login' (existing user) or 'invite' (new user) */
    intent: text("intent").notNull().default("login"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestIp: inet("request_ip"),
  },
  (t) => ({
    intentCheck: check(
      "magic_links_intent_check",
      sql`${t.intent} IN ('login','invite')`
    ),
    emailIdx: index("magic_links_email_idx").on(t.email),
  })
);

// ---------------------------------------------------------------
// IMPERSONATION TOKENS — admin "View as user" handoff between hosts.
//
// Issued on admin.localhost by a fully-authenticated admin, consumed once
// on localhost (clinic host) within 60s. Token-only auth on consume since
// the admin session cookie isn't visible across origins.
// ---------------------------------------------------------------
export const impersonationTokens = pgTable(
  "impersonation_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    adminId: uuid("admin_id")
      .notNull()
      .references((): AnyPgColumn => adminUsers.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    issueIp: inet("issue_ip"),
  },
  (t) => ({
    targetIdx: index("impersonation_tokens_target_idx").on(t.targetUserId),
    expiryIdx: index("impersonation_tokens_expiry_idx").on(t.expiresAt),
  })
);

// ---------------------------------------------------------------
// UPGRADE REQUESTS (D6)
// ---------------------------------------------------------------
export const upgradeRequests = pgTable(
  "upgrade_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => clinicUsers.id),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("offen"),
    karamNote: text("karam_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAdminEmail: text("resolved_by_admin_email"),
    userNote: text("user_note"),
  },
  (t) => ({
    statusCheck: check(
      "upgrade_requests_status_check",
      sql`${t.status} IN ('offen','bearbeitet','abgelehnt')`
    ),
  })
);

// ---------------------------------------------------------------
// TREATMENTS (per-clinic treatment categories — Detail mode)
// ---------------------------------------------------------------
export const treatments = pgTable(
  "treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    /** Default recall horizon, e.g. 6 = recall the patient 6 months after wonAt. */
    defaultRecallMonths: integer("default_recall_months"),
    /** Loose freetext keywords (lowercase, comma-separated) used by the keyword classifier. */
    keywords: text("keywords"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqSlug: unique("treatments_slug_unique").on(t.clinicId, t.slug),
    clinicIdx: index("treatments_clinic_idx").on(t.clinicId),
  })
);

// ---------------------------------------------------------------
// LOCATIONS (per-clinic — lifted from clinics.locations jsonb)
// ---------------------------------------------------------------
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    isPrimary: boolean("is_primary").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    clinicIdx: index("locations_clinic_idx").on(t.clinicId),
  })
);

// ---------------------------------------------------------------
// PATIENTS (deduplicated contact aggregation)
// ---------------------------------------------------------------
export const patients = pgTable(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    email: citext("email"),
    phone: text("phone"),
    fullName: text("full_name"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** First-touch source channel of the very first request from this patient. */
    firstTouchSource: text("first_touch_source"),
    lifetimeRevenueEur: numeric("lifetime_revenue_eur", {
      precision: 10,
      scale: 2,
    })
      .notNull()
      .default("0"),
    requestCount: integer("request_count").notNull().default(0),
    wonCount: integer("won_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("patients_clinic_idx").on(t.clinicId),
    ltvIdx: index("patients_ltv_idx").on(t.clinicId, t.lifetimeRevenueEur),
  })
);

// ---------------------------------------------------------------
// REVIEWS (per-clinic snapshots — Detail mode reputation card)
// ---------------------------------------------------------------
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    rating: numeric("rating", { precision: 2, scale: 1 }).notNull(),
    totalCount: integer("total_count").notNull().default(0),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
  },
  (t) => ({
    platformCheck: check(
      "reviews_platform_check",
      sql`${t.platform} IN ('google','jameda','trustpilot','manual')`
    ),
    clinicIdx: index("reviews_clinic_idx").on(t.clinicId, t.recordedAt),
  })
);

// ---------------------------------------------------------------
// REQUEST_RECALLS (recall / followup / review-request scheduling)
// ---------------------------------------------------------------
export const requestRecalls = pgTable(
  "request_recalls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").references((): AnyPgColumn => requests.id, {
      onDelete: "cascade",
    }),
    patientId: uuid("patient_id").references((): AnyPgColumn => patients.id, {
      onDelete: "cascade",
    }),
    scheduledFor: date("scheduled_for").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    note: text("note"),
    createdBy: uuid("created_by").references((): AnyPgColumn => clinicUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindCheck: check(
      "request_recalls_kind_check",
      sql`${t.kind} IN ('recall','followup','review_request')`
    ),
    statusCheck: check(
      "request_recalls_status_check",
      sql`${t.status} IN ('pending','sent','completed','skipped')`
    ),
    clinicIdx: index("request_recalls_clinic_idx").on(
      t.clinicId,
      t.scheduledFor
    ),
  })
);

// ---------------------------------------------------------------
// REQUESTS (Anfragen — SoT, D3)
// ---------------------------------------------------------------
export const requests = pgTable(
  "requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    source: text("source").notNull(),
    sourceCampaignId: text("source_campaign_id"),
    sourceAdId: text("source_ad_id"),
    utm: jsonb("utm"),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    treatmentWish: text("treatment_wish"),
    /** Normalized treatment category (clinic-side categorization). */
    treatmentId: uuid("treatment_id").references(
      (): AnyPgColumn => treatments.id,
      { onDelete: "set null" }
    ),
    /** Linked patient row (deduplicated by email/phone). */
    patientId: uuid("patient_id").references((): AnyPgColumn => patients.id, {
      onDelete: "set null",
    }),
    /** Location the request came in for (multi-location clinics only). */
    locationId: uuid("location_id").references(
      (): AnyPgColumn => locations.id,
      { onDelete: "set null" }
    ),
    budgetIndication: text("budget_indication"),
    message: text("message"),
    aiScore: integer("ai_score"),
    aiCategory: text("ai_category"),
    aiReasoning: text("ai_reasoning"),
    /** Structured signals from the AI scorer (e.g. {budgetMentioned: true, ...}). */
    aiSignals: jsonb("ai_signals"),
    aiPromptVersion: text("ai_prompt_version"),
    status: text("status").notNull().default("neu"),
    assignedTo: uuid("assigned_to").references((): AnyPgColumn => clinicUsers.id),
    convertedRevenueEur: numeric("converted_revenue_eur", {
      precision: 10,
      scale: 2,
    }),
    slaRespondBy: timestamp("sla_respond_by", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    wonAt: timestamp("won_at", { withTimezone: true }),
    dsgvoConsentAt: timestamp("dsgvo_consent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dsgvoConsentIp: inet("dsgvo_consent_ip"),
    rawPayload: jsonb("raw_payload"),
  },
  (t) => ({
    aiScoreCheck: check(
      "requests_ai_score_check",
      sql`${t.aiScore} IS NULL OR (${t.aiScore} BETWEEN 0 AND 100)`
    ),
    aiCategoryCheck: check(
      "requests_ai_category_check",
      sql`${t.aiCategory} IS NULL OR ${t.aiCategory} IN ('hot','warm','cold')`
    ),
    statusCheck: check(
      "requests_status_check",
      sql`${t.status} IN ('neu','qualifiziert','termin_vereinbart','beratung_erschienen','gewonnen','verloren','spam')`
    ),
    clinicIdx: index("requests_clinic_idx").on(t.clinicId),
    statusIdx: index("requests_status_idx").on(t.clinicId, t.status),
    slaIdx: index("requests_sla_idx").on(t.slaRespondBy),
    createdIdx: index("requests_created_idx").on(t.clinicId, t.createdAt),
  })
);

// ---------------------------------------------------------------
// REQUEST ACTIVITIES
// ---------------------------------------------------------------
export const requestActivities = pgTable(
  "request_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references((): AnyPgColumn => clinicUsers.id),
    kind: text("kind").notNull(),
    body: text("body"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    requestIdx: index("request_activities_request_idx").on(t.requestId),
    // Supports the stale-detection subquery in listRequests:
    //   (SELECT max(created_at) FROM request_activities WHERE request_id = ?)
    // Without this composite, the MAX requires a heap scan of all activities
    // for that request. With it, MAX is an index lookup of the last leaf.
    requestCreatedIdx: index("request_activities_request_created_idx").on(
      t.requestId,
      t.createdAt
    ),
    kindCheck: check(
      "request_activities_kind_check",
      sql`${t.kind} IN ('note','call','email','whatsapp','status_change','ai_rescore','assignment')`
    ),
  })
);

// ---------------------------------------------------------------
// ASSETS
// ---------------------------------------------------------------
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    shootDate: date("shoot_date"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    muxPlaybackId: text("mux_playback_id"),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => assets.id),
    tags: text("tags").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindCheck: check(
      "assets_kind_check",
      sql`${t.kind} IN ('video','foto','rohmaterial','behind_scenes')`
    ),
    clinicIdx: index("assets_clinic_idx").on(t.clinicId),
  })
);

// ---------------------------------------------------------------
// ANIMATION LIBRARY (global)
// ---------------------------------------------------------------
export const animationLibrary = pgTable("animation_library", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  treatmentTag: text("treatment_tag"),
  description: text("description"),
  storageKeyMaster: text("storage_key_master").notNull(),
  previewPosterKey: text("preview_poster_key"),
  durationS: integer("duration_s"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const animationInstances = pgTable(
  "animation_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    libraryId: uuid("library_id")
      .notNull()
      .references(() => animationLibrary.id),
    storageKeyCustomized: text("storage_key_customized"),
    status: text("status").notNull().default("standard"),
    requestedBy: uuid("requested_by").references(
      (): AnyPgColumn => clinicUsers.id
    ),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    requestNote: text("request_note"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "animation_instances_status_check",
      sql`${t.status} IN ('standard','requested','in_production','ready')`
    ),
    uniqPerClinic: unique("animation_instances_clinic_library_unique").on(
      t.clinicId,
      t.libraryId
    ),
  })
);

// ---------------------------------------------------------------
// DOCUMENTS
// ---------------------------------------------------------------
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    storageKey: text("storage_key").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    version: integer("version").notNull().default(1),
    visibleToRoles: text("visible_to_roles")
      .array()
      .notNull()
      .default(sql`ARRAY['inhaber','marketing']::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    kindCheck: check(
      "documents_kind_check",
      sql`${t.kind} IN ('vertrag','avv','auswertung_monatlich','vertriebsleitfaden','hwg_pruefung','sonstiges')`
    ),
    clinicIdx: index("documents_clinic_idx").on(t.clinicId),
  })
);

// ---------------------------------------------------------------
// CAMPAIGN SNAPSHOTS + KPI DAILY
// ---------------------------------------------------------------
export const campaignSnapshots = pgTable(
  "campaign_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    snapshotDate: date("snapshot_date").notNull(),
    platform: text("platform").notNull(),
    spendEur: numeric("spend_eur", { precision: 10, scale: 2 }),
    impressions: bigint("impressions", { mode: "number" }),
    clicks: bigint("clicks", { mode: "number" }),
    leads: integer("leads"),
    cplEur: numeric("cpl_eur", { precision: 10, scale: 2 }),
    ctr: numeric("ctr", { precision: 5, scale: 4 }),
    rawPayload: jsonb("raw_payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("campaign_snapshots_unique").on(
      t.clinicId,
      t.snapshotDate,
      t.platform
    ),
    platformCheck: check(
      "campaign_snapshots_platform_check",
      sql`${t.platform} IN ('meta','google','csv')`
    ),
  })
);

export const kpiDaily = pgTable(
  "kpi_daily",
  {
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    date: date("date").notNull(),
    qualifiedLeads: integer("qualified_leads"),
    costPerQualifiedLead: numeric("cost_per_qualified_lead", {
      precision: 10,
      scale: 2,
    }),
    appointments: integer("appointments"),
    consultationsHeld: integer("consultations_held"),
    casesWon: integer("cases_won"),
    noShowRate: numeric("no_show_rate", { precision: 5, scale: 4 }),
    totalSpendEur: numeric("total_spend_eur", { precision: 10, scale: 2 }),
    revenueAttributedEur: numeric("revenue_attributed_eur", {
      precision: 10,
      scale: 2,
    }),
    roas: numeric("roas", { precision: 6, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.clinicId, t.date] }),
  })
);

// ---------------------------------------------------------------
// GOALS
// ---------------------------------------------------------------
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    metric: text("metric").notNull(),
    targetValue: numeric("target_value", { precision: 10, scale: 2 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    createdBy: uuid("created_by").references((): AnyPgColumn => clinicUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    metricCheck: check(
      "goals_metric_check",
      sql`${t.metric} IN ('qualified_leads','revenue','cases_won','appointments','spend')`
    ),
    clinicIdx: index("goals_clinic_idx").on(t.clinicId, t.periodStart),
  })
);

// ---------------------------------------------------------------
// AUDIT LOG (D5 + DSGVO)
// ---------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id"),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    entityKind: text("entity_kind"),
    entityId: uuid("entity_id"),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    diff: jsonb("diff"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("audit_log_clinic_idx").on(t.clinicId, t.createdAt),
    actionIdx: index("audit_log_action_idx").on(t.action),
  })
);

// ---------------------------------------------------------------
// PLATFORM CREDENTIALS (D2)
// ---------------------------------------------------------------
export const platformCredentials = pgTable(
  "platform_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id),
    platform: text("platform").notNull(),
    accessTokenEnc: bytea("access_token_enc").notNull(),
    refreshTokenEnc: bytea("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    accountId: text("account_id"),
    scopes: text("scopes").array(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("platform_credentials_unique").on(t.clinicId, t.platform),
    platformCheck: check(
      "platform_credentials_platform_check",
      sql`${t.platform} IN ('meta','google')`
    ),
  })
);

// ---------------------------------------------------------------
// NOTIFICATIONS
// ---------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId, t.createdAt),
  })
);

// ---------------------------------------------------------------
// HWG CHECKS (plan §17 risk register — audit trail)
// ---------------------------------------------------------------
export const hwgChecks = pgTable("hwg_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  clinicId: uuid("clinic_id")
    .notNull()
    .references(() => clinics.id),
  actorId: uuid("actor_id").references((): AnyPgColumn => clinicUsers.id),
  input: text("input").notNull(),
  verdict: text("verdict").notNull(), // 'clean' | 'warn' | 'violation'
  findings: jsonb("findings"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------
// Admin users — Karam's super-admin identity (NOT a clinic_user).
// Access governed by ADMIN_EMAILS env + optional IP allowlist.
// ---------------------------------------------------------------
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  fullName: text("full_name"),
  mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
  mfaSecretEnc: bytea("mfa_secret_enc"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    adminIdx: index("admin_sessions_admin_idx").on(t.adminId),
  })
);
