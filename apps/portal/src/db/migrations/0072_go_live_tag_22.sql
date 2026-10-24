-- 0072: campaign go-live is Tag 22 after Vertragsunterzeichnung, not "Woche 5".
--
-- 0063 seeded the default Fortschritt-Journey with the go-live step labelled
-- "Woche 5". The binding value is Tag 22 (see 06-garantie.md, "Kampagnenlaufzeit
-- / Garantie-Periode"). 0063 has already been applied everywhere, so fixing its
-- VALUES list only helps fresh databases. This migration repairs the rows that
-- are already there.
--
-- Deliberately narrow: it only touches rows whose phase_label is still the exact
-- string 'Woche 5' AND whose title is the seeded go-live title, so an admin who
-- has since re-worded either field keeps their edit.

UPDATE timeline_default_steps
   SET phase_label = 'Tag 22',
       updated_at  = now()
 WHERE phase_label = 'Woche 5'
   AND title = 'Start Ihrer Anzeigen';

UPDATE clinic_timeline_entries
   SET phase_label = 'Tag 22'
 WHERE phase_label = 'Woche 5'
   AND title = 'Start Ihrer Anzeigen';
