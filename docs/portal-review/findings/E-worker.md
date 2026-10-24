# E-worker: Hintergrund-Maschinerie unter echten Produktionsbedingungen

Prüfer: nur lesen. Geprüft: `src/worker/**`, `src/server/jobs.ts`, `src/lib/queues.ts`, `src/server/email*.ts`, Resend-Webhook, Werbe-Outbox (CAPI/OCI), `oauth.ts`, `review-sync.ts`, `review-tokens.ts`, Review-Token-Routen, `fly.toml`, `apps/portal/Dockerfile`, pg-boss 10.4.x (`node_modules/pg-boss/src`).
Wiederbehandlungs-Prozessoren (`retreatment-*`) wurden gelesen, Befunde dort sind markiert `(in Arbeit, andere Sitzung)`.

## 1. Inventar: Jobs, Zeitpläne, Folgen

Alle Cron-Ausdrücke sind **UTC** (`boss.schedule(queue, cron)` ohne `tz`, `src/worker/index.ts:213-218`, `schedules.ts:6`). Es gibt keinen Vercel-Cron (`apps/portal/vercel.json` enthält nur Framework und Region) und keinen `after()`-Pfad. Alles läuft über pg-boss im Fly-Worker.

Grundverhalten pg-boss bei Worker = 0 (belegt in `node_modules/pg-boss`):
- Zeitpläne feuern nur, solange der Worker läuft (Timekeeper im Worker-Prozess, `connection.ts:26`). Verpasste Slots werden **nicht nachgeholt**, sie sind einfach weg. Beim Wiedereinschalten kommt also kein Cron-Sturm.
- Von der Web-App eingestellte Jobs (`boss.send`) bleiben im Zustand `created`, bis der Worker läuft. Default `keep_until` ist 14 Tage (`plans.js:195`). Danach löscht die Wartung sie ohne Spur. Sendet die Web-App an eine Queue, die der Worker noch nie angelegt hat, schlägt der Insert fehl, `safeAdd` fängt das und gibt `null` zurück (`jobs.ts:81-84`). Der Job ist dann nie existent gewesen.
- Zustandsgetriebene Prozessoren (Bewertungs-Mail, Wiederbehandlungs-Erinnerung) lesen "fällige" Zeilen aus der DB. Dort entsteht beim Einschalten ein Rückstau aus allem, was inzwischen fällig wurde.

| Job | Auslöser | Nutzersichtbare Wirkung | Wirkung bei Worker AUS (heute) | Wirkung beim Wiedereinschalten |
|---|---|---|---|---|
| `ai-score` | Lead-Intake (`api/leads/intake/route.ts:306`), Job in Queue | KI-Score/Kategorie (heiß/warm/kalt) in Anfragenliste, Detail, Anrufliste | Job wartet (14 Tage). Score bleibt leer, UI zeigt "–" | Alle wartenden Anfragen werden nacheinander bewertet (2 s Polling, 1 pro Zyklus). Unkritisch |
| `email-send` | `enqueueEmail`: Bewertungs-Mail, Wiederbehandlungs-Mail, Feedback-Alarm an Inhaber, Animation-bereit-Mail (`admin/animations/actions.ts:74`) | Patienten-Mails, Alarm bei negativer Patientenrückmeldung | Mail wartet in Queue, **kommt nicht an** | Alle wartenden Mails gehen gleichzeitig raus, auch Tage alte (kein Alterslimit) |
| `sla-check` | Cron `*/15 * * * *` | Glocken-Benachrichtigung "Reaktionszeit überschritten" (nur in-app, keine Mail) | Keine Benachrichtigung | Erster Tick meldet alle offenen Anfragen älter als 2 h auf einmal |
| `refresh-oauth` | Cron `*/15 * * * *` | Google-Token-Erneuerung, Meta-Ablauf-Hinweis | Google-Token läuft nach 1 h ab, wird von `sync-google` ohnehin neu geholt. Kein Meta-Hinweis | Erneuert sofort. Meta-Hinweis dann alle 15 min (siehe E-09) |
| `review-request-tick` | Cron `*/15 * * * *` | Bewertungs-Mail an Patient:innen (EINS Bewertungen) | Keine Mails. Zeilen bleiben `pending` | Alle `pending` Zeilen mit `scheduled_for <= heute` (UTC) gehen raus, 200 pro Tick, ohne Alterslimit (E-11) |
| `retreatment-reminder-tick` | Cron `0 8 * * *` (08:00 UTC = 09/10 Uhr Berlin) | Erinnerungs-Mail Wiederbehandlung | Keine Mails | Nächster 08:00-Tick. Das Gate "mehr als 60 Tage überfällig" (`lib/retreatment.ts`) begrenzt den Rückstau. `(in Arbeit, andere Sitzung)` |
| `retreatment-refresh` | Dispatcher `45 3 * * *` plus `enqueueRetreatmentRefresh` nach Einstellungsänderung (`wiederbehandlungen/actions.ts:155,216`) | Wiederbehandlungs-Kalender | Kalender wird nie berechnet, Änderung an Einstellungen wirkt nicht. `(in Arbeit, andere Sitzung)` | Rechnet neu |
| `kpi-rebuild` | Dispatcher `0 3 * * *`, Zeitraum nur "gestern" (`schedules.ts:99`) | **Alle Kennzahlen auf Dashboard/Auswertung** (lesen ausschließlich `kpi_daily`, `queries/kpis.ts:53-64`) | `kpi_daily` bleibt leer: Dashboard zeigt 0 Anfragen, 0 Termine (E-01) | Baut nur "gestern". Nichts davor wird nachgefüllt (E-01) |
| `forecast-snapshot` | Dispatcher `15 3 * * *` | Prognose-Karte | Kein Snapshot, Karte zeigt Leerzustand | Läuft nächste Nacht |
| `sync-meta` | Dispatcher `0 2 * * *` | Werbebudget, Kosten pro Anfrage | Keine Werbedaten | Nächste Nacht, nur "gestern" |
| `sync-google` | Dispatcher `30 2 * * *` | wie oben | wie oben | wie oben, aber inhaltlich falsch (E-04) |
| `sync-reviews-google` | Dispatcher `0 4 * * *`; zusätzlich Button "Jetzt aktualisieren" ruft Prozessor direkt in der Web-Anfrage (`review-sync.ts`) | Bewertungs-Kacheln | Nur über Button | Läuft nächste Nacht |
| `sync-reviews-jameda` | Dispatcher `20 4 * * *`; Button | wie oben | wie oben | wie oben |
| `monthly-report` | Dispatcher `0 5 1 * *`, `period: "__autoprev__"` | Monats-PDF unter Dokumente plus Mail | Nichts | **Funktioniert auch eingeschaltet nicht** (E-02) |
| `anomaly-scan` | Cron `30 */6 * * *` | Widget "Auffälligkeiten" | Widget leer | Läuft |
| `db-backup` | Cron `30 3 * * *` | Keine (Betrieb) | Kein Backup durch die App | Stürzt den Worker ab (E-03) |
| `purge-audit` | Cron `0 4 * * 0` | Keine | Audit-Log, Magic-Link- und Ratelimit-Tabellen wachsen | Räumt auf |
| `pvs-status-derive` | `applyPvsEvent`, singletonKey je Patient | Anfrage-Status und Umsatz aus PVS | PVS-Events werden gespeichert, Status ändert sich nicht. Entfällt für die erste Praxis (kein PVS) | Replay aller wartenden |
| `pvs-csv-ingest` | Upload-Aktion (`pvs-csv-upload.ts:182`) | CSV-Import | Upload-Zeile steht auf `processing`, nichts passiert | Verarbeitet |
| `pvs-link-backfill`, `pvs-lead-token-write` | PVS-Pfad, `leads.ts:213` | Patientenverknüpfung | nichts (nur mit PVS relevant) | Replay |
| `pvs-partition-rotate` | Cron `0 4 * * *` | keine | unkritisch, `applyPvsEvent` heilt Partitionen selbst (Kommentar in der Datei) | läuft |
| `pvs-reconcile` | Cron `15 */4 * * *` | PVS-Hilfe | wie oben | läuft |
| `pvs-treatment-suggest` | Cron `30 4 * * *` | Behandlungs-Zuordnungsvorschläge | keine | läuft |
| `pvs-agent-health-scan` | Cron `5 * * * *` | Alarm "Agent still" | Kein Alarm | läuft |
| `capi-purchase` | Outbox-Insert (Meta ist per `META_PURCHASE_REPORTING` aus) | Meta-Umsatzmeldung | Zeile bleibt `pending` | Skippt wegen Schalter |
| `oci-purchase` | Outbox bei InvoicePaid | Google-Ads-Umsatzmeldung | Zeile `pending`, Rückstau | Sendet (Google Ads API v18, E-17) |
| Dispatcher `*-dispatch` (8 Stück) | Cron | Fan-out je Praxis | nichts | je Praxis ein Job |

