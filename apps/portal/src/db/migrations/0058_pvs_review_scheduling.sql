-- 0058_pvs_review_scheduling.sql
-- PVS-bridge-driven EINS Bewertungen review scheduling.
--
-- Until now the only thing that schedules a review-request email is the
-- Make.com webhook (/api/patients/events -> applyPatientEvent), which carries a
-- per-event reviewConsent flag and an email. The PVS bridge already derives
-- "encounter completed" in the pvs-status-derive worker but never schedules a
-- review. This migration adds the two things the PVS path needs that the webhook
-- path got for free:
--
--   1. clinics.review_consent_attested -- the PVS stream is pseudonymized and
--      carries no per-event consent, so the Praxis attests ONCE (here) that it
--      informs patients at intake (HWG model, §7 UWG Abs. 3 Nr. 4, see
--      apps/portal/docs/eins-bewertungen.md). The derive worker only schedules when
--      this flag is true. Default false: no clinic auto-sends until it opts in.
--
--   2. review_email_schedule.pvs_appointment_id / pvs_encounter_id -- provenance
--      plus the idempotency key. A completed encounter is re-derived on every
--      later event for that patient, so without a per-appointment guard a single
--      visit would schedule a fresh email on every re-run once the 90-day
--      anti-spam window lapses. The UNIQUE INDEX below is the hard backstop.
--
-- All three live on small, non-partitioned tables, so plain ADD COLUMN + CREATE
-- INDEX is safe (no NOT VALID / no partition cascade needed). Existing and
-- webhook-scheduled rows keep pvs_appointment_id = NULL; Postgres treats NULLs
-- as DISTINCT in a unique index, so those rows are unconstrained and only PVS
-- rows for the same appointment can collide.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS review_consent_attested boolean NOT NULL DEFAULT false;

ALTER TABLE review_email_schedule
  ADD COLUMN IF NOT EXISTS pvs_appointment_id text;

ALTER TABLE review_email_schedule
  ADD COLUMN IF NOT EXISTS pvs_encounter_id text;

-- Idempotency: at most one review per (clinic, PVS appointment). NULL
-- appointment ids (webhook + legacy rows) are exempt by Postgres NULL-distinct
-- semantics.
CREATE UNIQUE INDEX IF NOT EXISTS review_email_schedule_pvs_appt_uidx
  ON review_email_schedule (clinic_id, pvs_appointment_id);
