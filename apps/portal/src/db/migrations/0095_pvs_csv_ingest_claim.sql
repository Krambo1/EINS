-- 0095_pvs_csv_ingest_claim.sql
-- PVS CSV import without the worker (decision C8, 2026-10-08).
--
-- A confirmed upload (status 'processing') is now processed inline right
-- after the mapping is confirmed, with /api/cron/daily and /api/cron/morning
-- catching up whatever was missed; the pg-boss worker may run the same job
-- if it is ever switched on. Every runner first takes an atomic claim:
--   * claimed_at: when a runner took the file. A claim older than 15 minutes
--     counts as dead (function timeout, crash) and may be taken again.
--     Refreshed while a run makes progress.
--   * ingest_attempts: claims taken so far. After the limit the upload is
--     marked 'failed' instead of being retried forever.
-- Status values are unchanged; claimed_at NULL + status 'processing' means
-- "confirmed, waiting for a runner".
--
-- Additive, idempotent. New columns inherit the table grants (eins_app).

ALTER TABLE pvs_csv_uploads ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE pvs_csv_uploads ADD COLUMN IF NOT EXISTS ingest_attempts int NOT NULL DEFAULT 0;