Zeitzonen: alle Crons laufen in UTC. Die Morgen-Mail (08:00 UTC) ist im Sommer 10:00 Berlin, im Winter 09:00. Das ist bewusst und unkritisch. Doppelläufe sind durch den pg-boss-Slot-Singleton ausgeschlossen. Überspringen ist möglich: ein Slot, in dem der Worker nicht läuft (Deploy, Absturz, Wartung), wird nicht nachgeholt. Bei Jobs mit "nur gestern"-Fenster (kpi, sync-meta, sync-google) bleibt dann eine Lücke.

## 2. Welche Jobs für die erste Praxis kritisch sind, Architekturvorschlag

Empfehlung in einem Satz: Alles, was ein Mensch in der Praxis erwartet (Mail, Zahl auf dem Dashboard), darf nicht an einem Worker hängen, den es nicht gibt. Der Worker bleibt nur für schwere, PVS-bezogene und asynchrone Dinge.

| Job | Empfehlung |
|---|---|
| Neue-Anfrage-Mail an die Praxis | Existiert nirgends (E-05). Neu bauen, **inline** nach Persistieren im Intake-Route via `after()` (Resend direkt, mit `email_suppression`), nicht über die Queue |
| `ai-score` | Inline via `after()` im Intake-Route (Regelscorer ist schnell, OpenAI-Aufruf nur mit Einwilligung). Queue nur als Retry-Netz |
| `email-send` (Feedback-Alarm, Animation-Mail) | Inline senden (wie `sendMagicLinkEmail` schon tut). Fehlschlag in eine kleine Outbox-Tabelle schreiben, Vercel-Cron wiederholt |
| `review-request-tick`, `retreatment-reminder-tick`, `sla-check` | **Vercel Cron** (`/api/cron/*`, mit `CRON_SECRET`). Review-Tick auf feste Sendezeit (Berlin 09:00 bis 18:00), siehe E-12 |
| `kpi-rebuild` | Vercel Cron nachts, Fenster mindestens 35 Tage statt "gestern", plus einmaliger Rückfüllauf beim Start der Praxis. Alternativ Dashboard live aus `requests` für "Anfragen" |
| `monthly-report` | Vercel Cron am 1. um 05:00 UTC, Periode im Cron-Handler berechnen (E-02) |
| `sync-meta`, `sync-google`, `refresh-oauth`, Review-Syncs | Vercel Cron (nachts). Kein Worker nötig, solange die Praxis höchstens wenige Konten hat |
| `anomaly-scan`, `forecast-snapshot` | Vercel Cron, unkritisch |
| `db-backup` | Aus dem Worker nehmen. Neon-PITR plus ein externer Export (GitHub Action oder Fly-Maschine mit `postgresql-client`) |
| `pvs-*`, `capi/oci` | Bleiben im Worker. Erst einschalten, wenn die erste Praxis ein PVS verbindet oder Google-Ads-Umsatzmeldung nötig wird |

Vercel-Cron-Hinweis: Auf dem Hobby-Plan sind nur tägliche Crons erlaubt. Der Review-Tick (alle 15 min) braucht Pro, sonst stündlich genügt es auch.

## 3. Befunde

