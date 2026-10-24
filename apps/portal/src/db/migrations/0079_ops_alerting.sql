-- 0079_ops_alerting.sql
-- Operator-facing alerting for the PVS bridge (EINS ops, not Praxis users).
--
--   1. worker_heartbeat  - the Fly worker writes a beat every 60 s, and a
--                          last-success stamp per PVS job. /api/health returns
--                          503 `worker_stale` when the beat is > 10 min old; the
--                          boot-time catch-up reads the per-job stamps.
--   2. ops_alert_log     - one row per (clinic, alert) with the time of the last
--                          operator email, so the 6 h rate limit survives
--                          serverless cold starts and worker restarts.
--   3. pvs_agent_status  - first_heartbeat_at (NULL = enrolled, never beat) and
--                          clock_skew_seconds (agent clock minus server clock).
--
-- No Drizzle mirror for 1 + 2: both are touched only through raw SQL in
-- server/worker-heartbeat.ts and server/ops-alerts.ts.

CREATE TABLE IF NOT EXISTS worker_heartbeat (
  name         text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ops_alert_log (
  scope_key    text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now()
);

-- Platform plumbing, written only by the superuser connection. Keep it off the
-- tenant role (docker/postgres/init grants new tables to eins_app by default).
REVOKE ALL ON worker_heartbeat FROM eins_app;
REVOKE ALL ON ops_alert_log FROM eins_app;

ALTER TABLE pvs_agent_status
  ADD COLUMN IF NOT EXISTS first_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_skew_seconds integer;

-- Every row that exists today was created by a heartbeat, so it has beaten.
UPDATE pvs_agent_status
   SET first_heartbeat_at = created_at
 WHERE first_heartbeat_at IS NULL;

COMMENT ON COLUMN pvs_agent_status.first_heartbeat_at IS
  'NULL = row seeded at agent enrollment and no heartbeat received yet (raises heartbeat_never after 2 h).';
COMMENT ON COLUMN pvs_agent_status.clock_skew_seconds IS
  'Agent sentAt minus portal receive time, in seconds. |skew| > 300 raises agent_clock_skew.';
