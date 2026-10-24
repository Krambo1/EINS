-- Outreach videos: the optional pointer to the lead / teardown moves from a
-- Notion page id to an Obsidian reference (Notion is retired).
--
-- Stored value is either an obsidian://open?vault=Karam&file=... URI or a
-- 32-hex lead-id (existing values are old Notion row ids, which equal the
-- lead-id of the migrated vault note). Only admin paths read this column
-- (listOutreachVideos: admin pages and the token API); the public watch page
-- does not select it.
ALTER TABLE outreach_videos RENAME COLUMN notion_page_id TO obsidian_ref;

COMMENT ON COLUMN outreach_videos.obsidian_ref IS
  'Obsidian link (obsidian://open?vault=Karam&file=...) or 32-hex lead-id of the vault note; nullable.';
