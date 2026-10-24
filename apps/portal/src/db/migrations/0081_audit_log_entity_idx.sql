-- 0081_audit_log_entity_idx.sql
-- Index for the per-Anfrage Protokoll on /anfragen/[id] (portal review D-7).
--
-- The detail page reads the last 20 audit rows of one Anfrage
--   WHERE clinic_id = $1 AND entity_kind = 'request' AND entity_id = $2
--   ORDER BY created_at DESC LIMIT 20
-- and every page view appends another 'view' row. The existing indexes
-- (clinic_id, created_at) and (action) cannot serve an entity_id lookup, so
-- the read was a scan over the whole, steadily growing table.
--
-- CONCURRENTLY: no write lock on audit_log while it builds (the migration
-- runner applies such files outside a transaction). Additive, idempotent.

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_kind, entity_id, created_at DESC);
