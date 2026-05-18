-- EINS Stimme — surface public-redirect events (Google/Jameda) in the
-- Patientenfeedback inbox alongside private feedback.
--
-- Background: until now, /r/[token]/go (the public-CTA redirector) only
-- updated request_recalls. The redirect flow stays unchanged — the patient
-- still 302s to Google/Jameda — but we now also persist a patient_feedback
-- row at click time so the Praxis sees one unified list of "who actually
-- engaged with the review request".
--
-- Schema deltas:
--   • patient_feedback.source           — 'private' | 'public_redirect'
--   • patient_feedback.public_platform  — 'google' | 'jameda' | NULL
--   • Idempotency: at most one public_redirect row per recall.
--   • Backfill: any historical recall with public_clicked_at + rating_value
--     gets a synthetic public_redirect row.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE patient_feedback
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS public_platform text;

ALTER TABLE patient_feedback
  DROP CONSTRAINT IF EXISTS patient_feedback_source_check;
ALTER TABLE patient_feedback
  ADD CONSTRAINT patient_feedback_source_check
  CHECK (source IN ('private','public_redirect'));

ALTER TABLE patient_feedback
  DROP CONSTRAINT IF EXISTS patient_feedback_public_platform_check;
ALTER TABLE patient_feedback
  ADD CONSTRAINT patient_feedback_public_platform_check
  CHECK (
    public_platform IS NULL
    OR public_platform IN ('google','jameda')
  );

-- One public_redirect row per recall. A subsequent click on the *other*
-- platform should UPDATE this row, not create a duplicate (handled in
-- recordPublicClick via ON CONFLICT).
--
-- Predicate is kept minimal (just source=) so the matching ON CONFLICT
-- inference in recordPublicClick can target this index. NULL recall_ids
-- — which can only arise post-hoc via the FK's ON DELETE SET NULL —
-- are treated as distinct by the b-tree, so legacy detached rows don't
-- conflict.
CREATE UNIQUE INDEX IF NOT EXISTS patient_feedback_public_redirect_unique
  ON patient_feedback(recall_id)
  WHERE source = 'public_redirect';

-- Backfill: synthesise public_redirect rows for historical clicks. We need
-- a rating to satisfy the NOT NULL + 1..5 check, so we skip recalls that
-- somehow have public_clicked_at without a rating_value (shouldn't happen
-- in practice — the landing page records the rating before exposing the
-- public CTA — but defensive against partial/legacy rows).
INSERT INTO patient_feedback (
  clinic_id,
  patient_id,
  recall_id,
  rating,
  contact_email,
  contact_name,
  source,
  public_platform,
  created_at
)
SELECT
  rr.clinic_id,
  rr.patient_id,
  rr.id,
  rr.rating_value,
  rr.review_email,
  rr.review_patient_name,
  'public_redirect',
  rr.public_clicked_platform,
  rr.public_clicked_at
FROM request_recalls rr
WHERE rr.kind = 'review_request'
  AND rr.public_clicked_at IS NOT NULL
  AND rr.rating_value IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM patient_feedback pf
    WHERE pf.recall_id = rr.id
      AND pf.source = 'public_redirect'
  );
