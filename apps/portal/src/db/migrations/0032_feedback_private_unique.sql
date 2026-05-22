-- EINS Stimme — defense-in-depth against private-feedback replay.
--
-- Background: the per-token POST to /api/review-tokens/[token]/feedback was
-- replayable. A patient (or attacker holding a leaked token URL) could
-- re-submit indefinitely; every call inserted a fresh patient_feedback row
-- and fired a fresh alert email.
--
-- The application layer now short-circuits when request_recalls.feedback_at
-- is already set. This partial unique index closes the race window — if two
-- POSTs arrive in flight before either sees feedback_at, the second insert
-- raises a unique-violation that the application catches and treats as a
-- replay.
--
-- Mirror of the existing 0015_feedback_public_redirect.sql index, but for
-- source='private' rows. recall_id NULL exclusion is required: the FK uses
-- ON DELETE SET NULL, so detached legacy rows must be allowed to coexist.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE UNIQUE INDEX IF NOT EXISTS patient_feedback_private_unique
  ON patient_feedback(recall_id)
  WHERE source = 'private' AND recall_id IS NOT NULL;
