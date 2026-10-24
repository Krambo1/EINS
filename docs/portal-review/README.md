# Portal-Review 2026-10-07: "bulletproof under real conditions"

Auftrag (Karam, 2026-10-07): das Kunden-Portal (`apps/portal`, inkl. Admin) komplett prüfen, unter echten Bedingungen lauffähig machen. Bugs, Performance-Engpässe, fehlende Features finden und beheben. Visuelles Design NICHT ändern, nur kritisieren (-> `DESIGN-CRITIQUE.md`).

## Wiederaufnahme (neue Sitzung liest nur diese Datei + LEDGER.md)

1. `LEDGER.md` lesen: jede Zeile hat Status `open | fixing | fixed | verified | wontfix | blocked`.
2. Offene Zeilen nach Schweregrad abarbeiten (P0 zuerst).
3. Nach jeder Fix-Runde: `pnpm --filter portal typecheck` und `pnpm --filter portal test`, Ergebnis unten in "Verlauf" eintragen.
4. Rohbefunde der Reviewer liegen in `findings/<bereich>.md`. Sie sind Behauptungen, nicht Wahrheit: vor dem Fix im Code bestätigen.

## Regeln

- Kein Visual-Redesign: keine Farben, Abstände, Layouts, Typografie ändern. Fehlende Zustände (Fehler, Leer, Laden) dürfen mit vorhandenen Komponenten/Klassen ergänzt werden.
- Copy-Regeln aus `CLAUDE.md` gelten für jeden neuen String (Sie, keine Gedankenstriche, Praxis, keine Anglizismen, kein Versal).
- Parallel arbeitende Sitzung (Stand 02:55): editiert gerade Wiederbehandlungen (`wiederbehandlungen/*`, `retreatment*`, `0078_*`, `worker/processors/retreatment-*`) und PVS-Events (`api/pvs/events/*`, `pvs-status-derive.ts`, `schema.ts`, `queues.ts`, `jobs.ts`, `worker/index.ts`, `schedules*`). Diese Dateien nur nach Re-Read und nur gezielt anfassen; Befunde dort als `blocked (andere Sitzung)` führen, wenn unklar.
- Vor jedem Edit Datei neu lesen (geteilter, uncommitteter Baum). Keine Commits, kein Deploy ohne Karams Wort.
- Sub-Agenten: Review = Sonnet (read-only), Fix = executor (Opus, medium) auf disjunkten Dateien, Prüfung = verifier (Sonnet) mit den Behauptungen, nicht den Schlüssen.
- Keine Migrationen gegen Prod. Neue Migrationen nur additiv, nächste freie Nummer prüfen (andere Sitzung legt evtl. auch welche an).

## Phasen

| Phase | Inhalt | Stand |
|---|---|---|
| 0 | Baseline: Typecheck + Tests | fertig |
| 1 | Review (9 Linsen A-I, Sonnet) -> `findings/*.md` | fertig (233 Rohbefunde) |
| 1b | Live-Durchlauf: `apps/portal/scripts/smoke-routes.mjs` (Route x Rolle) | fertig, 0 Fehler; nach Fixes erneut |
| 2 | Triage -> `LEDGER.md` (Workstreams WS1-WS10) | fertig |
| 3 | Fixes in Gruppen auf disjunkten Dateien, Logs in `fixes/WS*.md` | läuft (Welle 1: WS1, WS2, WS4, WS5, WS6, WS7) |
| 4 | Verifier-Runde + Typecheck/Tests | offen |
| 5 | Abschlussbericht `REPORT.md` + `DESIGN-CRITIQUE.md` | Design-Kritik fertig, Bericht offen |

## Bereiche (Review)

Erste drei nach Bereich (schon gestartet), danach auf Karams Wunsch nach Aufgabe (eine Linse je Agent).

| ID | Linse / Bereich | Datei |
|---|---|---|
| A | Bereich Infrastruktur: DB-Client/RLS, Middleware, env, Caching, Fehlerseiten, Zeitzonen, Health | findings/A-infra.md |
| B | Bereich Auth + Autorisierung JEDER Server-Action/API-Route | findings/B-auth.md |
| C | Bereich Anfragen: Intake, Liste, Detail, Status, Antwortzeit, Garantie-Auslöser, Benachrichtigung | findings/C-anfragen.md |
| D | Linse Performance (ganzes Portal) | findings/D-performance.md |
| E | Linse echte Bedingungen: Worker/Jobs/E-Mail, "Worker ist in Prod aus" | findings/E-worker.md |
| F | Linse Kaputtmachen, Kundenseite (ohne Anfragen/Auth) | findings/F-break-client.md |
| G | Linse Kaputtmachen, Admin-Portal | findings/G-break-admin.md |
| H | Linse fehlende Funktionen gegen Angebot/Garantie (KANON) | findings/H-product.md |
| I | Linse Ballast + toter Code | findings/I-bloat.md |

