-- Lead Cockpit — re-open the Portal as the working surface for the
-- pre-booking phase of a lead.
--
-- Hintergrund:
--   Migration 0050 hat den Recall/Wiedervorlage-Workflow entfernt und die
--   Anfrage-Detailseite zum reinen PVS-Listener gemacht (siehe
--   anfragen/[id]/actions.ts). Diese Read-only-Haltung ist richtig für
--   *Patienten*: deren Wahrheit lebt in der PVS. Eine frische Anfrage ist
--   aber ein *Fremder, noch kein Patient* — die PVS sieht sie gar nicht.
--   Für diese Vor-Patienten-Phase existiert keine Upstream-Quelle, also
--   greift die "genuinely portal-native"-Ausnahme aus dem actions.ts-Kommentar.
--
--   Diese Migration ergänzt die zwei Zwischen-Status für den Telefonstand und
--   legt die `request_followups`-Tabelle an (mehrere geplante Wiedervorlagen
--   je Anfrage + Historie). Die Grenze zur PVS bleibt scharf: sobald eine
--   Anfrage an einen PVS-Termin gekoppelt ist (`pvs_appointment_id IS NOT NULL`),
--   übernimmt die PVS-derived Status-Logik wieder (siehe changeStatus-Action).
--
-- Effekt auf Produktionsdaten:
--   * `requests_status_check` wird um 'kontaktiert' und 'nicht_erreicht'
--     erweitert. Die bestehenden acht Werte (inkl. der PVS-derived
--     'no_show'/'behandelt') bleiben gültig — keine Zeile wird ungültig.
--   * `request_followups` ist neu und leer.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + CREATE TABLE IF NOT EXISTS, RLS- und
-- Grant-Statements no-oppen bei Re-Run. Der Migrations-Runner wrappt jede
-- Datei bereits in eine Transaktion, daher kein eigenes BEGIN/COMMIT.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- requests.status — add the two manual working-phase statuses
-- ============================================================

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check
  CHECK (status IN (
    'neu',
    'kontaktiert',
    'nicht_erreicht',
    'termin_vereinbart',
    'beratung_erschienen',
    'no_show',
    'behandelt',
    'gewonnen',
    'verloren',
    'spam'
  ));

-- ============================================================
-- request_followups (Wiedervorlage) — full tenant table.
-- Mirrors the 0004 tenant-table pattern (RLS + grant in the same step).
-- ============================================================

CREATE TABLE IF NOT EXISTS request_followups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  due_at        timestamptz NOT NULL,
  note          text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','done','cancelled')),
  created_by    uuid REFERENCES clinic_users(id),
  completed_by  uuid REFERENCES clinic_users(id),
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Call-queue read path: "pending Wiedervorlagen je Praxis, fälligste zuerst".
CREATE INDEX IF NOT EXISTS request_followups_due_idx
  ON request_followups(clinic_id, status, due_at);
-- Detail-page read path: "alle Wiedervorlagen dieser Anfrage, neueste zuerst".
CREATE INDEX IF NOT EXISTS request_followups_request_idx
  ON request_followups(request_id, created_at DESC);

ALTER TABLE request_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_followups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS request_followups_tenant ON request_followups;
CREATE POLICY request_followups_tenant ON request_followups
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());

GRANT SELECT, INSERT, UPDATE, DELETE ON request_followups TO eins_app;
