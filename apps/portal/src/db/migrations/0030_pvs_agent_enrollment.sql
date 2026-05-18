-- PVS Bridge — one-time enrollment tokens for the GDT-Agent.
--
-- Flow:
--   1. Inhaber clicks "Agent installieren" in the portal. A row is inserted
--      here with a random token. The plaintext is shown ONCE in the UI and
--      embedded in the agent installer command line.
--   2. The agent (running on the Praxis Windows/Mac host) POSTs
--      /api/pvs/agent-enroll with { clinicId, token, machineFingerprint }.
--   3. The route verifies the token, mints a per-link HMAC secret (storing
--      it encrypted in platform_credentials with platform='pvs'), marks
--      the token consumed, and returns the secret to the agent ONCE.
--   4. Agent persists the secret encrypted via DPAPI (Windows) / Keychain (Mac).

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_agent_enrollment_tokens (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  token_hash            text NOT NULL UNIQUE,
  -- Optional pinning: when set, only an agent reporting this fingerprint
  -- can redeem. Filled by the UI when the inhaber knows the target host.
  expected_fingerprint  text,
  created_by            uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  consumed_at           timestamptz,
  consumed_fingerprint  text,
  consumed_ip           inet
);

CREATE INDEX IF NOT EXISTS pvs_agent_enrollment_tokens_clinic_idx
  ON pvs_agent_enrollment_tokens (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pvs_agent_enrollment_tokens_expiry_idx
  ON pvs_agent_enrollment_tokens (expires_at)
  WHERE consumed_at IS NULL;
