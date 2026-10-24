# Entscheidungen für Karam

Stand 2026-10-07. Gesammelt aus `fixes/WS*.md` und `findings/K-garantie.md`, `findings/L-patientendaten.md`. In eckigen Klammern steht, was jetzt gebaut ist; ohne Antwort bleibt das so.

## A. Vor dem ersten Deploy (Pflicht, keine Wahl)

1. **Migrationen auf Neon** in dieser Reihenfolge vor dem Code-Deploy: 0077, 0078-0080 (andere Sitzung), 0081, 0082, 0083, 0085, 0086, 0087, 0088, 0089, 0090-0091 (andere Sitzung), 0092, 0093 (andere Sitzung), 0094 (Mail "beansprucht" getrennt von "zugestellt", FX-V2), 0095 (CSV-Import ohne Worker, C8: ohne sie scheitert jeder CSV-Import und der neue Cron-Schritt). Vor 0088 auf Neon prüfen, dass keine Facebook-Seiten-ID an zwei Praxen hängt (sonst bricht 0088 mit Meldung ab), und die Rechte-Abfragen aus `findings/J-mandanten-sicherheit.md` Abschnitt 2.3 einmal lesend laufen lassen. Ohne 0082 schlägt jede Zielseiten-Anfrage bei der Signatur fehl und /einstellungen liefert 500.
2. **Vercel-Env (Portal):** `CRON_SECRET` (ohne: beide Cron-Routen 503), `EMAIL_DRIVER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`, `CLINIC_LANDING_ORIGIN`, `OPS_ALERT_EMAIL`. Optional `GOOGLE_ADS_API_VERSION`. Prüfen, dass `ADMIN_IP_ALLOWLIST` gesetzt ist (bestand schon vor dem Review: leer heißt, jede Admin-Anmeldung in Produktion scheitert; der Production-Build warnt dann).
2a. **Vercel-Env neu (FX-C, INT-C):** Das Portal startet nicht, wenn `REVIEW_RELAY_SECRET` kürzer als 32 Zeichen ist oder `CLINIC_LANDING_ORIGINS` keine URL enthält. `REVIEW_RELAY_SECRET` mit gleichem Wert in Portal und Zielseiten (ohne: Ratenbegrenzung der Bewertungsseite zählt weiter die Server-IP). `CLINIC_LANDING_ORIGINS`: jede eigene Praxis-Domain für Bewertungslinks, kommagetrennt (ohne: das Portal lehnt solche Domains beim Speichern ab). Optional `LEAD_WEBHOOK_SECRET` bzw. `LEAD_WEBHOOK_SECRET_<SLUG>` (ohne: CRM-Webhooks gehen unsigniert raus).
3. **Vercel-Env (Zielseiten):** je echter Praxis `PORTAL_URL` und `PORTAL_INTAKE_SECRET_<PRAXIS>`, sonst bricht der Production-Build jetzt bewusst ab.
4. **R2:** Lebenszyklus-Regel auf dem Bucket mit den Sicherungen (Präfix `backups/`, löschen nach 30 Tagen); nie eine öffentliche Domain oder r2.dev auf diesen Bucket; `R2_PUBLIC_BASE` nur für Avatare (der Code nutzt es nur noch dafür). Optional eigener Sicherungs-Bucket über `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`. Außerdem die **R2-CORS-Regel** setzen (Wortlaut im Kopf von `apps/portal/src/server/storage.ts`) und einen echten Upload auf portal.eins.ag testen. Ohne Regel scheitert jeder Upload, auch der AVV (Onboarding-Sperre).
4a. **Datenbank-Rolle (J-7, V1):** In Vercel muss `DATABASE_URL_APP` auf die Rolle `eins_app` zeigen (Pooler-Host), nie auf `neondb_owner`. Das Portal prüft das seit J-7 beim ersten Praxis-Zugriff und verweigert sonst jede Praxis-Seite (lieber laut als ohne Mandantentrennung). Vorher lesend prüfen, mit der App-URL verbunden: `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` muss `eins_app | f | f` liefern.
5. **Checkliste:** echte Meta-Business-Manager-ID und Einladungsadresse in `onboarding/checkliste/content.ts` (`EINS_CONTACT.metaBmId`, `EINS_CONTACT.adsEmail`).
5a. **Meta (E6b):** Die Verbindung fragt jetzt zusätzlich `pages_manage_metadata` an (nötig, damit Anfragen einer gewählten Facebook-Seite ankommen). Meta App Review muss diese Berechtigung freigeben; vorher prüfen, ob die Meta-Doku für Lead-Abruf auch `pages_read_engagement` und `pages_manage_ads` verlangt. Schon verbundene Praxen einmal neu verbinden.
6. **Wortlaut lesen:** Verzugs-Mitteilung und Rückruf-Warnung (`server/email/templates/clinic-notice.ts`) gehen jetzt per Knopfdruck an Inhaber und Praxis.

