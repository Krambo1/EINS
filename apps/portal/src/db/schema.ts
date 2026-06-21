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
  varchar,
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
  uniqueIndex,
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
export const clinics = pgTable("clinics", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Praxis billing currency, the display currency for all of this clinic's
   *  revenue. lifetime_revenue_eur / converted_revenue_eur hold values in THIS
   *  currency; the _eur suffix is a legacy name, not an EUR assertion. EUR
   *  default; set to CHF when onboarding a Swiss Praxis. CHECK in migration
   *  0057. Phase 11. */
  currency: text("currency").notNull().default("EUR"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  defaultDoctorEmail: text("default_doctor_email"),
  billingAddress: jsonb("billing_address"),
  hwgContactName: text("hwg_contact_name"),
  hwgContactEmail: text("hwg_contact_email"),
  locations: jsonb("locations").default(sql`'[]'::jsonb`),
  // --- EINS Bewertungen (post-visit review request engine) ---
  /** Public review URL for Google (or Google Business Profile place form). */
  googleReviewUrl: text("google_review_url"),
  /** Public review URL for Jameda. */
  jamedaReviewUrl: text("jameda_review_url"),
  /** Google Place ID — fed to Places API (New) for live rating + count sync. */
  googlePlaceId: text("google_place_id"),
  /** Public Jameda profile URL — HTML scraped (no public API exists). */
  jamedaProfileUrl: text("jameda_profile_url"),
  /** Days after `appointment_completed` before sending the review email. */
  reviewRequestDelayDays: integer("review_request_delay_days")
    .notNull()
    .default(3),
  /** Master switch: when false, /api/patients/events refuses to schedule sends. */
  reviewRequestEnabled: boolean("review_request_enabled")
    .notNull()
    .default(false),
  /**
   * Per-Praxis HWG attestation: the owner confirms they inform patients at
   * intake that a post-visit review email may follow (§7 UWG Abs. 3 Nr. 4,
   * see apps/portal/docs/eins-bewertungen.md). The PVS stream carries no per-event
   * consent (events are pseudonymized), so the pvs-status-derive worker only
   * schedules a review when this is true. Default false (migration 0058).
   */
  reviewConsentAttested: boolean("review_consent_attested")
    .notNull()
    .default(false),
  /** Origin used to render rating-token links in patient emails (`https://praxis-X.de`). */
  reviewLandingOrigin: text("review_landing_origin"),
  /** Sender address for review emails; falls back to global EMAIL_FROM. */
  reviewEmailFrom: text("review_email_from"),
  /** Mailbox that receives private-feedback alerts. Falls back to defaultDoctorEmail. */
  reviewInboxEmail: text("review_inbox_email"),
  // --- Ads conversion config (0036) ---
  /**
   * Meta Pixel id (numeric, ~15 digits). When set + a `META_CAPI_TOKEN_<SLUG>`
   * env var is present, the capi-purchase worker fires Purchase events on
   * InvoicePaid. Null disables Meta side.
   */
  metaPixelId: text("meta_pixel_id"),
  /**
   * Google Ads customer id. Accepts digits-only or dash-formatted
   * (e.g. `123-456-7890`); normalised to digits before the API call.
   * Null disables the Google side.
   */
  googleAdsCustomerId: text("google_ads_customer_id"),
  /**
   * Google Ads conversion-action resource name for the praxis's "Purchase"
   * action (e.g. `customers/1234567890/conversionActions/9876543210`).
   * Created once in Google Ads, then pasted here.
   */
  googleAdsConversionAction: text("google_ads_conversion_action"),
  /**
   * Optional per-praxis override for the MCC manager customer id used in
   * the `login-customer-id` header. Defaults to the global
   * `GOOGLE_ADS_LOGIN_CUSTOMER_ID` env var when null.
   */
  googleAdsLoginCustomerId: text("google_ads_login_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

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
    /** Storage adapter key, e.g. `avatars/<userId>.webp`. Resolve via
     *  `avatarUrlForKey()` to get a browser-fetchable URL. */
    avatarKey: varchar("avatar_key", { length: 500 }),
    /** Bumped on every avatar upload — drives the `?v=` cache-buster. */
    avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
    role: text("role").notNull(),
    /** Argon2id password hash. NULL = noch kein Passwort gesetzt
     *  (Backfill-Pfad: erster Login-Versuch löst Set-Password-Mail aus). */
    passwordHash: text("password_hash"),
    passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitationTokenHash: text("invitation_token_hash"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    /** Set when this user finished the interactive portal tour ("Fertig"). */
    onboardingTourCompletedAt: timestamp("onboarding_tour_completed_at", {
      withTimezone: true,
    }),
    /** Set when this user resolved the one-time tour prompt without finishing
     *  (clicked "Später", or started it from the prompt). Both this and
     *  completedAt being NULL is what makes the first-login prompt auto-show. */
    onboardingTourDismissedAt: timestamp("onboarding_tour_dismissed_at", {
      withTimezone: true,
    }),
    /** Set when the user closes (X) the small "Portal-Rundgang" card that the
     *  left nav shows after the tour prompt was skipped / the tour abandoned.
     *  Once set the nav card never re-appears; the tour stays re-launchable
     *  from Einstellungen. */
    onboardingTourNavCardDismissedAt: timestamp(
      "onboarding_tour_nav_card_dismissed_at",
      { withTimezone: true }
    ),
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
// TREATMENTS (per-clinic treatment categories)
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
    /** Latitude in WGS84 degrees, geocoded lazily by the AI-score worker. */
    lat: numeric("lat", { precision: 9, scale: 6 }),
    /** Longitude in WGS84 degrees, geocoded lazily by the AI-score worker. */
    lng: numeric("lng", { precision: 9, scale: 6 }),
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
// GEOCODE_CACHE — shared lookup of city/address → lat/lng via Nominatim.
// Not tenant-scoped: city geometry is public, not PII.
// ---------------------------------------------------------------
export const geocodeCache = pgTable(
  "geocode_cache",
  {
    normalizedQuery: text("normalized_query").primaryKey(),
    /** Null = negative result (Nominatim returned no match). */
    lat: numeric("lat", { precision: 9, scale: 6 }),
    lng: numeric("lng", { precision: 9, scale: 6 }),
    /** Full Nominatim response, kept for audit / debugging. */
    raw: jsonb("raw"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresIdx: index("geocode_cache_expires_idx").on(t.expiresAt),
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
    /** External PMS patient ID, used for dedup in /api/patients/events. */
    externalId: text("external_id"),
    /** Set when patient unsubscribes from review emails (Art. 21 DSGVO + §7 UWG). */
    reviewEmailUnsubscribedAt: timestamp("review_email_unsubscribed_at", {
      withTimezone: true,
    }),
    // --- PVS Bridge (0026_patients_pvs_columns.sql) ---
    /** Date of birth, denormalized from PVS for Stage-3 fuzzy linking + UI display. */
    dob: date("dob"),
    /** Gender code matching PVS conventions: f|m|d|x. */
    gender: text("gender"),
    /**
     * Denormalized "primary" PVS patient id (most-recent, highest-confidence
     * link). The full set of PVS ids that map to this portal patient lives in
     * pvs_patient_map — a portal patient can absorb multiple PVS records
     * after merges.
     */
    pvsPatientId: text("pvs_patient_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicIdx: index("patients_clinic_idx").on(t.clinicId),
    ltvIdx: index("patients_ltv_idx").on(t.clinicId, t.lifetimeRevenueEur),
    externalIdx: index("patients_external_idx").on(t.clinicId, t.externalId),
    emailIdx: index("patients_email_idx").on(t.clinicId, t.email),
    genderCheck: check(
      "patients_gender_check",
      sql`${t.gender} IS NULL OR ${t.gender} IN ('f','m','d','x')`
    ),
  })
);

// ---------------------------------------------------------------
// REVIEWS (per-clinic snapshots — reputation card)
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
      sql`${t.platform} IN ('google','jameda','manual')`
    ),
    clinicIdx: index("reviews_clinic_idx").on(t.clinicId, t.recordedAt),
  })
);

// ---------------------------------------------------------------
// REVIEW_EMAIL_SCHEDULE — Bewertungsanfrage-Email-Versand-Plan.
// One row per scheduled review-request email, tracking the per-token
// lifecycle: scheduled → sent → rating clicked → public CTA → private
// feedback. The `kind` column survives as a single-value constraint
// (`'review_request'`) so historical queries still parse; it has no
// other valid value. Recalls / Wiedervorlage live in the PVS, never
// here.
// ---------------------------------------------------------------
export const reviewEmailSchedule = pgTable(
  "review_email_schedule",
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
    // --- EINS Bewertungen (kind = 'review_request') ---
    /** Random 32-byte opaque token; embedded in the patient email URL. */
    reviewToken: text("review_token").unique(),
    /**
     * Hard expiry for the review_token. Set to `createdAt + 90 days` on
     * issue (migration 0035 backfilled this for legacy rows). Past this
     * timestamp resolveReviewToken returns null, all token endpoints 404,
     * and the row stays as a historical record.
     */
    reviewTokenExpiresAt: timestamp("review_token_expires_at", {
      withTimezone: true,
    }),
    /** Optional override email captured at intake time (patient mail). */
    reviewEmail: text("review_email"),
    /** Optional override name for greeting in the email. */
    reviewPatientName: text("review_patient_name"),
    /** Treatment label captured at intake (e.g. "Hyaluron-Auffrischung"). */
    reviewTreatmentLabel: text("review_treatment_label"),
    /** Set when the email-send job is enqueued. */
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Set when patient first hits the rating landing page. */
    ratingClickedAt: timestamp("rating_clicked_at", { withTimezone: true }),
    /** First-click rating value 1..5. Never overwritten. */
    ratingValue: integer("rating_value"),
    /** Set when patient follows the public Google/Jameda link. */
    publicClickedAt: timestamp("public_clicked_at", { withTimezone: true }),
    /** Platform clicked on the public CTA: 'google' | 'jameda'. */
    publicClickedPlatform: text("public_clicked_platform"),
    /** Set when patient submits the private feedback form. */
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    // --- PVS-bridge-driven scheduling (0058) ---
    /**
     * The PVS appointment whose EncounterCompleted scheduled this row. May be
     * NULL for legacy rows predating the PVS bridge. Doubles as the idempotency
     * key: a re-derived encounter never schedules a second email (uniqueAppt
     * below + a pre-check in scheduleReviewRequest).
     */
    pvsAppointmentId: text("pvs_appointment_id"),
    /** The PVS encounter id behind this row; provenance only. NULL for webhook rows. */
    pvsEncounterId: text("pvs_encounter_id"),
  },
  (t) => ({
    kindCheck: check(
      "review_email_schedule_kind_check",
      sql`${t.kind} = 'review_request'`
    ),
    statusCheck: check(
      "review_email_schedule_status_check",
      sql`${t.status} IN ('pending','sent','completed','skipped')`
    ),
    ratingValueCheck: check(
      "review_email_schedule_rating_value_check",
      sql`${t.ratingValue} IS NULL OR (${t.ratingValue} BETWEEN 1 AND 5)`
    ),
    publicPlatformCheck: check(
      "review_email_schedule_public_platform_check",
      sql`${t.publicClickedPlatform} IS NULL OR ${t.publicClickedPlatform} IN ('google','jameda')`
    ),
    clinicIdx: index("review_email_schedule_clinic_idx").on(
      t.clinicId,
      t.scheduledFor
    ),
    // Drives the cron scanner WHERE kind='review_request' AND status='pending' AND scheduledFor <= today.
    dueIdx: index("review_email_schedule_due_idx").on(
      t.kind,
      t.status,
      t.scheduledFor
    ),
    // 0058: at most one review per (clinic, PVS appointment). Webhook + legacy
    // rows have pvs_appointment_id = NULL and are exempt (Postgres NULL-distinct).
    uniqueAppt: uniqueIndex("review_email_schedule_pvs_appt_uidx").on(
      t.clinicId,
      t.pvsAppointmentId
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
    /**
     * Timestamp the request first transitioned out of `neu` (= MFA-Kontakt
     * passierte, weil eine Buchung/Behandlung/no_show das logisch impliziert).
     * Geschrieben von `pvs-status-derive.applyToRequest` beim ersten
     * neu → * Move; einmalig gesetzt, danach nie überschrieben. Quelle für
     * die Reaktionsmedian-KPI in `lifecycle.ts` und den SLA-Off-Switch in
     * `sla-check.ts`.
     *
     * Spalten-Name aus historischen Gründen "first_contacted_at"; semantisch
     * heute "first_actioned_at" (Option 1b, Mai 2026).
     */
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    /**
     * Timestamp the first time any clinic user opened the request detail
     * page. Distinct from `firstContactedAt` — this is purely an "unread"
     * tracker that drives the sidebar Anfragen badge. Set once, never updated.
     */
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    wonAt: timestamp("won_at", { withTimezone: true }),
    dsgvoConsentAt: timestamp("dsgvo_consent_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dsgvoConsentIp: inet("dsgvo_consent_ip"),
    rawPayload: jsonb("raw_payload"),
    // --- PVS Bridge (0027_request_pvs_columns.sql) ---
    /** Foreign key into the PVS calendar — used to dedupe AppointmentCreated
     *  events and to link multiple events (status change, no-show, completion)
     *  back to the same row. */
    pvsAppointmentId: text("pvs_appointment_id"),
    /** Foreign key into the PVS encounter/case — used to attach invoices. */
    pvsEncounterId: text("pvs_encounter_id"),
    /** PVS-derived scheduled appointment time. */
    appointmentAt: timestamp("appointment_at", { withTimezone: true }),
    /** Set the first time a PVS AppointmentStatusChanged → no_show event arrives. */
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    /** Set when EncounterCompleted (or CSV "treatment completed") arrives. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * Which subsystem last set `status`. Drives the "PVS gewinnt immer" rule
     * in the pvs-status-derive worker: PVS events overwrite manual edits
     * unconditionally for rows linked to a PVS appointment, and the UI shows
     * a `Quelle: PVS` readonly badge to signal the override.
     */
    statusSource: text("status_source").notNull().default("manual"),
    /**
     * Meta's canonical leadgen id for source='meta' rows. Populated by the
     * /api/webhooks/meta/leadgen route after retrieving field_data from
     * Graph API. Unique-per-clinic (partial index in migration 0033) so
     * Meta's aggressive retries dedupe at the database.
     */
    metaLeadId: text("meta_lead_id"),
    /**
     * Opaque client-supplied key from the `Idempotency-Key` header on
     * /api/leads/intake. Unique-per-clinic (partial index in migration
     * 0034) so a flaky network double-submit collapses into one row.
     */
    intakeIdempotencyKey: text("intake_idempotency_key"),
    // --- Closed-loop ads attribution (0036) ---
    /** Meta click id from the URL (`fbclid=…`). 90-day shelf life. */
    fbclid: text("fbclid"),
    /** Google click id from the URL (`gclid=…`). 90-day shelf life. */
    gclid: text("gclid"),
    /** Google iOS-14-era web-conversion fallback id. */
    wbraid: text("wbraid"),
    /** Google iOS-14-era app-conversion fallback id. */
    gbraid: text("gbraid"),
    /** Meta browser-set click id (`_fbc` cookie). */
    fbc: text("fbc"),
    /** Meta browser fingerprint (`_fbp` cookie). */
    fbp: text("fbp"),
    /** User-agent captured at lead intake, forwarded to CAPI user_data. */
    clickUserAgent: text("click_user_agent"),
    /**
     * Anonymised client IP (last octet zeroed for IPv4 / last 4 hextets for
     * IPv6). DSGVO-compliant geo signal for CAPI; never the raw IP.
     */
    clickIpAnon: text("click_ip_anon"),
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
      sql`${t.status} IN ('neu','kontaktiert','nicht_erreicht','termin_vereinbart','beratung_erschienen','no_show','behandelt','gewonnen','verloren','spam')`
    ),
    statusSourceCheck: check(
      "requests_status_source_check",
      sql`${t.statusSource} IN ('manual','pvs','csv')`
    ),
    clinicIdx: index("requests_clinic_idx").on(t.clinicId),
    statusIdx: index("requests_status_idx").on(t.clinicId, t.status),
    slaIdx: index("requests_sla_idx").on(t.slaRespondBy),
    createdIdx: index("requests_created_idx").on(t.clinicId, t.createdAt),
    pvsApptIdx: index("requests_pvs_appointment_idx").on(
      t.clinicId,
      t.pvsAppointmentId
    ),
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
// REQUEST FOLLOWUPS (Wiedervorlage) — portal-native, pre-booking phase only.
// Multiple scheduled callbacks per lead + history. See migration 0052 and
// anfragen/[id]/actions.ts for the PVS boundary rationale.
// ---------------------------------------------------------------
export const requestFollowups = pgTable(
  "request_followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    note: text("note"),
    status: text("status").notNull().default("pending"),
    createdBy: uuid("created_by").references((): AnyPgColumn => clinicUsers.id),
    completedBy: uuid("completed_by").references(
      (): AnyPgColumn => clinicUsers.id
    ),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "request_followups_status_check",
      sql`${t.status} IN ('pending','done','cancelled')`
    ),
    dueIdx: index("request_followups_due_idx").on(
      t.clinicId,
      t.status,
      t.dueAt
    ),
    requestIdx: index("request_followups_request_idx").on(
      t.requestId,
      t.createdAt
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
    leads: integer("leads"),
    costPerLead: numeric("cost_per_lead", {
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
      sql`${t.metric} IN ('leads','revenue','cases_won','appointments','spend','total_requests')`
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
    /**
     * Meta-only: the Facebook Page that owns the lead forms producing
     * leadgen webhook events. Indexed for the O(1) webhook lookup. Migration
     * 0033 backfills NULL for existing rows — those clinics must reconnect
     * (or hit the "Discover Page" admin action) to receive webhooks.
     */
    metaPageId: text("meta_page_id"),
    /** Meta-only: page-scoped access token used to call /<leadgen_id>. */
    metaPageAccessTokenEnc: bytea("meta_page_access_token_enc"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("platform_credentials_unique").on(t.clinicId, t.platform),
    platformCheck: check(
      "platform_credentials_platform_check",
      sql`${t.platform} IN ('meta','google','intake','pvs')`
    ),
  })
);

// ---------------------------------------------------------------
// ADS CONVERSION OUTBOX (0036)
// One row per (request, InvoicePaid event, channel) — the audit trail
// for closed-loop revenue attribution to Meta CAPI + Google Ads OCI.
// ---------------------------------------------------------------
export const adsConversionOutbox = pgTable(
  "ads_conversion_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id, { onDelete: "cascade" }),
    /**
     * The pvs_event_log row id of the InvoicePaid event that triggered
     * this row. The (clinic_id, channel, pvs_event_log_id) UNIQUE
     * constraint makes pvs-status-derive replays naturally idempotent.
     */
    pvsEventLogId: uuid("pvs_event_log_id").notNull(),
    channel: text("channel").notNull(),
    eventName: text("event_name").notNull(),
    valueEur: numeric("value_eur", { precision: 10, scale: 2 }).notNull(),
    /** Currency of value_eur (legacy name): EUR default, CHF for a Swiss
     *  Praxis. Captured from the invoice event and sent verbatim to Meta CAPI /
     *  Google OCI. CHECK in migration 0057. Phase 11. */
    currency: text("currency").notNull().default("EUR"),
    /** PVS `paidAt` timestamp; sent to platforms as the conversion time. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /**
     * `pending` → queued, worker hasn't run; `sent` → 2xx from platform;
     * `skipped` → preconditions not met (no click id / missing config),
     * never enqueued; `failed` → retries exhausted, response_body holds
     * the last error.
     */
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    responseCode: integer("response_code"),
    responseBody: jsonb("response_body"),
    /** Wire-level dedup key sent to the platform (Meta event_id / Google order_id). */
    dedupKey: text("dedup_key").notNull(),
    /** Hashed user_data sent on the wire; persisted for DSGVO + support. */
    userDataSnapshot: jsonb("user_data_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("ads_conversion_outbox_unique").on(
      t.clinicId,
      t.channel,
      t.pvsEventLogId
    ),
    statusIdx: index("ads_conversion_outbox_status_idx").on(
      t.clinicId,
      t.status,
      t.createdAt
    ),
    requestIdx: index("ads_conversion_outbox_request_idx").on(t.requestId),
    channelCheck: check(
      "ads_conversion_outbox_channel_check",
      sql`${t.channel} IN ('meta','google')`
    ),
    statusCheck: check(
      "ads_conversion_outbox_status_check",
      sql`${t.status} IN ('pending','sent','skipped','failed')`
    ),
    eventNameCheck: check(
      "ads_conversion_outbox_event_name_check",
      sql`${t.eventName} IN ('Purchase')`
    ),
  })
);

// ---------------------------------------------------------------
// PVS BRIDGE — re-export schema-pvs.ts so `db.schema.pvsLink` etc. resolve
// without having to import schema-pvs.ts directly at every call site.
// ---------------------------------------------------------------
export {
  pvsLink,
  pvsLinkSource,
  pvsEventLog,
  pvsPatientMap,
  pvsTreatmentMapping,
  pvsLocationMapping,
  pvsSyncStatus,
  linkingFailures,
  pvsCsvUploads,
  pvsAgentEnrollmentTokens,
  pvsLinkHealth,
  pvsLinkAudit,
  pvsReconcileAudit,
  pvsAgentStatus,
  pvsAgentFailureSummary,
} from "./schema-pvs";

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
// DASHBOARD ALERTS (anomaly-scan worker → "Auffälligkeiten" widget)
// ---------------------------------------------------------------
export const dashboardAlerts = pgTable(
  "dashboard_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Rule-provided default action steps. Empty = no action needed. */
    actionSteps: jsonb("action_steps").notNull().default(sql`'[]'::jsonb`),
    /** Optional LLM-added steps. NULL = enrichment did not run. */
    aiActionSteps: text("ai_action_steps").array(),
    metric: text("metric"),
    baselineValue: numeric("baseline_value", { precision: 14, scale: 4 }),
    observedValue: numeric("observed_value", { precision: 14, scale: 4 }),
    dedupeKey: text("dedupe_key").notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    dedupeUnique: unique("dashboard_alerts_dedupe_unique").on(
      t.clinicId,
      t.dedupeKey
    ),
    severityCheck: check(
      "dashboard_alerts_severity_check",
      sql`${t.severity} IN ('info','warn','high','extreme')`
    ),
    activeIdx: index("dashboard_alerts_active_idx").on(
      t.clinicId,
      t.createdAt
    ),
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
// FEEDBACK (clinic-user feedback inbox — UI/feature/bug/praise)
// ---------------------------------------------------------------
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => clinicUsers.id),
    category: text("category").notNull(),
    message: text("message").notNull(),
    pageUrl: text("page_url"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("offen"),
    karamNote: text("karam_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByAdminEmail: text("resolved_by_admin_email"),
  },
  (t) => ({
    clinicIdx: index("feedback_clinic_idx").on(t.clinicId, t.submittedAt),
    statusIdx: index("feedback_status_idx").on(t.status, t.submittedAt),
    categoryCheck: check(
      "feedback_category_check",
      sql`${t.category} IN ('verbesserung','fehler','lob','frage','sonstiges')`
    ),
    statusCheck: check(
      "feedback_status_check",
      sql`${t.status} IN ('offen','gesehen','bearbeitet','verworfen')`
    ),
  })
);

// ---------------------------------------------------------------
// CLINIC TIMELINE ENTRIES — clinic-facing "Fortschritt" feed.
// Admin-authored milestones (campaigns, deliveries, onboarding steps).
// Read-only for clinic users; visible to all clinic roles.
// ---------------------------------------------------------------
export const clinicTimelineEntries = pgTable(
  "clinic_timeline_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    // Nullable since 0063: relative-phase default-journey steps carry a
    // phase_label ("Woche 1 bis 2") instead of a concrete date. Dated,
    // admin-authored entries still set this.
    eventDate: timestamp("event_date", { withTimezone: true }),
    // Relative-phase label for date-less steps. Null on dated entries.
    phaseLabel: text("phase_label"),
    // Forward ordering for date-less journeys; 0 on legacy/dated entries.
    sortOrder: integer("sort_order").notNull().default(0),
    status: text("status").notNull().default("geplant"),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "clinic_timeline_status_check",
      sql`${t.status} IN ('geplant','laeuft','abgeschlossen')`
    ),
    byClinicDate: index("clinic_timeline_clinic_date_idx").on(
      t.clinicId,
      t.eventDate.desc()
    ),
    byClinicSort: index("clinic_timeline_clinic_sort_idx").on(
      t.clinicId,
      t.sortOrder
    ),
  })
);

