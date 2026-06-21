-- 0062_asset_checkliste.sql
-- Asset-Liefer-Checkliste (Kunden-Onboarding): the clinic delivers all
-- onboarding assets through the portal instead of email-pingpong, EINS sees
-- per clinic in the admin what is still missing. Two tables:
--
--   checklist_items  — one row per (clinic, item id "A1".."F4"): the per-item
--                      two-stage state. Item definitions live in code
--                      (app/(portal)/onboarding/checkliste/content.ts), NOT in
--                      the DB, so this stays a dumb state store.
--   checklist_files  — one row per uploaded file (logo, AVV, certificates, ...).
--                      Separate table on purpose: multiple files per item are
--                      individually listable/removable, and parallel uploads
--                      (Rezeption + Marketing at once) never race on a jsonb
--                      array (read-modify-write would lose a write).
--
-- Two-stage status: the clinic sets 'geliefert' (or 'entfaellt' = nicht
-- vorhanden), EINS confirms 'geprueft' in the admin. Blocker items (Block A)
-- count for the Leistungsstart only once 'geprueft'. Re-delivering a verified
-- item drops it back to 'geliefert' so EINS re-checks. Notion source of truth:
-- "Asset-Liefer-Checkliste (Kunden-Onboarding)".

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS checklist_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  item_id       text NOT NULL,
  status        text NOT NULL DEFAULT 'offen',
  -- Angabe fields keyed by field id, plus a "link" url for link /
  -- upload_oder_link items and boolean flags (e.g. keineVorhanden). Shape is
  -- owned by content.ts; unknown keys are rejected at the action layer.
  answer        jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at  timestamptz,
  delivered_by  uuid REFERENCES clinic_users(id),
  -- EINS-side confirmation. verified_by is an admin email (admins are not
  -- clinic_users), so there is no FK here.
  verified_at   timestamptz,
  verified_by   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES clinic_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_items_status_check
    CHECK (status IN ('offen','geliefert','geprueft','entfaellt')),
  -- One row per item per clinic; upsert target.
  CONSTRAINT checklist_items_clinic_item_uniq UNIQUE (clinic_id, item_id)
);

ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_items_tenant ON checklist_items;
CREATE POLICY checklist_items_tenant ON checklist_items
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_items TO eins_app;

CREATE TABLE IF NOT EXISTS checklist_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  item_id           text NOT NULL,
  storage_key       text NOT NULL,
  original_filename text NOT NULL,
  content_type      text,
  size_bytes        bigint NOT NULL,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  uploaded_by       uuid REFERENCES clinic_users(id)
);

CREATE INDEX IF NOT EXISTS checklist_files_clinic_item_idx
  ON checklist_files (clinic_id, item_id);

ALTER TABLE checklist_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_files FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_files_tenant ON checklist_files;
CREATE POLICY checklist_files_tenant ON checklist_files
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_files TO eins_app;
