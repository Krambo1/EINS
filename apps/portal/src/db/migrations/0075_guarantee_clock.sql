-- 0075: guarantee clock for "Keine Anfrage, keine Rechnung" (admin only).
--
-- A Praxis pays nothing until the first qualified inquiry through an EINS
-- measurement path (EINS-Messweg) arrives. If none arrives within 90 calendar
-- days from signing, extended by delay days, the collaboration ends at no cost
-- (KANON.md section 5). These tables hold the facts behind that clock:
--
--   guarantee_clocks                   one row per clinic: signing date, the
--                                      confirmed first qualified inquiry, and a
--                                      manual end state
--   guarantee_delays                   Praxis delays and platform disruptions
--                                      that extend the deadline
--   guarantee_candidate_rejections     inquiries Karam ruled out as the first
--                                      qualified one, with the reason
--
-- Only FACTS are stored. Deadline, "Tag X von N", days left and the derived
-- states (läuft, Rechnung fällig, beendet ohne Anfrage) are computed by the
-- pure module src/lib/guarantee-clock.ts, so a delay entered after the
-- deadline passed simply moves the deadline instead of needing a state repair.
--
-- PRIVILEGES: admin only, the Praxis must not see this yet. No eins_app GRANT
-- (same treatment as pvs_vendor_config in 0071 and outreach_videos in 0073),
-- plus an explicit REVOKE and RLS enabled without any policy, so even a future
-- blanket GRANT would still return zero rows to the tenant role. The admin
-- pages read and write on the superuser (owner) handle, which RLS does not
-- apply to.

CREATE TABLE IF NOT EXISTS guarantee_clocks (
  clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,

  -- Day of signing. The 90 days run from here.
  signed_on date NOT NULL,

  -- Confirmed first qualified inquiry. Only this sets "Rechnung fällig".
  -- inquiry_on is the Berlin calendar date the inquiry arrived, frozen at
  -- confirmation so the evidence survives even if the request row is deleted.
  qualifying_request_id uuid REFERENCES requests(id) ON DELETE SET NULL,
  qualifying_inquiry_on date,
  qualifying_confirmed_by text,
  qualifying_confirmed_at timestamptz,

  -- Ends Karam records by hand. The other states are derived.
  manual_end_state text,
  manual_end_on date,
  manual_end_note text,
  manual_end_set_by text,
  manual_end_set_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guarantee_clocks_manual_end_check CHECK (
    manual_end_state IS NULL
    OR manual_end_state IN ('beendet_durch_praxis', 'beendet_plattform_stoerung')
  ),
  CONSTRAINT guarantee_clocks_manual_end_complete CHECK (
    (manual_end_state IS NULL) = (manual_end_on IS NULL)
  ),
  CONSTRAINT guarantee_clocks_qualifying_complete CHECK (
    (qualifying_inquiry_on IS NULL) = (qualifying_confirmed_at IS NULL)
  ),
  -- An ended clock cannot also have a confirmed inquiry, and vice versa.
  CONSTRAINT guarantee_clocks_single_outcome CHECK (
    qualifying_inquiry_on IS NULL OR manual_end_state IS NULL
  )
);

CREATE TABLE IF NOT EXISTS guarantee_delays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  -- verzug: the Praxis missed a Mitwirkung (Kanon section 6).
  -- plattform_stoerung: platform blocked the account or changed its rules.
  kind text NOT NULL DEFAULT 'verzug',

  -- Inclusive range of counted days. For verzug: from the day after the
  -- missed Mitwirkungs-deadline through the day of fulfilment. to_date NULL =
  -- still open, counts through today.
  from_date date NOT NULL,
  to_date date,

  reason text NOT NULL,
  -- When EINS told the Praxis by e-mail (Kanon: EINS teilt jeden Verzug per
  -- E-Mail mit). NULL = not notified yet; the admin page flags it.
  notified_at timestamptz,

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guarantee_delays_kind_check CHECK (kind IN ('verzug', 'plattform_stoerung')),
  CONSTRAINT guarantee_delays_range_check CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS guarantee_delays_clinic_idx
  ON guarantee_delays (clinic_id, from_date);

CREATE TABLE IF NOT EXISTS guarantee_candidate_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,

  reason text NOT NULL,
  note text,

  rejected_by text,
  rejected_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT guarantee_rejections_reason_check CHECK (reason IN (
    'spam_automatisiert',
    'dieselbe_person_30_tage',
    'bewerbung',
    'verkaufsangebot',
    'keine_kontaktdaten'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS guarantee_rejections_request_idx
  ON guarantee_candidate_rejections (request_id);

CREATE INDEX IF NOT EXISTS guarantee_rejections_clinic_idx
  ON guarantee_candidate_rejections (clinic_id);

ALTER TABLE guarantee_clocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantee_delays ENABLE ROW LEVEL SECURITY;
ALTER TABLE guarantee_candidate_rejections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE ALL ON guarantee_clocks, guarantee_delays, guarantee_candidate_rejections FROM eins_app;
  END IF;
END
$$;