### E-01: Dashboard-Kennzahlen lesen nur `kpi_daily`, die nur der Worker füllt
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/kpis.ts:53-64`, `src/app/(portal)/dashboard/page.tsx:202`, `src/worker/processors/kpi-rebuild.ts`, `src/worker/schedules.ts:94-100`
- Beleg: `kpiSummaryUncached` summiert nur `schema.kpiDaily`. Ein Aufruf von `enqueueKpiRebuild` außerhalb von `jobs.ts` existiert nicht (Grep). Der Dispatcher fährt nur "gestern" (`from: yesterdayIso(), to: yesterdayIso()`).
- Szenario: Die erste Praxis erhält am Montag drei echte Anfragen. Worker ist aus: Dashboard, Auswertung und Fortschritt zeigen 0 Anfragen und leere Verläufe. Auch nach dem Einschalten werden nur Tage ab "gestern" berechnet. Anfragen vom Montag erscheinen nie, weil der Montag nie neu gebaut wird. Spätere Statuswechsel (Termin, gewonnen) für ältere Anfragen schlagen ebenfalls nie durch, weil `createdAt::date` der Schlüssel ist und nur "gestern" neu gerechnet wird. Der Inhaber sieht "nichts passiert", obwohl die Anfragenliste voll ist.
- Fix-Vorschlag: Kennzahlen "Anfragen" und "Termine" live aus `requests` lesen (RLS-sicher über `withClinicContext`) oder den nächtlichen Rebuild auf ein Fenster der letzten 35 Tage ausweiten und einmal beim Anlegen der Praxis rückfüllen. Rebuild zusätzlich bei jedem Statuswechsel einer Anfrage für den betroffenen Tag anstoßen.

### E-02: Monats-Auswertung wird nie erzeugt, `__autoprev__` wird nirgends aufgelöst
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/worker/schedules.ts:115`, `src/worker/processors/monthly-report.ts:34-40`
- Beleg: Der Dispatcher sendet `period: "__autoprev__"`. Der Prozessor macht `period.split("-").map(Number)`, bekommt `NaN`, loggt `invalid period` und kehrt normal zurück. Grep nach `__autoprev__` findet nur Zeitplan und Test, der Test zementiert den Platzhalter.
- Szenario: Am 1. jedes Monats läuft der Job "erfolgreich" (kein Fehler, kein Retry), erzeugt aber weder PDF, Dokument noch Mail. Das Versprechen "Monats-Auswertung im Portal" bricht still, auch bei laufendem Worker.
- Fix-Vorschlag: In `processMonthlyReport` `period === "__autoprev__"` zum Vormonat in Europe/Berlin auflösen, Test anpassen. Bei ungültigem Wert werfen statt still zurückkehren.

### E-03: `db-backup` stürzt den Worker ab, weil `pg_dump` im Image fehlt
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `apps/portal/Dockerfile:73-75`, `src/worker/processors/db-backup.ts:41-48`
- Beleg: Das Runtime-Image installiert nur `tini` und `tsx` (`apk add --no-cache tini`). `spawn("pg_dump", ...)` und `spawn("gzip", ...)` haben keinen `error`-Listener. Fehlendes Binary löst auf dem ChildProcess ein `error`-Event ENOENT aus. Ohne Listener ist das eine unbehandelte Ausnahme und beendet den Node-Prozess. Zusätzlich wird nur der `gzip`-Exitcode geprüft (`db-backup.ts:79`), nicht der von `pg_dump`.
- Szenario: Um 03:30 UTC stirbt der Worker, laufende Jobs gehen verloren (Retry erst nach 15 min Expire), Fly startet neu. Jede Nacht. Selbst mit installiertem `pg_dump`: bricht der Dump mittendrin ab (Pooler, Timeout), wird ein abgeschnittenes Archiv als "erfolgreiches Backup" hochgeladen. Außerdem nutzt der Job `env.DATABASE_URL` (Pooler) statt der Direkt-URL, und er puffert den ganzen Dump zweimal im Speicher (`Buffer.concat`) auf einer 512-MB-Maschine.
- Fix-Vorschlag: `postgresql17-client` ins Image (Version zu Neon passend), `error`-Listener an beide Prozesse, Exitcode von `pg_dump` prüfen, `bossConnectionString()` als Quelle, per Multipart-Upload streamen. Oder den Job entfernen und Neon-PITR plus externen Export nutzen. R2-Lebenszyklus für `backups/` setzen.

### E-04: `sync-google` fragt für jede Praxis dasselbe Konto ab
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/worker/processors/sync-google.ts:56-69`, `src/db/schema.ts:121,133`
- Beleg: Die Abfrage geht an `customers/${env.GOOGLE_ADS_LOGIN_CUSTOMER_ID}/googleAds:searchStream` mit `FROM customer`. Die Praxis hat aber `googleAdsCustomerId` und optional `googleAdsLoginCustomerId` im Schema, und `google-ads-oci.ts` nutzt sie korrekt. Der Sync liest sie nie.
- Szenario: Der Login-Kunde ist das Manager-Konto (MCC) von EINS. Jede verbundene Praxis bekommt dessen Kennzahlen (oder 0) als "eigene" Werbekosten in `campaign_snapshots`. Eine Praxis sieht Ausgaben, die nicht ihre sind. Mandantenübergreifende Zahlen im Dashboard.
- Fix-Vorschlag: `customerId` aus `clinics.googleAdsCustomerId` lesen, `login-customer-id` aus `clinics.googleAdsLoginCustomerId ?? env`. Ohne Kundennummer überspringen.

### E-05: Keine Benachrichtigung der Praxis über neue Anfragen
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/server/leads.ts` (kein Notification-Insert), `src/app/api/leads/intake/route.ts:296-312`, Grep `insert(schema.notifications)` findet nur `sla-check.ts:78` und `refresh-oauth.ts:82`
- Beleg: Beim Eingang einer Anfrage wird nur der KI-Score-Job eingestellt. Weder Mail noch In-App-Benachrichtigung an Inhaber oder Frontdesk.
- Szenario: Eine Patientin füllt das Formular am Freitag um 17:30 Uhr aus. Niemand in der Praxis erfährt davon, bis jemand das Portal öffnet. Die einzige Erinnerung ist die In-App-Meldung nach 2 h (E-14), und die gibt es nur bei laufendem Worker. Das Garantie-Modell lebt von schneller Reaktion (48-Werkstunden-Regel).
- Fix-Vorschlag: Im Intake-Route per `after()` eine Mail an Inhaber und Frontdesk (Rolle, nicht unterdrückt) senden und eine Benachrichtigung einfügen. Inline, nicht über die Queue.

