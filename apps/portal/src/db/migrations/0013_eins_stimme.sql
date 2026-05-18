-- EINS Stimme — post-visit review-request engine.
--
-- High-level architecture (see apps/portal/docs/eins-stimme.md):
--   1. Make.com per-clinic scenario fans PMS "appointment completed" events
--      into POST /api/patients/events (HMAC-signed with the same per-clinic
--      'intake' secret used by clinic-landing form submissions).
--   2. The handler upserts a patients row and schedules a request_recalls
--      row with kind='review_request' and a 32-byte review_token.
--   3. A 15-minute BullMQ cron tick scans pending review_request rows whose
--      scheduled_for has arrived and enqueues an emailSend job each.
--   4. The patient's mail carries five 1..5★ buttons that all point at
--      /r/<token>?rating=N on the clinic's landing host. The landing page
--      always shows both the public Google/Jameda CTA AND a private feedback
--      form — never gated, regardless of rating. BGH 2022 + Google GMB policy.
--   5. Private submissions land in patient_feedback as a triage inbox; public
--      clicks are recorded for KPI but the patient is bounced straight to
--      the platform.
--
-- This migration only adds columns + tables + RLS + grants. The associated
-- Drizzle mirror lives in src/db/schema.ts.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- =============================================================
-- 1. CLINICS — review program config.
-- =============================================================

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS google_review_url             text,
  ADD COLUMN IF NOT EXISTS jameda_review_url             text,
  ADD COLUMN IF NOT EXISTS review_request_delay_days     integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS review_request_enabled        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_landing_origin         text,
  ADD COLUMN IF NOT EXISTS review_email_from             text,
  ADD COLUMN IF NOT EXISTS review_inbox_email            text;

-- Sanity bounds: 0..30 days; 0 means "send same-day". 30+ days hurts response.
ALTER TABLE clinics
  DROP CONSTRAINT IF EXISTS clinics_review_request_delay_days_check;
ALTER TABLE clinics
  ADD CONSTRAINT clinics_review_request_delay_days_check
  CHECK (review_request_delay_days BETWEEN 0 AND 30);

-- =============================================================
-- 2. REQUEST_RECALLS — extend for the review_request workflow.
-- =============================================================

ALTER TABLE request_recalls
  ADD COLUMN IF NOT EXISTS review_token              text,
  ADD COLUMN IF NOT EXISTS review_email              text,
  ADD COLUMN IF NOT EXISTS review_patient_name       text,
  ADD COLUMN IF NOT EXISTS review_treatment_label    text,
  ADD COLUMN IF NOT EXISTS sent_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS rating_clicked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS rating_value              integer,
  ADD COLUMN IF NOT EXISTS public_clicked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS public_clicked_platform   text,
  ADD COLUMN IF NOT EXISTS feedback_at               timestamptz;

ALTER TABLE request_recalls
  DROP CONSTRAINT IF EXISTS request_recalls_rating_value_check;
ALTER TABLE request_recalls
  ADD CONSTRAINT request_recalls_rating_value_check
  CHECK (rating_value IS NULL OR (rating_value BETWEEN 1 AND 5));

ALTER TABLE request_recalls
  DROP CONSTRAINT IF EXISTS request_recalls_public_platform_check;
ALTER TABLE request_recalls
  ADD CONSTRAINT request_recalls_public_platform_check
  CHECK (
    public_clicked_platform IS NULL
    OR public_clicked_platform IN ('google','jameda')
  );

-- Token uniqueness — partial index, since `review_token` is NULL for
-- legacy recall/followup rows.
CREATE UNIQUE INDEX IF NOT EXISTS request_recalls_review_token_unique
  ON request_recalls(review_token)
  WHERE review_token IS NOT NULL;

-- Scanner index: WHERE kind='review_request' AND status='pending' AND scheduled_for <= today
CREATE INDEX IF NOT EXISTS request_recalls_due_idx
  ON request_recalls(kind, status, scheduled_for);

-- =============================================================
-- 3. PATIENTS — externalId + unsubscribe flag.
-- =============================================================

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS external_id                  text,
  ADD COLUMN IF NOT EXISTS review_email_unsubscribed_at timestamptz;

CREATE INDEX IF NOT EXISTS patients_external_idx
  ON patients(clinic_id, external_id);

CREATE INDEX IF NOT EXISTS patients_email_idx
  ON patients(clinic_id, email);

-- Patients table is not RLS-enabled in 0002_rls.sql (it's worker-managed,
-- not user-facing). Skip RLS additions here.

-- =============================================================
-- 4. PATIENT_FEEDBACK — private inbox.
-- =============================================================

CREATE TABLE IF NOT EXISTS patient_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      uuid REFERENCES patients(id) ON DELETE SET NULL,
  recall_id       uuid REFERENCES request_recalls(id) ON DELETE SET NULL,
  rating          integer NOT NULL,
  free_text       text,
  contact_back_ok boolean NOT NULL DEFAULT false,
  contact_email   text,
  contact_name    text,
  status          text NOT NULL DEFAULT 'neu',
  internal_note   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid REFERENCES clinic_users(id),
  CONSTRAINT patient_feedback_rating_check
    CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT patient_feedback_status_check
    CHECK (status IN ('neu','gesehen','beantwortet','geschlossen'))
);

CREATE INDEX IF NOT EXISTS patient_feedback_clinic_idx
  ON patient_feedback(clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_feedback_status_idx
  ON patient_feedback(clinic_id, status, created_at DESC);

ALTER TABLE patient_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_feedback_tenant ON patient_feedback;
CREATE POLICY patient_feedback_tenant ON patient_feedback
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON patient_feedback TO eins_app;

-- =============================================================
-- 5. EMAIL_SUPPRESSION — do-not-send list per clinic.
-- =============================================================

CREATE TABLE IF NOT EXISTS email_suppression (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_suppression_unique UNIQUE (clinic_id, email),
  CONSTRAINT email_suppression_reason_check
    CHECK (reason IN ('unsubscribed','bounced','complained','manual'))
);

CREATE INDEX IF NOT EXISTS email_suppression_clinic_idx
  ON email_suppression(clinic_id, email);

-- Suppression rows are written by both public unsubscribe links (no session,
-- superuser DB role) and admin actions. Keep RLS off here — `app_current_clinic()`
-- isn't set on the unsubscribe code path. Reads happen through the superuser
-- connection (worker scanner) and the per-clinic settings UI uses
-- `withClinicContext` to filter explicitly.
