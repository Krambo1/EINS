-- PVS Bridge — CSV upload bookkeeping.
--
-- One row per CSV file the clinic uploads via the wizard at
-- /einstellungen/integrationen/setup/csv. The pvs-csv-ingest worker reads
-- the storage_key, applies the mapping_json (column→canonical-field), and
-- emits canonical events through applyPvsEvent in-process.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_csv_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  storage_key        text NOT NULL,
  original_filename  text NOT NULL,
  -- Stream the CSV maps to: 'patients'|'appointments'|'encounters'|'invoices'.
  -- One upload row per stream — the wizard groups them as a single "upload session"
  -- via upload_group_id below.
  stream             text NOT NULL,
  mapping_json       jsonb NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  total_rows         int,
  processed_rows     int NOT NULL DEFAULT 0,
  error_count        int NOT NULL DEFAULT 0,
  error_summary      jsonb,
  upload_group_id    uuid,
  created_by         uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  CONSTRAINT pvs_csv_uploads_stream_check CHECK (
    stream IN ('patients','appointments','encounters','invoices')
  ),
  CONSTRAINT pvs_csv_uploads_status_check CHECK (
    status IN ('pending','processing','completed','failed','cancelled')
  )
);

CREATE INDEX IF NOT EXISTS pvs_csv_uploads_clinic_idx
  ON pvs_csv_uploads (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pvs_csv_uploads_status_idx
  ON pvs_csv_uploads (status, created_at);

CREATE INDEX IF NOT EXISTS pvs_csv_uploads_group_idx
  ON pvs_csv_uploads (upload_group_id);
