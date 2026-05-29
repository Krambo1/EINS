-- Phase 2 hardening (P2-1): operator reconciliation audit trail.
--
-- Background:
--   The reconciliation CLI (apps/portal/scripts/pvs-reconcile.ts) lets an
--   operator un-link a wrong fuzzy patient match, force a per-praxis
--   lifetime-revenue recompute, and replay a date range of events through
--   pvs-status-derive. Every applied action must be auditable: who, when,
--   what changed, with a JSON diff capturing the affected rows.
--
-- The state-machine work (P1-2) added a `needs_rederive` shaped column via
--   `applied_at`. For unlink+replay flows we need a separate mark: even an
--   already-applied row may need to be rederived if a fuzzy link upstream
--   turned out to be wrong. We add `needs_rederive boolean` so the derive
--   worker (and replay subcommand) has a clean signal to re-run effects
--   without touching applied_at.
--
-- Schema additions:
--   1. pvs_reconcile_audit — append-only history of operator CLI actions.
--      One row per applied action. Captures: actor (CLI user / system),
--      kind ('unlink' | 'recompute_lifetime' | 'replay_events'), targets
--      (clinic, patient ids), reason text, and a JSON diff of affected
--      rows (before + after snapshots, capped at 200 rows by the CLI).
--
--   2. pvs_event_log.needs_rederive boolean — opt-in flag the CLI sets
--      on rows the operator wants the derive worker to re-process. The
--      replay subcommand reads `WHERE needs_rederive = true` and clears
--      the flag after derive-enqueue succeeds.
--
-- Reversibility:
--   The audit table starts empty; dropping it loses history but breaks
--   nothing. needs_rederive defaults false on existing rows.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- (1) Reconcile audit table.
CREATE TABLE IF NOT EXISTS pvs_reconcile_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- 'unlink' | 'recompute_lifetime' | 'replay_events' | 'manual_repair'.
  -- Free-text so new subcommands don't need a migration; the CLI clamps
  -- the values it writes.
  kind        text NOT NULL,
  -- The OS user who ran the CLI (process.env.USER / USERNAME). Captured
  -- because the CLI runs without a portal-session identity. NULL when
  -- triggered from a worker.
  actor       text,
  -- Free-form reason the operator supplied via --reason. Bounded by the
  -- CLI to 500 chars.
  reason      text,
  -- Capped JSON snapshot of the affected rows BEFORE the action ran.
  -- Used to drive a hypothetical "undo" tool later. Bounded by the CLI.
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Capped JSON snapshot of the affected rows AFTER the action ran.
  after_state  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- True when invoked without --apply (records the dry-run for audit
  -- completeness). The CLI records both kinds so an operator's "I ran
  -- dry-run and then applied" trail is visible.
  dry_run     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pvs_reconcile_audit_clinic_idx
  ON pvs_reconcile_audit (clinic_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pvs_reconcile_audit_kind_idx
  ON pvs_reconcile_audit (kind, created_at DESC);

-- (2) pvs_event_log.needs_rederive flag.
--
-- ALTER on the parent propagates to existing partitions; new partitions
-- inherit. Defaulting to false is safe on backfill since existing rows
-- have already been processed.
ALTER TABLE pvs_event_log
  ADD COLUMN IF NOT EXISTS needs_rederive boolean NOT NULL DEFAULT false;

-- Partial index: small, scans only the rows the replayer cares about.
CREATE INDEX IF NOT EXISTS pvs_event_log_needs_rederive_idx
  ON pvs_event_log (clinic_id, occurred_at)
  WHERE needs_rederive = true;
