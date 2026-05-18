-- Per-user "last seen" timestamps for sidebar sections that surface a
-- "Neu" pill (Fortschritt, Medien, Dokumente, …).
--
-- One row per (user, section). Badge logic compares the section's content
-- timestamps (e.g. MAX(documents.created_at)) against this user's row,
-- and the row is upserted to now() each time the user opens that section.
-- New table (rather than per-section columns on clinic_users) so adding
-- a new badge-capable section in the future is one row of config, not a
-- schema migration.

CREATE TABLE IF NOT EXISTS user_nav_section_views (
  user_id uuid NOT NULL
    REFERENCES clinic_users(id) ON DELETE CASCADE,
  section text NOT NULL,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section)
);

-- RLS policy matches the rest of the per-user tables: rows are visible to
-- whichever clinic owns the user. Lookup is always via JOIN on
-- clinic_users, so we scope via that path.
ALTER TABLE user_nav_section_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_nav_section_views_tenant ON user_nav_section_views;
CREATE POLICY user_nav_section_views_tenant ON user_nav_section_views
  USING (
    user_id IN (
      SELECT id FROM clinic_users WHERE clinic_id = app_current_clinic()
    )
  )
  WITH CHECK (
    user_id IN (
      SELECT id FROM clinic_users WHERE clinic_id = app_current_clinic()
    )
  );
