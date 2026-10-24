-- 0086_admin_notices_invoice.sql
-- WS7 (portal review H-03, H-08, G-09).
--
-- clinic_notices: every formal notice EINS sends a Praxis from the admin
-- (Verzug, Rückruf-Warnung, Anzeigen-Pause, Fortsetzung). Stores recipients,
-- subject, exact body text and send time, so a disputed Fristverlängerung or
-- warning can be proven with what was actually sent, not a typed date.
--
-- guarantee_delays.notice_id: links a Verzug to the notice that announced it.
--
-- guarantee_clocks.first_invoice_sent_on / first_invoice_paid_on: Karam
-- invoices outside the portal; these dates record it so the first-invoice
-- trigger has a visible follow-up and a confirmation can no longer be undone
-- silently after the invoice went out.
--
-- No Drizzle mirror: touched only through raw SQL in server/clinic-notices.ts
-- and the admin Garantie pages. Additive and idempotent.

CREATE TABLE IF NOT EXISTS clinic_notices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  recipients   text[] NOT NULL DEFAULT '{}',
  subject      text NOT NULL,
  body_text    text NOT NULL,
  sent_at      timestamptz,
  failed_recipients text[] NOT NULL DEFAULT '{}',
  send_error   text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clinic_notices_kind_check
    CHECK (kind IN ('verzug', 'warnung_rueckruf', 'pause', 'fortsetzung', 'fristende'))
);

CREATE INDEX IF NOT EXISTS clinic_notices_clinic_idx ON clinic_notices (clinic_id, created_at);

ALTER TABLE guarantee_delays
  ADD COLUMN IF NOT EXISTS notice_id uuid REFERENCES clinic_notices(id) ON DELETE SET NULL;

ALTER TABLE guarantee_clocks
  ADD COLUMN IF NOT EXISTS first_invoice_sent_on date,
  ADD COLUMN IF NOT EXISTS first_invoice_paid_on date;
