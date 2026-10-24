# WS4: Worker, Cron ohne Worker, E-Mail

| ID | Status | Dateien | Was und warum |
|---|---|---|---|
| E-28 | fixed | worker/processors/{ai-score,refresh-oauth,sync-google,sync-reviews-google,sync-reviews-jameda}.ts, server/email.ts | Jeder externe `fetch` in den Prozessoren hat jetzt `AbortSignal.timeout` (OpenAI 15 s, Google/Jameda 10 s), Resend-Versand ist auf 15 s begrenzt; sync-meta/GAQL bekommen ihr Zeitlimit mit E-16/E-04. |
| B-2 | fixed | server/email.ts | In `NODE_ENV=production` ohne `EMAIL_DRIVER=resend` + `RESEND_API_KEY` liefert `getEmailSender()` einen Sender, der einmal `console.error` loggt und bei jedem Versand wirft; kein stiller Konsolen-Fallback mehr. Dev/Test unverändert (Konsole). |
| A-12 | fixed | server/email.ts | Folge von B-2: der Konsolen-Treiber läuft in Produktion nie, der Fehl-Sender loggt nur den Betreff, nie Text/URL/Empfänger. Die Klartext-Logzeilen in `auth/magic-link.ts` gehören WS6 (siehe unten). |
| E-02 | fixed | worker/processors/monthly-report.ts, worker/processors/berlin-days.ts (+test) | `__autoprev__` wird zum Berliner Vormonat aufgelöst, ungültige Periode wirft statt still `return`; Prozessor ist idempotent (PDF nur ohne Dokument-Zeile, Mails über Ledger 0083) und überspringt Praxen, die nach dem Monat angelegt wurden. Läuft jetzt auch über `/api/cron/daily` (Morgen-Slot). |
| E-26 | fixed | worker/processors/monthly-report.ts | Betreff/Titel "Monats-Auswertung September 2026" statt "2026-09"; Mail an Inhaber und Marketing (aktive Nutzer, wie Dokument-Sichtbarkeit); Sendefehler werden gesammelt und am Ende geworfen, der Wiederholungslauf schickt nur an die fehlgeschlagenen Empfänger. |
| E-08 | fixed | worker/processors/review-request.ts, server/email-once.ts (neu), Migration 0083 | Bewertungs-Mail wird direkt gesendet statt über `enqueueEmail`; Zeile wird atomar `pending -> sent` beansprucht, Sendefehler setzt sie zurück auf `pending`; Ledger `email_send_log` + Resend-Idempotency-Key verhindern Doppelversand, auch wenn Worker und Cron beide laufen. |
| E-11 | fixed | worker/processors/review-request.ts | Zeilen mit `scheduled_for` älter als 14 Tage gehen auf `skipped`/`stale` statt rausgeschickt zu werden. |
| E-12 | fixed | worker/processors/review-request.ts, berlin-days.ts (+Test) | Versand nur Mo-Fr 09:00-17:59 Berlin, Fälligkeit nach Berliner Datum statt UTC; außerhalb bleibt alles `pending`. |
| E-13 | fixed | worker/processors/review-request.ts, server/email.ts | Absender `"<Praxis> via EINS" <team@eins.ag>` (oder `review_email_from`, falls gesetzt), Reply-To = `review_inbox_email` bzw. `default_doctor_email`; `SendEmailInput` hat dafür `from`/`replyTo`. Eigene Marketing-Subdomain: siehe Entscheidungen. |
| E-18 | fixed | server/email.ts, worker/processors/review-request.ts, server/review-tokens.ts, api/review-tokens/[token]/unsubscribe/route.ts | `List-Unsubscribe` zeigt auf `POST /api/review-tokens/<t>/unsubscribe` (RFC 8058), mailto mit reiner Adresse, Abmeldung funktioniert auch nach Ablauf des 90-Tage-Tokens (`allowExpired`), Ratelimit für geteilte Gmail-IPs angehoben. |
| B-22 | fixed | api/review-tokens/[token]/unsubscribe/route.ts, clinic-landing app/r/unsubscribe/{page,actions}.tsx | GET meldet nicht mehr ab: Portal-GET leitet auf die Bestätigungsseite um, die Seite zeigt einen Knopf "Jetzt abmelden" (Server Action -> POST). Scanner melden niemanden mehr ab. |
| E-19 | fixed | server/email.ts, worker/processors/email-send.ts | Resend bekommt `idempotencyKey` (Option `idempotencyKey` am Sender, Feld im `email-send`-Job); alle neuen Direktversände setzen einen stabilen Schlüssel. Ein Schlüssel aus dem Job-Inhalt wurde bewusst nicht gebaut (würde gleiche Ops-Alarme innerhalb 24 h verschlucken). |
| E-30 | fixed | server/review-tokens.ts, server/email/templates/feedback-alert.ts | Feedback-Alarm wird inline gesendet (Ledger-Schlüssel `feedback-alert/<id>`), Queue nur als Rückfallnetz; zusätzlich Glocken-Meldung an Inhaber:innen. Alarm-Mail enthält keine Patientendaten mehr (Name, E-Mail, Freitext nur im Portal, Regel 5) und keinen Gedankenstrich. Animation-Teil siehe G-11. |
| G-11 | fixed | admin/animations/actions.ts | "Bereit"-Mail geht inline (Ledger-Schlüssel je Übergang) statt über die Queue; nur ein echter Wechsel auf `ready` (atomar `status <> 'ready'`) setzt `deliveredAt` und mailt, Doppelklick schickt keine zweite Mail; Speicher-Schlüssel muss unter `<clinicId>/` liegen und per `storage.head` existieren. Upload-Feld statt Freitext ist UI (WS7, siehe unten). |
| E-06 | fixed | api/webhooks/resend/{route,classify,classify.test}.ts | Befund stimmt: Resend liefert `bounce.type` SES-artig großgeschrieben ("Permanent"), der Vergleich mit "permanent" griff nie. Neue reine Funktion `suppressionReasonFor`: Groß-/Kleinschreibung egal, `email.bounced` gilt als hart außer explizit "transient" (Resend meldet temporäre Fehler als `delivery_delayed`); Test mit realistischem Payload. Die Doku-Seite konnte heute nicht live abgerufen werden (Abruf-Limit), Casing aus bekanntem Resend-Beispiel. |
| E-07 | fixed | api/webhooks/resend/route.ts | Unterdrückung sucht die Praxis jetzt auch über `review_email_schedule.review_email` und `requests.contact_email`; alle Vergleiche case-insensitiv (`lower()`). |
| E-04 | fixed | worker/processors/sync-google.ts | Abfrage geht an `customers/<clinics.google_ads_customer_id>`, `login-customer-id` = `clinics.google_ads_login_customer_id` ?? env (MCC nur noch als Header); ohne Kundennummer kein Sync und sichtbarer `lastSyncError`; Berliner "gestern", 15-s-Zeitlimit. |
| E-17 | fixed | server/google-ads-oci.ts, worker/processors/sync-google.ts | Eine Konstante `GOOGLE_ADS_API_VERSION` für beide Aufrufer, Standard `v23`, per Env `GOOGLE_ADS_API_VERSION` überschreibbar; 404 wird laut als "Version abgekündigt?" gemeldet. Aktuelle Version nicht live geprüft. |
| E-16 | fixed | worker/processors/sync-meta.ts | Teilfehler je Werbekonto werden gesammelt und vor dem Schreiben geworfen (kein 0 € über echte Werte, Job/Cron-Schritt meldet Fehler); Kontenliste mit Paging; Token im `Authorization`-Header statt URL; 15-s-Zeitlimit; Berliner "gestern". |
| E-09 | fixed | worker/processors/refresh-oauth.ts, worker/processors/connection-alerts.ts (neu) | Meta-Ablauf-Hinweis über `notifyOwnersOnce`: höchstens eine Glocke je Inhaber:in und 7 Tage (Dedupe per `NOT EXISTS` in SQL), abgelaufene Token sagen "abgelaufen". Mail an den Inhaber zusätzlich: nicht gebaut (siehe Entscheidungen). |
| E-29 | fixed | worker/processors/{refresh-oauth,sync-google,connection-alerts}.ts | Google-Token-Endpunkt 400/401 (Widerruf) oder 3 Tage ohne erfolgreichen Sync: Glocke "Google-Verbindung unterbrochen" an Inhaber:innen, höchstens einmal je 7 Tage. Karte in Einstellungen: WS6-Datei, nicht angefasst. |
| C-33 | fixed | worker/processors/sla-check.ts | Ein einziges `INSERT ... SELECT ... NOT EXISTS` (Dedupe je Nutzer und Anfrage) statt Volltabellen-Load aller `sla_breach`-Meldungen plus N+1; nur Fristüberschreitungen der letzten 7 Tage, damit der erste Lauf nach Pause keine Welle erzeugt. SQL lokal per Dry-Run geprüft. |
| E-14 | fixed (Teil) | worker/processors/sla-check.ts | Abfrage-/Dedupe-Teil wie C-33 behoben. Die 2-Stunden-Frist rund um die Uhr bleibt laut Entscheidung 2 (Karam, 06.10.); keine Werkstunden-Logik eingebaut. |
| E-31 | fixed (Teil) | server/review-tokens.ts | Landing-Klick: der letzte Stern gilt (nicht mehr der erste), bis die Patientin Feedback absendet; abgesendetes Feedback setzt die Bewertung verbindlich. Scanner, die 1..5 der Reihe nach öffnen, nageln nicht mehr 1 ★ fest. Vollständig wäre: Landing-Seite bucht erst nach Knopfdruck, das ist clinic-landing `app/r/[token]/page.tsx` (nicht meine Datei). |
| E-03 | fixed | worker/processors/db-backup.ts, apps/portal/Dockerfile | Beides: Image installiert `postgresql17-client` (Rückfall auf Alpines Standard-Client), und der Job stürzt nicht mehr ab: `error`-Listener an pg_dump/gzip, Exitcode beider Prozesse geprüft (kein abgeschnittenes Archiv), Direktverbindung statt Pooler, Fehler -> `notifyOps` (high) + Job-Fehler. `uncaughtException`-Handler im Worker: siehe "Braucht andere Datei". |
| E-22 | fixed (Teil) | /fly.toml | `kill_signal = "SIGTERM"`, `kill_timeout = 35` (pg-boss wartet bis 30 s). Prozessweite `uncaughtException`/`unhandledRejection`-Handler und Hard-Timeout im Shutdown gehören in `worker/index.ts` (andere Sitzung). |
| E-01 | fixed (Rebuild-Teil) | api/cron/daily/route.ts (neu), api/cron/_lib/run.ts (neu), worker/processors/kpi-rebuild.ts, apps/portal/vercel.json | Täglicher Vercel-Cron `/api/cron/daily` (03:00 UTC, Bearer `CRON_SECRET`, konstantzeitiger Vergleich, 401/503, nodejs, maxDuration 300, force-dynamic) baut `kpi_daily` für heute plus die 7 Tage davor (Berliner Tage) neu, nach Meta-/Google-Sync; idempotenter Upsert, Tage ohne Quelldaten werden auf 0 zurückgesetzt (Selbstheilung). Jeder Schritt und jede Praxis in eigenem try/catch, eine JSON-Logzeile je Schritt, JSON-Zusammenfassung. Live-Werte im Dashboard: WS5. |
| E-27 | fixed | worker/processors/{kpi-rebuild,sync-meta,sync-google,forecast-snapshot}.ts, berlin-days.ts | KPI-Gruppierung `(created_at AT TIME ZONE 'Europe/Berlin')::date`, "gestern"/"heute" überall aus dem Berliner Kalender statt `toISOString()`. |
| H-11 | fixed (Code-Teil) | api/cron/{daily,morning}/route.ts, vercel.json | Ohne Worker laufen jetzt: KPI-Neuaufbau, Meta/Google-Sync, OAuth-Hinweise, Prognose, Bewertungs-Syncs, Anomalien, Audit-Purge (So.) nachts; Bewertungs-Mails, Monats-Auswertung (Tag 1-7) und SLA-Glocke morgens (`/api/cron/morning`, 08:00 UTC, im Sendefenster). Feedback-Alarm und Animation-Mail inline. Weiter nur mit Worker: KI-Score (WS1 inline?), Wiederbehandlungs-Erinnerung (andere Sitzung), PVS, CAPI/OCI, DB-Backup. |
| E-05 | no_change_needed | - | Durch WS1 behoben (Neue-Anfrage-Mail inline im Intake). |

