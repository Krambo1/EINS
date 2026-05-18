-- Add lat/lng to locations for distance scoring in the rule-based AI scorer.
--
-- Stored as numeric(9,6) — six decimals of degrees ≈ 11 cm of resolution,
-- which is overkill for our use case but trivial in storage. The columns are
-- nullable: a location is geocoded lazily by the worker on first use, the
-- result is persisted back here, and the next lead skips the Nominatim hit.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS lng numeric(9,6);

-- Partial index — we only query rows with coordinates, and most locations
-- start out without them.
CREATE INDEX IF NOT EXISTS locations_geo_idx
  ON locations(clinic_id)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