### E-06: Resend-Webhook erkennt harte Bounces vermutlich nie (Groß-/Kleinschreibung)
- Schwere: P1
- Art: bug
- Sicherheit: mittel
- Ort: `src/app/api/webhooks/resend/route.ts:111-113`
- Beleg: `const isPermanent = event.data?.bounce?.type === "permanent";`. Resends Bounce-Payload liefert `bounce.type` als `"Permanent"` (großgeschrieben), soweit mir die Resend-Dokumentation bekannt ist (aus dem Gedächtnis, nicht gegen die aktuelle Doku geprüft).
- Szenario: Eine Patientenadresse bounct hart. Der Webhook wertet das als "transient" und trägt nichts in `email_suppression` ein. Jede weitere Bewertungs-/Erinnerungs-Mail an diese Adresse bounct wieder, Absender-Reputation der geteilten Domain `eins.ag` (auch Magic-Links!) sinkt.
- Fix-Vorschlag: `String(type).toLowerCase() === "permanent"`; zusätzlich "undetermined" bei wiederholtem Auftreten behandeln. Mit echtem Resend-Testevent prüfen.

### E-07: Bounce und Beschwerde unterdrücken nur Adressen aus `patients` und `clinic_users`
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/app/api/webhooks/resend/route.ts:146-165`, `src/worker/processors/retreatment-reminder.ts:206-228`, `review-request.ts` (liest `review_email_schedule.review_email`)
- Beleg: `suppressEverywhere` sucht nur in `schema.patients.email` und `schema.clinicUsers.email`. Die Bewertungs-Mail geht an `review_email_schedule.review_email`, die Wiederbehandlungs-Mail bevorzugt `requests.contact_email`. Beide Quellen werden nicht abgefragt.
- Szenario: Die Adresse stammt aus einer Anfrage, nicht aus `patients`: Bounce oder Spam-Beschwerde erzeugen keinen Eintrag, die nächste Mail geht trotzdem raus (`(in Arbeit, andere Sitzung)` für den Wiederbehandlungs-Teil).
- Fix-Vorschlag: Zusätzlich `requests.contact_email` und `review_email_schedule.review_email` auflösen, oder besser die Mail beim Senden mit `tags: [{name:"clinic_id"}]` versehen und im Webhook darüber zuordnen.

### E-08: Bewertungs-Mail kann still verloren gehen, `enqueueEmail` gibt `null` zurück
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/worker/processors/review-request.ts:187-206`, `src/server/jobs.ts:74-85`
- Beleg: Die Zeile wird auf `sent` gesetzt, danach `await enqueueEmail(...)`. `enqueueEmail` fängt Fehler und gibt `null` zurück, wirft aber nicht. Der Rollback auf `pending` greift nur im `catch`, also nie bei `null`. Der Wiederbehandlungs-Prozessor behandelt genau diesen Fall korrekt (`retreatment-reminder.ts:189-198`).
- Szenario: Kurzer DB-Wackler oder fehlende Queue beim Enqueue: Zeile steht auf `sent`, die Patientin bekommt nie eine Mail, in der Auswertung zählt sie als "gesendet".
- Fix-Vorschlag: Rückgabewert prüfen, bei `null` auf `pending` zurücksetzen (wie `retreatment-reminder.ts`). Besser: Mail direkt im Tick senden und danach auf `sent` setzen.

### E-09: Meta-Ablauf-Hinweis wird alle 15 Minuten neu eingefügt
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/worker/processors/refresh-oauth.ts:63-90`
- Beleg: Für jede Meta-Verbindung mit `expires_at <= jetzt + 7 Tage` wird bei jedem Tick (`*/15`) für jeden Inhaber ein neuer `notifications`-Eintrag eingefügt. Es gibt keine Prüfung auf vorhandene Meldung. Auch abgelaufene Token (`expires_at` in der Vergangenheit) erfüllen die Bedingung dauerhaft.
- Szenario: Die Praxis verbindet Meta, 53 Tage später beginnt die Woche vor Ablauf: 96 identische Glockenmeldungen pro Tag und Inhaber, 672 pro Woche. Die Glocke ist unbenutzbar, die echte Meldung geht unter.
- Fix-Vorschlag: Einmal je Verbindung und Ablaufdatum melden (Prüfung auf bestehende Meldung `kind='meta_token_expiring'` mit gleichem `link` und Zeitraum oder Spalte `expiry_notified_at`). Zusätzlich Mail an den Inhaber.

### E-10: Sync-Fehler und fehlgeschlagene Jobs bleiben unsichtbar, kein Admin-Blick auf pg-boss
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/lib/queues.ts:99-103`, `src/worker/index.ts:157-163`, `src/app/admin/operations/page.tsx` (kein Bezug zu `pgboss.job`), `src/worker/index.ts:79` (`throw err`)
- Beleg: `DEFAULT_RETRY = { retryLimit: 3, retryDelay: 5, retryBackoff: true }`: Wiederholung nach etwa 5, 10, 20 Sekunden. Keine Queue hat `deadLetter`. Kein Code im Portal liest `pgboss.job` oder `pgboss.archive`. Sichtbar sind nur `lastSyncError` der Plattform-Verbindungen (`SyncErrorsQueue`) und einzelne Alarme.
- Szenario: Resend ist 2 Minuten gestört: drei Retries in 35 Sekunden schlagen fehl, der `email-send`-Job ist endgültig `failed`, die Feedback-Alarm-Mail an den Inhaber ist weg. Niemand erfährt es. Gleiches für `review-request-tick`, `monthly-report`, Dispatcher. Nach `delete_after` verschwindet die Spur.
- Fix-Vorschlag: `deadLetter`-Queue pro Prozess-Queue, Retry für Mail großzügiger (`retryLimit: 8`, `retryDelay: 60`, Backoff). Admin-Operations-Seite um "Fehlgeschlagene Jobs" aus `pgboss.job where state='failed'` ergänzen. Zusätzlich Fehlermeldung per Mail an Karam (täglicher Sammelhinweis).

