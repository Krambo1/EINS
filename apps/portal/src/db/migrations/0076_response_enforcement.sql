-- 0076: Rückruf-Lage, Folge 3 of the 48-Werkstunden response rule (admin only).
--
-- KANON.md section 6a, Garantie-Anhang v2.1 § 6 Abs. (5) lit. c: if three or
-- more inquiries are past 48 Werkstunden without a contact attempt at the same
-- time, EINS may warn the Praxis by e-mail; if three or more are still open at
-- the end of the next Werktag after the warning, EINS may pause paid ads; EINS
-- resumes as soon as the Praxis has attempted contact on those inquiries.
--
-- Karam sends the warning and pauses the ads by hand (mail client, ad
-- account). This table only records that he did, so the admin page can show
-- the cure deadline, the pause state and when the resume is due:
--
--   kind = 'warnung'      warning e-mail sent
--   kind = 'pause'        paid ads paused; request_ids = the overdue inquiries
--                         at that moment (the resume condition)
--   kind = 'fortgesetzt'  paid ads resumed
--
-- Only FACTS are stored. Overdue counts, cure deadline and "Fortsetzen fällig"
-- are computed by the pure module src/lib/response-time.ts.
--
-- PRIVILEGES: admin only, same treatment as the guarantee tables in 0075. No
-- eins_app GRANT, an explicit REVOKE and RLS enabled without any policy, so
-- even a future blanket GRANT returns zero rows to the tenant role. The admin
-- pages read and write on the superuser (owner) handle.

CREATE TABLE IF NOT EXISTS response_enforcement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,

  kind text NOT NULL,
  -- When it happened (may be backdated a little, e.g. warning sent last night).
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- Inquiries overdue without contact attempt at that moment. Plain ids, no
  -- FK: the snapshot must survive a deleted request (deleted = nothing open).
  request_ids uuid[] NOT NULL DEFAULT '{}',
  note text,

  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT response_enforcement_kind_check CHECK (kind IN ('warnung', 'pause', 'fortgesetzt'))
);

CREATE INDEX IF NOT EXISTS response_enforcement_clinic_idx
  ON response_enforcement_events (clinic_id, occurred_at);

ALTER TABLE response_enforcement_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE ALL ON response_enforcement_events FROM eins_app;
  END IF;
END
$$;
