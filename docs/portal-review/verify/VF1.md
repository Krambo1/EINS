# VF1: Verifikation FX-V1 und FX-V2

Gelaufen (alle gruen): login/admin-login/sicherheit actions, rate-limit-slot (+db mit RATE_LIMIT_DB_TEST=1), archive, review-url-allowlist, flash, email.delivery-error (76 Tests); email-once.db, request-notify, ops-alerts, purge-retention.db, leads-consents, cron/_lib/run, dsgvo export route (58 Tests). Eigene Wegwerf-Probes (geloescht): Allowlist-URLs, Betreff-Auflösung, Retention-Regex gegen lokale DB (SELECT).

| WS ID | Ergebnis | Beleg | Satz |
|---|---|---|---|
| FX-V1 V3 Neben 2 (Login) | CONFIRMED | rate-limit-slot.ts: INSERT .. ON CONFLICT DO UPDATE .. WHERE count<limit OR Fenster abgelaufen, RETURNING; kein Row = refused; db.test 40 parallel = 10; actions.test 25 parallel = 10 Argon2 | Atomar auf der gesperrten Zeile, Erfolg gibt beide Plaetze zurueck, Ausnahme zwischen Reserve und Verify haelt Platz nur bis Fensterende (konservativ). |
| FX-V1 Admin-Login | CONFIRMED | admin/login/actions.ts reserve vor verifyAdminPassword, Release erst nach createAdminSession; Test 5/5 | wie oben |
| FX-V1 Passwort aendern | CONFIRMED | sicherheit/actions.ts:81-100; Test 3/3 | Reserve vor Argon2, Release bei Erfolg |
| FX-V1 V3 Neben 1 | CONFIRMED | actions.ts:553-568 und 636-651 .returning + Fehler bei 0 Zeilen, kein Audit; Test 3/3 | Fremde Id wirft SettingsUserError. |
| FX-V1 V3 Neben 5 | CONFIRMED | eigene Probe: /maps/../url, %2e%2e, %252e%252e, ..%2f, %5c..%5c, /mapsx, /maps%2fx, //maps, http, google.com.evil.com alle false; %2F im Ortsnamen true | Traversal-Varianten fallen. |
| FX-V1 V3 Neben 6 | CONFIRMED | login/page.tsx:34-43 "Kundenansicht", Sie, kein U+2014 | ok |
| FX-V1 V4 Neben 6 | CONFIRMED | flash.ts isUserFacingError weist EmailDeliveryError ab; Tests flash 6, delivery-error 2 | ok |
| FX-V1 V6 Copy | CONFIRMED | actions.ts:1084 "Einstellungen für Abschluss-Meldungen gespeichert" | ok |
| FX-V2 V4 Neben 2 | CONFIRMED | email-once.ts Claim-SQL (delivered_at IS NULL AND sent_at < now()-15min), gleicher Key; email-once.db 6/6 (parallel genau einer, frisch nicht, alt neu, delivered nie); request-notify 26; ops-alerts 10 | Stale Claim wird mit demselben Key erneut genommen, Zugestelltes nie. Morgen-Nachholer nutzt dieselbe Bedingung (morning/route.ts:83-100, archivierte Praxen ausgeschlossen). |
| FX-V2 Migration 0094 | CONFIRMED | Datei gelesen, idempotent im DO-Block, Altzeilen als zugestellt; Spalten lokal vorhanden (DB-Test laeuft) | ok |
| FX-V2 L-13 (H2) | CONFIRMED | Probe: "botox" -> "Neue Anfrage: Botox", "  BOTOX  " ok, "Brigitte Meier", "0171 1234567", "Botox, Brigitte Meier 0171" -> "Neue Anfrage über EINS", ohne Katalog generisch, Quiz "lippen  aufspritzen" -> Katalog-Schreibweise; kein Leak in html/text | ok |
| FX-V2 V1 Regel 2 (URL) | CONFIRMED | Regex gegen lokale DB: `/botox?utm_source=ig&fbclid=f1&gclid=g1#form` -> `/botox?utm_source=ig#form`, `/?fbclid=x` -> `/`, `FBCLID` gross, `?fbclid&x=1`, `&&`, kaputte URL bleibt Text und wird nur bereinigt, `x=fbclid=1` bleibt; purge-retention.db 1/1 inkl. zweitem Lauf 0 | ok |
| FX-V2 24-Monate Freitext | CONFIRMED | purge-retention.ts:128-146, 245-246, 344-346 | treatment_wish nur Katalogname derselben Praxis, budget nur feste Stufen. |
| FX-V2 DSGVO-Export-Audit | CONFIRMED | route.ts Pull-Stream HWM 0, complete erst bei next.done; Test 3/3 | Rest: Node-Adapter kann einen Puffer vorlesen, "complete" kann wenige KB vor dem letzten Byte beim Client stehen (vom Autor genannt). |
| FX-V2 err.message-Logs | CONFIRMED | intake/route.ts:407, request-notify.ts nutzen describeErrorForLog | ok |
| FX-V2 L-6 Consent-Zeit | CONFIRMED | leads.ts:186-213, 279; Test 3/3 | ok |
| FX-V2 V4 Neben 4 (CRON_SECRET) | CONFIRMED | env.ts:29-37, run.ts:19-28 (503, Logzeile ohne Geheimnis); run.test 5 | ok |
| FX-V2 V4 Neben 5 | CONFIRMED | env.ts:15-19,118-130 isHttpUrl | ok |
| FX-V2 V4 Neben 7 (ai-score) | CONFIRMED | daily/route.ts:117 isNull(clinics.archivedAt) | ok |
| FX-V2 V4 Neben 9 | CONFIRMED | daily/route.ts:52, morning/route.ts:53 Schritt active-clinics; run.test grün | ok |

## Zusammenfassung
CONFIRMED 20, REFUTED 0, UNCLEAR 0.

## Nebenbefunde
- `src/lib/review-url-allowlist.ts` isUnderPathSection: erster Abschnitt wird case-insensitive verglichen (`/MAPS/x` wird akzeptiert) und `search.google.com/local/` (leeres Folgesegment) zaehlt als "mit Folgeabschnitt"; harmlos, nur Strenge.
- `src/server/request-notify.ts` runNewRequestNotification: schlaegt bei mehreren Empfaengern einer von zwei fehl, gilt die Anfrage als zugestellt; der fehlgeschlagene Empfaenger wird nie nachgeholt (bestehendes Verhalten, nicht neu).
- `src/auth/rate-limit-policy.ts` Kopfkommentar veraltet (vom Autor genannt).
- DSGVO-Route `pull`: wirft `audit("failed")` im catch selbst, wird `controller.error` nie erreicht (nur falls writeAudit wirft).
