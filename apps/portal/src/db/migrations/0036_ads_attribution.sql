-- Closed-loop revenue attribution: click-IDs on requests, per-praxis ads
-- config on clinics, and an append-only outbox of conversion uploads to
-- Meta CAPI + Google Ads OCI.
--
-- Pipeline:
--   /api/lead (clinic-landing) extracts fbclid/gclid/etc. from URL + cookies.
--   /api/leads/intake (portal) persists them onto requests.
--   PVS bridge delivers an InvoicePaid event → pvs-status-derive worker.
--   Derive worker inserts ONE outbox row per (request, InvoicePaid, channel),
--     then enqueues the channel-specific worker.
--   Workers POST to Meta CAPI (Purchase event) / Google Ads OCI
--     (uploadClickConversions). Outcome lands back in the outbox row.
--
-- Why columns on requests, not jsonb? The workers run a tight per-row
-- lookup; typed columns keep that path index-friendly and the schema
-- self-documenting. The lossy nature of click IDs (90-day lifetime, often
-- absent entirely) makes them genuinely first-class and not just metadata.
--
-- The outbox table is the single source of truth for what was attempted
-- and what the platform said back. The pvs_event_log row id is the natural
-- dedup unit: one InvoicePaid = at most one CAPI Purchase + one OCI upload.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- requests: click-IDs + client hints captured at lead intake.
-- All nullable: most requests will have neither fbclid nor gclid
-- (organic traffic, manual entry, walk-ins via PVS-only path).
-- ============================================================
ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS fbclid             text,
  ADD COLUMN IF NOT EXISTS gclid              text,
  ADD COLUMN IF NOT EXISTS wbraid             text,
  ADD COLUMN IF NOT EXISTS gbraid             text,
  ADD COLUMN IF NOT EXISTS fbc                text,
  ADD COLUMN IF NOT EXISTS fbp                text,
  ADD COLUMN IF NOT EXISTS click_user_agent   text,
  -- Anonymised at the edge (last octet of IPv4 / last 4 hextets of IPv6
  -- zeroed) before storage. CAPI accepts the anonymised form as a weaker
  -- but DSGVO-compliant geo signal. We store the anonymised string
  -- directly (not a hash) so the worker can pass it through without
  -- re-deriving anything.
  ADD COLUMN IF NOT EXISTS click_ip_anon      text;

-- Indexes only on the most commonly-joined columns. wbraid/gbraid are
-- Google's iOS-14-era fallbacks and rare enough to not warrant their own
-- index — the worker reads them only on already-located rows.
CREATE INDEX IF NOT EXISTS requests_fbclid_idx
  ON requests (clinic_id, fbclid)
  WHERE fbclid IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_gclid_idx
  ON requests (clinic_id, gclid)
  WHERE gclid IS NOT NULL;

-- ============================================================
-- clinics: per-praxis ads-conversion config.
--
-- Meta CAPI System-User token stays in env vars (META_CAPI_TOKEN_<SLUG>)
-- to match the existing clinic-landing convention; only the pixel id
-- lives in the DB. Google Ads access token is refreshed from
-- platform_credentials (platform='google'); only the customer id +
-- conversion-action resource name + optional MCC override live here.
-- ============================================================
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS meta_pixel_id                       text,
  ADD COLUMN IF NOT EXISTS google_ads_customer_id              text,
  ADD COLUMN IF NOT EXISTS google_ads_conversion_action        text,
  ADD COLUMN IF NOT EXISTS google_ads_login_customer_id        text;

-- Loose format check on the Google Ads customer id: 10 digits, dashes
-- allowed. We normalize to digits-only when calling the API.
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_google_ads_customer_id_check;
ALTER TABLE clinics ADD CONSTRAINT clinics_google_ads_customer_id_check CHECK (
  google_ads_customer_id IS NULL OR
  google_ads_customer_id ~ '^[0-9-]{10,15}$'
);

-- ============================================================
-- ads_conversion_outbox — one row per (request, InvoicePaid, channel).
--
-- Lifecycle:
--   pending  → enqueued, worker has not run yet
--   sent     → 2xx from platform, response stored
--   skipped  → preconditions not met (no fbclid/gclid; no clinic config;
--              no CAPI token; etc.); never enqueued
--   failed   → exhausted retries, response_body has last error
--
-- Idempotency: UNIQUE(clinic_id, channel, pvs_event_log_id). The
-- pvs_event_log row of the InvoicePaid event is stable and survives
-- pvs-status-derive replays, so a second derive run never duplicates.
-- ============================================================
CREATE TABLE IF NOT EXISTS ads_conversion_outbox (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id          uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  pvs_event_log_id    uuid NOT NULL,
  channel             text NOT NULL,
  event_name          text NOT NULL,
  value_eur           numeric(10,2) NOT NULL,
  occurred_at         timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'pending',
  attempt_count       integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  sent_at             timestamptz,
  response_code       integer,
  response_body       jsonb,
  -- Platform-side dedup key we sent on the wire. Stored so we can prove
  -- to support that we used a stable id (Meta event_id, Google order_id).
  dedup_key           text NOT NULL,
  -- Snapshot of the user_data we sent — useful for support tickets and
  -- DSGVO data-subject requests ("what did you send to Meta about me?").
  -- All PII is already hashed at the time it lands here.
  user_data_snapshot  jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ads_conversion_outbox_channel_check
    CHECK (channel IN ('meta', 'google')),
  CONSTRAINT ads_conversion_outbox_status_check
    CHECK (status IN ('pending', 'sent', 'skipped', 'failed')),
  CONSTRAINT ads_conversion_outbox_event_name_check
    CHECK (event_name IN ('Purchase'))
);

-- The dedup constraint that makes the outbox safe under PVS replays.
CREATE UNIQUE INDEX IF NOT EXISTS ads_conversion_outbox_unique
  ON ads_conversion_outbox (clinic_id, channel, pvs_event_log_id);

CREATE INDEX IF NOT EXISTS ads_conversion_outbox_status_idx
  ON ads_conversion_outbox (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ads_conversion_outbox_request_idx
  ON ads_conversion_outbox (request_id);

-- ============================================================
-- RLS: tenant-scoped via clinic_id, same pattern as 0031_rls_pvs.sql.
-- ============================================================
ALTER TABLE ads_conversion_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_conversion_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ads_conversion_outbox_tenant ON ads_conversion_outbox;
CREATE POLICY ads_conversion_outbox_tenant ON ads_conversion_outbox
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());