## B. Produkt

| # | Frage | Gebaut |
|---|---|---|
| 1 | Monatsziel (F-07): Wer setzt es? | [keine Eingabe; Empfehlung: EINS im Admin, Onboarding-Schritt "Monatsziel mit EINS besprechen"] |
| 2 | Garantie-Stand für die Praxis sichtbar (Tag X von 90, erste Anfrage ja/nein) in /fortschritt? (H-06) | [nein, nur Admin] |
| 3 | Manuelle Anfrage anlegen (Telefon, DM, Empfang), zählt nie als EINS-Messweg? | [nicht gebaut; FAQ verspricht es nicht mehr] |
| 4 | Zuweisung "Wer ruft zurück" (H-14) vor der ersten Praxis? | [nicht gebaut] |
| 5 | Zählt "E-Mail/WhatsApp gesendet" als Kontaktversuch für die 48-Werkstunden-Frist? | [ja] |
| 6 | Spam auch aus späteren Status setzen? Berührt die Garantie-Zählung. | [nur aus "Neu"] |
| 7 | CSV-Export der Anfragen: alle Rollen mit Leserecht oder nur Inhaber? | [alle mit `requests.view`] |
| 8 | Betreff der Neue-Anfrage-Mail mit Behandlung ("Neue Anfrage: Botox")? | [ja; Alternative ohne Behandlung] |
| 9 | Monats-Auswertung auch an die Marketing-Rolle? | [ja] |
| 10 | No-Show-Quote ohne PVS: "0 %" oder "–"? | ["0 %"] |
| 11 | DSGVO-Auskunft/Löschung je einzelner Person (nicht nur je Praxis)? | [nicht gebaut] |
| 12 | Meta-Ablauf zusätzlich per Mail an den Inhaber (bisher nur Glocke)? | [nur Glocke] |

## C. Sicherheit und Betrieb

| # | Frage | Gebaut |
|---|---|---|
| 1 | Sitzung: fest 8 h (30 Tage mit "Angemeldet bleiben") oder gleitend? | [fest] |
| 2 | Gleiche E-Mail in zwei aktiven Praxen: neue Einladung wird abgelehnt (Meldung verrät die andere Mitgliedschaft). | [abgelehnt] |
| 3 | Intake-Geheimnis rotieren: Inhaber oder nur EINS? Altes gilt 24 h weiter. | [Inhaber] |
| 4 | Kundenansicht: Kontaktversuche des Admins zählen wie die der Praxis (im Audit Ihnen zugeordnet). | [zählen] |
| 5 | Kundenansicht von anderer IP: nur protokolliert. | [protokolliert] |
| 6 | Einwilligungs-IP anonymisiert (letztes Oktett 0) oder voll? | [anonymisiert] |
| 7 | Portal-Ausfall bei Zielseiten-Anfrage: Patient sieht nach max. ca. 20 s Fehler mit Praxis-Telefon. Dauerhafter Puffer (Ausgangskorb)? | [kein Puffer] |
| 8 | CSV-Import (PVS) ohne Worker bleibt auf "wird verarbeitet". Worker an oder Verarbeitung ohne Worker? Grenze 4 MB. | **Karam 2026-10-08: Verarbeitung ohne Worker bauen.** |
| 9 | DB-Backup läuft nur im Worker; ohne Worker nur Neon-PITR. Externer Export nötig? | [nur PITR] **Karam 2026-10-08: Neon reicht für den Start; eigene Kopie, bevor mehrere Praxen echte Daten haben.** |
| 10 | Patienten-Mails (Bewertungen) über eigene Subdomain (z. B. `mail.eins.ag`), damit Beschwerden nicht die Login-Mails treffen? | [gleiche Domain] |
| 11 | Google-Ads-API-Version vor dem ersten Google-Kunden prüfen (Standard `v23`, nicht live geprüft). | - |
| 12 | Health: Hat der Worker in Prod je einen Heartbeat geschrieben und steht dann auf 0, meldet `/api/health` dauerhaft 503 und mailt alle 6 h. Heute leer, also kein Problem; nach einem Worker-Test die Zeile löschen. | - |
| 13 | Alarm-Mail bei gehäuften falsch signierten Anfragen (Zielseite nach Rotation nicht umgestellt)? | [nicht gebaut] |
| 14 | Sentry einbinden (neue Abhängigkeit) oder Vercel-Logs nach `kind:"error"` filtern? | [Logs] |

