-- 0061_discovery_fragebogen.sql
-- Discovery-Fragebogen (Kunden-Onboarding), Teil 1: the clinic answers the
-- Vorab-Formular in the portal before the onboarding meeting. One row per
-- clinic; answers are a jsonb map keyed by question id ("A1", "C1", ...).
-- Question definitions live in code (content.ts), NOT in the DB, so this
-- table stays a dumb answer store. Lifecycle: 'entwurf' (draft, freely
-- editable) -> 'eingereicht' (submitted, read-only for the clinic; admin can
-- reopen later if needed). Notion source of truth for the question set:
-- "Discovery-Fragebogen (Kunden-Onboarding)".

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS discovery_fragebogen (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Map of question id -> answer (string for Auswahl/Text, string[] for
  -- Mehrfachauswahl). Unknown ids are rejected at the action layer.
  answers       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'entwurf',
  submitted_at  timestamptz,
  submitted_by  uuid REFERENCES clinic_users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES clinic_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovery_fragebogen_status_check
    CHECK (status IN ('entwurf','eingereicht')),
  -- One questionnaire per clinic; upsert target.
  CONSTRAINT discovery_fragebogen_clinic_uniq UNIQUE (clinic_id)
);

ALTER TABLE discovery_fragebogen ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_fragebogen FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discovery_fragebogen_tenant ON discovery_fragebogen;
CREATE POLICY discovery_fragebogen_tenant ON discovery_fragebogen
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON discovery_fragebogen TO eins_app;
