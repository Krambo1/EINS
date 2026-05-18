-- Leitfaden-Schulung — per-user quiz attempts proving the EINS-Garantie
-- "mindestens ein Praxis-Mitarbeiter absolviert das initiale Schulungs-
-- Modul" mitwirkungspflicht. Each row is one submission; only `passed`
-- rows count towards the per-user pass state surfaced in the sidebar.
--
-- Same RLS pattern as feedback / clinic_timeline_entries: clinic_id is
-- the tenant key, app_current_clinic() is the session-variable scope.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS leitfaden_quiz_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES clinic_users(id) ON DELETE CASCADE,
  score               integer NOT NULL,
  total               integer NOT NULL,
  passed              boolean NOT NULL,
  questions_version   integer NOT NULL DEFAULT 1,
  answers             jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leitfaden_quiz_score_check
    CHECK (score >= 0 AND score <= total)
);

CREATE INDEX IF NOT EXISTS leitfaden_quiz_user_passed_idx
  ON leitfaden_quiz_attempts(user_id) WHERE passed = true;

CREATE INDEX IF NOT EXISTS leitfaden_quiz_clinic_created_idx
  ON leitfaden_quiz_attempts(clinic_id, created_at DESC);

ALTER TABLE leitfaden_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leitfaden_quiz_attempts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS leitfaden_quiz_attempts_tenant ON leitfaden_quiz_attempts;
CREATE POLICY leitfaden_quiz_attempts_tenant ON leitfaden_quiz_attempts
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT ON leitfaden_quiz_attempts TO eins_app;
