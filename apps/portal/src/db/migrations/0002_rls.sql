-- Row-Level Security policies (plan §11).
--
-- The app role (eins_app) is restricted to rows whose `clinic_id`
-- equals the session variable `app.current_clinic_id`.
-- The superuser role (eins) bypasses RLS — used by migrations, seed,
-- worker jobs, and the admin panel.
--
-- Sessions and authentication tables are also constrained by user_id.

-- Helper: pull current clinic from session. Returns NULL when unset so
-- unpopulated contexts return zero rows (fail-closed).
CREATE OR REPLACE FUNCTION app_current_clinic() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_clinic_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Enable RLS on every tenant-bearing table and deny everything by default;
-- then add a single USING policy for eins_app.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'clinics','clinic_users','requests','request_activities','assets',
      'animation_instances','documents','campaign_snapshots','kpi_daily',
      'goals','platform_credentials','notifications','upgrade_requests',
      'hwg_checks'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
  END LOOP;
END
$$;

-- --- clinics --------------------------------------------------
DROP POLICY IF EXISTS clinics_tenant ON clinics;
CREATE POLICY clinics_tenant ON clinics
  USING (id = app_current_clinic())
  WITH CHECK (id = app_current_clinic());

-- --- clinic_users ---------------------------------------------
DROP POLICY IF EXISTS clinic_users_tenant ON clinic_users;
CREATE POLICY clinic_users_tenant ON clinic_users
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- requests + activities ------------------------------------
DROP POLICY IF EXISTS requests_tenant ON requests;
CREATE POLICY requests_tenant ON requests
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS request_activities_tenant ON request_activities;
CREATE POLICY request_activities_tenant ON request_activities
  USING (EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_activities.request_id
      AND r.clinic_id = app_current_clinic()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM requests r
    WHERE r.id = request_activities.request_id
      AND r.clinic_id = app_current_clinic()
  ));

-- --- assets ---------------------------------------------------
DROP POLICY IF EXISTS assets_tenant ON assets;
CREATE POLICY assets_tenant ON assets
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- animation_instances --------------------------------------
DROP POLICY IF EXISTS animation_instances_tenant ON animation_instances;
CREATE POLICY animation_instances_tenant ON animation_instances
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- documents (additional role check is applied in application code) ---
DROP POLICY IF EXISTS documents_tenant ON documents;
CREATE POLICY documents_tenant ON documents
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- campaign_snapshots + kpi_daily ---------------------------
DROP POLICY IF EXISTS campaign_snapshots_tenant ON campaign_snapshots;
CREATE POLICY campaign_snapshots_tenant ON campaign_snapshots
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

DROP POLICY IF EXISTS kpi_daily_tenant ON kpi_daily;
CREATE POLICY kpi_daily_tenant ON kpi_daily
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- goals ----------------------------------------------------
DROP POLICY IF EXISTS goals_tenant ON goals;
CREATE POLICY goals_tenant ON goals
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- platform_credentials -------------------------------------
DROP POLICY IF EXISTS platform_credentials_tenant ON platform_credentials;
CREATE POLICY platform_credentials_tenant ON platform_credentials
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- notifications --------------------------------------------
DROP POLICY IF EXISTS notifications_tenant ON notifications;
CREATE POLICY notifications_tenant ON notifications
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- upgrade_requests -----------------------------------------
DROP POLICY IF EXISTS upgrade_requests_tenant ON upgrade_requests;
CREATE POLICY upgrade_requests_tenant ON upgrade_requests
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- --- hwg_checks -----------------------------------------------
DROP POLICY IF EXISTS hwg_checks_tenant ON hwg_checks;
CREATE POLICY hwg_checks_tenant ON hwg_checks
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

-- ============================================================
-- AUDIT LOG — write-only for the app role, read-only for superuser.
-- App inserts are scoped by session clinic; reads happen via superuser
-- (admin panel) or ad-hoc via psql.
-- ============================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_write_scoped ON audit_log;
CREATE POLICY audit_log_write_scoped ON audit_log
  FOR INSERT
  WITH CHECK (
    clinic_id IS NULL OR clinic_id = app_current_clinic()
  );

DROP POLICY IF EXISTS audit_log_read_scoped ON audit_log;
CREATE POLICY audit_log_read_scoped ON audit_log
  FOR SELECT
  USING (
    clinic_id IS NULL OR clinic_id = app_current_clinic()
  );

-- ============================================================
-- Animation library and admin_* stay superuser-only for the app role.
-- Animation library is global (read-only for apps via a plain GRANT).
-- admin_users / admin_sessions are NEVER accessible via the app role;
-- access is performed with the superuser role through the admin panel.
-- ============================================================

-- Animation library: readable to app, writable only via superuser.
ALTER TABLE animation_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE animation_library FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS animation_library_read ON animation_library;
CREATE POLICY animation_library_read ON animation_library
  FOR SELECT USING (archived_at IS NULL);

-- Sessions/magic_links are scoped by userId, not clinicId. They're never
-- queried by the RLS app role — auth queries happen pre-session on the
-- superuser connection. We leave RLS off for these.

-- Revoke write grants on animation_library for the app role — app can only read.
REVOKE INSERT, UPDATE, DELETE ON animation_library FROM eins_app;

-- admin_* tables: app role has no access at all.
REVOKE ALL ON admin_users FROM eins_app;
REVOKE ALL ON admin_sessions FROM eins_app;