Abweichung von Entscheidung 1: zwei Cron-Routen statt einer. `/api/cron/daily` läuft um 03:00 UTC (04/05 Uhr Berlin); Patienten- und Inhaber-Mails dürfen laut E-12 nicht nachts raus, deshalb laufen Bewertungs-Mails, Monats-Auswertung und SLA-Glocke im zweiten Eintrag `/api/cron/morning` (08:00 UTC). Zusammen 2 Cron-Einträge, also auf jedem Vercel-Plan zulässig.

## Braucht andere Datei

- `src/worker/index.ts` (andere Sitzung): prozessweite `uncaughtException`/`unhandledRejection`-Handler und ein Hard-Timeout im Shutdown, damit ein Doppel-SIGTERM nicht hängt (E-03/E-22). `processMonthlyReport` liefert weiter `Promise<void>`, `runMonthlyReport` ist die Variante mit Ergebnis.
- `src/worker/schedules.ts` (andere Sitzung): Dispatcher kann `__autoprev__` behalten (wird jetzt aufgelöst). Den kpi-rebuild-Dispatcher auf Berliner "gestern" umstellen (heute `toISOString()`, um 03:00 UTC zufällig richtig).
- `src/server/jobs.ts` (andere Sitzung): `enqueueEmail`-Payload-Typ um `idempotencyKey?: string` ergänzen; der `email-send`-Prozessor reicht ihn bereits an Resend weiter (in `review-tokens.ts` derzeit über eine Variable übergeben).
- `src/server/ops-alerts.ts` (ohne Besitzer im Ledger): `notifyOps` versendet über `enqueueEmail`, kommt bei Worker 0 also nie an. Auf `sendEmailOnce` (server/email-once.ts) mit Schlüssel `ops/<scope>/<Zeitfenster>` umstellen.
- `src/lib/env.ts` (WS3): `CRON_SECRET`, `GOOGLE_ADS_API_VERSION`, `OPS_ALERT_EMAIL` ins Schema; Produktionsprüfung `EMAIL_DRIVER=resend` + `RESEND_API_KEY` beim Start (B-2-Gegenstück, `server/email.ts` wirft bereits beim Senden).
- `src/auth/magic-link.ts` (WS6): Klartext-E-Mail und rohe `clinic=<uuid>` in Logzeilen kürzen bzw. `clinicLogId` (A-12 Rest).
- `src/app/admin/operations/_components/AnimationenQueue.tsx` (WS7): Upload-Feld statt Freitext-Schlüssel; Hinweistext darf bleiben (Mail geht jetzt wirklich automatisch).
- clinic-landing `app/r/[token]/page.tsx`: Stern erst nach bewusster Aktion buchen, nicht beim Seitenaufruf (E-31 Rest).
- `src/worker/processors/retreatment-reminder.ts` (andere Sitzung): Wiederbehandlungs-Erinnerung braucht ebenfalls einen Cron-Pfad ohne Worker; kann in `/api/cron/morning` als weiterer Schritt aufgenommen werden, sobald der Prozessor direkt sendet und idempotent ist.

