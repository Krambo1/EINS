-- PVS Bridge — mapping tables.
--
-- pvs_patient_map     : PVS patient id ↔ portal patient id, with link method
-- pvs_treatment_mapping: PVS treatment code ↔ portal treatment id
-- pvs_location_mapping : PVS location id ↔ portal location id
--
-- All three are clinic-scoped (RLS enforced in 0031_rls_pvs.sql).

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ---------- pvs_patient_map ----------
CREATE TABLE IF NOT EXISTS pvs_patient_map (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_patient_id     text NOT NULL,
  portal_patient_id  uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  link_method        text NOT NULL,
  confidence_score   numeric(3,2),
  linked_at          timestamptz NOT NULL DEFAULT now(),
  linked_by          uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  CONSTRAINT pvs_patient_map_unique UNIQUE (clinic_id, pvs_patient_id),
  CONSTRAINT pvs_patient_map_method_check CHECK (
    link_method IN ('external_id','bemerkung_token','fuzzy','manual')
  )
);
CREATE INDEX IF NOT EXISTS pvs_patient_map_portal_idx
  ON pvs_patient_map (clinic_id, portal_patient_id);

-- ---------- pvs_treatment_mapping ----------
CREATE TABLE IF NOT EXISTS pvs_treatment_mapping (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_treatment_code   text NOT NULL,
  pvs_label            text,
  portal_treatment_id  uuid REFERENCES treatments(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'unmapped',
  suggested_treatment_id uuid REFERENCES treatments(id) ON DELETE SET NULL,
  suggested_score      numeric(3,2),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  mapped_by            uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  mapped_at            timestamptz,
  CONSTRAINT pvs_treatment_mapping_unique UNIQUE (clinic_id, pvs_treatment_code),
  CONSTRAINT pvs_treatment_mapping_status_check CHECK (
    status IN ('unmapped','mapped','ignored')
  )
);
CREATE INDEX IF NOT EXISTS pvs_treatment_mapping_clinic_idx
  ON pvs_treatment_mapping (clinic_id, status);

-- ---------- pvs_location_mapping ----------
CREATE TABLE IF NOT EXISTS pvs_location_mapping (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_location_id     text NOT NULL,
  pvs_label           text,
  portal_location_id  uuid REFERENCES locations(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'unmapped',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  mapped_by           uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  mapped_at           timestamptz,
  CONSTRAINT pvs_location_mapping_unique UNIQUE (clinic_id, pvs_location_id),
  CONSTRAINT pvs_location_mapping_status_check CHECK (
    status IN ('unmapped','mapped','ignored')
  )
);
CREATE INDEX IF NOT EXISTS pvs_location_mapping_clinic_idx
  ON pvs_location_mapping (clinic_id, status);