// ---------------------------------------------------------------
// TIMELINE DEFAULT STEPS — central, admin-editable template for the
// default Fortschritt-Journey. Copied into clinic_timeline_entries when a
// clinic is onboarded (auto on creation / admin "Standard-Journey einsetzen").
// Global EINS content, NOT tenant-scoped and NOT exposed to eins_app: only
// admin code on the superuser `db` connection touches it (see migration 0063).
// ---------------------------------------------------------------
export const timelineDefaultSteps = pgTable(
  "timeline_default_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sortOrder: integer("sort_order").notNull(),
    phaseLabel: text("phase_label"),
    title: text("title").notNull(),
    description: text("description"),
    defaultStatus: text("default_status").notNull().default("geplant"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusCheck: check(
      "timeline_default_steps_status_check",
      sql`${t.defaultStatus} IN ('geplant','laeuft','abgeschlossen')`
    ),
    bySort: index("timeline_default_steps_sort_idx").on(t.sortOrder),
  })
);

// ---------------------------------------------------------------
// LEITFADEN QUIZ ATTEMPTS — per-user proof of "Schulungs-Modul"
// (EINS-Garantie Mitwirkungspflicht). Each row is one submission;
// `passed` rows count towards the per-user pass state used to drive
// the sidebar badge and the /leitfaden CTA.
// ---------------------------------------------------------------
export const leitfadenQuizAttempts = pgTable(
  "leitfaden_quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    total: integer("total").notNull(),
    passed: boolean("passed").notNull(),
    questionsVersion: integer("questions_version").notNull().default(1),
    answers: jsonb("answers").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    scoreCheck: check(
      "leitfaden_quiz_score_check",
      sql`${t.score} >= 0 AND ${t.score} <= ${t.total}`
    ),
    userPassedIdx: index("leitfaden_quiz_user_passed_idx").on(t.userId),
    clinicCreatedIdx: index("leitfaden_quiz_clinic_created_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
  })
);

