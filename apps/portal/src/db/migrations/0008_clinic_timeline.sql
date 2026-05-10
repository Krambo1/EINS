-- Clinic-facing "Fortschritt" timeline — admin-authored milestones (campaign
-- launch, report delivery, onboarding step, etc.). Read-only for clinic
-- users; mutated only via admin server actions.
--
-- Same RLS pattern as `feedback`: clinic_id session-variable scope so any
-- clinic-authenticated query is implicitly tenant-filtered.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS clinic_timeline_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text,
  event_date         timestamptz NOT NULL,
  status             text NOT NULL DEFAULT 'geplant',
  created_by_email   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_timeline_status_check
    CHECK (status IN ('geplant','laeuft','abgeschlossen'))
);

CREATE INDEX IF NOT EXISTS clinic_timeline_clinic_date_idx
  ON clinic_timeline_entries(clinic_id, event_date DESC);

ALTER TABLE clinic_timeline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_timeline_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_timeline_entries_tenant ON clinic_timeline_entries;
CREATE POLICY clinic_timeline_entries_tenant ON clinic_timeline_entries
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_timeline_entries TO eins_app;
