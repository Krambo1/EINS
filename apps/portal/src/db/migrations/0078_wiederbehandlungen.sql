-- 0078_wiederbehandlungen.sql
-- Wiederbehandlungs-Kalender: for every patient EINS brought in and the
-- Praxis treated (PVS EncounterCompleted), compute when the next session of
-- the same treatment is due, show the Praxis what is coming up, and (only
-- when the Praxis switches it on) send the patient one neutral reminder two
-- weeks before the due date.
--
-- This deliberately revisits 0050 ("recalls belong in the PVS"). The
-- difference: 0050 removed a hand-maintained default_recall_months that the
-- portal guessed. Here the interval comes from the Praxis's OWN PVS history
-- (median gap between repeat sessions per treatment) or from an explicit
-- Praxis setting. With neither, the treatment stays out of the calendar.
--
-- Scope v1: EINS-attributed patients only (patients with at least one
-- request through an EINS-Messweg or a Meta/Google platform form). The
-- "all patients of the Praxis" version needs separate AVV coverage.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- --------------------------------------------------------------------------
-- treatments: per-treatment interval setting + the computed PVS interval
-- --------------------------------------------------------------------------
-- retreatment_mode:
--   auto  = use the interval computed from the Praxis's PVS history (if any)
--   fixed = use retreatment_interval_months (Praxis set it by hand)
--   off   = never in the calendar (one-time procedures, consultations)
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS retreatment_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS retreatment_interval_months integer,
  ADD COLUMN IF NOT EXISTS pvs_retreatment_interval_days integer,
  ADD COLUMN IF NOT EXISTS pvs_retreatment_samples integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pvs_retreatment_patients integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pvs_retreatment_computed_at timestamptz;

ALTER TABLE treatments DROP CONSTRAINT IF EXISTS treatments_retreatment_mode_check;
ALTER TABLE treatments ADD CONSTRAINT treatments_retreatment_mode_check
  CHECK (retreatment_mode IN ('auto','fixed','off'));

ALTER TABLE treatments DROP CONSTRAINT IF EXISTS treatments_retreatment_months_check;
ALTER TABLE treatments ADD CONSTRAINT treatments_retreatment_months_check
  CHECK (
    retreatment_interval_months IS NULL
    OR retreatment_interval_months BETWEEN 1 AND 36
  );

ALTER TABLE treatments DROP CONSTRAINT IF EXISTS treatments_retreatment_fixed_check;
ALTER TABLE treatments ADD CONSTRAINT treatments_retreatment_fixed_check
  CHECK (retreatment_mode <> 'fixed' OR retreatment_interval_months IS NOT NULL);

-- --------------------------------------------------------------------------
-- clinics: reminder switch + where the patient books
-- --------------------------------------------------------------------------
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS retreatment_reminders_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retreatment_consent_attested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retreatment_booking_url text,
  ADD COLUMN IF NOT EXISTS retreatment_phone text;

-- Reminders can only be on while the owner's attestation is on record.
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_retreatment_attested_check;
ALTER TABLE clinics ADD CONSTRAINT clinics_retreatment_attested_check
  CHECK (NOT retreatment_reminders_enabled OR retreatment_consent_attested);

-- --------------------------------------------------------------------------
-- retreatment_cycles: one row per (patient, treatment, session cycle)
-- --------------------------------------------------------------------------
-- A cycle is one session plus any touch-up within 30 days. The newest cycle
-- per (patient, treatment) is the live one (open / booked / dismissed);
-- older cycles are 'returned' history. Rebuilt daily by the
-- retreatment-refresh worker from pvs_event_log; the rebuild never touches
-- the reminder_* / token / booking_clicked_at / dismissed_* columns.
CREATE TABLE IF NOT EXISTS retreatment_cycles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id              uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  treatment_id            uuid NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  -- The EINS request that makes this patient EINS-attributed (latest one).
  request_id              uuid REFERENCES requests(id) ON DELETE SET NULL,
  -- First session day of this cycle (Europe/Berlin calendar date).
  cycle_on                date NOT NULL,
  -- What the patient paid for this cycle (netted invoices), in the clinic
  -- currency. NULL when the PVS sent no invoice for it.
  cycle_revenue_cents     bigint,
  interval_days           integer NOT NULL,
  interval_source         text NOT NULL,
  due_on                  date NOT NULL,
  remind_on               date NOT NULL,
  status                  text NOT NULL DEFAULT 'open',
  -- Set when status = 'returned': first day of the next cycle + its revenue.
  returned_on             date,
  returned_revenue_cents  bigint,
  -- Set when status = 'booked': day of the upcoming appointment.
  booked_for              date,
  reminder_status         text NOT NULL DEFAULT 'pending',
  reminder_sent_at        timestamptz,
  reminder_skip_reason    text,
  -- The exact address the reminder went to (unsubscribe suppresses this one).
  reminder_email          text,
  -- Opaque 64-hex token for the patient-facing booking + unsubscribe links.
  token                   text NOT NULL,
  booking_clicked_at      timestamptz,
  dismissed_at            timestamptz,
  dismissed_by            uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retreatment_cycles_token_uniq UNIQUE (token),
  CONSTRAINT retreatment_cycles_cycle_uniq
    UNIQUE (clinic_id, patient_id, treatment_id, cycle_on),
  CONSTRAINT retreatment_cycles_status_check
    CHECK (status IN ('open','booked','returned','dismissed')),
  CONSTRAINT retreatment_cycles_reminder_status_check
    CHECK (reminder_status IN ('pending','sent','skipped','not_needed')),
  CONSTRAINT retreatment_cycles_interval_source_check
    CHECK (interval_source IN ('fixed','pvs')),
  CONSTRAINT retreatment_cycles_interval_days_check
    CHECK (interval_days > 0)
);

CREATE INDEX IF NOT EXISTS retreatment_cycles_clinic_due_idx
  ON retreatment_cycles (clinic_id, due_on);

-- Drives the reminder tick: status='open' AND reminder_status='pending' AND remind_on <= today.
CREATE INDEX IF NOT EXISTS retreatment_cycles_reminder_due_idx
  ON retreatment_cycles (reminder_status, status, remind_on);

ALTER TABLE retreatment_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE retreatment_cycles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS retreatment_cycles_tenant ON retreatment_cycles;
CREATE POLICY retreatment_cycles_tenant ON retreatment_cycles
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON retreatment_cycles TO eins_app;
