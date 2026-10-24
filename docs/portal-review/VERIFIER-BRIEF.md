# Verifier-Brief (für jeden Verifier, zuerst lesen)

Du prüfst Behauptungen aus Fix-Logs (`docs/portal-review/fixes/<WS>.md`) im EINS-Portal (`apps/portal`, Next.js 15, Drizzle, lokales Postgres). Jede Log-Zeile mit `fixed` ist eine Behauptung. Du versuchst, sie zu widerlegen: Code lesen, gezielt Tests ausführen, die laufende App abfragen. Kontext für Produktion: `docs/portal-review/REVIEWER-BRIEF.md` (Vercel UTC, Neon-Pooler, Worker aus, Nutzer in Europe/Berlin).

## Regeln

1. **Nur lesen und ausführen.** Keine Quelldatei ändern, kein git außer `git diff`/`git status`/`git log`, kein `pnpm install`, kein Deploy. Mehrere Sitzungen arbeiten im selben uncommitteten Baum.
2. **Einzige Schreibstelle:** deine Ergebnisdatei `docs/portal-review/verify/<V>.md`, per Bash angehängt (`cat >> ... <<'EOF'`). Nach je ca. 5 geprüften Behauptungen anhängen, nicht erst am Ende (Sitzungslimit kann jederzeit kommen).
3. **Format je Zeile:** `| <WS> <ID> | CONFIRMED / REFUTED / UNCLEAR | Beleg (Datei:Zeile, Testausgabe, HTTP-Status) | ein Satz |`. REFUTED nur mit konkretem Beleg und Szenario. Am Ende Abschnitt `## Zusammenfassung` (Anzahl je Ergebnis, REFUTED-Liste) und `## Nebenbefunde` (neue Fehler, die dir auffallen, mit Datei:Zeile).
4. **Speicher ist knapp:** kein `npx tsc` über das ganze Projekt, kein `npx vitest run` ohne Pfad, kein `next build`, kein `seed-load.mjs`. Nur einzelne Testdateien: `npx vitest run <pfad>` in `apps/portal`.
5. **Laufende App:** http://localhost:3007 (Portal). Admin läuft auf dem Host `admin.localhost:3007` (siehe `apps/portal/RUN.md` und `src/middleware.ts`). Anmelden mit den Demo-Zugängen aus `apps/portal/RUN.md` bzw. `src/db/seed.ts` (nur localhost, nur diese Testwerte; Werte nie in die Ergebnisdatei schreiben). Sitzungen für Skript-Abrufe kannst du wie `apps/portal/scripts/smoke-routes.mjs` erzeugen und löschen. Ist der Server weg: Werkzeug `mcp__Claude_Browser__preview_start` mit Name `portal-local`, sonst als UNCLEAR melden.
6. **Lokale DB** (`docker exec eins-postgres psql -U eins -d eins_portal`): lesen frei. Schreiben nur über die App selbst (Formulare, API) und nur, wenn dein Auftrag es nennt. Testzeilen, die du anlegst, mit Präfix `verify-` benennen und am Ende löschen. Die Marker-Anfrage `f08ce438-0f5f-4532-9fbe-971987abfde4` (Praxis Neu) nie ändern oder löschen.
7. **E-Mail lokal:** `EMAIL_DRIVER=console`, kein Resend-, OpenAI-, Meta-Schlüssel gesetzt. Mails erscheinen im Log des Dev-Servers (`mcp__Claude_Browser__preview_logs`), nichts geht nach außen.
8. **Nicht prüfen:** Dateien der anderen Sitzung (`wiederbehandlungen/**`, `retreatment*`, `worker/processors/pvs-*`, `api/pvs/**`, `server/pvs-*`, `lib/queues.ts`, `server/jobs.ts`, `worker/index.ts`, `worker/schedules.ts`).
9. **Regeln, gegen die geprüft wird:** Copy (Sie, keine Gedankenstriche U+2014, Praxis statt Klinik, deutsche Begriffe, € statt EUR, kein Versal), keine Patientendaten in Mails an die Praxis und in Logs, Berliner Zeit für alles Sichtbare und für Tagesgrenzen, Mandantentrennung (`withClinicContext`, Session-clinicId), kein Visual-Redesign. Garantie-Wortlaut: `docs/umbau-ki-organisch/KANON.md`.

Antwort am Ende: max. 10 Zeilen (Anzahl CONFIRMED/REFUTED/UNCLEAR, jede REFUTED-Zeile in einem Satz, wichtigster Nebenbefund).
