-- 0069: persist the agent's operational-health heartbeat fields.
--
-- The on-prem agent has been sending these on every 60s heartbeat since the
-- H10c/H13/M-A2/M-D4 work (apps/bridge/agent/src/index.ts, emitHeartbeat):
--
--   pendingCount, oldestPendingAt, stalePendingCount,
--   missingFolders, dbAdaptersFailed, adapterStatuses
--
-- The portal's Zod envelope did not list them, and Zod's default object mode
-- strips unknown keys silently, so every one of them was parsed, discarded
-- and answered with 200 ok. There were no columns to put them in either.
--
-- Why that matters: failed_events is a DEAD-LETTER counter. It counts events
-- that were read, attempted and permanently rejected. The three most likely
-- real-world install failures produce zero events AND zero failures, so they
-- are indistinguishable from a quiet week at the Praxis:
--
--   * the GDT export folder moved or the share remapped (missing_folders)
--   * the DB adapters never started, e.g. rotated PVS credentials after an
--     update (db_adapters_failed), or one stream halted (adapter_statuses)
--   * the outbox is queueing and retrying forever behind a new Praxis
--     firewall rule, so nothing has permanently failed yet but hours of
--     revenue sit on the workstation (pending_events / stale_pending_events)
--
-- With these columns the portal can tell "nothing happened" apart from
-- "nothing is working" without anyone touching the Praxis machine.
--
-- Purely additive; every column has a default so the existing single row per
-- clinic stays valid and an older agent that omits the fields keeps working.

ALTER TABLE pvs_agent_status
  ADD COLUMN IF NOT EXISTS pending_events integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stale_pending_events integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oldest_pending_at timestamptz,
  ADD COLUMN IF NOT EXISTS missing_folders jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS db_adapters_failed text,
  ADD COLUMN IF NOT EXISTS adapter_statuses jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN pvs_agent_status.pending_events IS
  'Outbox rows queued but not yet accepted by the portal. Distinct from failed_events, which only counts permanently dead rows.';
COMMENT ON COLUMN pvs_agent_status.stale_pending_events IS
  'Subset of pending_events older than the agent stale threshold (1h). Non-zero means the backlog is stuck, not merely in flight.';
COMMENT ON COLUMN pvs_agent_status.missing_folders IS
  'Configured watch folders the agent could not find on its last folder scan. Non-empty means the file path moved and the agent is reading nothing.';
COMMENT ON COLUMN pvs_agent_status.db_adapters_failed IS
  'Error message when startRunner threw at boot, else NULL. Non-NULL means no DB-adapter stream is running at all.';
COMMENT ON COLUMN pvs_agent_status.adapter_statuses IS
  'Per-vendor/per-stream snapshot from the DB-adapter runner (status, lastError, connectError). Surfaces a single halted stream that the aggregate counters hide.';
