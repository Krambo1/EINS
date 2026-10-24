-- 0082: auth hardening (portal review WS6).
--
--   1. audit_log.impersonated_by_admin_id
--      Every audit row written while an EINS admin works inside a Praxis via
--      "Als Benutzer öffnen" carries the admin id. actor_id stays the
--      impersonated clinic user (the session's identity), so existing joins
--      keep working; this column is what makes the write attributable to the
--      admin (B-24 / G-10). NULL = a real Praxis user acted.
--
--   2. platform_credentials.previous_access_token_enc + previous_valid_until
--      Rotating the Zielseiten intake secret keeps the previous secret valid
--      for a grace window (24 h), so a click on "Geheimnis rotieren" no longer
--      makes every landing-page form fail until EINS updates the Zielseite
--      (C-34 / F-11). Rotating twice in a row drops the original secret at
--      once (leak response).
--
-- Additive and idempotent. Both tables are written by the superuser
-- connection only; no grant changes needed.

ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS impersonated_by_admin_id uuid;

CREATE INDEX IF NOT EXISTS audit_log_impersonated_idx
  ON audit_log (impersonated_by_admin_id, created_at)
  WHERE impersonated_by_admin_id IS NOT NULL;

COMMENT ON COLUMN audit_log.impersonated_by_admin_id IS
  'admin_users.id when the action ran inside an admin impersonation session ("Als Benutzer öffnen"); NULL when the Praxis user acted.';

ALTER TABLE platform_credentials
  ADD COLUMN IF NOT EXISTS previous_access_token_enc bytea,
  ADD COLUMN IF NOT EXISTS previous_valid_until timestamptz;

COMMENT ON COLUMN platform_credentials.previous_access_token_enc IS
  'Previous secret after a rotation (intake only). Accepted by signature checks until previous_valid_until.';
