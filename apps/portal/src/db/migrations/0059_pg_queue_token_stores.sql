-- 0059_pg_queue_token_stores.sql
--
-- Postgres-backed replacements for the two non-queue Redis consumers, part of
-- migrating the portal job system off Redis onto pg-boss:
--
--   1. admin_tokens  — single-use admin login + password-reset tokens
--                      (was the Redis adm:mlk: / adm:pwd: store with GETDEL).
--   2. rate_limits   — fixed-window rate-limit counters
--                      (was the Redis INCR/EXPIRE buckets).
--
-- The pg-boss queue self-manages its own `pgboss` schema (created by the worker
-- at boot with migrate:true, on the superuser connection), so no queue tables
-- live here.
--
-- Drizzle mirror: src/db/schema.ts (adminTokens, rateLimits).

-- =============================================================
-- 1. admin_tokens
-- =============================================================
CREATE TABLE IF NOT EXISTS admin_tokens (
  token_hash  text PRIMARY KEY,
  email       text NOT NULL,
  purpose     text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_tokens_expires_idx ON admin_tokens (expires_at);

-- admin_tokens holds login / password-reset token hashes + admin emails. Lock
-- it to the superuser, mirroring admin_users / admin_sessions (see 0002_rls.sql).
-- docker/postgres/init grants new public tables to eins_app via ALTER DEFAULT
-- PRIVILEGES, so this REVOKE is required, not cosmetic.
REVOKE ALL ON admin_tokens FROM eins_app;

-- =============================================================
-- 2. rate_limits
-- =============================================================
CREATE TABLE IF NOT EXISTS rate_limits (
  key           text PRIMARY KEY,
  count         integer NOT NULL,
  window_start  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start);

-- rate_limits is written only by the superuser `db` connection
-- (server/rate-limit.ts). The tenant role never needs it; keep it off eins_app.
REVOKE ALL ON rate_limits FROM eins_app;
