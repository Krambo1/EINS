-- 0074: default Fortschritt-Journey for the KI + organic model (30.09.2026).
--
-- The journey seeded by 0063 (and patched by 0072) describes the old model:
-- a Produktionstag in the Praxis, campaigns built in weeks 3 to 4, ads going
-- live on Tag 22. Since 30.09.2026 there is no Produktionstag: the Inhaber
-- records a few minutes of video and voice on the phone, EINS builds a KI-Klon,
-- posts run organically first, and the first qualified inquiry through EINS
-- triggers the first invoice (90 days from signing). Source: KANON.md
-- section 9 (docs/umbau-ki-organisch).
--
-- Same shape as 0072: 0063 is already applied everywhere, so this repairs the
-- rows in place, in the template (timeline_default_steps) and in every
-- already-seeded clinic copy (clinic_timeline_entries). Status is never touched,
-- so a clinic's progress stays as it was.
--
-- Narrow on purpose. Template rows match on sort_order + the seeded title;
-- clinic rows match on the seeded title + phase_label. A step an admin has
-- re-titled keeps the edit. Step 100 keeps its title, so it only changes where
-- the description is still the seeded one.

CREATE TEMP TABLE journey_0074 (
  sort_order      integer NOT NULL,
  old_phase       text NOT NULL,
  old_title       text NOT NULL,
  new_phase       text NOT NULL,
  new_title       text NOT NULL,
  new_description text NOT NULL
);

INSERT INTO journey_0074 VALUES
  (10, 'Zum Start', 'Auftakt-Gespräch und Zugänge',
   'Woche 1', 'Onboarding-Gespräch und Zugänge',
   'Mit Ihrer Unterschrift beginnen die 90 Tage. Bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt, zahlen Sie nichts. In der ersten Woche lernen wir Ihre Praxis im Onboarding-Gespräch per Video kennen: Ihre wichtigsten Behandlungen, Ihre Wunsch-Patientinnen und Ihr Einzugsgebiet. Sie füllen vorab den kurzen Fragebogen im Portal aus, unterschreiben die Einwilligung für Ihren KI-Klon und geben uns die Zugänge zu Instagram, Facebook, Meta Business und der Domain für Ihre Zielseite.'),
  (20, 'Woche 1 bis 2', 'Produktionstag in Ihrer Praxis',
   'Woche 1', 'Ihre Klon-Aufnahme',
   'Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf. Daraus entsteht Ihr KI-Klon. Unsere Anleitung führt Sie Schritt für Schritt durch die Aufnahme. Ihr Gesicht und Ihre Stimme nutzen wir nur für Ihre Praxis.'),
  (30, 'Woche 1 bis 2', 'Ihre Zielseiten entstehen',
   'Woche 1 bis 2', 'Ihr Klon und Ihre Zielseite entstehen',
   'Aus Ihrer Aufnahme entsteht Ihr KI-Klon. Parallel bauen wir eine eigene Zielseite für Ihre profitabelste Behandlung: Dorthin führen der Link in Ihrem Profil und später Ihre Anzeigen. Klar aufgebaut, schnell geladen, mit Ihren Bewertungen und Ihrem Arzt-Profil. Ihre bestehende Website bleibt unberührt.'),
  (40, 'Woche 2 bis 3', 'Anfrage-System und Auswertung',
   'Woche 1 bis 2', 'Anfrage-System und Auswertung',
   'Wir richten Ihr System für Patienten-Anfragen ein: Jede Anfrage wird vorqualifiziert und an Ihr Team weitergeleitet, automatische Erinnerungen inklusive. Jede Anfrage steht mit ihrer Herkunft in Ihrem Portal, also mit dem Beitrag oder der Anzeige, über die sie kam.'),
  (50, 'Woche 3 bis 4', 'Rechtsprüfung Ihrer Werbung',
   'Woche 1 bis 2', 'Erste Beiträge zu Ihrer Freigabe',
   'Wir schicken Ihnen die ersten Beiträge: Videos mit Ihrem KI-Klon, Erklär-Animationen und Bildmaterial. Alles ist HWG-geprüft und als KI-generiert gekennzeichnet. Kein Beitrag ohne Ihre Freigabe. Das ist in wenigen Minuten erledigt: ansehen, ja oder nein.'),
  (60, 'Woche 3 bis 4', 'Ihre Kampagnen werden aufgebaut',
   'Ab Woche 2', 'Ihre ersten Beiträge gehen live',
   'Die freigegebenen Beiträge erscheinen organisch auf den Kanälen Ihrer Praxis, und die Anfragen laufen mit ihrer Herkunft in Ihr Portal. Ab jetzt schicken wir Ihnen die neuen Beiträge einmal pro Woche gesammelt zur Freigabe.'),
  (70, 'Tag 22', 'Start Ihrer Anzeigen',
   'Erste qualifizierte Anfrage', 'Erste Anfrage, erste Rechnung',
   'Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt. Mit der ersten Anfrage kommt die erste Rechnung, und wir schlagen Ihnen vor, welches Werbebudget hinter welche Beiträge gehört.'),
  (80, 'Ab Woche 6', 'Feinschliff und Optimierung',
   'Laufend', 'Anzeigen hinter den Beiträgen, die wirken',
   'Sobald sichtbar ist, welche Beiträge Anfragen bringen, setzen wir bezahlte Anzeigen auf Meta und Google genau dahinter. Das Werbebudget zahlen Sie direkt an die Plattformen. Woche für Woche schärfen wir die Qualität der Anfragen und senken die Kosten pro Anfrage.'),
  (90, 'Monatlich', 'Ihr Monatsbericht und Strategie-Gespräch',
   'Monatlich', 'Ihre Auswertung und Strategie-Gespräch',
   'Jeden Monat sehen Sie im Portal, welche Beiträge und Anzeigen liefen, welche wir gestoppt haben, wie viele Anfragen kamen und wie viele Behandlungen daraus wurden. Im kurzen Strategie-Gespräch legen wir gemeinsam die nächsten Schritte fest.');