// ---------------------------------------------------------------
// Admin users — Karam's super-admin identity (NOT a clinic_user).
// Access governed by ADMIN_EMAILS env + optional IP allowlist.
// ---------------------------------------------------------------
export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: citext("email").notNull().unique(),
  fullName: text("full_name"),
  /** Argon2id password hash. NULL bis Karam ein Passwort gesetzt hat. */
  passwordHash: text("password_hash"),
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
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

// ---------------------------------------------------------------
// EINS Bewertungen — private patient feedback inbox.
//
// Distinct from `reviews` (aggregate platform snapshots). One row per
// patient submission triggered from the rating landing's private form.
// Visible inside the portal as a triage queue at /bewertungen/feedback.
// ---------------------------------------------------------------
export const patientFeedback = pgTable(
  "patient_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").references((): AnyPgColumn => patients.id, {
      onDelete: "set null",
    }),
    reviewRequestId: uuid("review_request_id").references(
      (): AnyPgColumn => reviewEmailSchedule.id,
      { onDelete: "set null" }
    ),
    /** Patient's rating at submit time (1..5). */
    rating: integer("rating").notNull(),
    /** Free-text feedback in patient's words. */
    freeText: text("free_text"),
    /** Patient agreed the Praxis may contact them about this feedback. */
    contactBackOk: boolean("contact_back_ok").notNull().default(false),
    /** Snapshot of contact for the Praxis to act on, even if patient unsubscribes later. */
    contactEmail: text("contact_email"),
    contactName: text("contact_name"),
    /** Triage state. */
    status: text("status").notNull().default("neu"),
    /** Internal note written by clinic user. */
    internalNote: text("internal_note"),
    /**
     * Where the row came from:
     *   • 'private'         — patient submitted the private feedback form.
     *   • 'public_redirect' — patient was redirected to Google/Jameda via the
     *                         public CTA; row is a "they engaged externally"
     *                         marker, with no free text or contact consent.
     */
    source: text("source").notNull().default("private"),
    /** For source='public_redirect': which platform they were sent to. */
    publicPlatform: text("public_platform"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(
      (): AnyPgColumn => clinicUsers.id
    ),
  },
  (t) => ({
    ratingCheck: check(
      "patient_feedback_rating_check",
      sql`${t.rating} BETWEEN 1 AND 5`
    ),
    statusCheck: check(
      "patient_feedback_status_check",
      sql`${t.status} IN ('neu','gesehen','beantwortet','geschlossen')`
    ),
    sourceCheck: check(
      "patient_feedback_source_check",
      sql`${t.source} IN ('private','public_redirect')`
    ),
    publicPlatformCheck: check(
      "patient_feedback_public_platform_check",
      sql`${t.publicPlatform} IS NULL OR ${t.publicPlatform} IN ('google','jameda')`
    ),
    clinicIdx: index("patient_feedback_clinic_idx").on(
      t.clinicId,
      t.createdAt.desc()
    ),
    statusIdx: index("patient_feedback_status_idx").on(
      t.clinicId,
      t.status,
      t.createdAt.desc()
    ),
  })
);

