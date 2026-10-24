-- 0077: separate consent for reporting an inquiry and a later treatment to
-- Meta and Google.
--
-- Rule (owner decision 2026-10-06): a "Lead" (form submit) or "Purchase"
-- (PVS shows a paid invoice) goes to Meta or Google ONLY when BOTH hold:
--   1. the person ticked the optional, not pre-checked consent checkbox in
--      the EINS form (clinic-landing step-contact), and
--   2. the person came via a paid ad of THAT platform (Meta: paid-Meta UTM,
--      classifyAttribution() channel = meta_anzeige; Google: gclid / wbraid /
--      gbraid on the request).
-- Without both, nothing is reported to that platform.
--
--   ads_consent_at          server time the intake accepted the consent;
--                           NULL = never given (Meta Lead Gen webhook, manual
--                           entries, imports, old landing clients)
--   ads_consent_version     version of the consent text the person saw
--                           (clinic-landing ADS_CONSENT_VERSION)
--   ads_consent_revoked_at  set by the Praxis on the request detail page when
--                           the person withdraws consent
--
-- The capi-purchase / oci-purchase workers check these columns at SEND time,
-- so a revoke before sending stops a pending report.
--
-- PRIVILEGES: eins_app holds table-level privileges on requests (no
-- column-level GRANTs anywhere), so the new columns are covered as-is. RLS on
-- requests (0002) already scopes them to the session's clinic.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS ads_consent_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ads_consent_version     text,
  ADD COLUMN IF NOT EXISTS ads_consent_revoked_at  timestamptz;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_ads_consent_revoked_check;
ALTER TABLE requests ADD CONSTRAINT requests_ads_consent_revoked_check
  CHECK (ads_consent_revoked_at IS NULL OR ads_consent_at IS NOT NULL);
