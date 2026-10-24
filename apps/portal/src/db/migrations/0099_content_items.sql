-- 0099_content_items.sql
-- Organic-first portal, phase 3: posts (Beiträge), where they went live, and
-- the tagged links that carry their code (PORTAL-ORGANISCH-BAUPLAN.md).
--
-- content_items         one post as EINS made it. `code` is the opaque post
--                       code (lib/post-code.ts, 5 characters, no vowels),
--                       unique per Praxis; it is what utm_content carries.
-- content_publications  where and when a post went live (permalink pasted by
--                       EINS, D4 "manual with permalink"), and when it stopped.
-- content_links         the generated tagged links per post and medium.
-- requests.content_item_id  the post an inquiry came from, resolved at intake
--                       from utm_content (clinic + code). A code that matches
--                       the pattern but no post keeps only its raw utm value
--                       and is listed in the admin.
--
-- Privileges: the Praxis reads its own rows (FORCE RLS, SELECT policy,
-- GRANT SELECT to eins_app); only EINS writes (superuser handle).

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS content_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code          text NOT NULL,
  title         text NOT NULL,
  treatment_id  uuid REFERENCES treatments(id) ON DELETE SET NULL,
  format        text NOT NULL,
  uses_clone    boolean NOT NULL DEFAULT false,
  ai_content    boolean NOT NULL DEFAULT true,
  asset_id      uuid REFERENCES assets(id) ON DELETE SET NULL,
  caption       text,
  hwg_check_id  uuid REFERENCES hwg_checks(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'entwurf',
  stop_reason   text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_items_code_check
    CHECK (code ~ '^(?=[bcdfghjkmnpqrstvwxz2-9]*[2-9])(?=[bcdfghjkmnpqrstvwxz2-9]*[bcdfghjkmnpqrstvwxz])[bcdfghjkmnpqrstvwxz2-9]{5}$'),
  CONSTRAINT content_items_format_check
    CHECK (format IN ('reel','story','karussell','bild','video')),
  CONSTRAINT content_items_status_check
    CHECK (status IN ('entwurf','zur_freigabe','aenderung','freigegeben','geplant','live','gestoppt')),
  CONSTRAINT content_items_stop_reason_check
    CHECK (status <> 'gestoppt' OR (stop_reason IS NOT NULL AND btrim(stop_reason) <> '')),
  CONSTRAINT content_items_clinic_code_uniq UNIQUE (clinic_id, code)
);
CREATE INDEX IF NOT EXISTS content_items_clinic_status_idx ON content_items (clinic_id, status);

CREATE TABLE IF NOT EXISTS content_publications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id    uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  clinic_id          uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  platform           text NOT NULL,
  platform_media_id  text,
  permalink          text NOT NULL,
  published_at       timestamptz NOT NULL,
  stopped_at         timestamptz,
  published_by       text NOT NULL DEFAULT 'manuell',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_publications_platform_check CHECK (platform IN ('instagram','facebook','tiktok')),
  CONSTRAINT content_publications_by_check CHECK (published_by IN ('manuell','api')),
  CONSTRAINT content_publications_permalink_check CHECK (permalink ~ '^https://'),
  CONSTRAINT content_publications_permalink_uniq UNIQUE (permalink)
);
CREATE INDEX IF NOT EXISTS content_publications_item_idx ON content_publications (content_item_id);
CREATE INDEX IF NOT EXISTS content_publications_clinic_idx ON content_publications (clinic_id, published_at);

CREATE TABLE IF NOT EXISTS content_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  clinic_id        uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  medium           text NOT NULL,
  url              text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_links_medium_check CHECK (medium IN ('profil_link','dm','story_link','organisch')),
  CONSTRAINT content_links_item_medium_uniq UNIQUE (content_item_id, medium)
);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS content_item_id uuid
  REFERENCES content_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS requests_content_item_idx
  ON requests (content_item_id) WHERE content_item_id IS NOT NULL;

ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_items_tenant_read ON content_items;
CREATE POLICY content_items_tenant_read ON content_items
  FOR SELECT USING (clinic_id = app_current_clinic());

ALTER TABLE content_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_publications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_publications_tenant_read ON content_publications;
CREATE POLICY content_publications_tenant_read ON content_publications
  FOR SELECT USING (clinic_id = app_current_clinic());

ALTER TABLE content_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_links_tenant_read ON content_links;
CREATE POLICY content_links_tenant_read ON content_links
  FOR SELECT USING (clinic_id = app_current_clinic());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    GRANT SELECT ON content_items, content_publications, content_links TO eins_app;
  END IF;
END
$$;