## D. Garantie (aus W2, `findings/K-garantie.md`)

| # | Frage | Gebaut |
|---|---|---|
| 1 | Messwege Anruf und Buchung (K-4): Im Code gibt es keinen Eingang dafür, Vertrag und FAQ nennen sie aber. Für die erste Praxis nur das Formular als Messweg führen, oder Eingang für Telefonanbieter/Calendly bauen? | **Karam 2026-10-07: noch offen.** [nichts gebaut; Admin zeigt "Messwege live: nur Formular"] **Karam 2026-10-08: mit Formularen starten. Eingang für Tracking-Nummer und Buchungslink muss gebaut sein, bevor die nächste Praxis onboardet wird; bis dahin keine Nummer, kein Link.** |
| 2 | KI-Bewertung "binnen 60 Minuten" (K-5, Hauptvertrag § 6): läuft nur im Worker. | [wird gebaut: Bewertung direkt nach Eingang per `after()`, wie die Neue-Anfrage-Mail; OpenAI nur mit Einwilligung, sonst regelbasiert] |
| 3 | Verzugs-Mitteilung nach Fristende (K-1): bisher belebt sie die abgelaufene Uhr rückwirkend. `06-garantie.md` verbietet das. Risiko, dass das im Streit nicht hält: etwa 65 %. | [wird gebaut: Mitteilung nach Fristende zählt nicht mehr] |
| 4 | Testanfragen beim Onboarding (K-3) zählen heute als Kandidat und als "nicht beantwortet". | [wird gebaut: Anfragen vor der Unterschrift zählen nicht, Ablehnungsgrund "Test"] |
| 5 | Praxis ohne Unterschriftsdatum (FX-G): Gilt die 48-Werkstunden-Regel ab 06.10.2026 wie bisher, oder erst ab einem eingetragenen Datum? | [wie bisher ab 06.10.2026; jede echte Praxis bekommt ein Datum] **Karam 2026-10-08: so lassen, Datum immer eintragen.** |
| 6 | Anfrage als "Test" abgelehnt (FX-G): zusätzlich auf "Spam" setzen, damit sie bei der Praxis nicht als unbeantwortet erscheint? | [nein, nur Ablehnung; Empfehlung: ja] **Karam 2026-10-08: ja, bauen.** |

## E. Patientendaten (aus W3, `findings/L-patientendaten.md`)

