-- Persistent cache for Nominatim geocoding results.
--
-- Why cache: Nominatim's ToS asks for ≤ 1 req/sec and a stable User-Agent.
-- A handful of leads from the same city in a day would otherwise hammer it.
-- TTL split: 30d positive (city geometry is stable), 7d negative (typos /
-- misspellings might be corrected upstream).
--
-- normalized_query is a lowercased, whitespace-collapsed form so "  Berlin "
-- and "berlin" share a cache row. Keep that normalization in lockstep with
-- geocode/nominatim.ts; if either drifts, we get cache misses instead of
-- correctness bugs — but we also start hammering Nominatim.
--
-- Not tenant-scoped: city-name → coordinates is shared knowledge, not PII.
-- No RLS policy, GRANTed to eins_app directly.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS geocode_cache (
  normalized_query  text PRIMARY KEY,
  lat               numeric(9,6),       -- null = negative result (not found)
  lng               numeric(9,6),
  raw               jsonb,              -- full Nominatim response for audit
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS geocode_cache_expires_idx ON geocode_cache(expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON geocode_cache TO eins_app;
