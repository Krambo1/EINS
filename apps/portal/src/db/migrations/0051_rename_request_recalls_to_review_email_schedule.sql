-- Honest naming for the Bewertungsanfrage-Email-Scheduler.
--
-- Until 0050 the `request_recalls` table held three flavours of "follow-up
-- thing": kind='review_request' (Bewertungsanfrage-Email-Versand-Plan),
-- kind='recall' and kind='followup'. 0050 narrowed the constraint to the
-- only surviving kind, leaving the table name as a lie — it does not
-- schedule "recalls" of any kind; that workflow lives in the PVS.
--
-- This migration renames the table + its FK column on patient_feedback to
-- match what they actually do. Constraint and index names get renamed in
-- the same transaction so the schema reads cleanly going forward.
--
-- Naming choices:
--   * Table:  `review_email_schedule` — what the table actually is.
--   * patient_feedback.recall_id → patient_feedback.review_request_id —
--     the FK now reads as "which review-request row was this feedback
--     submitted against?".
--
-- Idempotent: ALTER ... IF EXISTS skips no-ops; DO blocks guard auto-named
-- FK constraints that may not exist on dev DBs that pre-date the auto-name.

BEGIN;

-- 1) Rename the table.
ALTER TABLE IF EXISTS request_recalls RENAME TO review_email_schedule;

-- 2) Rename the FK column on patient_feedback. The auto-generated FK
--    constraint name (`patient_feedback_recall_id_fkey`) also gets
--    rebranded so future pg_dump output reads honestly.
ALTER TABLE patient_feedback RENAME COLUMN recall_id TO review_request_id;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patient_feedback_recall_id_fkey'
  ) THEN
    ALTER TABLE patient_feedback
      RENAME CONSTRAINT patient_feedback_recall_id_fkey
      TO patient_feedback_review_request_id_fkey;
  END IF;
END $$;

-- 3) Rename the named CHECK constraints. PostgreSQL keeps these under
--    their original names even after RENAME TABLE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_recalls_kind_check') THEN
    ALTER TABLE review_email_schedule
      RENAME CONSTRAINT request_recalls_kind_check
      TO review_email_schedule_kind_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_recalls_status_check') THEN
    ALTER TABLE review_email_schedule
      RENAME CONSTRAINT request_recalls_status_check
      TO review_email_schedule_status_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_recalls_rating_value_check') THEN
    ALTER TABLE review_email_schedule
      RENAME CONSTRAINT request_recalls_rating_value_check
      TO review_email_schedule_rating_value_check;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_recalls_public_platform_check') THEN
    ALTER TABLE review_email_schedule
      RENAME CONSTRAINT request_recalls_public_platform_check
      TO review_email_schedule_public_platform_check;
  END IF;
  -- Token-expiry check from migration 0035.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'request_recalls_review_token_expiry_check') THEN
    ALTER TABLE review_email_schedule
      RENAME CONSTRAINT request_recalls_review_token_expiry_check
      TO review_email_schedule_review_token_expiry_check;
  END IF;
END $$;

-- 4) Rename indexes. PK is auto-named; the partial unique on review_token
--    was named explicitly in migration 0013.
ALTER INDEX IF EXISTS request_recalls_pkey
  RENAME TO review_email_schedule_pkey;
ALTER INDEX IF EXISTS request_recalls_review_token_unique
  RENAME TO review_email_schedule_review_token_unique;
ALTER INDEX IF EXISTS request_recalls_clinic_idx
  RENAME TO review_email_schedule_clinic_idx;
ALTER INDEX IF EXISTS request_recalls_due_idx
  RENAME TO review_email_schedule_due_idx;

-- 5) Rename the RLS policy carried over from 0004. The policy body itself
--    (clinic_id = app_current_clinic()) is unchanged; only the name moves.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename  = 'review_email_schedule'
      AND policyname = 'request_recalls_tenant'
  ) THEN
    ALTER POLICY request_recalls_tenant ON review_email_schedule
      RENAME TO review_email_schedule_tenant;
  END IF;
END $$;

COMMIT;
