-- PVS Bridge — extend platform_credentials platform enum to allow 'pvs'.
--
-- The PVS HMAC secret is partitioned from the 'intake' secret so rotation
-- and breach blast-radius are isolated. /api/leads/intake and
-- /api/patients/events keep using platform='intake'; /api/pvs/events,
-- /api/pvs/events/batch, and the GDT-Agent direct POST all use platform='pvs'.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE platform_credentials
  DROP CONSTRAINT IF EXISTS platform_credentials_platform_check;

ALTER TABLE platform_credentials
  ADD CONSTRAINT platform_credentials_platform_check
  CHECK (platform IN ('meta','google','intake','pvs'));
