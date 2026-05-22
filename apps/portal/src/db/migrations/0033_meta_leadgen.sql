-- Meta Lead-Ads — per-lead webhook ingestion.
--
-- Background: Round 2 testing revealed the Meta integration was OAuth-only;
-- sync-meta pulls aggregate insights (spend/impressions/leads-count) but
-- never the individual lead records. Praxen connecting Meta got campaign
-- numbers but no actual leads. This migration closes that gap.
--
-- Schema deltas:
--   • platform_credentials.meta_page_id            — the Facebook Page that
--     owns the lead forms. Auto-discovered from /me/accounts on OAuth.
--   • platform_credentials.meta_page_access_token_enc — page-scoped token
--     used to call /<leadgen_id>?fields=field_data. Distinct from the
--     user access token in access_token_enc; both rotate independently.
--   • requests.meta_lead_id — Meta's canonical leadgen id. Unique per
--     clinic so webhook retries from Meta dedupe at the DB.
--
-- Why two columns on platform_credentials instead of a new table:
--   In V1 each clinic owns exactly one Page (auto-picked on OAuth). When we
--   need to support clinics with multiple Pages, split into a child table
--   `meta_pages(clinic_id, page_id, …)`. Today we'd be over-engineering.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE platform_credentials
  ADD COLUMN IF NOT EXISTS meta_page_id text,
  ADD COLUMN IF NOT EXISTS meta_page_access_token_enc bytea;

-- Webhook payload entry[].id is the page_id; we index for the O(1) lookup
-- in the leadgen route. Partial index keeps the b-tree small (only Meta
-- rows have a page id).
CREATE INDEX IF NOT EXISTS platform_credentials_meta_page_idx
  ON platform_credentials(meta_page_id)
  WHERE meta_page_id IS NOT NULL;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS meta_lead_id text;

-- Idempotency: Meta retries delivery aggressively. The webhook handler
-- treats a duplicate insert as success — but only if the unique constraint
-- exists to make ON CONFLICT meaningful. Scoped per clinic because two
-- distinct Praxen can theoretically share an ad set (rare but possible).
CREATE UNIQUE INDEX IF NOT EXISTS requests_meta_lead_unique
  ON requests(clinic_id, meta_lead_id)
  WHERE meta_lead_id IS NOT NULL;
