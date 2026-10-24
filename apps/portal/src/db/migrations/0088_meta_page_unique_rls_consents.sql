-- 0088_meta_page_unique_rls_consents.sql
-- Fix-Welle 2, FX-D (portal review J-1, J-3, J-9, L-6, L-4).
-- Additive and idempotent. Role statements are guarded with IF EXISTS so the
-- file also runs on Neon, where eins_app may be named or granted differently.

-- ---------------------------------------------------------------------------
-- J-1: one Facebook page belongs to at most one Praxis. Incoming Meta leads
-- are routed by page id; a page bound to two Praxen would hand a patient
-- inquiry to a guessed Praxis. Existing duplicates stop the migration with a
-- clear message instead of being resolved by guessing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(meta_page_id, ', ') INTO dup FROM (
    SELECT meta_page_id FROM platform_credentials
    WHERE meta_page_id IS NOT NULL
    GROUP BY meta_page_id HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION
      '0088: Facebook-Seite(n) % sind mit mehreren Praxen verbunden. Bei der falschen Praxis meta_page_id und meta_page_access_token_enc auf NULL setzen, dann erneut migrieren.', dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS platform_credentials_meta_page_uniq
  ON platform_credentials (meta_page_id)
  WHERE meta_page_id IS NOT NULL;

-- The old non-unique partial index on the same column is now redundant.
DROP INDEX IF EXISTS platform_credentials_meta_page_idx;

-- ---------------------------------------------------------------------------
-- J-3: clinic_notices and email_suppression get RLS. ENABLE only, no FORCE:
-- every current access runs on the owner / superuser connection (`db`),
-- which bypasses RLS and stays unchanged. The app role gets nothing on
-- clinic_notices and only a tenant-scoped SELECT on email_suppression.
-- ---------------------------------------------------------------------------
ALTER TABLE clinic_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppression ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_suppression_tenant ON email_suppression;
CREATE POLICY email_suppression_tenant ON email_suppression
  FOR SELECT
  USING (clinic_id = app_current_clinic());

-- J-3 + J-9: tables that no app-role (withClinicContext / dbApp / withApiTx)
-- code path touches. Checked by grep on 2026-10-07: every access to these
-- tables goes through `db` (auth/session.ts, auth/magic-link.ts,
-- server/clinic-notices.ts, server/email-suppression.ts, patient-events.ts,
-- review-tokens.ts, webhooks/resend, geocode/nominatim.ts,
-- timeline-journey.ts, outreach-videos.ts, admin journey actions,
-- db/migrate.ts on DATABASE_URL_DIRECT).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE ALL ON clinic_notices FROM eins_app;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON email_suppression FROM eins_app;
    GRANT SELECT ON email_suppression TO eins_app;
    REVOKE ALL ON sessions, magic_links, schema_migrations FROM eins_app;
    REVOKE ALL ON geocode_cache, timeline_default_steps FROM eins_app;
    IF to_regclass('public.outreach_videos') IS NOT NULL THEN
      REVOKE ALL ON outreach_videos FROM eins_app;
    END IF;
    IF to_regclass('public.outreach_video_events') IS NOT NULL THEN
      REVOKE ALL ON outreach_video_events FROM eins_app;
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- L-6: consent record per Anfrage. Shape (written by server/leads.ts):
--   { "basis": "landing_form" | "meta_leadform",
--     "privacy":   { "version": "...", "at": "<iso>" },
--     "ageGate":   { "given": true, "at": "<iso>" },
--     "ai":        { "given": bool, "version": "...", "at": "<iso>" },
--     "marketing": { "given": bool, "version": "...", "at": "<iso>", "pending": "doi" },
--     "metaFormId": "..." }
-- NULL on rows from before this migration.
-- ---------------------------------------------------------------------------
ALTER TABLE requests ADD COLUMN IF NOT EXISTS consents jsonb;

-- ---------------------------------------------------------------------------
-- L-4: the retention sweep selects by created_at across all clinics.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS requests_created_at_idx ON requests (created_at);
