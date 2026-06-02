-- 0054_pvs_health_config_invalid.sql
--
-- Phase 5: a real first-poll value validator for the SQL-introspection agent.
--
-- The agent's schema-drift detector only catches a column that disappears or
-- is renamed (the explicit-column SELECT throws). It cannot catch a column
-- that still exists but holds the WRONG data: a paid-status code the YAML map
-- does not recognise, a mostly-NULL appointment-id column, a gross amount
-- where the map expects net. On the very first poll the agent now samples the
-- returned rows, normalises each via the YAML map, and refuses to baseline a
-- config whose data does not resolve. On failure it halts the stream and posts
-- a new health event: event_kind = 'config_invalid'.
--
-- This widens the pvs_link_health.event_kind CHECK to accept that value. The
-- table is small (one row per real config/health change, deduped), not
-- partitioned, so a plain DROP + ADD is cheap; no NOT VALID needed. Additive
-- widening only: no existing row can violate a CHECK that merely adds a value.
--
-- Deploy order (Phase 5 brief): this migration + the pvs-health.ts EventKind
-- enum ship BEFORE the agent build that can post 'config_invalid', so the
-- portal accepts the new health kind the moment the agent starts emitting it.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE pvs_link_health
  DROP CONSTRAINT IF EXISTS pvs_link_health_event_kind_check;

ALTER TABLE pvs_link_health
  ADD CONSTRAINT pvs_link_health_event_kind_check
  CHECK (event_kind IN (
    'schema_drift',
    'schema_recovered',
    'stream_error',
    'stream_recovered',
    'auth_expired',
    'connection_lost',
    'rate_limited',
    'config_invalid'
  ));