// ---------------------------------------------------------------
// EMAIL_SUPPRESSION — global do-not-send list per clinic.
//
// Populated by /r/unsubscribe links and by Resend bounce/complaint
// webhooks (future). The review-request scanner skips any patient
// whose email matches an active suppression.
// ---------------------------------------------------------------
export const emailSuppression = pgTable(
  "email_suppression",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    /** Why this address is suppressed. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("email_suppression_unique").on(t.clinicId, t.email),
    reasonCheck: check(
      "email_suppression_reason_check",
      sql`${t.reason} IN ('unsubscribed','bounced','complained','manual')`
    ),
    clinicIdx: index("email_suppression_clinic_idx").on(t.clinicId, t.email),
  })
);

// ---------------------------------------------------------------
// FORECAST SNAPSHOTS — nightly precomputed 90-day cashflow forecast
// per praxis. See migration 0037 for column rationale and src/server/
// forecast/engine.ts for the shape of `weeklyBuckets` / `topKpis`.
// ---------------------------------------------------------------
export const forecastSnapshots = pgTable(
  "forecast_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    snapshotDate: date("snapshot_date").notNull(),
    horizonDays: integer("horizon_days").notNull().default(90),
    /** Engine output: array of weekly bucket objects with p10/p50/p90 for
     *  both booked + paid series. */
    weeklyBuckets: jsonb("weekly_buckets").notNull(),
    /** Top-line KPIs surfaced above the chart (pipelineValue + 30/60/90 cash). */
    topKpis: jsonb("top_kpis").notNull(),
    /** Total won deals at snapshot time. <30 means the UI gates the chart. */
    sampleSizeWon: integer("sample_size_won").notNull(),
    /** Open requests included in the forecast. */
    openRequestCount: integer("open_request_count").notNull().default(0),
    /** Open requests excluded due to treatment-level cold-start (zero won-history). */
    excludedRequestCount: integer("excluded_request_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniq: unique("forecast_snapshots_clinic_date_unique").on(
      t.clinicId,
      t.snapshotDate
    ),
    latestIdx: index("forecast_snapshots_latest_idx").on(
      t.clinicId,
      t.snapshotDate.desc()
    ),
    horizonCheck: check(
      "forecast_snapshots_horizon_check",
      sql`${t.horizonDays} BETWEEN 7 AND 365`
    ),
    sampleCheck: check(
      "forecast_snapshots_sample_check",
      sql`${t.sampleSizeWon} >= 0`
    ),
  })
);

