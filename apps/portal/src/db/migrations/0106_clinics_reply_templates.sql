-- 0106_clinics_reply_templates.sql
-- The Praxis's own changes to the Antwortvorlagen on /bewertungen (Karam,
-- 2026-10-30: "expandable AND customizable"). Shape (validated in code,
-- bewertungen/_lib/reply-templates-store.ts):
--   { "edited": { "<standard id>": { "title": "...", "text": "..." } },
--     "custom": [ { "id": "eigene-...", "bucket": "positiv", "title": "...", "text": "..." } ] }
-- NULL = nothing changed: the standard templates as they ship. No backfill.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS reply_templates jsonb;
