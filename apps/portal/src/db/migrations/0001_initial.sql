-- EINS Portal — initial schema.
-- Matches apps/portal/src/db/schema.ts verbatim.
-- Extensions are created by docker/postgres/init/01-extensions.sql at container boot.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';

-- ============================================================
-- CLINICS & USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS clinics (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name       text NOT NULL,
  display_name     text NOT NULL,
  slug             text UNIQUE NOT NULL,
  plan             text NOT NULL CHECK (plan IN ('standard','erweitert')),
  plan_started_at  timestamptz NOT NULL DEFAULT now(),
  logo_url         text,
  primary_color    text,
  default_doctor_email text,
  billing_address  jsonb,
  hwg_contact_name text,
  hwg_contact_email text,
  locations        jsonb DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE TABLE IF NOT EXISTS clinic_users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email                   citext NOT NULL,
  full_name               text,
  role                    text NOT NULL CHECK (role IN ('inhaber','marketing','frontdesk')),
  mfa_enrolled            boolean NOT NULL DEFAULT false,
  mfa_secret_enc          bytea,
  mfa_backup_codes        jsonb DEFAULT '[]'::jsonb,
  invited_at              timestamptz,
  invitation_token_hash   text,
  last_login_at           timestamptz,
  ui_mode                 text NOT NULL DEFAULT 'einfach' CHECK (ui_mode IN ('einfach','detail')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  archived_at             timestamptz,
  CONSTRAINT clinic_users_email_unique UNIQUE (clinic_id, email)
);
CREATE INDEX IF NOT EXISTS clinic_users_clinic_idx ON clinic_users(clinic_id);

-- ============================================================
-- SESSIONS & MAGIC LINKS
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES clinic_users(id) ON DELETE CASCADE,
  token_hash    text UNIQUE NOT NULL,
  mfa_verified  boolean NOT NULL DEFAULT false,
  user_agent    text,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS magic_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        citext NOT NULL,
  token_hash   text UNIQUE NOT NULL,
  user_id      uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  intent       text NOT NULL DEFAULT 'login' CHECK (intent IN ('login','invite')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  request_ip   inet
);
CREATE INDEX IF NOT EXISTS magic_links_email_idx ON magic_links(email);

-- ============================================================
-- UPGRADE REQUESTS (D6)
-- ============================================================

CREATE TABLE IF NOT EXISTS upgrade_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id),
  requested_by            uuid NOT NULL REFERENCES clinic_users(id),
  requested_at            timestamptz NOT NULL DEFAULT now(),
  status                  text NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','bearbeitet','abgelehnt')),
  karam_note              text,
  resolved_at             timestamptz,
  resolved_by_admin_email text,
  user_note               text
);

-- ============================================================
-- ANFRAGEN (D3)
-- ============================================================

CREATE TABLE IF NOT EXISTS requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id),
  source             text NOT NULL,
  source_campaign_id text,
  source_ad_id       text,
  utm                jsonb,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  treatment_wish     text,
  budget_indication  text,
  message            text,
  ai_score           int CHECK (ai_score IS NULL OR (ai_score BETWEEN 0 AND 100)),
  ai_category        text CHECK (ai_category IS NULL OR ai_category IN ('hot','warm','cold')),
  ai_reasoning       text,
  ai_prompt_version  text,
  status             text NOT NULL DEFAULT 'neu'
                     CHECK (status IN ('neu','qualifiziert','termin_vereinbart',
                                       'beratung_erschienen','gewonnen','verloren','spam')),
  assigned_to        uuid REFERENCES clinic_users(id),
  converted_revenue_eur numeric(10,2),
  sla_respond_by     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  first_contacted_at timestamptz,
  won_at             timestamptz,
  dsgvo_consent_at   timestamptz NOT NULL DEFAULT now(),
  dsgvo_consent_ip   inet,
  raw_payload        jsonb
);
CREATE INDEX IF NOT EXISTS requests_clinic_idx ON requests(clinic_id);
CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(clinic_id, status);
CREATE INDEX IF NOT EXISTS requests_sla_idx ON requests(sla_respond_by);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests(clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS request_activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES clinic_users(id),
  kind        text NOT NULL CHECK (kind IN ('note','call','email','whatsapp','status_change','ai_rescore','assignment')),
  body        text,
  meta        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_activities_request_idx ON request_activities(request_id, created_at DESC);

-- ============================================================
-- MEDIEN
-- ============================================================

CREATE TABLE IF NOT EXISTS assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  kind            text NOT NULL CHECK (kind IN ('video','foto','rohmaterial','behind_scenes')),
  title           text NOT NULL,
  description     text,
  shoot_date      date,
  storage_key     text NOT NULL,
  mime_type       text,
  file_size_bytes bigint,
  mux_playback_id text,
  version         int NOT NULL DEFAULT 1,
  supersedes_id   uuid REFERENCES assets(id),
  tags            text[],
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_clinic_idx ON assets(clinic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS animation_library (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                 text NOT NULL,
  treatment_tag         text,
  description           text,
  storage_key_master    text NOT NULL,
  preview_poster_key    text,
  duration_s            int,
  created_at            timestamptz NOT NULL DEFAULT now(),
  archived_at           timestamptz
);

CREATE TABLE IF NOT EXISTS animation_instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id),
  library_id              uuid NOT NULL REFERENCES animation_library(id),
  storage_key_customized  text,
  status                  text NOT NULL DEFAULT 'standard'
                          CHECK (status IN ('standard','requested','in_production','ready')),
  requested_by            uuid REFERENCES clinic_users(id),
  requested_at            timestamptz,
  request_note            text,
  delivered_at            timestamptz,
  CONSTRAINT animation_instances_clinic_library_unique UNIQUE (clinic_id, library_id)
);

