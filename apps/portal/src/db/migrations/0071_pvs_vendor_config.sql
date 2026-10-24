-- 0071: remote delivery of PVS vendor configs.
--
-- THE GAP THIS CLOSES
--
-- A vendor config (apps/bridge/agent/src/db-adapters/configs/*.yaml) is the
-- SQL the on-prem agent runs against a Praxis PVS. When a PVS update renames a
-- column, the agent's drift detector halts the affected stream and the only
-- recovery was: edit the YAML, cut a new agent build, and reinstall it on every
-- affected machine. At two Praxen that is an afternoon. At thirty on the same
-- PVS, one Tomedo update is thirty site visits for a one-line change.
--
-- These tables make the config a thing the portal delivers. The agent pulls the
-- manifest on its 60s heartbeat, fetches what differs, and puts it into force
-- without anyone touching the workstation.
--
-- WHY THE PORTAL CANNOT MINT ONE
--
-- Whoever can push a config has arbitrary read access to patient databases on
-- every connected machine, so the Ed25519 signing key deliberately does NOT
-- live here. Bundles are signed offline (apps/bridge/agent/scripts/
-- sign-vendor-config.ts) and uploaded finished. This portal verifies with a
-- PUBLIC key (PVS_CONFIG_PUBLIC_KEYS) and stores the bundle verbatim; the agent
-- verifies again before applying. A full compromise of this database can
-- withhold an update or replay an old one, and the agent's monotonic-version
-- rule refuses the replay.
--
-- ROLLOUT IS EXPLICIT. A freshly uploaded config reaches nobody: rollout_mode
-- starts at 'off'. 'pilot' delivers only to the clinics listed in
-- pvs_vendor_config_target. 'all' delivers to everyone running that vendor.
--
-- PRIVILEGES: no RLS and no eins_app GRANT on either table, deliberately, the
-- same treatment as timeline_default_steps in 0063. These are operator surfaces
-- read only by the admin pages and the agent endpoints, both of which run on the
-- superuser handle. Since a row here decides which SQL executes against a Praxis
-- patient database, "the tenant-scoped role physically cannot reach it" is a
-- stronger guarantee than any policy we could write.

CREATE TABLE IF NOT EXISTS pvs_vendor_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The YAML `vendor:` id, e.g. 'tomedo-db'. Not a bridge_source: several
  -- vendor ids can map to the same source (both CGM-M1 variants → cgm_m1pro).
  vendor text NOT NULL,

  -- Monotonic per vendor. Agents refuse anything at or below what they run, so
  -- a revert is published as a NEW version carrying the older YAML.
  version integer NOT NULL,

  -- Signed mirrors of the YAML's own fields, so the admin UI can render a
  -- config without parsing YAML and cannot be shown something the agent would
  -- not run (the agent cross-checks these against the parsed YAML).
  bridge_source text NOT NULL,
  driver text NOT NULL,
  streams jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_agent_version text NOT NULL,
  notes text,

  yaml text NOT NULL,
  sha256 text NOT NULL,
  key_id text NOT NULL,
  signature text NOT NULL,
  signed_at timestamptz NOT NULL,

  -- The bundle exactly as uploaded. This is what gets served to agents, byte
  -- for byte: re-assembling it from the columns above would risk a field order
  -- or whitespace difference that invalidates the signature.
  bundle jsonb NOT NULL,

  rollout_mode text NOT NULL DEFAULT 'off'
    CHECK (rollout_mode IN ('off', 'pilot', 'all')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),

  uploaded_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,

  CONSTRAINT pvs_vendor_config_version_unique UNIQUE (vendor, version)
);

COMMENT ON TABLE pvs_vendor_config IS
  'Signed PVS vendor configs distributed to on-prem agents. Signatures are minted offline; this table only verifies and serves.';
COMMENT ON COLUMN pvs_vendor_config.bundle IS
  'The uploaded bundle verbatim. Served to agents unmodified so the offline signature stays valid.';
COMMENT ON COLUMN pvs_vendor_config.rollout_mode IS
  'off = delivered to nobody (default on upload); pilot = only clinics in pvs_vendor_config_target; all = every clinic running this vendor.';

-- Manifest resolution asks for "newest active version per vendor", so the
-- index is (vendor, version DESC) with the rollout filter applied on top.
CREATE INDEX IF NOT EXISTS pvs_vendor_config_vendor_version_idx
  ON pvs_vendor_config (vendor, version DESC);
CREATE INDEX IF NOT EXISTS pvs_vendor_config_rollout_idx
  ON pvs_vendor_config (rollout_mode, status);

-- Per-clinic pin. Serves two purposes with one row: the pilot allowlist for a
-- staged rollout, and holding one Praxis on a known-good version while a newer
-- one goes wide.
CREATE TABLE IF NOT EXISTS pvs_vendor_config_target (
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  vendor text NOT NULL,
  config_id uuid NOT NULL REFERENCES pvs_vendor_config(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_email text,
  PRIMARY KEY (clinic_id, vendor)
);

COMMENT ON TABLE pvs_vendor_config_target IS
  'Per-clinic config pin. Overrides rollout_mode in both directions: it delivers a pilot version, and it holds a clinic back from an all-rollout.';

CREATE INDEX IF NOT EXISTS pvs_vendor_config_target_config_idx
  ON pvs_vendor_config_target (config_id);

-- What each agent reports it is ACTUALLY running. Without this the portal can
-- advertise v7 to thirty Praxen and have no idea that six of them refused it.
ALTER TABLE pvs_agent_status
  ADD COLUMN IF NOT EXISTS vendor_configs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS config_sync_error text,
  ADD COLUMN IF NOT EXISTS config_rollbacks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pvs_agent_status.vendor_configs IS
  'Remote vendor configs in force on this machine: [{vendor, version, sha256, appliedAt, source}]. A vendor missing here runs the config bundled with its agent build.';
COMMENT ON COLUMN pvs_agent_status.config_sync_error IS
  'Why the agent last failed to pull or apply a config, else NULL. Non-NULL with a version mismatch means the push is stuck, not merely slow.';
COMMENT ON COLUMN pvs_agent_status.config_rollbacks IS
  'Configs this machine reverted on its own after they halted a previously healthy stream: [{vendor, rejectedVersion, revertedTo, reason, at}]. A rolled-back version is never re-applied there.';
