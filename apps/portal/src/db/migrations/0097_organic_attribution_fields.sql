-- 0097_organic_attribution_fields.sql
-- Organic-first portal, phase 1 (docs/umbau-ki-organisch/PORTAL-ORGANISCH-BAUPLAN.md).
--
-- requests:
--   attribution_confidence  how sure the portal is about the origin of an
--                           inquiry: messweg | plattform | selbstauskunft |
--                           praxis_eingabe | unbekannt. Written by persistLead
--                           (lib/sources.ts attributionConfidence). The backfill
--                           below mirrors that function for every stored source.
--   self_reported_source    "Wie sind Sie auf uns aufmerksam geworden?", closed
--                           list, no free text. Auswertung only, never a Messweg.
--   ttclid                  TikTok click id, attribution only (never reported).
--
-- patients:
--   first_touch_channel      reporting channel of the first-touch Anfrage
--   first_touch_content_code utm_content (post or ad) of that Anfrage
--   The content code is backfilled here; the channel needs the UTM rules in
--   lib/sources.ts and is backfilled by `pnpm --filter portal
--   backfill:first-touch` (idempotent) after this migration.
--
-- Nothing is renamed: every stored requests.source value stays valid.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS attribution_confidence text NOT NULL DEFAULT 'unbekannt';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS self_reported_source text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS ttclid text;

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_attribution_confidence_check;
ALTER TABLE requests ADD CONSTRAINT requests_attribution_confidence_check
  CHECK (attribution_confidence IN ('messweg','plattform','selbstauskunft','praxis_eingabe','unbekannt'));

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_self_reported_source_check;
ALTER TABLE requests ADD CONSTRAINT requests_self_reported_source_check
  CHECK (self_reported_source IS NULL OR self_reported_source IN
    ('instagram','facebook','tiktok','google_suche','empfehlung','sonstiges','anruf_praxis'));

-- Backfill: same sets as classifyAttribution() in lib/sources.ts.
UPDATE requests SET attribution_confidence = CASE
  WHEN lower(btrim(source)) IN (
    'formular','intake','landing','landing_form','zielseite',
    'anruf','tracking_anruf','call_tracking','tracking_call',
    'buchung','buchungslink','booking','booking_link'
  ) THEN 'messweg'
  WHEN lower(btrim(source)) IN ('meta','meta_lead_form','google','google_form','google_ads') THEN 'plattform'
  WHEN lower(btrim(source)) IN ('manuell','manual') THEN 'praxis_eingabe'
  WHEN lower(btrim(source)) IN ('empfehlung','referral','word_of_mouth') THEN 'selbstauskunft'
  ELSE 'unbekannt'
END
WHERE attribution_confidence = 'unbekannt';

ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_touch_channel text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS first_touch_content_code text;

-- Content code of the earliest attached Anfrage whose source is the
-- patient's first-touch source (the one firstTouchAfterAttach picked).
UPDATE patients p SET first_touch_content_code = left(ft.utm_content, 200)
FROM (
  SELECT DISTINCT ON (r.patient_id) r.patient_id, r.utm ->> 'utm_content' AS utm_content
  FROM requests r
  JOIN patients pp ON pp.id = r.patient_id
  WHERE r.source = pp.first_touch_source
  ORDER BY r.patient_id, r.created_at ASC
) ft
WHERE ft.patient_id = p.id
  AND p.first_touch_content_code IS NULL
  AND ft.utm_content IS NOT NULL
  AND btrim(ft.utm_content) <> '';
