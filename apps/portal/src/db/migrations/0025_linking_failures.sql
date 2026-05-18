-- PVS Bridge — unlinked-event inbox.
--
-- When applyPvsEvent encounters a PVS patient id that none of the three
-- linking stages can resolve, a row is inserted here with the top-3 fuzzy
-- candidates so the Praxis owner can resolve it with one click.
--
-- Status transitions:
--   'open'     — needs attention (the default)
--   'resolved' — clinic user picked one of the candidates or a manual patient
--   'ignored'  — clinic user marked it as not-a-real-patient (test data,
--                spam, archived patient, etc.)

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS linking_failures (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_event_log_id         uuid NOT NULL,
  pvs_event_occurred_at    timestamptz NOT NULL,
  pvs_patient_id           text NOT NULL,
  -- Snapshot of the PVS patient fields we tried to match on, so the resolver
  -- UI can render them without joining back to the (possibly already deleted)
  -- event log row.
  pvs_patient_snapshot     jsonb NOT NULL,
  -- Top-3 fuzzy candidates: [{patientId, score, reason}, ...]
  candidates               jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                   text NOT NULL DEFAULT 'open',
  resolved_to_patient_id   uuid REFERENCES patients(id) ON DELETE SET NULL,
  resolved_at              timestamptz,
  resolved_by              uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  resolution_method        text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linking_failures_status_check CHECK (
    status IN ('open','resolved','ignored')
  ),
  CONSTRAINT linking_failures_resolution_check CHECK (
    resolution_method IS NULL OR resolution_method IN
      ('candidate_pick','manual_search','new_patient','ignored')
  )
);

CREATE INDEX IF NOT EXISTS linking_failures_inbox_idx
  ON linking_failures (clinic_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS linking_failures_pvs_patient_idx
  ON linking_failures (clinic_id, pvs_patient_id, status);
