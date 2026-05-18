-- Remove Trustpilot from the portal.
--
-- We initially planned to sync Trustpilot business unit data (added in 0014)
-- but discovered their read APIs are paywalled behind a Standard plan
-- (~€259/mo). Not worth it for a healthcare-clinic agency where Jameda +
-- Google carry essentially all reviews. We're ripping every Trustpilot
-- reference out instead of leaving dead UI and dead code lying around.

-- Drop any seeded or manually-entered trustpilot rows so the bewertungen
-- page stops rendering a tile for it.
DELETE FROM reviews WHERE platform = 'trustpilot';

-- Drop the per-clinic external-ID column added in 0014.
ALTER TABLE clinics DROP COLUMN IF EXISTS trustpilot_business_unit_id;

-- Replace the platform CHECK constraint to drop 'trustpilot' from the
-- allowed set. The constraint name comes from 0004_detail_mode.sql.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_platform_check;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_platform_check
  CHECK (platform IN ('google','jameda','manual'));
