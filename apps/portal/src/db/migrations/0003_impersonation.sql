-- Admin "View as clinic user" impersonation.
--
-- Adds:
--   1. sessions.impersonated_by_admin_id — distinguishes impersonation
--      sessions from real ones. NULL for the regular magic-link flow.
--   2. impersonation_tokens — short-lived (60s), single-use handoff between
--      admin.localhost (issuer) and localhost (consumer). Token cleartext
--      lives only in the URL; we store its sha256 here.
--
-- Both objects sit OUTSIDE the RLS app role's reach: sessions/* tables
-- are queried on the superuser connection (see db/client.ts:41), and the
-- impersonation token consumer also runs there because the user has no
-- session yet at consume time.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS impersonated_by_admin_id uuid
    REFERENCES admin_users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS impersonation_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      text UNIQUE NOT NULL,
  admin_id        uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  target_user_id  uuid NOT NULL REFERENCES clinic_users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  issue_ip        inet
);

CREATE INDEX IF NOT EXISTS impersonation_tokens_target_idx
  ON impersonation_tokens(target_user_id);
CREATE INDEX IF NOT EXISTS impersonation_tokens_expiry_idx
  ON impersonation_tokens(expires_at);

-- App role has no business reading these — admin-only writes/reads through
-- the superuser connection. Mirrors the admin_users / admin_sessions stance
-- in 0002_rls.sql.
REVOKE ALL ON impersonation_tokens FROM eins_app;
