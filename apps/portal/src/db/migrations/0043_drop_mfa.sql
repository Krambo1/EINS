-- Remove TOTP / Authenticator-app MFA.
--
-- Karam decided to drop MFA entirely: admin allowlist + IP gate are the
-- second factor for /admin; clinic login is now password-only. Password
-- reset / magic-link flow continues to exist (unchanged surface).
--
-- This migration:
--   * drops mfa_enrolled / mfa_secret_enc / mfa_backup_codes from clinic_users
--     and the matching pair from admin_users
--   * drops mfa_verified from sessions + admin_sessions
--   * drops the trusted_devices table (its only purpose was "remember this
--     browser so I don't have to type the TOTP code")
--
-- Irreversible by design. The mfa_secret_enc material is encrypted with
-- ENCRYPTION_KEY anyway; dropping the column doesn't expose anything that
-- wasn't already opaque to non-key-holders.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinic_users
  DROP COLUMN IF EXISTS mfa_enrolled,
  DROP COLUMN IF EXISTS mfa_secret_enc,
  DROP COLUMN IF EXISTS mfa_backup_codes;

ALTER TABLE admin_users
  DROP COLUMN IF EXISTS mfa_enrolled,
  DROP COLUMN IF EXISTS mfa_secret_enc;

ALTER TABLE sessions
  DROP COLUMN IF EXISTS mfa_verified;

ALTER TABLE admin_sessions
  DROP COLUMN IF EXISTS mfa_verified;

DROP TABLE IF EXISTS trusted_devices;
