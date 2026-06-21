-- 0063_timeline_default_journey.sql
-- Default Fortschritt-Journey: every newly onboarded Praxis should open the
-- Fortschritt tab and see a clear, forward-looking plan of what EINS does over
-- the coming weeks (reassurance: EINS has a plan, a timeline, set expectations),
-- instead of an empty tab. Two parts:
--
--   1. clinic_timeline_entries gains relative-phase support. A brand-new clinic
--      has no real campaign dates yet, so the default steps carry a phase_label
--      ("Woche 1 bis 2", "Ab Woche 6", "Nach 90 Tagen") and a sort_order for
--      forward ordering, and event_date becomes NULLABLE. Existing dated,
--      admin-authored entries (and the demo clinic's showcase history) keep
--      working unchanged: they have a date and sort_order 0.
--
--   2. timeline_default_steps — the central, admin-editable template. One row
--      per default step. It is COPIED into clinic_timeline_entries when a clinic
--      is onboarded (auto on creation, or via the admin "Standard-Journey
--      einsetzen" button). Editing the template only affects future seedings;
--      already-seeded clinics are tweaked per clinic in the existing Fortschritt
--      admin tab.
--
-- Not tenant-scoped: the template is global EINS content, not clinic PII, and is
-- only ever read/written by admin code on the superuser connection (`db`). It is
-- NEVER exposed to the clinic-facing app role (eins_app) — clinics only ever see
-- their own seeded copies in clinic_timeline_entries. Hence: no RLS, no eins_app
-- GRANT (least privilege; eins_app physically cannot read the template).
--
-- Source of truth for the step content: Notion "Der Ablauf" + the offer's
-- onboarding timeline, rewritten Inhaber-facing (formal Sie, plain German, no
-- Anglizismen: "Anfragen" not "Leads").

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ---------------------------------------------------------------------------
-- 1. Relative-phase support on clinic_timeline_entries
-- ---------------------------------------------------------------------------

ALTER TABLE clinic_timeline_entries
  ALTER COLUMN event_date DROP NOT NULL;

ALTER TABLE clinic_timeline_entries
  ADD COLUMN IF NOT EXISTS phase_label text;

ALTER TABLE clinic_timeline_entries
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- Forward ordering for relative-phase (date-less) journeys. Dated entries keep
-- using clinic_timeline_clinic_date_idx.
CREATE INDEX IF NOT EXISTS clinic_timeline_clinic_sort_idx
  ON clinic_timeline_entries (clinic_id, sort_order);

-- ---------------------------------------------------------------------------
-- 2. Central, admin-editable default-journey template
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS timeline_default_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort_order      integer NOT NULL,
  phase_label     text,
  title           text NOT NULL,
  description     text,
  default_status  text NOT NULL DEFAULT 'geplant',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timeline_default_steps_status_check
    CHECK (default_status IN ('geplant','laeuft','abgeschlossen'))
);

CREATE INDEX IF NOT EXISTS timeline_default_steps_sort_idx
  ON timeline_default_steps (sort_order);

-- Seed the default 10-step journey. Guarded so re-running the migration on an
-- already-populated template (e.g. after an admin edited it) does NOT clobber
-- their edits or duplicate rows.
INSERT INTO timeline_default_steps (sort_order, phase_label, title, description, default_status)
SELECT * FROM (VALUES
  (10,  'Zum Start',       'Auftakt-Gespräch und Zugänge',
        'Wir lernen Ihre Praxis kennen: Ihre wichtigsten Behandlungen, Ihre Wunsch-Patientinnen und Ihr Einzugsgebiet. Sie füllen vorab den kurzen Fragebogen im Portal aus, wir klären gemeinsam die Zugänge und legen Ihren Produktionstag fest.',
        'laeuft'),
  (20,  'Woche 1 bis 2',   'Produktionstag in Ihrer Praxis',
        'Ein Dreh- und Fototag bei Ihnen vor Ort. Wir produzieren Ihr Hauptvideo und rund 20 hochwertige Fotos von Praxis, Team und Behandlungen. Für Sie sind das etwa vier bis sechs Stunden, alles Weitere übernehmen wir.',
        'geplant'),
  (30,  'Woche 1 bis 2',   'Ihre Zielseiten entstehen',
        'Wir bauen eigene Zielseiten für Ihre profitabelsten Behandlungen, gemacht für bezahlte Anzeigen. Klar aufgebaut, schnell geladen, mit Ihren Bewertungen und Ihrem Arzt-Profil. Ihre bestehende Website bleibt unberührt.',
        'geplant'),
  (40,  'Woche 2 bis 3',   'Anfrage-System und Auswertung',
        'Wir richten Ihr System für Patienten-Anfragen ein: Jede Anfrage wird vorqualifiziert und an Ihr Team weitergeleitet, automatische Erinnerungen inklusive. Parallel bauen wir Ihre Auswertung auf, damit Sie jeden investierten Euro nachvollziehen können.',
        'geplant'),
  (50,  'Woche 3 bis 4',   'Rechtsprüfung Ihrer Werbung',
        'Alle Anzeigen, Texte und Video-Skripte prüfen wir gegen die typischen Abmahn-Muster im Heilmittelwerbegesetz (HWG). Ohne diese Freigabe geht keine Anzeige live. So werben Sie ohne Abmahnrisiko.',
        'geplant'),
  (60,  'Woche 3 bis 4',   'Ihre Kampagnen werden aufgebaut',
        'Wir richten Ihre Anzeigen bei Instagram, Facebook und Google ein: Zielgruppen, Budgets und alle nötigen Formate. Den Budget-Plan stimmen wir vorab mit Ihnen ab.',
        'geplant'),
  (70,  'Woche 5',         'Start Ihrer Anzeigen',
        'Ihre Kampagnen gehen live. Die ersten Patienten-Anfragen erreichen Ihr Team erfahrungsgemäß innerhalb der ersten Woche. Den Start beobachten wir täglich.',
        'geplant'),
  (80,  'Ab Woche 6',      'Feinschliff und Optimierung',
        'Jetzt wird Ihr System Woche für Woche besser und günstiger: Wir vergleichen Anzeigen-Varianten, schärfen die Qualität der Anfragen und senken die Kosten pro Anfrage.',
        'geplant'),
  (90,  'Monatlich',       'Ihr Monatsbericht und Strategie-Gespräch',
        'Jeden Monat erhalten Sie einen verständlichen Bericht mit allen wichtigen Zahlen und unseren Empfehlungen. Im kurzen Strategie-Gespräch legen wir gemeinsam die nächsten Schritte fest.',
        'geplant'),
  (100, 'Nach 90 Tagen',   'Großes 90-Tage-Gespräch',
        'Wir blicken gemeinsam auf die ersten drei Monate: Was haben die Anzeigen gebracht, welche Behandlungen laufen am besten und wie gehen wir von hier aus weiter. Sie entscheiden über die nächsten Monate.',
        'geplant')
) AS v(sort_order, phase_label, title, description, default_status)
WHERE NOT EXISTS (SELECT 1 FROM timeline_default_steps);
