-- Detail Mode v2 — schema additions for the richer Detail UI.
--
-- Adds: treatments, locations, patients, reviews, request_recalls
-- Extends: requests (treatment_id, patient_id, location_id, ai_signals)
-- Extends: goals (metric check now includes 'spend')
--
-- All new tenant tables are RLS-policied in the same migration so a single
-- application step lands the whole feature.
--
-- Existing rows in clinics.locations (jsonb) are migrated into the new
-- locations table. The jsonb column stays in place for two releases as a
-- read-only fallback before being dropped.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- treatments
-- ============================================================

CREATE TABLE IF NOT EXISTS treatments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id                uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name                     text NOT NULL,
  slug                     text NOT NULL,
  is_active                boolean NOT NULL DEFAULT true,
  display_order            integer NOT NULL DEFAULT 0,
  default_recall_months    integer,
  keywords                 text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  archived_at              timestamptz,
  CONSTRAINT treatments_slug_unique UNIQUE (clinic_id, slug)
);
CREATE INDEX IF NOT EXISTS treatments_clinic_idx ON treatments(clinic_id);

-- ============================================================
-- locations
-- ============================================================

CREATE TABLE IF NOT EXISTS locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  is_primary      boolean NOT NULL DEFAULT false,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz
);
CREATE INDEX IF NOT EXISTS locations_clinic_idx ON locations(clinic_id);

-- Backfill from clinics.locations jsonb if present.
DO $$
DECLARE
  c RECORD;
  loc jsonb;
  pos int;
  loc_name text;
  loc_address text;
BEGIN
  FOR c IN SELECT id, locations FROM clinics WHERE locations IS NOT NULL LOOP
    pos := 0;
    IF jsonb_typeof(c.locations) = 'array' THEN
      FOR loc IN SELECT value FROM jsonb_array_elements(c.locations) LOOP
        -- Tolerate either string entries or {name, address} objects.
        IF jsonb_typeof(loc) = 'string' THEN
          loc_name := loc#>>'{}';
          loc_address := NULL;
        ELSE
          loc_name := COALESCE(loc->>'name', loc->>'label', 'Standort');
          loc_address := loc->>'address';
        END IF;
        INSERT INTO locations (clinic_id, name, address, is_primary, display_order)
        VALUES (c.id, loc_name, loc_address, pos = 0, pos);
        pos := pos + 1;
      END LOOP;
    END IF;
  END LOOP;
END
$$;

-- ============================================================
-- patients
-- ============================================================

CREATE TABLE IF NOT EXISTS patients (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email                   citext,
  phone                   text,
  full_name               text,
  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  first_touch_source      text,
  lifetime_revenue_eur    numeric(10,2) NOT NULL DEFAULT 0,
  request_count           integer NOT NULL DEFAULT 0,
  won_count               integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_clinic_idx       ON patients(clinic_id);
CREATE INDEX IF NOT EXISTS patients_ltv_idx          ON patients(clinic_id, lifetime_revenue_eur);
-- NULL-safe partial unique indexes (one row per clinic+email, one per clinic+phone).
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_email_unique
  ON patients(clinic_id, email)
  WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_phone_unique
  ON patients(clinic_id, phone)
  WHERE phone IS NOT NULL;

-- ============================================================
-- reviews
-- ============================================================

CREATE TABLE IF NOT EXISTS reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('google','jameda','trustpilot','manual')),
  rating          numeric(2,1) NOT NULL,
  total_count     integer NOT NULL DEFAULT 0,
  period_start    date,
  period_end      date,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  notes           text
);
CREATE INDEX IF NOT EXISTS reviews_clinic_idx ON reviews(clinic_id, recorded_at);

-- ============================================================
-- request_recalls (created BEFORE the requests ALTER below since FK targets it)
-- ============================================================

CREATE TABLE IF NOT EXISTS request_recalls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id      uuid REFERENCES requests(id) ON DELETE CASCADE,
  patient_id      uuid REFERENCES patients(id) ON DELETE CASCADE,
  scheduled_for   date NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('recall','followup','review_request')),
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','completed','skipped')),
  note            text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_recalls_clinic_idx ON request_recalls(clinic_id, scheduled_for);

-- ============================================================
-- requests — extend with treatment_id, patient_id, location_id, ai_signals
-- ============================================================

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS treatment_id uuid REFERENCES treatments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS patient_id   uuid REFERENCES patients(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS location_id  uuid REFERENCES locations(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_signals   jsonb;

CREATE INDEX IF NOT EXISTS requests_treatment_idx ON requests(clinic_id, treatment_id);
CREATE INDEX IF NOT EXISTS requests_patient_idx   ON requests(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS requests_location_idx  ON requests(clinic_id, location_id);

-- ============================================================
-- goals — extend metric check to include 'spend'
-- ============================================================

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_metric_check;
ALTER TABLE goals ADD CONSTRAINT goals_metric_check
  CHECK (metric IN ('qualified_leads','revenue','cases_won','appointments','spend'));

-- ============================================================
-- RLS policies for the new tenant tables
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'treatments','locations','patients','reviews','request_recalls'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END
$$;

DROP POLICY IF EXISTS treatments_tenant ON treatments;
CREATE POLICY treatments_tenant ON treatments
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS locations_tenant ON locations;
CREATE POLICY locations_tenant ON locations
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS patients_tenant ON patients;
CREATE POLICY patients_tenant ON patients
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS reviews_tenant ON reviews;
CREATE POLICY reviews_tenant ON reviews
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS request_recalls_tenant ON request_recalls;
CREATE POLICY request_recalls_tenant ON request_recalls
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- Grant table-level privileges to the app role for the new tables. The
-- 0001/0002 migrations grant these globally via DEFAULT PRIVILEGES, but new
-- tables created in a later migration need explicit grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  treatments, locations, patients, reviews, request_recalls
TO eins_app;