-- ============================================================
-- DOKUMENTE
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  kind              text NOT NULL
                    CHECK (kind IN ('vertrag','avv','auswertung_monatlich','vertriebsleitfaden','hwg_pruefung','sonstiges')),
  title             text NOT NULL,
  valid_from        date,
  valid_to          date,
  storage_key       text NOT NULL,
  file_size_bytes   bigint,
  version           int NOT NULL DEFAULT 1,
  visible_to_roles  text[] NOT NULL DEFAULT ARRAY['inhaber','marketing']::text[],
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_clinic_idx ON documents(clinic_id, created_at DESC);

-- ============================================================
-- CAMPAIGNS / KPIs / GOALS
-- ============================================================

CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  snapshot_date  date NOT NULL,
  platform       text NOT NULL CHECK (platform IN ('meta','google','csv')),
  spend_eur      numeric(10,2),
  impressions    bigint,
  clicks         bigint,
  leads          int,
  cpl_eur        numeric(10,2),
  ctr            numeric(5,4),
  raw_payload    jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_snapshots_unique UNIQUE (clinic_id, snapshot_date, platform)
);

CREATE TABLE IF NOT EXISTS kpi_daily (
  clinic_id                 uuid NOT NULL REFERENCES clinics(id),
  date                      date NOT NULL,
  qualified_leads           int,
  cost_per_qualified_lead   numeric(10,2),
  appointments              int,
  consultations_held        int,
  cases_won                 int,
  no_show_rate              numeric(5,4),
  total_spend_eur           numeric(10,2),
  revenue_attributed_eur    numeric(10,2),
  roas                      numeric(6,2),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, date)
);

CREATE TABLE IF NOT EXISTS goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  metric       text NOT NULL CHECK (metric IN ('qualified_leads','revenue','cases_won','appointments')),
  target_value numeric(10,2) NOT NULL,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  created_by   uuid REFERENCES clinic_users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS goals_clinic_idx ON goals(clinic_id, period_start);

-- ============================================================
-- AUDIT
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid,
  actor_id     uuid,
  actor_email  text,
  action       text NOT NULL,
  entity_kind  text,
  entity_id    uuid,
  ip_address   inet,
  user_agent   text,
  diff         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_clinic_idx ON audit_log(clinic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action);

-- ============================================================
-- INTEGRATIONEN (OAuth tokens, pgcrypto-encrypted at rest)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  platform          text NOT NULL CHECK (platform IN ('meta','google')),
  access_token_enc  bytea NOT NULL,
  refresh_token_enc bytea,
  expires_at        timestamptz,
  account_id        text,
  scopes            text[],
  last_synced_at    timestamptz,
  last_sync_error   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_credentials_unique UNIQUE (clinic_id, platform)
);

-- ============================================================
-- BENACHRICHTIGUNGEN
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES clinic_users(id) ON DELETE CASCADE,
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, created_at DESC);

-- ============================================================
-- HWG-CHECKS
-- ============================================================

CREATE TABLE IF NOT EXISTS hwg_checks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  actor_id    uuid REFERENCES clinic_users(id),
  input       text NOT NULL,
  verdict     text NOT NULL CHECK (verdict IN ('clean','warn','violation')),
  findings    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ADMIN (Karam's super-admin identity — no clinic_id tenancy)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  full_name      text,
  mfa_enrolled   boolean NOT NULL DEFAULT false,
  mfa_secret_enc bytea,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash   text UNIQUE NOT NULL,
  mfa_verified boolean NOT NULL DEFAULT false,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions(admin_id);

-- ============================================================
-- SIMPLE SCHEMA-VERSION TABLE for our mini migration runner
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