### E-11: Bewertungs-Rückstau beim Einschalten, kein Alterslimit
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/worker/processors/review-request.ts:57-71`
- Beleg: Auswahl `status='pending' AND scheduled_for <= heute`, `LIMIT 200`, ohne untere Grenze für `scheduled_for`.
- Szenario: PVS meldet Besuche, der Worker ist drei Wochen aus. Beim Einschalten bekommen 200 Patienten pro 15 Minuten "Wie war Ihr Besuch?" für Termine von vor drei Wochen. Der Wiederbehandlungs-Prozessor hat dafür das Gate "mehr als 60 Tage überfällig", der Bewertungs-Tick nicht.
- Fix-Vorschlag: Untergrenze (z. B. `scheduled_for >= heute - 14 Tage`), ältere Zeilen auf `skipped` mit Notiz `stale`.

### E-12: Bewertungs-Tick sendet rund um die Uhr, auch nachts und am Wochenende
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/worker/schedules.ts:46-48`, `review-request.ts:38`
- Beleg: Cron `*/15 * * * *` ohne Sendefenster. Fälligkeit ist ein UTC-Datum (`new Date().toISOString().slice(0, 10)`), keine Uhrzeit.
- Szenario: Eine Zeile mit `scheduled_for = heute` wird um 00:15 UTC (01:15 oder 02:15 Berlin) gesendet. Eine Patientin über 50 erhält eine Praxis-Mail nachts, vermutlich als Spam gemeldet. Beschwerden senken die Reputation (E-06).
- Fix-Vorschlag: Fenster Berlin 09:00 bis 18:00, Mo bis Fr, und Berliner Datum statt UTC verwenden.

### E-13: Bewertungs-Mail kommt von "EINS", nicht von der Praxis (`reviewEmailFrom` ungenutzt)
- Schwere: P1
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/worker/processors/review-request.ts:63,93-96,198-206`, `src/server/email.ts:153-161`, `src/worker/processors/email-send.ts:56-62`
- Beleg: Die Abfrage lädt `clinics.reviewEmailFrom`, `sendOne` verwendet es nie. `ResendEmailSender.send` setzt immer `from: env.EMAIL_FROM` und `replyTo: env.EMAIL_REPLY_TO`. Betreff: "Wie war Ihr Besuch bei {Praxis}?". Der Wiederbehandlungs-Text behauptet "Die Praxis ist der sichtbare Absender" (Kommentar in `templates/retreatment-reminder.ts`).
- Szenario: Die Patientin sieht "EINS <team@eins.ag>" von einer Agentur, die sie nicht kennt. Hohe Spam-Quote, Antworten landen bei EINS statt in der Praxis. Marketing-Mails und Magic-Links teilen sich dieselbe Absenderdomain, ein Reputationsschaden trifft den Login der Praxis.
- Fix-Vorschlag: `from` pro Job übergeben ("Praxisname via EINS <team@eins.ag>" oder verifizierte Praxisadresse), `replyTo` auf die Praxis (`review_inbox_email`). Marketing-Klasse über eine eigene Subdomain senden.

### E-14: SLA-Meldung nach 2 Stunden rund um die Uhr, vollständige Tabellenabfrage je Tick
- Schwere: P2
- Art: ux-flow
- Sicherheit: mittel
- Ort: `src/lib/constants.ts:138`, `src/server/leads.ts:143`, `src/worker/processors/sla-check.ts:34-52`
- Beleg: `slaRespondBy = jetzt + 2 h`, keine Werkstunden-Logik, im Gegensatz zur vertraglichen 48-Werkstunden-Regel in `lib/werkstunden.ts`. `existing` lädt alle `sla_breach`-Meldungen der ganzen Plattform bei jedem Tick.
- Szenario: Anfrage Freitag 22:00: um 00:00 meldet das Portal "Reaktionszeit überschritten" an Inhaber und Frontdesk, obwohl nach Vertrag erst Montag 09:00 die Uhr läuft. Die Praxis stumpft ab. Mit wachsender Tabelle wird der Tick alle 15 Minuten teurer.
- Fix-Vorschlag: Fristen auf die vorhandene Werkstunden-Berechnung stützen, Dedupe per `NOT EXISTS` in der Abfrage (`link = '/anfragen/<id>'`).

### E-15: Mail-Treiber fällt in Produktion still auf `console` zurück
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/lib/env.ts:60`, `src/server/email.ts:240-258`
- Beleg: `EMAIL_DRIVER` hat Default `"console"`. Bei `resend` ohne `RESEND_API_KEY` wird mit nur einer Warnung auf den Konsolentreiber gewechselt. Die Fly-Secrets sind getrennt von den Vercel-Variablen. Auch `APP_ORIGIN` (Default `http://localhost:3001`) und `CLINIC_LANDING_ORIGIN` (Default `http://localhost:3002`) haben localhost-Defaults, ohne Produktionsprüfung.
- Szenario: Beim Einschalten des Workers fehlt `EMAIL_DRIVER=resend` oder `APP_ORIGIN` in den Fly-Secrets. Alle Jobs melden "done", Zeilen stehen auf `sent`, aber keine Mail geht raus oder Links zeigen auf `localhost`. Es gibt keinen Fehler.
- Fix-Vorschlag: In Produktion (`NODE_ENV=production`) beim Start abbrechen, wenn `EMAIL_DRIVER !== 'resend'`, `RESEND_API_KEY` fehlt, `APP_ORIGIN`/`CLINIC_LANDING_ORIGIN` auf localhost stehen oder `DATABASE_URL_DIRECT` fehlt. Eine Checkliste der nötigen Fly-Secrets in `RUN.md` ergänzen.

