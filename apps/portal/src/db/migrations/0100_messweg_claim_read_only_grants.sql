-- 0100_messweg_claim_read_only_grants.sql
-- Organic-first portal, fixes after the phase 1-3 check
-- (PORTAL-ORGANISCH-STAND.md).
--
-- 1. messweg_events.outcome 'in_arbeit': the claim row a delivery writes
--    before it is processed. A claim that stays 'in_arbeit' (process died
--    between claim and result) is taken over by the provider's next retry
--    once it is older than the stale window in server/messweg/ingest.ts,
--    so a call or booking is never lost silently.
-- 2. The Praxis only reads the Messweg and Beiträge tables. Default
--    privileges hand eins_app INSERT/UPDATE/DELETE on every new table;
--    FORCE RLS with a SELECT-only policy already blocks those writes, this
--    makes the grant match the intent so the policy is not the only barrier.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE messweg_events DROP CONSTRAINT IF EXISTS messweg_events_outcome_check;
ALTER TABLE messweg_events ADD CONSTRAINT messweg_events_outcome_check
  CHECK (outcome IN ('in_arbeit','angelegt','zusammengefasst','ohne_praxis','ignoriert'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON tracking_numbers, booking_links, content_items, content_publications, content_links
      FROM eins_app;
    GRANT SELECT
      ON tracking_numbers, booking_links, content_items, content_publications, content_links
      TO eins_app;
  END IF;
END
$$;
