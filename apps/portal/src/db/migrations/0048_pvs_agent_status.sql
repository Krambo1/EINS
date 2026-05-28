-- Phase 2 hardening (P2-2): agent heartbeat + failure-summary surface.
--
-- The GDT-Agent (apps/bridge/agent) POSTs a heartbeat every 60s and a
-- failure-summary roll-up once per day before pruning failed outbox rows
-- locally. The portal stores them so the admin clinic detail page can
-- answer "is this Praxis's agent healthy?" without anyone SSH-ing into
-- the workstation, and "what events did we permanently lose, when, and
-- why?" without grepping agent logs.
--
-- Schema:
--   1. pvs_agent_status
--      One row per clinic (the agent runs at most once per Praxis).
--      Upserted on every heartbeat. The dashboard reads:
--        - last_heartbeat_at: when did we last hear from the agent?
--        - failed_events: how many outbox rows are dead-lettered right now?
--        - oldest_failed_at: when did the oldest unsent failure originate?
--        - last_failure_reason: human-readable last error text
--        - recent_reasons: array of {reason, count} for the "Show last 10"
--          expander. Capped at 10 entries by the agent.
--
--   2. pvs_agent_failure_summary
--      Append-only history of dead-letter prune events. One row per
--      successful failure-summary POST. Lets the operator answer "what
--      happened on the agent between 2026-04-01 and 2026-04-30" even
--      after the local SQLite outbox has pruned those rows.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_agent_status (
  clinic_id            uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  agent_version        text,
  last_heartbeat_at    timestamptz NOT NULL DEFAULT now(),
  failed_events        integer     NOT NULL DEFAULT 0,
  oldest_failed_at     timestamptz,
  last_failure_reason  text,
  -- JSON array of {reason: text, count: integer} entries; capped at 10
  -- by the agent. Stored as jsonb so the admin page can render it
  -- without a join.
  recent_reasons       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pvs_agent_status_failed_idx
  ON pvs_agent_status (clinic_id)
  WHERE failed_events > 0;

CREATE TABLE IF NOT EXISTS pvs_agent_failure_summary (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Number of failed outbox rows the agent pruned in this run.
  pruned_count         integer NOT NULL,
  -- Window the pruned rows covered.
  pruned_oldest_at     timestamptz,
  pruned_newest_at     timestamptz,
  -- Reasons rolled up by the agent (top 10 by count).
  reasons              jsonb   NOT NULL DEFAULT '[]'::jsonb,
  -- When the agent POSTed this summary. May lag behind pruned_newest_at
  -- by minutes-to-days depending on network state.
  reported_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pvs_agent_failure_summary_clinic_idx
  ON pvs_agent_failure_summary (clinic_id, reported_at DESC);
