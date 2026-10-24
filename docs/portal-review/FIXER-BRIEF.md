# Fixer-Brief (für jeden Fix-Agenten, zuerst lesen)

Du behebst Befunde aus dem Portal-Review. Lies zuerst `docs/portal-review/REVIEWER-BRIEF.md` (Kontext: Produktion = Vercel UTC + Neon-Pooler + Worker aus) und dann die Befunde, die dein Auftrag nennt, in `docs/portal-review/findings/*.md`. Befunde sind Behauptungen: im Code prüfen, bevor du änderst. Ist ein Befund falsch oder schon behoben, nicht ändern, im Log als `no_change_needed` mit Grund eintragen.

## Harte Regeln

1. **Nur deine Dateien.** Dein Auftrag listet die Dateien/Ordner, die dir gehören. Andere Dateien nur lesen. Brauchst du eine Änderung außerhalb, trage sie im Log unter "Braucht andere Datei" ein, statt sie selbst zu machen. Neue Dateien darfst du anlegen, wenn sie zu deinem Thema gehören.
2. **Geteilter, uncommitteter Baum.** Mehrere Agenten und eine andere Claude-Sitzung arbeiten gleichzeitig. Jede Datei direkt vor dem Edit neu lesen, gezielte Edits (kein Komplett-Überschreiben bestehender Dateien), keine Formatierungs-Umbauten. Kein git commit, kein git checkout/stash/reset, kein Deploy, kein `pnpm install`.
3. **Kein Visual-Redesign.** Farben, Abstände, Layout, Typografie, Komponentenwahl bleiben. Erlaubt: fehlende Fehler-/Leer-/Ladezustände, Bestätigungsdialoge, Doppelklick-Schutz, zusätzliche Informationszeilen oder Felder mit den vorhandenen Komponenten und Klassen im selben Stil wie das Umfeld. `uppercase`-Klassen NICHT entfernen (das ist Design, wird separat entschieden).
4. **Copy-Regeln** für jeden neuen oder geänderten sichtbaren Text: Sie (groß), keine Gedankenstriche (U+2014), "Praxis" nie "Klinik", deutsche Begriffe (Anfrage, Auswertung, Zielseite, Werbebudget, Gespräch), € statt EUR, Satzanfang groß, kein Versal. Kurz und klar für Inhaber:innen 40-65.
5. **Datenschutz:** In E-Mails an die Praxis keine Patientendaten im Text (Name, Telefon, E-Mail, Nachricht), nur Behandlung, Quelle, Zeitpunkt und Link ins Portal. Keine Patientendaten in Logs.
6. **Zeitzone:** Alles, was ein Mensch als Datum/Uhrzeit sieht oder was "heute/diesen Monat" bedeutet, in Europe/Berlin. `src/lib/formatting.ts` formatiert bereits in Berlin und exportiert `berlinDateString()` und `DISPLAY_TIME_ZONE`. SQL-Tagesgrenzen mit `AT TIME ZONE 'Europe/Berlin'`.
7. **Migrationen:** nur additiv und idempotent (`IF NOT EXISTS`), Dateiname mit der dir zugeteilten Nummer (`00NN_<thema>.sql`, siehe Auftrag). `src/db/schema.ts` wird von mehreren geteilt: nur gezielte Einzel-Edits an eindeutigen Ankern, direkt vorher neu lesen. Migration lokal anwenden mit `pnpm --filter portal db:migrate` (nur lokale DB).
8. **Nicht anfassen (andere Sitzung, in Arbeit):** `src/app/(portal)/wiederbehandlungen/**`, `src/**/retreatment*`, `src/worker/processors/pvs-*`, `src/app/api/pvs/**`, `src/server/pvs-*`, `src/server/actions/pvs-csv-upload.ts` nur wenn dein Auftrag es nennt, `src/lib/queues.ts`, `src/server/jobs.ts`, `src/worker/index.ts`, `src/worker/schedules.ts`. Lesen ja, ändern nein.
9. **Prüfen:** Nach jeder Fix-Gruppe `npx tsc --noEmit -p .` in `apps/portal`. Fehler in fremden Dateien ignorieren (andere arbeiten gerade, z. B. `pvs-csv-mapper.ts` der anderen Sitzung), nur deine müssen sauber sein. Tests für die Module, die du änderst: `npx vitest run <pfad>`. Für reine Logik (Zeitrechnung, Validierung, Parser) einen kleinen Test ergänzen.
10. **Log nach JEDEM Befund** (nicht erst am Ende, wir können jederzeit abgeschnitten werden): `docs/portal-review/fixes/<dein-ws>.md`, eine Zeile je Befund: `| ID | fixed / no_change_needed / skipped / needs_decision | Dateien | ein Satz was und warum |`. Am Ende Abschnitte "Braucht andere Datei", "Migration", "Offene Entscheidungen für Karam", "Nicht getestet".

## Muster, die es schon gibt

- `after()` aus `next/server` für Arbeit nach der Antwort (Next 15.5).
- E-Mail senden: `getEmailSender()` bzw. die Exporte in `src/server/email.ts` (inline, funktioniert ohne Worker), Unterdrückungsliste `src/server/email-suppression.ts`.
- RLS: `withClinicContext(clinicId, userId, fn, label)`; Superuser `db` nur mit clinicId aus Session/Token.
- Berliner Wandzeit parsen: `instantFromBerlinWall` in `src/lib/werkstunden.ts`.
- Fehlerseite im Portal-Stil: `src/app/(portal)/anfragen/error.tsx`.
- Rollen: `can(role, permission)` aus `src/lib/roles.ts`.

Deine Antwort am Ende: max. 12 Zeilen (Anzahl fixed/skipped/needs_decision, wichtigste Änderungen, was Karam entscheiden muss).