// ---------------------------------------------------------------
// USER NAV SECTION VIEWS — per-user "last seen" timestamps for sidebar
// sections that surface a "Neu" pill (Fortschritt, Medien, Dokumente, …).
// Badge logic compares MAX(content.created_at) against this row; the row
// is upserted to now() when the user opens that section's page.
// ---------------------------------------------------------------
export const userNavSectionViews = pgTable(
  "user_nav_section_views",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => clinicUsers.id, { onDelete: "cascade" }),
    /** Stable key for the section, e.g. "fortschritt", "medien", "dokumente". */
    section: text("section").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.section] }),
  })
);

// ---------------------------------------------------------------
// DISCOVERY-FRAGEBOGEN — Kunden-Onboarding Teil 1 (Vorab-Formular).
// One row per clinic; `answers` is a jsonb map keyed by question id
// ("A1", "C1", ...). Question definitions live in code
// (app/(portal)/onboarding/fragebogen/content.ts), not in the DB.
// Lifecycle: 'entwurf' (draft) -> 'eingereicht' (read-only for clinic).
// ---------------------------------------------------------------
export const discoveryFragebogen = pgTable(
  "discovery_fragebogen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    answers: jsonb("answers").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("entwurf"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    submittedBy: uuid("submitted_by").references(() => clinicUsers.id),
    /** Set when the Praxis re-submits AFTER the first submission (owner can
     *  reopen + edit from Einstellungen). submittedAt keeps the first send;
     *  this drives the "Erneut eingereicht" badge in the admin clinic view. */
    resubmittedAt: timestamp("resubmitted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => clinicUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicUniq: unique("discovery_fragebogen_clinic_uniq").on(t.clinicId),
    statusCheck: check(
      "discovery_fragebogen_status_check",
      sql`${t.status} IN ('entwurf','eingereicht')`
    ),
  })
);

