-- 0066_client_uploads.sql
-- "Dateien an EINS" — general clinic-to-EINS file delivery outside the
-- onboarding checklist. The clinic uploads documents, images and videos
-- (direct-to-storage via presigned URL, so file size is not bounded by the
-- serverless request cap); EINS receives them in the admin clinic detail
-- ("Dateien" tab) and marks them as seen. One row per delivered file.
--
-- seen_at/seen_by is the EINS-side read receipt: NULL = "Neu" in the admin,
-- set = acknowledged. seen_by is an admin email (admins are not clinic_users,
-- so no FK — same convention as checklist_items.verified_by).

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS client_uploads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  storage_key       text NOT NULL,
  original_filename text NOT NULL,
  content_type      text,
  size_bytes        bigint NOT NULL,
  -- Optional free-text note the clinic attached to the delivery batch.
  note              text,
  uploaded_by       uuid REFERENCES clinic_users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  seen_at           timestamptz,
  seen_by           text,
  -- A storage key is minted once per upload target (uuid in the key), so a
  -- double-finalize of the same key must not produce two rows.
  CONSTRAINT client_uploads_storage_key_uniq UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS client_uploads_clinic_created_idx
  ON client_uploads (clinic_id, created_at DESC);

ALTER TABLE client_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_uploads FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_uploads_tenant ON client_uploads;
CREATE POLICY client_uploads_tenant ON client_uploads
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON client_uploads TO eins_app;
