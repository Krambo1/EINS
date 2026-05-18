-- Review platform external IDs — Google Places, Trustpilot, Jameda.
--
-- The portal already stores public review-submit URLs (`google_review_url`,
-- `jameda_review_url`) used by EINS Stimme to redirect satisfied patients.
-- Pulling live rating + review-count data needs different identifiers:
--
--   * Google: a Place ID (e.g. ChIJN1t_tDeuEmsRUsoyG83frY4) for the
--             Places API (New). Cheap, server-side API key, no per-clinic
--             OAuth.
--   * Trustpilot: a Business Unit ID (e.g. 5d8f49a30000ff000a8c0123) for
--             the Trustpilot Business API. One platform-wide API key,
--             rate-limited but generous.
--   * Jameda: no public API exists — we scrape the profile page's
--             schema.org JSON-LD block. The submit URL ends in `/bewerten/`;
--             the profile URL is the parent path. We store the profile URL
--             explicitly to avoid fragile derivation.
--
-- All three are optional per clinic: a missing ID means we skip the sync
-- for that platform (no error, no empty snapshot).

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS google_place_id              text,
  ADD COLUMN IF NOT EXISTS trustpilot_business_unit_id  text,
  ADD COLUMN IF NOT EXISTS jameda_profile_url           text;