Nicht im Review: PVS-Bridge-Serverseite (`api/pvs/**`, `server/pvs-*`), schon zweimal tief geprüft, und andere Sitzung arbeitet gerade daran.

## Verlauf

- 2026-10-07 02:55 Start. Tracker angelegt.
- 2026-10-07 ~03:20 Alle 9 Reviews fertig. Zeitzonen-Fix zentral in `lib/formatting.ts` (Hauptsitzung). `FIXER-BRIEF.md`, `LEDGER.md`, `DESIGN-CRITIQUE.md` geschrieben. Fix-Welle 1 gestartet: WS1, WS2, WS4, WS5, WS6, WS7 (Opus-Executor, Hintergrund). Danach WS3, WS8, dann WS9 Ballast, WS10 Copy, Verifier.
- **Wiederaufnahme nach Abbruch:** `LEDGER.md` lesen, dann je WS das Log `fixes/WS*.md`. Fehlt ein Abschluss-Abschnitt im Log, ist der WS unvollständig: neuen Fixer mit demselben Auftrag starten und ihm sagen, dass er nur Befunde ohne Log-Zeile bearbeitet.
- 2026-10-07 nach Sitzungslimit: Welle 1 hatte 97 Befunde geloggt (WS1 alle, WS2 23, WS4 26, WS5 17, WS6 0, WS7 14). Alle sechs Fixer per SendMessage fortgesetzt, Dev-Server 3007 neu gestartet, WS3 und WS8 gestartet (alle acht laufen).
- 2026-10-07 ~14:10 Docker war abgestürzt (verwaiste Socket-Dateien `AppData/Local/Docker/run/dockerInference` und `docker-secrets-engine/engine.sock` nach unsauberem Herunterfahren um 02:26; Ordner nach `*.stale-<zeit>` umbenannt, Docker läuft wieder). WS1, WS2, WS4, WS5, WS7, WS8 fertig. Smoke: 0 Fehler; Mandanten-Test geschärft, kein Leck (fremde Anfrage zeigt "Seite nicht gefunden", Status 200 nur wegen Streaming). Offen für Verifier: warum Hartmann-Inhaber um 03:05 nicht ins Onboarding umgeleitet wurde (lokal kein Fragebogen; Gate-Logik unverändert).
- 2026-10-07 nachmittags: WS3 und WS6 fertig (alle WS1-WS8 fertig, ca. 190 Log-Zeilen). WS9 Ballast läuft. `INTEGRATION.md` (Querverweise zwischen WS, zwei Fixer INT-A/INT-B nach WS9), `DECISIONS.md` (Pflicht vor Deploy + Fragen) geschrieben. Danach: WS10 Copy, Verifier, Smoke, `REPORT.md`.
- 2026-10-07 abends: WS9 fertig (rund 1.850 Zeilen weniger, 15 Zeitzonen-Anzeigen behoben). Welle 2 Prüfung (W1 Mandanten/Sicherheit, W2 Garantie gegen KANON, W3 Patientendaten) fertig, Befunde in `findings/J-*.md`, `K-*.md`, `L-*.md`. Karam entschieden: Messwege Anruf/Buchung offen, Aufbewahrungsfristen wie vorgeschlagen bauen. INT-A und INT-B laufen. Danach Fix-Welle 2 laut `WAVE2.md` (FX-G ∥ FX-D, dann FX-C), dann WS10, Verifier, Schlussprüfung, `REPORT.md`.
- 2026-10-07 spät: INT-A, INT-B, FX-G, FX-D, FX-C fertig. INT-C (Reste + Fehler in `request-notify` bei Praxis ohne Garantie-Uhr) läuft, W5 Datenmenge läuft parallel (nur lokale DB, Testdaten `lasttest-*`; falls abgebrochen: `node apps/portal/scripts/seed-load.mjs clean`). Danach WS10 Copy, Verifier (nach Bereichen getrennt, Sonnet, inkl. Klick-Test W4), Schlussprüfung, `REPORT.md`. Offen bei Karam: "Test" zusätzlich auf Spam setzen? Meta-Seitenauswahl bauen?

