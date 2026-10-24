-- 0085_assets_supersedes_idx.sql
-- /medien hides superseded asset versions with
--   NOT EXISTS (SELECT 1 FROM assets newer WHERE newer.supersedes_id = assets.id)
-- (listAssets in server/queries/assets.ts). Partial index so that probe is an
-- index lookup instead of a scan; only rows that supersede something are in it.
-- Additive and idempotent.

CREATE INDEX IF NOT EXISTS assets_supersedes_idx
  ON assets (supersedes_id)
  WHERE supersedes_id IS NOT NULL;