### E-16: Sync-Meta überschreibt echte Werte mit 0 bei Teilfehlern
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/worker/processors/sync-meta.ts:57-62,92-110`
- Beleg: Bei `!ins.ok` je Werbekonto wird mit `continue` weitergemacht. Die Summe (auch 0) wird per `onConflictDoUpdate` geschrieben, `lastSyncError` auf `null` gesetzt, Job gilt als Erfolg. Kontenliste ohne Paginierung. Das Token steht in der URL (`access_token=` im Query-String).
- Szenario: Meta liefert für ein Konto kurz 429 oder 500: Werbekosten des Vortags werden als 0 € gespeichert, ein früher korrekter Wert überschrieben. Dashboard zeigt "0 € Werbebudget", der Fehler ist nirgends sichtbar.
- Fix-Vorschlag: Fehler je Konto sammeln und werfen (Job-Retry), nur bei vollständigem Erfolg schreiben. Token als Header senden. Zeitlimit per `AbortSignal.timeout`.

### E-17: Google Ads API v18 ist vermutlich abgekündigt
- Schwere: P2
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/server/google-ads-oci.ts:19`, `src/worker/processors/sync-google.ts:60`
- Beleg: Beide Dateien nutzen die URL-Version `v18`. Google stellt Ads-API-Versionen etwa ein Jahr nach Veröffentlichung ab (v18 erschien Ende 2024). Heute ist Oktober 2026. Nicht gegen die Live-API geprüft.
- Szenario: Alle Aufrufe liefern 404/UNIMPLEMENTED, Ausgaben-Sync und Umsatzmeldung brechen. Wegen E-10 bemerkt es nur, wer in "Sync-Fehler" schaut.
- Fix-Vorschlag: Version in eine zentrale Konstante und Umgebungsvariable, auf aktuelle Version heben, bei 404 laut melden.