## Migration

- `0083_email_send_log.sql`: neue Tabelle `email_send_log(idempotency_key PK, clinic_id, sent_at)` + Index, `REVOKE ALL ... FROM eins_app`. Additiv, `IF NOT EXISTS`. Lokal angewendet. Nebenwirkung: der lokale Lauf hat auch die noch offenen `0079_ops_alerting` und `0080_ads_outbox_invoice_dedup` (andere Sitzungen) mit angewendet.
- Prod: vor dem ersten Cron-Lauf `pnpm --filter portal db:migrate` gegen Neon, sonst scheitern alle Ledger-Mails (Monats-Auswertung, Bewertungs-Mail, Feedback-Alarm, Animation).

## Offene Entscheidungen für Karam

1. **Patientenmails über eigene Subdomain** (E-13): Bewertungs-Mails laufen als `"<Praxis> via EINS" <team@eins.ag>`, gleiche Domain wie Login-Links. Eine Beschwerdewelle trifft so auch die Anmelde-Mails. Empfehlung: Subdomain (z. B. `mail.eins.ag`) in Resend verifizieren und als `review_email_from` je Praxis setzen.
2. **Feedback-Alarm ohne Patientendaten** (E-30): Die Mail an die Praxis nennt nur Sterne und Rückrufwunsch, Name/E-Mail/Text stehen nur im Portal (Regel 5). Wer den Inhalt in der Mail will, müsste das bewusst zurückdrehen.
3. **Google-Ads-API-Version** (E-17): Standard jetzt `v23`, nicht live geprüft. Vor dem ersten Google-Kunden die aktuell unterstützte Version in Googles Sunset-Liste nachsehen und ggf. `GOOGLE_ADS_API_VERSION` setzen.
4. **Meta-Ablauf zusätzlich per Mail** (E-09): bisher nur Glocke (einmal je Woche). Mail an den Inhaber wäre ein kleiner Zusatz.
5. **Monats-Auswertung auch an Marketing-Rolle** (E-26): umgesetzt, weil das Dokument für beide sichtbar ist. Falls nur Inhaber gewünscht: eine Zeile in `monthly-report.ts`.
6. **DB-Backup**: Job bleibt im Worker (läuft nur bei Worker 1). Ohne Worker gibt es nur Neon-PITR. Entscheiden, ob ein externer Export (GitHub Action) nötig ist; R2-Lebenszyklus für `backups/` setzen.

