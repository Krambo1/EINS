-- PVS Bridge — request columns + status enum extension.
--
-- Extends the requests table with PVS-derived appointment timestamps and
-- expands the status enum with 'no_show' and 'behandelt'.
--
-- Status lifecycle (with PVS):
--   neu → qualifiziert → termin_vereinbart → beratung_erschienen
--                                          → no_show
--   → behandelt → gewonnen   (revenue confirmed)
--                / verloren  (manual flip)
--   / spam
--
-- The 'PVS gewinnt immer' rule: status_source='pvs' means subsequent PVS
-- events overwrite manual edits; 'manual' means the row was last touched
-- by a user. The pvs-status-derive worker only updates rows whose
-- status_source != 'manual' OR whose pvs_appointment_id is set.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS pvs_appointment_id text,
  ADD COLUMN IF NOT EXISTS pvs_encounter_id   text,
  ADD COLUMN IF NOT EXISTS appointment_at     timestamptz,
  ADD COLUMN IF NOT EXISTS no_show_at         timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS status_source      text NOT NULL DEFAULT 'manual';

-- Status enum extension: add no_show + behandelt.
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (
  status IN (
    'neu',
    'qualifiziert',
    'termin_vereinbart',
    'beratung_erschienen',
    'no_show',
    'behandelt',
    'gewonnen',
    'verloren',
    'spam'
  )
);

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_source_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_source_check CHECK (
  status_source IN ('manual','pvs','csv')
);

-- Index for replay-by-appointment lookup.
CREATE INDEX IF NOT EXISTS requests_pvs_appointment_idx
  ON requests (clinic_id, pvs_appointment_id)
  WHERE pvs_appointment_id IS NOT NULL;

-- Index for the appointment-calendar projection on the dashboard.
CREATE INDEX IF NOT EXISTS requests_appointment_at_idx
  ON requests (clinic_id, appointment_at)
  WHERE appointment_at IS NOT NULL;

-- Partial index for the no-show KPI rollup.
CREATE INDEX IF NOT EXISTS requests_no_show_idx
  ON requests (clinic_id, no_show_at)
  WHERE no_show_at IS NOT NULL;
