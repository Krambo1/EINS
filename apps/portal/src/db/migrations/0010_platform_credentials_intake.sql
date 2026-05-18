-- Extend platform_credentials.platform to allow 'intake' rows.
--
-- The clinic-landing → portal lead mirror signs each POST with a per-clinic
-- HMAC-SHA256 secret. The secret is stored encrypted in this table with
-- platform='intake' and decrypted on demand by verifyLeadSignature().
--
-- The drizzle schema mirror in src/db/schema.ts already lists 'meta','google'
-- — bump it to include 'intake' alongside this migration.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE platform_credentials
  DROP CONSTRAINT IF EXISTS platform_credentials_platform_check;

ALTER TABLE platform_credentials
  ADD CONSTRAINT platform_credentials_platform_check
  CHECK (platform IN ('meta','google','intake'));
