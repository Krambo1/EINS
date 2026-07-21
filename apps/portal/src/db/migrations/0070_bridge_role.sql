-- PVS Bridge — the `eins_bridge` database role.
--
-- The bridge server (apps/bridge, Fastify + polling scheduler on Fly) connects
-- to THIS database with its own restricted role, passed as BRIDGE_DATABASE_URL.
-- Until this migration the role existed only as hand-typed DDL in the Neon
-- console: nothing in the repo could recreate it, so a DB rebuild silently
-- dropped the bridge's only way in. This file is that DDL, checked in.
--
-- Scope is derived from apps/bridge/src/db/client.ts and is deliberately the
-- exact set of statements that file issues, nothing wider:
--
--   pvs_link              SELECT  (listConnectedLinks, loadDueLinks,
--                                  getLinkByClinicAndVendor)
--                         UPDATE  (status, updated_at) only: recordFailure
--                                 trips a link to 'error', clearErrorStatus
--                                 restores it to 'connected'
--   pvs_sync_status       SELECT, INSERT, UPDATE: checkpointSync,
--                         markInitialSyncStarted, completeInitialSync,
--                         recordFailure
--   platform_credentials  SELECT (clinic_id, platform, access_token_enc):
--                         loadClinicPvsSecret decrypts the per-clinic HMAC
--                         secret with APP_KEY
--
-- Everything else the bridge needs flows through the portal's HTTP API
-- (HMAC-signed POSTs to /api/pvs/events), not through this connection.
--
-- ── RLS ───────────────────────────────────────────────────────────────
-- All three tables are FORCE ROW LEVEL SECURITY with tenant-only policies
-- keyed on app_current_clinic() (migrations 0002, 0031). The bridge is a
-- cross-tenant service: it never sets app.current_clinic_id, so under those
-- policies alone it would read exactly zero rows. FORCE RLS applies to the
-- table owner too, and Neon does not hand out BYPASSRLS, so the role gets
-- its own permissive policies below. The GRANTs above are the real privilege
-- boundary; the policies only decide row visibility.
--
-- ── The password is NOT here ──────────────────────────────────────────
-- The role is created NOLOGIN on purpose so this file carries no secret.
-- To actually let the bridge connect, run once per environment, out of band:
--
--   ALTER ROLE eins_bridge WITH LOGIN PASSWORD '<generated>';
--
-- then set the DSN on Fly (direct Neon endpoint, NOT the pooler):
--
--   fly secrets set -a eins-bridge \
--     BRIDGE_DATABASE_URL="postgres://eins_bridge:<generated>@<host>/neondb"
--
-- Rotating the password is the same ALTER ROLE + fly secrets set pair.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- Role. NOLOGIN until a password is set out of band (see header).
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_bridge') THEN
    CREATE ROLE eins_bridge NOLOGIN;
  END IF;
END
$$;

-- CONNECT is granted to PUBLIC by default, but say it explicitly so the role
-- still works if that default is ever revoked (mirrors the eins_app grant in
-- docker/postgres/init/01-extensions.sql). Dynamic because the database is
-- `eins_portal` locally and `neondb` on Neon.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO eins_bridge;', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO eins_bridge;

-- ============================================================
-- Table privileges — the privilege boundary.
-- ============================================================
GRANT SELECT                            ON pvs_link             TO eins_bridge;
GRANT UPDATE (status, updated_at)       ON pvs_link             TO eins_bridge;
GRANT SELECT, INSERT, UPDATE            ON pvs_sync_status      TO eins_bridge;
GRANT SELECT (clinic_id, platform, access_token_enc)
                                        ON platform_credentials TO eins_bridge;

-- ============================================================
-- RLS policies — row visibility for the cross-tenant service role.
-- ============================================================
DROP POLICY IF EXISTS pvs_link_bridge ON pvs_link;
CREATE POLICY pvs_link_bridge ON pvs_link
  TO eins_bridge
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS pvs_sync_status_bridge ON pvs_sync_status;
CREATE POLICY pvs_sync_status_bridge ON pvs_sync_status
  TO eins_bridge
  USING (true)
  WITH CHECK (true);

-- Narrower than the other two: the bridge only ever reads the 'pvs' row
-- (loadClinicPvsSecret filters on it), so Meta/Google tokens in the same
-- table stay invisible to this role even though it holds SELECT on it.
DROP POLICY IF EXISTS platform_credentials_bridge ON platform_credentials;
CREATE POLICY platform_credentials_bridge ON platform_credentials
  FOR SELECT
  TO eins_bridge
  USING (platform = 'pvs');