### E-18: Unsubscribe-Link der Bewertungs-Mail funktioniert nicht als One-Click, Token läuft nach 90 Tagen ab
- Schwere: P2
- Art: bug
- Sicherheit: mittel
- Ort: `src/worker/processors/review-request.ts:195`, `src/server/email.ts:173-182`, `apps/clinic-landing/app/r/unsubscribe/page.tsx`, `src/server/review-tokens.ts:91-94`
- Beleg: `List-Unsubscribe` zeigt auf `${landingOrigin}/r/unsubscribe?token=...`. Das ist eine Seiten-Route (`page.tsx`), die beim Rendern abmeldet, aber kein POST-Handler. RFC 8058 (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`) verlangt ein POST. Die Mailto-Variante lautet `<mailto:EINS <team@eins.ag>?subject=unsubscribe>` (`env.EMAIL_FROM` mit Anzeigename, ungültig, `email.ts:180`). Nach `reviewTokenExpiresAt` (90 Tage) liefert `resolveReviewToken` `null`, die Abmeldung schlägt mit "Link nicht gültig" fehl.
- Szenario: Gmail-Nutzer klickt "Abbestellen" im Kopf der Mail: POST an die Seite, Antwort 405, keine Abmeldung. Eine Patientin öffnet nach vier Monaten den alten Link: nicht abgemeldet, nächste Mail kommt (§ 7 UWG). Link-Scanner, die die Seite per GET öffnen, melden Patienten ungewollt ab.
- Fix-Vorschlag: `List-Unsubscribe` auf die Portal-API `POST /api/review-tokens/<token>/unsubscribe` zeigen lassen (existiert, akzeptiert GET und POST). Abmelde-Token nie ablaufen lassen (eigener Token oder Ablaufprüfung nur für Bewertung). Mailto mit reiner Adresse bauen.

### E-19: Doppelversand-Risiko in `email-send`, kein Idempotenzschlüssel
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `src/worker/processors/email-send.ts:56-62`, `src/server/email.ts:153-165`
- Beleg: `resend.emails.send` ohne `idempotencyKey`. Schlägt der Aufruf nach Annahme durch Resend fehl (Timeout, Verbindungsabbruch), wirft er, pg-boss wiederholt, Mail geht doppelt raus. Auch der Worker-Absturz zwischen Versand und `complete` führt zur Wiederholung.
- Szenario: Patientin erhält zwei identische Bewertungsmails oder Erinnerungen, peinlich und Spam-Beschwerde.
- Fix-Vorschlag: Job-ID als `Idempotency-Key` an Resend geben (SDK-Option `headers: {"Idempotency-Key": jobId}`) und `AbortSignal` mit Zeitlimit. Mail-Jobs mit `singletonKey` je Zeile einstellen.

### E-20: Produzent in Vercel öffnet pro Instanz bis zu 4 Direktverbindungen zu Neon und wartet im Intake darauf
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/server/jobs.ts:42-58,67-85`, `src/lib/env.ts:264-266`, `src/app/api/leads/intake/route.ts:306-307`
- Beleg: `bossConnectionString()` bevorzugt `DATABASE_URL_DIRECT` (Direktendpunkt). Der Produzent hat `max: 4`, startet bei jedem kalten Start `boss.start()` (Schema-Prüfung) und wird im Intake mit `await enqueueAiScore(id)` abgewartet. Kein Verbindungs-Timeout.
- Szenario: Bei einem Anzeigen-Schub starten 30 parallele Instanzen, bis zu 120 Direktverbindungen. Neon-Direktlimit (klein bei kleinem Compute) wird erreicht, Intake wird langsam oder die Verbindungen blockieren den Pooler-Hintergrund. Antwortzeit des Formulars steigt um Kaltstart plus DB-Weckzeit. Hängt Neon, hängt die Anfrage nach dem Speichern (der Absender kann erneut senden).
- Fix-Vorschlag: Produzent über den Pooler (nur `INSERT`, kein Advisory Lock) oder direkt per SQL in `pgboss.job`, Enqueue mit `after()` statt `await`, Verbindungs-Timeout setzen.

### E-21: Queues und Zeitpläne entstehen nur beim Worker-Start
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `src/worker/index.ts:177-196`, `src/server/jobs.ts:96-103`
- Beleg: `createQueue` und `schedule` laufen ausschließlich in `main()` des Workers (`migrate: true`). Der Produzent hat `migrate:false` (`index.js:120-123`: ohne Migration nur `contractor.check()`).
- Szenario: Wurde der Worker seit Migration/Deploy von Queue-Namen (z. B. `retreatment-refresh`, `retreatment-reminder-tick`, 0078) nie gestartet, existiert die Queue nicht. Jeder `enqueueRetreatmentRefresh` schlägt still fehl (`null`). Falls das `pgboss`-Schema in Neon noch gar nicht existiert, scheitert schon `boss.start()` des Produzenten bei jedem Lead (Warnung im Log, Score fehlt). `(in Arbeit, andere Sitzung)` für den Wiederbehandlungsanteil.
- Fix-Vorschlag: Queue-Anlage als eigener, einmaliger Deploy-Schritt (`pnpm worker:init`, `createQueue` für alle Queues) beim Rollout, unabhängig vom Dauerbetrieb. Vor Praxisstart prüfen, dass `pgboss.queue` alle Namen enthält.

### E-22: Kein Hard-Kill-Zeitlimit und zu kurze Fly-Schonfrist beim Deploy
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `fly.toml` (kein `kill_timeout`), `src/worker/index.ts:226-237`
- Beleg: Fly sendet SIGTERM und nach der Standardfrist von 5 Sekunden SIGKILL. `boss.stop({ graceful: true })` wartet bis 30 s (`index.js:152`). `shutdown` hat keinen eigenen Hard-Timeout und ignoriert wiederholte Signale nicht. Weder `uncaughtException` noch `unhandledRejection` sind behandelt.
- Szenario: Ein Deploy mitten im Review-Tick, nachdem Zeilen auf `sent` gesetzt wurden, aber vor dem Enqueue: SIGKILL nach 5 s, Mails gehen dauerhaft verloren (E-08). Laufende Jobs (PDF, Backup) werden abgewürgt und erst nach 15 min Expire wiederholt.
- Fix-Vorschlag: `kill_timeout = 35` (Sekunden) in `fly.toml`, Prozess-weite Handler für `uncaughtException` und `unhandledRejection` mit sauberem Stop.

### E-23: Worker lässt Neon dauerhaft wach, 33 Poll-Schleifen auf Direktverbindung
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/worker/index.ts:166-186`, `src/lib/queues.ts:130-139`
- Beleg: 26 Prozess-Queues plus 8 Dispatcher-Queues je mit eigener `work()`-Schleife (2 s bei latenzkritischen, 30 s sonst), pg-boss-Pool Default 10, zusätzlich `db`-Pool max 10 (`db/client.ts:36`). Mit `supervise` und `schedule` laufende Wartungsabfragen im Minutentakt.
- Szenario: Bei laufendem Worker wird die Neon-Compute nie suspendiert (Kosten). Bei einem DB-Neustart reconnecten pg-boss und postgres.js selbst (Fehler werden über `boss.on('error')` geloggt), die Last aber bleibt konstant.
- Fix-Vorschlag: Für den Praxisstart nur benötigte Queues registrieren (Konfiguration per Umgebungsvariable `WORKER_QUEUES`), Polling bei nächtlichen Jobs auf 60 s heben. Nach Umzug der kritischen Jobs auf Vercel Cron fällt der Dauerbetrieb weg.

### E-24: Poll-Takt begrenzt Durchsatz der Fan-out-Jobs
- Schwere: P2
- Art: performance
- Sicherheit: niedrig
- Ort: `src/worker/index.ts:146-153`, `node_modules/pg-boss/src/worker.js:77-78`
- Beleg: `batchSize: 1`, `pollingIntervalSeconds: 30` für die Sync-Queues. Die Worker-Schleife wartet nach jedem Durchlauf `interval - duration`.
- Szenario: Etwa 2 Jobs pro Minute je Queue. Bei 60 Praxen dauert `sync-meta` 30 Minuten und läuft in `sync-google`/`kpi-rebuild`-Zeitfenster. Für die erste Praxis unkritisch.
- Fix-Vorschlag: `batchSize: 5` plus `localConcurrency` für Sync-Queues, oder Polling auf 5 s.

### E-25: Fan-out-Wiederholung dupliziert Jobs, Dispatcher ohne Singleton
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/worker/index.ts:130-146`
- Beleg: `boss.send(d.target, buildData(c.id), { ...DEFAULT_RETRY })` ohne `singletonKey`. Bricht der Dispatcher nach 5 von 10 Praxen ab und wird wiederholt, entstehen für die ersten 5 doppelte Jobs.
- Szenario: Doppelte `monthly-report`-Mails (sobald E-02 behoben), doppelte Syncs. Bei idempotenten Jobs harmlos.
- Fix-Vorschlag: `singletonKey: ${target}:${clinicId}:${tagesdatum}` mit `policy: 'short'` oder `useSingletonQueue`.

### E-26: Monatsmail hat Rohperiode "2026-09" im Betreff und unterdrückt Fehler je Empfänger
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `src/worker/processors/monthly-report.ts:107-160`
- Beleg: Betreff `EINS · Monats-Auswertung ${period}` mit `period = "2026-09"`. Mail geht nur an Rolle `inhaber` (nicht `marketing`, obwohl das Dokument für beide sichtbar ist). Fehler beim Senden werden je Empfänger gefangen und geschluckt, der Job meldet Erfolg.
- Szenario: Der Inhaber liest "Monats-Auswertung 2026-09". Eine fehlgeschlagene Mail wird nie wiederholt.
- Fix-Vorschlag: Periode als "September 2026" ausschreiben, bei Sendefehler Job erneut ausführen (idempotent über `documents`-Prüfung, was schon vorhanden ist).

### E-27: kpi-rebuild rechnet auf UTC-Tag, nicht auf Berliner Tag
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/worker/processors/kpi-rebuild.ts:55-63,80`, `src/worker/schedules.ts:61-63`
- Beleg: Gruppiert nach `created_at::date` (Session-Zeitzone UTC auf Neon) und das Zeitfenster "gestern" wird mit `toISOString()` (UTC) berechnet. Die Monats-Auswertung (`monthly-report`) nutzt dagegen Berliner Kalendermonate (`berlinMidnight`).
- Szenario: Anfrage um 00:30 Berlin (Sommer 22:30 UTC Vortag) wird dem Vortag zugerechnet. Tages- und Monatssummen im Dashboard weichen leicht von der Monats-Auswertung ab.
- Fix-Vorschlag: `(created_at AT TIME ZONE 'Europe/Berlin')::date` und Berliner "gestern".

### E-28: Mehrere Prozessoren rufen externe APIs ohne Zeitlimit
- Schwere: P3
- Art: robustness
- Sicherheit: hoch
- Ort: `ai-score.ts` (OpenAI, `fetch` ohne Signal), `sync-meta.ts`, `sync-google.ts`, `refresh-oauth.ts`, `sync-reviews-google.ts`, `sync-reviews-jameda.ts`
- Beleg: Nur `meta-capi.ts` (5 s) und `google-ads-oci.ts` (5 bis 10 s) haben `AbortSignal.timeout`. Alle anderen `fetch`-Aufrufe können bis zur Node-Vorgabe (mehrere Minuten) hängen. Jede Queue arbeitet seriell (eine Schleife je Queue).
- Szenario: OpenAI hängt: `ai-score` blockiert für alle weiteren Anfragen bis Expire (15 min). Der Button "Jetzt aktualisieren" läuft die Review-Prozessoren innerhalb einer Vercel-Anfrage, ein hängender Jameda-Abruf ist ein Request-Timeout.
- Fix-Vorschlag: Überall `signal: AbortSignal.timeout(10_000)`.

### E-29: Google-Ablauf und Token-Widerruf bleiben für die Praxis unsichtbar
- Schwere: P2
- Art: ux-flow
- Sicherheit: mittel
- Ort: `src/worker/processors/refresh-oauth.ts:34-60`, `sync-google.ts:99-105`
- Beleg: Schlägt das Erneuern fehl (z. B. `invalid_grant` nach Widerruf), wird nur `lastSyncError` geschrieben. Es gibt keine Benachrichtigung an den Inhaber (anders als bei Meta). Bei `hasGoogle()` falsch oder fehlender Kundennummer: nur Log-Zeile.
- Szenario: Die Praxis trennt in ihrem Google-Konto den Zugriff. Seit Wochen keine Werbedaten, der Inhaber sieht nur veraltete Zahlen. Karam sieht es nur, wenn er in "Sync-Fehler" schaut.
- Fix-Vorschlag: Bei dauerhaftem Fehler (3 Tage in Folge) Glocke plus Mail "Bitte Google erneut verbinden", Karte in Einstellungen mit klarem Zustand.

### E-30: Mail "Neue Rückmeldung" und Animation-Mail hängen am Worker
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/server/review-tokens.ts:343-366`, `src/app/admin/animations/actions.ts:74`
- Beleg: Beide nutzen `enqueueEmail` (Queue). Bei Worker aus oder bei erschöpften Retries (E-10) kommt die Mail nicht an. Der Feedback-Alarm ist die einzige Benachrichtigung über negative Patientenrückmeldungen.
- Szenario: Eine unzufriedene Patientin schreibt Rückruf erwünscht, die Praxis erfährt es nicht, die Beschwerde landet öffentlich auf Google.
- Fix-Vorschlag: Alarm inline senden (wie `sendFeedbackEmail`), plus In-App-Benachrichtigung.

### E-31: Review-Token-Landing zählt Bewertungs-Klicks per Seitenaufruf
- Schwere: P3
- Art: data-correctness
- Sicherheit: niedrig
- Ort: `src/app/api/review-tokens/[token]/click/route.ts:84-86`, `src/server/review-tokens.ts:134-146`
- Beleg: Der Stern-Link `?rating=N` im Mailtext wird von der Landing-Seite per POST (`target: "land"`) verbucht, erster Wert gewinnt (`COALESCE(rating_value, ...)`). Mail-Scanner, die JavaScript ausführen und alle fünf Links öffnen, schreiben den ersten Stern als "Bewertung der Patientin".
- Szenario: Die Auswertung zeigt Bewertungen, die die Patientin nie abgegeben hat.
- Fix-Vorschlag: Rating erst nach bewusster Aktion (Button) buchen, oder den letzten statt den ersten Wert nehmen.

## Design-Kritik (nur Kritik)

- Review-Request-Mail (`templates/review-request.ts:361`) nutzt `text-transform:uppercase` auf Beschriftungen der Besuchskarte. Das verstößt gegen die Regel "kein Versal" und wirkt in Praxis-Mail schreiend. Betrifft nur sichtbare Kleinbeschriftung, keine Funktion.
- Im Magic-Link-Layout (`email.ts`, Kommentar zu "uppercase labels" im Audit-Raster) ist gleiches Muster dokumentiert. Bitte prüfen, ob die Labels tatsächlich Versalien rendern.
- Feedback-Alarm (`templates/feedback-alert.ts:46`) enthält einen Gedankenstrich (U+2014) im Text "Kein expliziter Rückrufwunsch — bitte ...". Betreff nutzt "–" (U+2013). Copy-Regel P3, ändert sich mit einem Zeichen.
- Der PDF-/Monatsbericht verwendet im Betreff die Rohperiode (siehe E-26). Lesbarkeit für 40- bis 65-Jährige: ausgeschriebener Monatsname.

## Zusammenfassung

Anzahl je Schwere (31 Befunde): P0 = 0, P1 = 12, P2 = 15, P3 = 4.

Die 3 dringendsten Punkte:
1. E-01: Alle Dashboard-Kennzahlen kommen aus `kpi_daily`, die nur der (abgeschaltete) Worker füllt und die nie rückwirkend aufgefüllt wird. Die erste Praxis sieht 0 Anfragen trotz echter Anfragen.
2. E-05 und E-30: Weder neue Anfragen noch negative Patientenrückmeldungen lösen eine sofortige Mail aus. Das Erste existiert nicht, das Zweite hängt am Worker. Beides inline oder per Vercel Cron bauen.
3. E-02, E-03, E-06, E-10: Die Monats-Auswertung erzeugt wegen `__autoprev__` nie etwas, `db-backup` bringt den Worker nachts zum Absturz, harte Bounces werden vermutlich nie unterdrückt und fehlgeschlagene Jobs sieht niemand.