| # | Frage | Gebaut |
|---|---|---|
| 1 | Aufbewahrung (L-4): heute wird außer dem Audit-Log nichts nach Alter gelöscht. Vorschlag: Spam nach 90 Tagen löschen; Klick-Kennungen nach 90 Tagen leeren; archivierte Praxis 90 Tage nach Archivierung automatisch löschen (Export vorher); Anfragen ohne Termin und Behandlung nach 24 Monaten anonymisieren. | **Karam 2026-10-07: ja, wie vorgeschlagen.** [wird in Welle 2 gebaut, läuft über `/api/cron/daily`] |
| 2 | DB-Sicherung (L-3) liegt im selben R2-Bucket wie die Uploads, Name erratbar. Eigener privater Bucket plus 30-Tage-Regel? (Läuft nur mit Worker; heute nur Neon-PITR.) | [nichts] |
| 3 | `R2_PUBLIC_BASE` (L-11): Wird es je gesetzt, sind alle Dateien öffentlich, auch Dokumente und Sicherungen. | [wird gebaut: öffentliche Auslieferung nur für Avatare] |
| 4 | Spam-Löschung (FX-D): Spam bleibt, solange die Garantie-Uhr der Praxis noch offen sein kann (Unterschrift jünger als 180 Tage, nicht entschieden), als Beleg für abgelehnte Kandidaten. | [so gebaut] |
| 5 | Anonymisierung nach 24 Monaten löscht auch KI-Begründung, Einwilligungs-IP und Notiztexte des Teams zu diesen Anfragen. | [so gebaut] |
| 6 | Meta mit mehreren Facebook-Seiten: Verbinden bricht jetzt mit Hinweis ab (vorher wurde still die erste Seite genommen, J-1). Seitenauswahl bauen, bevor die erste Praxis Meta verbindet? | [nicht gebaut; Empfehlung: ja, vor dem ersten Meta-Anschluss] **Karam 2026-10-08: bauen.** |
| 7 | TikTok-Pixel und erweiterte Google-Conversions (FX-C, L-7): jetzt aus. Wieder an nur, wenn TikTok in den Einwilligungstexten steht bzw. Google serverseitig hinter der Einwilligung gemeldet wird. | [aus] |
| 8 | CRM-Webhook der Zielseite an das Praxis-CRM: weiter Klick-Kennungen (`fbc`/`fbp`) und Werbe-Einwilligungsfelder mitsenden? | [ja, unverändert] |

## F. Aufräumen (aus WS9, `fixes/WS9.md`)

| # | Frage | Gebaut |
|---|---|---|
| 1 | Ungenutzte Abhängigkeiten (Liste in WS9, Zeile I-4) mit `pnpm install` entfernen, danach `pnpm --filter portal build`. | [nicht entfernt] |
| 2 | `/hwg-check` verlinken oder entfernen? | [bleibt, nicht verlinkt] |
| 3 | Review-Mail-Testskripte in `src/scripts` löschen? | [bleiben] |
| 4 | Telefonnummer vor dem Hashen für Meta ins internationale Format bringen (bessere Zuordnung, ändert alle künftigen Hashes)? | [nein] |
| 5 | Dateigrößen überall mit Komma ("3,4 MB")? Heute nur in Medien. | [nein] |
| 6 | `kpi_daily` bleibt, solange zwei Anomalie-Regeln und "Portal seit" sie lesen. | - |
| 7 | Bewertungsmail (INT-A, A6): Ein Stern zählt erst nach "Bewertung speichern" oder Klick auf Google/Jameda, nicht schon beim Öffnen des Links. Grund: Link-Scanner der Mailprogramme erzeugten sonst Bewertungen. Folge: Wer nur den Stern in der Mail klickt und die Seite schließt, wird nicht gezählt. | [so gebaut] |

## G. Design und Copy

Siehe `DESIGN-CRITIQUE.md`. Größter Hebel: 55 Versal-Etiketten auf Satzanfang und `fg-primary`.

## H. Aus INT-C

| # | Frage | Gebaut |
|---|---|---|
| 1 | Magic-Link-Audit: Absenderfeld der Zeile enthält weiter die E-Mail (wie jeder Login-Eintrag). Auch dort nur Domain + kurzer Hash? | [nein] |
| 2 | Behandlung im Betreff der Neue-Anfrage-Mail. Verifier V1 hat gezeigt: die Heuristik ließ einen bloßen Namen ("Brigitte Meier") in den Betreff. | [Hauptsitzung 22:05: auf die strenge Variante umgestellt (FX-V2): Freitext nur, wenn er genau einer Behandlung aus dem Katalog der Praxis entspricht, sonst "Neue Anfrage über EINS"] |