// ---------------------------------------------------------------
// ASSET-LIEFER-CHECKLISTE — Kunden-Onboarding Teil 2. The clinic delivers
// onboarding assets through the portal. `checklist_items` holds the per-item
// two-stage state (clinic sets 'geliefert'/'entfaellt' -> EINS confirms
// 'geprueft'); `checklist_files` holds uploaded files in their own table so
// multiple files per item are individually listable/removable and parallel
// uploads never race a jsonb array. Item definitions live in code
// (app/(portal)/onboarding/checkliste/content.ts), keyed by item id.
// ---------------------------------------------------------------
export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    status: text("status").notNull().default("offen"),
    answer: jsonb("answer").notNull().default(sql`'{}'::jsonb`),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveredBy: uuid("delivered_by").references(() => clinicUsers.id),
    // EINS-side confirmation; verified_by is an admin email (no FK).
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: uuid("updated_by").references(() => clinicUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    clinicItemUniq: unique("checklist_items_clinic_item_uniq").on(
      t.clinicId,
      t.itemId
    ),
    statusCheck: check(
      "checklist_items_status_check",
      sql`${t.status} IN ('offen','geliefert','geprueft','entfaellt')`
    ),
  })
);

export const checklistFiles = pgTable(
  "checklist_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedBy: uuid("uploaded_by").references(() => clinicUsers.id),
  },
  (t) => ({
    clinicItemIdx: index("checklist_files_clinic_item_idx").on(
      t.clinicId,
      t.itemId
    ),
  })
);

