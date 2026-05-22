-- EINS Stimme — review-token expiry.
--
-- Background: a token issued at appointment-completion time was valid
-- forever. Round 2 testing confirmed a 400-day-old token still resolved
-- and accepted feedback. We want a hard window so leaked URLs decay, and
-- so the inbox isn't perpetually attractive to scrapers.
--
-- Window: 90 days from creation, matching the patient-data retention
-- assumption in the consent text + the typical review-request follow-up
-- cadence. After expiry the token's resolve path returns "not found" and
-- the recall row stays as a record that the request happened.
--
-- Backfill: existing rows get `createdAt + 90 days`. Historical tokens
-- past that already-effective expiry will start returning not_found
-- immediately — that's the intended outcome and matches the test report's
-- recommendation.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE request_recalls
  ADD COLUMN IF NOT EXISTS review_token_expires_at timestamptz;

UPDATE request_recalls
   SET review_token_expires_at = created_at + INTERVAL '90 days'
 WHERE kind = 'review_request'
   AND review_token_expires_at IS NULL;

-- New rows must always carry an expiry — enforced in application code,
-- but a partial check constraint surfaces any future code path that
-- forgets to set it.
ALTER TABLE request_recalls
  DROP CONSTRAINT IF EXISTS request_recalls_review_token_expiry_check;
ALTER TABLE request_recalls
  ADD CONSTRAINT request_recalls_review_token_expiry_check
  CHECK (
    review_token IS NULL
    OR review_token_expires_at IS NOT NULL
  );
