-- PVS Bridge — denormalize a few PVS-derived fields onto patients so the
-- linking engine and the patient-detail UI don't need a join for the common
-- read path.
--
-- `pvs_patient_id` here is denormalized from pvs_patient_map for one specific
-- (highest-confidence, most-recent) link. The full set of PVS patient IDs that
-- map to this portal patient remains in pvs_patient_map (a patient can be
-- merged from multiple PVS records). Keep both in sync via the status-derive
-- worker.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- Trigram extension drives the Stage-3 fuzzy linker indexes below.
-- IF NOT EXISTS so it's safe to re-run; superuser role required (the
-- migration runner connects with DATABASE_URL = postgres superuser).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS dob              date,
  ADD COLUMN IF NOT EXISTS gender           text,
  ADD COLUMN IF NOT EXISTS pvs_patient_id   text;

ALTER TABLE patients
  DROP CONSTRAINT IF EXISTS patients_gender_check;
ALTER TABLE patients
  ADD CONSTRAINT patients_gender_check CHECK (
    gender IS NULL OR gender IN ('f','m','d','x')
  );

-- Partial unique index — many patients have no PVS link yet.
CREATE UNIQUE INDEX IF NOT EXISTS patients_pvs_id_unique
  ON patients (clinic_id, pvs_patient_id)
  WHERE pvs_patient_id IS NOT NULL;

-- Fuzzy-match helpers for Stage-3 linking. Trigram extension is created
-- once at init time; this migration assumes it's present (see
-- docker/postgres/init/01-extensions.sql).
CREATE INDEX IF NOT EXISTS patients_phone_trgm_idx
  ON patients USING gin (phone gin_trgm_ops)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS patients_fullname_trgm_idx
  ON patients USING gin (full_name gin_trgm_ops)
  WHERE full_name IS NOT NULL;