// ---------------------------------------------------------------
// ADMIN TOKENS — single-use admin login + password-reset tokens.
// Replaces the former Redis token store (adm:mlk: / adm:pwd:). Sensitive
// (token hashes + admin emails), so migration 0059 REVOKEs all access from
// the eins_app role — only the superuser `db` connection touches it.
// ---------------------------------------------------------------
export const adminTokens = pgTable(
  "admin_tokens",
  {
    /** sha256 hex of the URL token; only the hash is stored. */
    tokenHash: text("token_hash").primaryKey(),
    email: text("email").notNull(),
    /** 'login' (magic-link) or 'password_reset'. */
    purpose: text("purpose").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    expiresIdx: index("admin_tokens_expires_idx").on(t.expiresAt),
  })
);

// ---------------------------------------------------------------
// RATE LIMITS — fixed-window counters for the Postgres rate limiter.
// Replaces the former Redis INCR/EXPIRE buckets. Accessed via the superuser
// `db` connection; not clinic-scoped. Expired rows are pruned by purge-audit.
// ---------------------------------------------------------------
export const rateLimits = pgTable(
  "rate_limits",
  {
    /** `rl:<scope>:<identifier>`. */
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  },
  (t) => ({
    windowIdx: index("rate_limits_window_idx").on(t.windowStart),
  })
);
