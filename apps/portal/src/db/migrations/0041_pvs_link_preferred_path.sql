-- Phase 4: REST / DB-read failover selector for the same vendor.
--
-- A single Praxis on a multi-path vendor (currently only Tomedo, which has
-- both a cloud REST adapter and a Phase 1 SQL-introspection agent path) needs
-- a single source of truth for which path is authoritative. Without this,
-- both paths would emit the same canonical events twice; the portal would
-- dedup them via `pvs_event_log.pvs_external_event_id`, but the doubled
-- traffic is wasteful and the link's "last_event_at" race is unreadable.
--
-- The column models the brief Section 5.7 "preferred_path" contract:
--
--   'auto'    : let the bridge decide. Today: REST when an adapter exists,
--               DB-read otherwise. Default for all existing rows.
--   'rest'    : force the cloud scheduler to poll this link via the REST
--               adapter; ignore any agent-side db-adapter for the same vendor.
--   'db_read' : force the cloud scheduler to skip this link; the on-prem
--               agent's SQL-introspection runner owns the path.
--
-- The cloud scheduler reads this in `loadDueLinks` (apps/bridge/src/db/
-- client.ts). The on-prem agent does not care: it polls whatever vendor
-- configs the operator enrolled via --enable-db-adapter, which is a
-- machine-local decision.
--
-- Backwards compat: existing rows default to 'auto'. No code path interprets
-- a NULL value because the column is NOT NULL.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE pvs_link
  ADD COLUMN IF NOT EXISTS preferred_path text NOT NULL DEFAULT 'auto';

ALTER TABLE pvs_link
  DROP CONSTRAINT IF EXISTS pvs_link_preferred_path_check;

ALTER TABLE pvs_link
  ADD CONSTRAINT pvs_link_preferred_path_check
  CHECK (preferred_path IN ('auto', 'rest', 'db_read'));

-- Hot path for the cloud scheduler: "give me links that should run REST".
-- The scheduler already filters on (status='connected', vendor in REST set,
-- next_poll_at <= now); the new filter is "preferred_path != 'db_read'".
-- A partial index keeps the planner happy without scanning rows that are
-- explicitly opted out of cloud polling.
CREATE INDEX IF NOT EXISTS pvs_link_due_rest_idx
  ON pvs_link (status, pvs_vendor)
  WHERE preferred_path <> 'db_read';
