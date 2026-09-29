-- 0073: outreach videos on eins.ag/v/<slug>.
--
-- THE GAP THIS CLOSES
--
-- Teardown videos for outreach went out as Loom or Google Drive links. Neither
-- told us whether the Praxis opened the link, how far they watched or whether
-- they clicked through to book a Gespräch, and none of it was readable by the
-- outreach tooling. These tables hold the video (the bytes live in R2) and a
-- cookieless event log that the admin page and the token API aggregate.
--
-- PRIVACY: no cookie, no IP. `viewer_hash` is an HMAC over IP + user agent +
-- UTC day with a key derived from SESSION_SECRET, so it groups one device's
-- events within one day and cannot be reversed to an IP or linked across days.
--
-- PRIVILEGES: no RLS and no eins_app GRANT, the same treatment as
-- pvs_vendor_config in 0071. These rows belong to EINS, not to a Praxis
-- tenant; only the admin pages and the public/token routes read them, all on
-- the superuser handle.

CREATE TABLE IF NOT EXISTS outreach_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Public handle in the URL. Random, 10 chars from a 31-char alphabet
  -- (~49 bits), so links cannot be enumerated.
  slug text NOT NULL UNIQUE,

  praxis_name text NOT NULL,
  title text,
  -- Short personal note shown above the video.
  message text,
  recipient_email text,
  -- Row in the Notion leads DB, so tooling can join stats to the lead.
  notion_page_id text,

  storage_key text NOT NULL,
  poster_key text,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  duration_seconds integer,

  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS outreach_videos_created_idx
  ON outreach_videos (created_at DESC);

CREATE TABLE IF NOT EXISTS outreach_video_events (
  id bigserial PRIMARY KEY,
  video_id uuid NOT NULL REFERENCES outreach_videos(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('open', 'play', 'progress', 'cta')),
  -- Watch milestone for 'progress' (10/25/50/75/90/100), 0 for everything else.
  percent smallint NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),

  -- Random per page load, generated in the browser, never stored there.
  session_id text NOT NULL,
  viewer_hash text NOT NULL,
  -- Opened from the admin page (?intern=1): kept, but left out of the stats.
  internal boolean NOT NULL DEFAULT false,
  device text CHECK (device IN ('mobile', 'tablet', 'desktop')),

  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per session and milestone. The event route inserts with
-- ON CONFLICT DO NOTHING, so a replayed or spammed beacon cannot inflate
-- the numbers.
CREATE UNIQUE INDEX IF NOT EXISTS outreach_video_events_dedupe_idx
  ON outreach_video_events (video_id, session_id, kind, percent);

CREATE INDEX IF NOT EXISTS outreach_video_events_video_idx
  ON outreach_video_events (video_id, created_at);