UPDATE timeline_default_steps t
   SET phase_label = m.new_phase,
       title       = m.new_title,
       description = m.new_description,
       updated_at  = now()
  FROM journey_0074 m
 WHERE t.sort_order = m.sort_order
   AND t.title = m.old_title;

UPDATE clinic_timeline_entries e
   SET phase_label = m.new_phase,
       title       = m.new_title,
       description = m.new_description,
       updated_at  = now()
  FROM journey_0074 m
 WHERE e.title = m.old_title
   AND e.phase_label = m.old_phase;

-- Step 100: title and phase stay, only the seeded description changes (it
-- asked "Was haben die Anzeigen gebracht", but ads are optional now).
UPDATE timeline_default_steps
   SET description = 'Wir blicken gemeinsam auf die ersten drei Monate: welche Beiträge und Anzeigen Anfragen gebracht haben, welche Behandlungen daraus wurden und wie viel Werbebudget wir als Nächstes empfehlen. Sie entscheiden über die nächsten Monate.',
       updated_at  = now()
 WHERE title = 'Großes 90-Tage-Gespräch'
   AND description = 'Wir blicken gemeinsam auf die ersten drei Monate: Was haben die Anzeigen gebracht, welche Behandlungen laufen am besten und wie gehen wir von hier aus weiter. Sie entscheiden über die nächsten Monate.';

UPDATE clinic_timeline_entries
   SET description = 'Wir blicken gemeinsam auf die ersten drei Monate: welche Beiträge und Anzeigen Anfragen gebracht haben, welche Behandlungen daraus wurden und wie viel Werbebudget wir als Nächstes empfehlen. Sie entscheiden über die nächsten Monate.',
       updated_at  = now()
 WHERE title = 'Großes 90-Tage-Gespräch'
   AND phase_label = 'Nach 90 Tagen'
   AND description = 'Wir blicken gemeinsam auf die ersten drei Monate: Was haben die Anzeigen gebracht, welche Behandlungen laufen am besten und wie gehen wir von hier aus weiter. Sie entscheiden über die nächsten Monate.';

DROP TABLE journey_0074;