- 2026-10-07 21:00 (nach Limit): Dev-Server :3007 neu, Smoke 0 Fehler (4 Nutzer, Mandantentest ok). Roter Test `sql-array-param` war Fehlalarm; `purge-retention.ts` auf `IN (...)` umgestellt, alle Tests dazu grün. FX-M (Datenmenge, Opus) und WS10 (Copy, mech-executor) laufen parallel auf getrennten Dateien. Danach: Copy in FX-M-Dateien, Verifier, Schlussprüfung, `REPORT.md`.

- 2026-10-07 21:55: FX-M fertig (Dashboard Jahr/Max 12-15 s -> ~1 s, Anruf-Schlange 95 -> 24 ms, Admin-Garantie gekappt; Testdaten gelöscht), WS10 fertig (~62 Stellen). `forecast.ts` liest `derivedStatus` mit. Dev-Server neu gestartet (war auf 7 GB). Verifier V1-V7 laufen parallel (`VERIFY.md`, `VERIFIER-BRIEF.md`, Ergebnisse `verify/`). Bricht ein Verifier ab: dieselbe Zeile aus `VERIFY.md` neu starten, ihm sagen, dass er nur Behauptungen ohne Zeile in `verify/V<n>.md` prüft.

- 2026-10-07 22:00: Verifier V1-V7 fertig (2 Behauptungen widerlegt: Klick-Kennungen in gespeicherter Seitenadresse, "EUR-Wert"; Klick-Test: 404 nach K-2-Fehler auf Admin-Garantieseite u. a.). Alles in `VERIFY.md` "Nacharbeit". FX-V1/FX-V2/FX-V3 laufen parallel (Logs `fixes/FX-V*.md`; "IN ARBEIT"-Zeile = halb fertig, mit gleichem Auftrag aus `VERIFY.md` neu starten). Danach ein Verifier über FX-V, Schlussprüfung, `REPORT.md`.

- 2026-10-07 nachts: FX-V1/2/3 fertig, Abschluss-Verifier VF1 20/0 und VF2 20/0 (4 offen mangels lokaler Daten). Danach Hauptsitzung: Admin-Gate-Test erkennt Guards über Hilfsfunktionen, Lint in `global-error.tsx`, Copy "Abschluss-Meldungen", Host-Fälschung in `middleware.ts` geschlossen (+ `middleware.test.ts`). Schlussprüfung W7 grün: tsc beide Apps, vitest 1.226 + 14 DB-Tests, Smoke 140/0, `next build` Portal und Zielseiten. `REPORT.md` fertig.

- 2026-10-08: Karam hat die offenen Entscheidungen beantwortet (`DECISIONS.md`, "Karam 2026-10-08") und die Umsetzung der Design-Kritik freigegeben. DS1-DS5 fertig (`DESIGN-UMSETZUNG.md`, Logs `fixes/DS*.md`), D6 und C8 fertig (`fixes/FX-DECISIONS.md`, neue Migration 0095), E6 Meta-Seitenauswahl läuft, Sichtprüfung VD1/VD2 läuft (`VERIFY-DESIGN.md`). Danach: Nacharbeit aus VD, dann tsc, ganze Testsuite, Smoke, `next build`, `REPORT.md` ergänzen. Bricht ein Agent ab: Log lesen, gleichen Auftrag neu starten, nur offene Punkte.

- 2026-10-08 nachts: DN1-DN3 fertig, kleine Reste (`fixes/REST.md`), Sichtprüfung VD3 (`verify/VD3.md`, zwei Handy-Fehler danach behoben und live nachgemessen), Schlussprüfung grün (tsc 3 Pakete, vitest 1.319, DB-Tests 20, Smoke 144/0, beide Builds). `REPORT.md` aktualisiert.

### Endstand (2026-10-08 nachts)

Design umgesetzt, Karams Entscheidungen gebaut, nichts committet, nichts deployt. Einstieg: `REPORT.md`. Vor dem Deploy: `DECISIONS.md` Abschnitt A (Migrationen bis 0095, 0095 vor dem Code; Meta App Review `pages_manage_metadata`). Offen nur: Sichtprüfung der Admin-Seiten am Handy (Prüfer war nicht angemeldet). Punkte für die PVS-Sitzung: `HANDOFF-ANDERE-SITZUNG.md`.

### Endstand (2026-10-07 nachts, überholt)

Review abgeschlossen, nichts committet, nichts deployt. Einstieg: `REPORT.md`. Vor dem Deploy: `DECISIONS.md` Abschnitt A. Offene Entscheidungen: `DECISIONS.md` (D1, D6, E6, D5, C8, C9). Punkte für die PVS-Sitzung: `HANDOFF-ANDERE-SITZUNG.md`.

Lokaler Produktions-Build des Portals braucht `DATABASE_URL_APP` in der Umgebung (nur für den Prozess setzen, nicht in Dateien).
