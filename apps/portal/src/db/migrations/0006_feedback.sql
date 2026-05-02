-- Feedback inbox — clinic users submit suggestions, bug reports, praise,
-- or questions about the portal. Lands in the DB and emails Karam.
--
-- Status lifecycle: 'offen' → 'gesehen' (Karam acknowledged) → 'bearbeitet'
-- (resolved / acted on). 'verworfen' for ignored. Mirrors upgrade_requests.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS feedback (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  submitted_by             uuid NOT NULL REFERENCES clinic_users(id),
  category                 text NOT NULL,
  message                  text NOT NULL,
  page_url                 text,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  status                   text NOT NULL DEFAULT 'offen',
  karam_note               text,
  resolved_at              timestamptz,
  resolved_by_admin_email  text,
  CONSTRAINT feedback_category_check
    CHECK (category IN ('verbesserung','fehler','lob','frage','sonstiges')),
  CONSTRAINT feedback_status_check
    CHECK (status IN ('offen','gesehen','bearbeitet','verworfen'))
);

CREATE INDEX IF NOT EXISTS feedback_clinic_idx ON feedback(clinic_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback(status, submitted_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feedback_tenant ON feedback;
CREATE POLICY feedback_tenant ON feedback
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON feedback TO eins_app;
