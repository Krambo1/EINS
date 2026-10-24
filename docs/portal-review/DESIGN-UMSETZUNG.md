# Design-Kritik: Umsetzung

Karam hat am 2026-10-08 freigegeben, die Punkte aus `DESIGN-CRITIQUE.md` umzusetzen. Diese Datei sagt, wer welche Dateien besitzt und was je Paket zu tun ist. Log je Paket: `fixes/DS<n>.md`.

Schon erledigt (Copy-Durchgang): "Mon" heißt "Monat", "Kein Drama" und "Kürzel (slug)" sind weg.

## Regeln für alle Pakete

- Nur die eigenen Dateien ändern. Braucht ein Punkt eine fremde Datei: im eigenen Log unter "Braucht andere Datei" notieren, nicht ändern.
- Nie anfassen (andere Sitzung): `wiederbehandlungen/**`, `retreatment*`, `worker/processors/pvs-*`, `api/pvs/**`, `server/pvs-*`, `lib/queues.ts`, `server/jobs.ts`, `worker/index.ts`, `worker/schedules.ts`.
- Nur Oberfläche. Keine Änderung an Server-Aktionen, Abfrage-Bedeutung, Garantie-Rechnung, Anmelde-Logik, Migrationen, neuen Abhängigkeiten oder neuen Routen. Neue reine Lese-Abfragen nur in DS5 und nur, wenn es keine passende gibt.
- `@eins/ui` wird nur vom Portal genutzt. Nur DS1 entfernt dort Versal-Etiketten; alle anderen Anpassungen an gemeinsamen Bausteinen am Aufrufort (umhüllen, `className`), nie im Baustein. `Button` hat `variant="danger"`, nicht `destructive`. `Card` braucht `!`-Präfix für Überschreibungen.
- Bestehende Fixes nicht zurückdrehen: Dashboard-Tempo (FX-M, eine Abfrage für alle Zeiträume), `useId`-Hydrationsfix im Dashboard, Berliner Zeit, Admin-Guards (`admin-gate.test.ts` muss grün bleiben).
- Copy: Sie, keine Gedankenstriche (U+2014), Praxis statt Klinik, keine Anglizismen (Anfrage, Werbeertrag, Abschluss, Zielseite, Werbebudget, Gespräch), €, kein Versal, Satzanfang groß. Nie Text direkt auf Mint-Fläche.
- Handy 375 px: kein seitliches Scrollen der Seite. Lieber weniger Spalten am Aufrufort zeigen als Daten abschneiden.
- KI-Bewertung: darf nie so klingen, als entscheide sie, ob eine Anfrage zählt (KANON: "Der KI-Score entscheidet nie").

### Etikett-Regel (alle Pakete in ihren Dateien)

`uppercase` und `tracking-wide`/`tracking-wider`/`tracking-widest` an Etiketten entfernen. Der Text steht im Quelltext in Satzschreibung (erster Buchstabe groß, Rest normal). Etiketten in `text-fg-tertiary` oder `text-fg-secondary` werden `text-fg-primary` mit `font-medium`. Mindestgröße `text-sm`; nur Achsenbeschriftungen und Legenden in Diagrammen dürfen `text-xs` bleiben. Ausnahme: Initialen im `Avatar`.

## Pakete und Dateibesitz

| Paket | Agent | Dateien (Besitz) | Punkte |
|---|---|---|---|
| DS1 | mech-executor | `packages/ui/src/components/{Donut,DropdownMenu,ExplainerPopover,TrafficLightCard,TrendChart}.tsx`, `(portal)/bewertungen/**`, `(portal)/hwg-check/**`, `(portal)/leitfaden/**`, `(portal)/medien/**`, `server/email.ts`, `server/email/templates/review-request.ts`, `server/reports/leitfaden-pdf.tsx` | Etikett-Regel in diesen Dateien |
| DS2 | executor (Opus) | `(portal)/dashboard/**`, `(portal)/werbebudget/**`, `(portal)/fortschritt/**` | Datumszeile, Leerzustand "Heute", Zeitraumschalter, Werbebudget Handy + Leerzustand, Fortschritt-Stand, Etiketten |
| DS3 | executor (Opus) | `(portal)/anfragen/**` | KI-Bewertung mit Skala, Funkeln einmal, Frist sichtbar, Anfrage-Detail + Anrufen am Handy, rote Markierungen erklärt, Wiedervorlagen-Leerzustand, Etiketten |
| DS4a | executor (Opus) | `(portal)/_components/**`, `server/queries/navBadges*.ts`, `(auth)/**` (nur Seiten und Komponenten, nicht `actions.ts`) | Seitenleiste kürzer, Anfragen am Handy, eigene Plakette "fällig", Kundenansicht-Banner, Anmeldung mit klarem Hauptweg, Etiketten |
| DS4b | executor (Opus) | `(portal)/einstellungen/**` (ohne `actions.ts`), `(portal)/dateien/**`, `(portal)/onboarding/fragebogen/**` (ohne `actions.ts`) | Dateien-Papierkorb, Fragebogen-Abschnitte, Etiketten |
| DS5 | executor (Opus) | `app/admin/**` (ohne `*/actions.ts`, `login/**/route.ts`), lesend `server/guarantee-clock.ts`, `server/queries/admin*.ts` | Admin-Startseite Garantie-Lage, Admin-Tabellen am Handy, Untertitel, gefährliche Knöpfe, Etiketten |

Nicht hier: Leerzustand Wiederbehandlungen (Dateien der anderen Sitzung, steht in `HANDOFF-ANDERE-SITZUNG.md`).

## Prüfen

Executor: am Ende einmal `npx tsc --noEmit -p .` in `apps/portal` (bei DS1 zusätzlich in `packages/ui`, falls dort ein tsconfig liegt), dazu gezielt die Tests der berührten Dateien. Kein `next build`, kein eigener Dev-Server, keine ganze Testsuite, kein Browser (Speicher knapp; Sichtprüfung macht danach ein Verifier).

Danach (Hauptsitzung): ein Verifier mit Browser, 375 px und Desktop, als Inhaber und als Admin (`verify/VD.md`); dann Nacharbeit; dann tsc, ganze Testsuite, Smoke, `next build`.

## Log-Format

`fixes/DS<n>.md`: Kopf mit Paket und Datum, dann Tabelle `| Punkt | Dateien | Was geändert | Status |`. Status: `behoben`, `teilweise (Grund)`, `nicht gemacht (Grund)`. Zuerst eine Zeile `IN ARBEIT` für den Punkt, an dem gerade gearbeitet wird; nach jedem Punkt die Zeile schreiben (Sitzungslimit). Am Ende Abschnitt "Abschluss" mit tsc-Ergebnis und "Braucht andere Datei".

## Wiederaufnahme

Log lesen. Fehlt "Abschluss", ist das Paket unvollständig: Agent mit demselben Auftrag neu starten und ihm sagen, dass er nur Punkte ohne fertige Log-Zeile bearbeitet.
