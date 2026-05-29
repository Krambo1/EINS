-- Phase 1 hardening (P1-2): pvs_link pending→connected state machine.
--
-- Background:
--   The previous applyPvsEvent accepted events whenever pvs_link.status was
--   one of {connected, akkreditierung, pending} — i.e. a 'pending' link
--   was treated as live. That meant events ingested before an operator
--   confirmed the link applied their derive effects (revenue attribution,
--   ads-conversion fanout) against an unreviewed configuration. If the
--   wrong vendor was auto-set, the data lands in the wrong place silently.
--
-- The new contract:
--   • Events arriving at a 'pending' link are still WRITTEN to
--     pvs_event_log (audit trail, replayable), but the linker, derive
--     worker, and last_event_at update are SKIPPED.
--   • When the operator confirms the link via confirmPvsLinkActive(...),
--     the status flips to 'connected' AND every previously-quarantined
--     event for that clinic is replayed through the linker + derive.
--
-- Schema additions:
--   1. `link_status_at_ingest text NOT NULL`
--        Immutable snapshot of pvs_link.status at the moment this event
--        was inserted. Used by the replayer to find quarantined rows.
--        Backfill: every existing row predates the state machine, so
--        treat them as ingested under 'connected'.
--
--   2. `applied_at timestamptz`
--        NULL until the linker + derive ran successfully against this
--        event. Set in the same transaction as the linker/derive writes
--        (or right after). Replay selects rows WHERE applied_at IS NULL
--        AND link_status_at_ingest = 'pending'. Existing rows already
--        had their effects applied; backfill with ingested_at so the
--        replayer doesn't pick them up.
--
-- Partition note:
--   pvs_event_log is RANGE-partitioned by occurred_at (one partition per
--   calendar month per migration 0022). ALTER TABLE on the parent
--   automatically propagates the column definitions to all current
--   partitions. New partitions inherit the parent's columns.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE pvs_event_log
  ADD COLUMN IF NOT EXISTS link_status_at_ingest text NOT NULL DEFAULT 'connected';

ALTER TABLE pvs_event_log
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- Backfill: existing rows were applied at ingest time.
-- We set applied_at = ingested_at so the replay query skips them.
UPDATE pvs_event_log
  SET applied_at = ingested_at
  WHERE applied_at IS NULL;

-- Drop the default on link_status_at_ingest after backfill — new
-- rows MUST specify the snapshot explicitly so we can't silently
-- regress to "assume connected."
ALTER TABLE pvs_event_log
  ALTER COLUMN link_status_at_ingest DROP DEFAULT;

-- Index to make the replay query fast on big clinics. Partial index
-- so it only carries rows the replayer cares about.
CREATE INDEX IF NOT EXISTS pvs_event_log_pending_replay_idx
  ON pvs_event_log (clinic_id, occurred_at)
  WHERE applied_at IS NULL AND link_status_at_ingest = 'pending';
