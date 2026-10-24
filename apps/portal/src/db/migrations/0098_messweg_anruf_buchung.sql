-- 0098_messweg_anruf_buchung.sql
-- Organic-first portal, phase 2: the EINS-Messwege "Anruf auf EINS-Tracking-
-- Nummer" and "Buchung über EINS-Buchungslink" (KANON § 5, Garantie-Anhang § 2).
--
-- tracking_numbers  one row per EINS tracking number of a Praxis (Matelso pool).
--                   channel says where the number is shown, so a call carries
--                   its channel. Admin writes, Praxis reads.
-- booking_links     one row per EINS booking link (Calendly event type).
--                   external_ref = the provider's id for it (Calendly event type
--                   URI), used to find the Praxis of a booking. Admin writes,
--                   Praxis reads.
-- messweg_events    the provider log: one row per webhook delivery that EINS
--                   accepted, idempotent on (provider, external_id). This is
--                   the "Protokoll der Tracking-Nummer" and the "Buchungs-
--                   Eintrag" the contract names as proof. Metadata only: no
--                   call recording, no message text. Admin only.
-- requests          tracking_number_id / booking_link_id: which number or link
--                   the Messweg-Anfrage came through.
-- request_activities kind 'messweg': the same person called or booked again
--                   within 30 days (counted once, KANON § 5). Never a contact
--                   attempt of the Praxis (response-time.ts ignores it).

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS tracking_numbers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- E.164 without spaces, e.g. +4922112345678.
  e164        text NOT NULL,
  channel     text NOT NULL,
  provider    text NOT NULL DEFAULT 'matelso',
  label       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT tracking_numbers_channel_check
    CHECK (channel IN ('profil','zielseite','meta','google','sonstige')),
  CONSTRAINT tracking_numbers_provider_check CHECK (provider IN ('matelso','fixture')),
  CONSTRAINT tracking_numbers_e164_check CHECK (e164 ~ '^\+[1-9][0-9]{6,14}$')
);
-- A number belongs to one Praxis at a time; a pool number reassigned later is
-- deactivated first.
CREATE UNIQUE INDEX IF NOT EXISTS tracking_numbers_active_e164_uidx
  ON tracking_numbers (e164) WHERE active;
CREATE INDEX IF NOT EXISTS tracking_numbers_clinic_idx ON tracking_numbers (clinic_id);

CREATE TABLE IF NOT EXISTS booking_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'calendly',
  url          text NOT NULL,
  external_ref text NOT NULL,
  medium       text NOT NULL,
  label        text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT booking_links_medium_check CHECK (medium IN ('profil_link','dm','zielseite')),
  CONSTRAINT booking_links_provider_check CHECK (provider IN ('calendly','fixture')),
  CONSTRAINT booking_links_url_check CHECK (url ~ '^https://')
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_links_active_ref_uidx
  ON booking_links (provider, external_ref) WHERE active;
CREATE INDEX IF NOT EXISTS booking_links_clinic_idx ON booking_links (clinic_id);

CREATE TABLE IF NOT EXISTS messweg_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  external_id  text NOT NULL,
  kind         text NOT NULL,
  -- NULL when the number or link is not assigned to any Praxis.
  clinic_id    uuid REFERENCES clinics(id) ON DELETE CASCADE,
  request_id   uuid REFERENCES requests(id) ON DELETE SET NULL,
  outcome      text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  -- Provider facts only: called number, caller number, duration, booking
  -- time, utm. Never a recording or free text.
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messweg_events_kind_check CHECK (kind IN ('anruf','buchung')),
  CONSTRAINT messweg_events_outcome_check
    CHECK (outcome IN ('angelegt','zusammengefasst','ohne_praxis','ignoriert')),
  CONSTRAINT messweg_events_provider_uniq UNIQUE (provider, external_id)
);
CREATE INDEX IF NOT EXISTS messweg_events_clinic_idx ON messweg_events (clinic_id, received_at DESC);

ALTER TABLE requests ADD COLUMN IF NOT EXISTS tracking_number_id uuid
  REFERENCES tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS booking_link_id uuid
  REFERENCES booking_links(id) ON DELETE SET NULL;

ALTER TABLE request_activities DROP CONSTRAINT IF EXISTS request_activities_kind_check;
ALTER TABLE request_activities ADD CONSTRAINT request_activities_kind_check
  CHECK (kind IN ('note','call','email','whatsapp','status_change','ai_rescore','assignment','messweg'));

-- Praxis reads its own numbers and links (onboarding checklist block G);
-- only EINS (superuser handle) writes.
ALTER TABLE tracking_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_numbers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tracking_numbers_tenant_read ON tracking_numbers;
CREATE POLICY tracking_numbers_tenant_read ON tracking_numbers
  FOR SELECT USING (clinic_id = app_current_clinic());

ALTER TABLE booking_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_links_tenant_read ON booking_links;
CREATE POLICY booking_links_tenant_read ON booking_links
  FOR SELECT USING (clinic_id = app_current_clinic());

-- Provider log: admin only (0076 pattern).
ALTER TABLE messweg_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    GRANT SELECT ON tracking_numbers TO eins_app;
    GRANT SELECT ON booking_links TO eins_app;
    REVOKE ALL ON messweg_events FROM eins_app;
  END IF;
END
$$;
