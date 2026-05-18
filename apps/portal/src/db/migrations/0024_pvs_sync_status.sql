-- PVS Bridge — per-link sync bookkeeping.
--
-- One row per pvs_link. The bridge scheduler ticks every 30s and queries
-- WHERE next_poll_at <= now() AND status='connected' to find due links.
-- Polling adapters (Tomedo) update last_incremental_cursor; push adapters
-- (HealthHub, RED) update last_event_at via the events route.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_sync_status (
  pvs_link_id                 uuid PRIMARY KEY REFERENCES pvs_link(id) ON DELETE CASCADE,
  last_initial_sync_started_at  timestamptz,
  last_initial_sync_completed_at timestamptz,
  last_incremental_at         timestamptz,
  last_incremental_cursor     text,
  consecutive_failure_count   int NOT NULL DEFAULT 0,
  last_error                  text,
  last_error_at               timestamptz,
  next_poll_at                timestamptz,
  total_events_ingested       bigint NOT NULL DEFAULT 0,
  total_events_last_24h       int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pvs_sync_status_next_poll_idx
  ON pvs_sync_status (next_poll_at);