## Env für Vercel (Produktion)

- `CRON_SECRET` (neu, Pflicht; ohne liefern beide Cron-Routen 503). Zufallswert, z. B. `openssl rand -hex 32`. Vercel schickt ihn automatisch als Bearer.
- `EMAIL_DRIVER=resend` und `RESEND_API_KEY` (Pflicht; sonst wirft jeder Versand, kein Konsolen-Fallback mehr).
- `EMAIL_FROM` (bare Adresse auf verifizierter Domain), optional `EMAIL_REPLY_TO`.
- `APP_ORIGIN`, `CLINIC_LANDING_ORIGIN` (Links in Mails, One-Click-Abmeldung).
- `OPS_ALERT_EMAIL` (optional, Backup-/PVS-Alarme; siehe ops-alerts-Hinweis oben).
- `GOOGLE_ADS_API_VERSION` (optional, Standard `v23`).
- Für den Fly-Worker, falls später eingeschaltet: dieselben Mail-Variablen plus `DATABASE_URL_DIRECT`.

## Nicht getestet

- `/api/cron/daily` und `/api/cron/morning` wurden per tsx-Skript direkt gegen die lokale DB aufgerufen (Handler-Import, `CRON_SECRET` nur im Prozess): falscher Bearer -> 401, ohne Secret -> 503 (Dev-Server :3007), `morning` -> 200, alle Schritte ok, Monats-Auswertung `created: 4`, zweiter Lauf `mailed_only: 4` ohne neue Mails (Ledger greift). Die JSON-Ausgabe von `daily` lief im selben Skript vor `morning` ohne Ausnahme durch, ihre Zusammenfassung wurde aber abgeschnitten; ein zweiter Lauf scheiterte, weil der lokale Docker-Postgres inzwischen gestoppt ist (ECONNREFUSED). Einzelne `ok`-Flags von `daily` daher nicht gesehen.
- Echter Resend-Versand, Idempotency-Key-Verhalten bei Resend, Resend-Webhook mit echtem Testevent (Payload-Casing aus dem bekannten Doku-Beispiel, Doku heute nicht abrufbar).
- Meta-/Google-Ads-Aufrufe (keine Zugangsdaten lokal), Google-Ads-Version.
- `db-backup` mit echtem `pg_dump`; Docker-Build mit `postgresql17-client`; `fly.toml` `kill_timeout` (kein Deploy).
- clinic-landing Abmeldeseite im Browser (nur Typcheck); Animations-Aktion im Admin-UI (nur Typcheck).
- Bewertungs-Tick mit fälliger Zeile im Sendefenster (lokal außerhalb des Fensters gelaufen, `outsideWindow: true`).
