-- Phase 1 hardening (P1-3, P1-2 prep):
--
--   1. `pvs_agent_enrollment_tokens.allow_vendor_switch` — operator opt-in
--      flag captured at token-creation time. The redemption path refuses
--      to flip pvs_link.pvs_vendor unless this flag is set on the token
--      used. A typical install (greenfield Praxis on no prior PVS) gets
--      vendor_switch=false; an explicit "we're migrating from Tomedo to
--      gdt_agent" install gets vendor_switch=true. Without this gate, any
--      operator who reuses an enrollment flow on a clinic with a prior
--      cloud-adapter setup silently switches the vendor and starts
--      rejecting the old adapter's events (which is the "the dashboard
--      stopped updating three weeks ago" failure mode the plan calls out).
--
--   2. `pvs_link_audit` — append-only history of pvs_link state changes.
--      Captures vendor switches, status transitions (pending → connected,
--      etc.), and reissue/rotation events. Surfaced in the admin clinic
--      detail page; used by reconciliation tooling (Phase 2) and the
--      red-team test plan.
--
-- Both changes are additive and backward-compatible: existing tokens
-- default to allow_vendor_switch=false (the safe choice), and pvs_link_audit
-- starts empty.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- (1) Token-creation flag.
ALTER TABLE pvs_agent_enrollment_tokens
  ADD COLUMN IF NOT EXISTS allow_vendor_switch boolean NOT NULL DEFAULT false;

-- (2) Audit table.
CREATE TABLE IF NOT EXISTS pvs_link_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- One of: 'vendor_switch', 'status_change', 'secret_rotated',
  -- 'enrollment_redeemed', 'manual_override'. Free-text rather than a
  -- CHECK constraint so new event kinds don't need a migration.
  kind text NOT NULL,
  -- Previous and new values for the field that changed, both serialized
  -- as text so the audit row is grep-able without a JSON path. NULL means
  -- "not applicable" (e.g. enrollment_redeemed doesn't have a 'from').
  from_value text,
  to_value text,
  -- Free-form context for the operator: e.g. the redeeming agent's
  -- machineFingerprint, or the operator's justification for a manual
  -- override. Bounded to discourage payload bloat; truncated upstream.
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Who triggered the change. NULL when the trigger was a system action
  -- (e.g. derive-worker auto-recovery) rather than an operator.
  actor_user_id uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pvs_link_audit_clinic_idx
  ON pvs_link_audit (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pvs_link_audit_kind_idx
  ON pvs_link_audit (kind, created_at DESC);
