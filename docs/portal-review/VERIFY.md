# Verifier-Runde (nach FX-M und WS10)

Sonnet-Verifier (`verifier`, `model: sonnet`), je Bereich einer, parallel (nur lesen und ausführen). Jeder bekommt die Behauptungen aus den genannten Logs, nicht die Schlüsse. Ergebnis je Behauptung: `CONFIRMED` / `REFUTED` / `UNCLEAR` mit Beleg (Datei:Zeile, Testausgabe, HTTP-Antwort). Jeder Verifier schreibt fortlaufend nach `verify/V<n>.md` (per Bash `cat >>`, keine andere Datei ändern).

| V | Bereich | Logs (Behauptungen) | Extra |
|---|---|---|---|
| V1 | Anfrage-Eingang, Benachrichtigung, Patientendaten, Aufbewahrung | `WS1`, `FX-D`, `INT-C` 6-8, 11 | Intake per HTTP mit gültiger Signatur auf lokaler DB; Mail-Text ohne Patientendaten; `RETENTION_DB_TEST=1` (DATABASE_URL aus `.env.local` explizit setzen) |
| V2 | Anfragen-Oberfläche, Dashboard, Datenmenge | `WS2`, `WS5`, `INT-B`, `FX-M` | Berliner Tagesgrenzen, DST 25.10.2026, Dashboard-Bereiche |
| V3 | Auth, Sitzungen, Mandanten, Zielseiten | `WS6`, `FX-C` | Fremde Ids in Server-Aktionen/API (Marker-Anfrage `f08ce438-0f5f-4532-9fbe-971987abfde4`), Abmelden per POST, Link-Login, Impersonation-Sperren |
| V4 | Betrieb: Fehlerseiten, env, Cron, Worker 0, E-Mail | `WS3`, `WS4`, `INT-A` | `/api/cron/daily` und `/morning` mit und ohne `CRON_SECRET`; 03:05-Onboarding-Weiterleitung (Smoke-Abweichung: damals keine Weiterleitung trotz fehlendem Fragebogen; heute korrekt. Prüfen, ob das Gate bei DB-Fehler offen durchlässt) |
| V5 | Admin und Garantie | `WS7`, `FX-G`, `INT-C` 1-5, 9-10 | Regeln gegen `docs/umbau-ki-organisch/KANON.md` (90 Tage, Verzugs-Mail, nur Messweg Formular, KI-Score entscheidet nie) |
| V6 | Kundenseiten, Ballast, Copy | `WS8`, `WS9`, `WS10` | Gedankenstriche/Anglizismen-Restsuche |
| V7 | Klick-Test W4 im Browser | `WAVE2.md` W4 | Kernwege live, auch 375 px; neue Wege: K-2-Kästchen, Störungs-Knopf, "Nachricht vermerken", Abmelden, Restzeit-Anzeige Kundenansicht. Lokal hat keine Praxis einen Fragebogen, also landet jeder Inhaber im Onboarding (richtig): Fragebogen und Pflicht-Checkliste einmal durchklicken. Dashboard-Bereichsumschalter bei 375 px: passt "Monat" statt "Mon" in eine Zeile? (`lib/dashboard-range.ts:39`, nur melden) |

Danach (Hauptsitzung): REFUTED-Punkte an einen Executor, dann `npx tsc --noEmit -p .`, `npx vitest run`, Smoke, `next build` Portal und clinic-landing (W7), `REPORT.md`.

Hinweis `next build`: nur mit gestopptem Portal-Dev-Server (`preview_stop`). Der Dev-Server wächst auf rund 7 GB Arbeitsspeicher; der Rechner hatte am 07.10. um 21:20 nur 1,7 GB Zusage frei, clinic-landing-Build brach mit "Zone Allocation failed - process out of memory" ab (Kompilieren, Typprüfung, `validate` und HWG-Lint davor grün). Das ist ein Dev-Thema, kein Produktionsfehler.

## Nacharbeit aus der Verifier-Runde (wird gesammelt, dann ein Fix-Durchgang)

| Quelle | Datei | Was |
|---|---|---|
| V6 REFUTED | `einstellungen/integrationen/ads-conversion/page.tsx:137`, `einstellungen/integrationen/page.tsx:467` | sichtbares "EUR-Wert(e)" -> "Euro-Wert(e)" (WS10 hatte es als erledigt geloggt) |
| V6 Copy | `lib/search/staticIndex.ts:382` | "Werbeertrag (ROAS)" -> "Werbeertrag" |
| V6 Copy | `werbebudget/page.tsx:284`, `:552` | "CTR" -> "Klickrate" |
| V6 Copy | `einstellungen/actions.ts:1073`, `ads-conversion/page.tsx:213` | "Conversion-Einstellungen" ist eigene Wortwahl, kein Werkzeugname -> deutsch ("Einstellungen für Abschluss-Meldungen" o. ä., kurz halten) |
| V6 Neben | `onboarding/fragebogen/actions.ts:206` | erstes Speichern ohne Zeile ohne Konfliktbehandlung (zwei Tabs gleichzeitig -> Unique-Fehler): `onConflictDoUpdate`/`DoNothing` |
| V1 REFUTED | `worker/processors/purge-retention.ts` | Klick-Kennungen (fbclid, gclid, wbraid, gbraid, dclid, msclkid, ttclid) stecken auch in der gespeicherten Seitenadresse `ai_signals.quiz.sourceUrl` und `raw_payload.quiz.sourceUrl` (Zielseite speichert `window.location.href`). Nach 90 Tagen diese Query-Parameter aus der URL entfernen (Regel 2), Test in `purge-retention.db.test.ts` ergänzen |
| V1 Neben | `worker/processors/purge-retention.ts` | 24-Monats-Anonymisierung: `treatment_wish` (Freitext der Patientin) auch auf NULL; `budget_indication` nur, wenn Freitext (Werte prüfen) |
| V1 Neben | DSGVO-Export-Route (`api/admin/clinics/[id]/dsgvo/export`) | Audit "Export vollständig" entsteht auch bei abgebrochenem Download; die Löschung archivierter Praxen verlässt sich darauf. Audit erst nach vollständig erzeugtem Datenstrom schreiben |
| V1 Neben | `api/leads/intake/route.ts:405`, `server/request-notify.ts` | rohes `err.message` -> `describeErrorForLog` |
| V1 Neben | Intake (L-6) | `consents.*.at` wie `dsgvo_consent_at` auf die Eingangszeit begrenzen |
| V5 Copy | `admin/garantie/[clinicId]/page.tsx` | "Weitere 1 Anfragen anzeigen": Einzahl "1 weitere Anfrage anzeigen" |
| V5 Hinweis | - | Kein Fehler: Verzugstage zählen ab Fristbeginn, sobald die Verzugs-Mail rechtzeitig ging (KANON: "nur wenn EINS per E-Mail informiert hat"; K-1). Praxis ohne Unterschriftsdatum: 48-Werkstunden-Regel ab 06.10. ist offene Entscheidung D5 |
| V4 Neben 2 | `server/email-once.ts`, `server/request-notify.ts`, `api/cron/morning` (Nachholer), Migration `0093` | Claim vor Versand ohne Wiederaufnahme: stirbt die Function zwischen Claim und Versand, geht die Mail nie raus (Neue-Anfrage-Mail, Monats-Auswertung, Bewertungsmail). Umbau: Claim-Zeitpunkt getrennt von "gesendet"; "gesendet" erst nach Erfolg; Nachholer nimmt Zeilen mit Claim älter 15 min und ohne "gesendet" erneut (Resend-Idempotenzschlüssel verhindert Doppelversand innerhalb 24 h). Migration additiv (`0093`) |
| V4 Neben 4 | `api/cron/_lib/run.ts`, `lib/env.ts` | `CRON_SECRET` ohne Mindestlänge: in Produktion mindestens 32 Zeichen (Prüfung wie `REVIEW_RELAY_SECRET`) |
| V4 Neben 5 | `lib/env.ts` | `CLINIC_LANDING_ORIGINS`: nur `http:`/`https:` zulassen (heute bestehen `localhost:3002` und `javascript:` die Prüfung) |
| V4 Neben 6 | `server/email.ts`, `lib/flash.ts` | Sendefehler werfen schlichte englische Errors, `isUserFacingError` würde sie der Praxis zeigen: eigene Fehlerklasse (nicht für die Praxis) |
| V4 Neben 7 | `api/cron/daily/route.ts` (`ai-score-catch-up`, `purge-audit`) | archivierte Praxen überspringen wie die anderen Schritte |
| V4 Neben 9 | `api/cron/_lib/run.ts` | `activeClinicIds()` in einen Schritt ziehen, damit ein DB-Ausfall beim Start JSON statt 500 liefert |
| V4 Hinweis | - | Nicht fixen, nur im Bericht: SLA-Glocke ohne Worker nur 1x täglich (Vercel-Cron-Takt); Onboarding-Sperre lässt durch, wenn der Middleware-Header fehlt (nur Dev); 0084 bleibt bewusst frei |
| V3 Neben 1 | `(portal)/einstellungen/actions.ts` (`archiveTreatmentAction` ~546, `archiveLocationAction` ~623) | Bei fremder Id ändert das UPDATE 0 Zeilen, trotzdem Erfolgsmeldung und Audit "delete": Zeilenzahl prüfen, sonst "nicht gefunden", kein Audit |
| V3 Neben 2 | `(auth)/login/actions.ts` (~56-67, ~119-155) | Login-Begrenzung zählt Fehlversuche erst nach Argon2: parallele Salve umgeht 10 je Adresse / 30 je IP. Versuch vor der Prüfung zählen (atomar), bei Erfolg wie bisher zurücksetzen; Test dazu |
| V3 Neben 4 | `(portal)/_components/search-storage.ts:10` | Kommentar behauptet Clear-Site-Data beim Abmelden (gibt es bewusst nicht): Kommentar korrigieren |
| V3 Neben 5 | `lib/review-url-allowlist.ts` | Pfadgrenze: `/maps` nur als ganzer Abschnitt (`/maps`, `/maps/...`), nicht `/mapsx` oder kodierte `%2f`-Pfade; Test ergänzen |
| V3 Neben 6 | Login-Fehlertexte `impersonation_*` | "Ansicht als Benutzer" -> "Kundenansicht" (wie Banner) |
| V3 Neben 3 | `server/actions/pvs-csv-upload.ts` ~215 | andere Sitzung: `status = 'pending'` ins WHERE von `confirmCsvMapping` (Doppel-Einreihung) -> HANDOFF |
| V2 Neben 1 | `api/requests/export/csv.ts:13-14` | Telefonnummern "+49 ..." bekommen ein Apostroph, das Excel/Calc in CSV wörtlich zeigt (fast jede Nummer verunreinigt). Ziel: kein sichtbares Apostroph bei Telefonnummern und Zahlen (`typeof number` nie schützen), Formel-Schutz für alles mit Buchstaben/anderen Zeichen bleibt. Excel liest auch "+49 170 ..." ohne Schutz als Formel (#NULL!), also eine Form wählen, die Excel und LibreOffice als Text zeigen; Tests mit "+49 170 1234567", "+491701234567", "=HYPERLINK(...)", "+cmd|..." , "-5" |
| V2 Neben 2 | `server/queries/requests.ts:158-163` vs `:835-850` | Listenfilter "Reaktionszeit überschritten" ohne Statusfilter, Zähler nur `neu`: angleichen (Liste wie Zähler) |
| V2 Neben 3 | Dashboard No-Show-Kachel (Achse) | Bei Quote 0 Achsenmarken "0 %, 0,0 %, 0,3 %": doppelte Null, ungleich gerundet; Marken bei Maximum 0 sauber setzen (keine Design-Änderung) |
| V2 Neben 5 | `anfragen/[id]/actions.ts` `revokeAdsConsent` (~600) | wirft statt `{ ok, message }` wie die anderen Cockpit-Aktionen (C-25) |
| V2 UNCLEAR | `(portal)/_components/OnboardingGateGuard.tsx:21-26` | `refreshedFor` wird nach der Weiterleitung nie zurückgesetzt; zweiter Klick auf denselben gesperrten Pfad könnte ohne `router.refresh()` die gesperrte Seite zeigen: prüfen, ggf. zurücksetzen |
| V2 Hinweis | - | `uppercase` in `ForecastStrip.tsx`, `anfragen/[id]/page.tsx:681`: Design-Thema, nur in `DESIGN-CRITIQUE.md` |
| V7 5.6 | `admin/garantie/[clinicId]/**`, `admin/garantie/actions.ts` | Nach einem Fehler der Ablehnungs-Sperre (K-2) zeigt der Browser "Seite nicht gefunden" (Log `GET ...?fehler=... 404`), erst Neuladen zeigt die Meldung; 2 von 2 Mal. Ursache finden (Redirect aus der Server-Aktion, Admin-Host-Middleware, `notFound()` bei unbekanntem Suchparameter?), beheben, Klick-Test |
| V7 3.3 | `(portal)/anfragen/page.tsx:174` | "81 Eintrage" -> "Einträge" |
| V7 3.9 | `anfragen/[id]/_followups.tsx` + Aktion | Wiedervorlage in der Vergangenheit (01.01.2020) ohne Warnung gespeichert; leeres Datum still abgewiesen: beide mit deutscher Meldung, Vergangenheit ablehnen (heute erlaubt, Berliner Zeit) |
| V7 3.6 | Verlauf in `anfragen/[id]` | "Status-Änderung" ohne Zielstatus, obwohl `meta.from/to` (bzw. `derivedStatus`) vorliegt: "Status: Kontaktiert -> Termin vereinbart" im vorhandenen Stil (deutsche Labels aus `ALL_REQUEST_STATUS_LABELS`) |
| V7 3.5 | Status-Auswahl `anfragen/[id]` | Zurück auf "Neu" nicht anbietbar: nur prüfen. Erlaubt die Übergangstabelle in `lib/constants.ts` den Weg, fehlt er in der Oberfläche -> anbieten; sonst `no_change_needed` (gewollt) |
| V7 Neben | `api/requests/export/route.ts` | CSV laut Browser ohne UTF-8-BOM (Umlaute in Excel): prüfen, ob `buildCsv` das BOM liefert und die Antwort es behält |
| V7 6 | `lib/dashboard-range.ts:39` | "Mon" -> "Monat" (gemessen: 250 px von 293 px Kartenbreite, bleibt einzeilig) |
| V7 Hinweis | - | Kein Fehler: "Woche" gibt es im Umschalter nicht (Auftrag war falsch); Checklisten-Haken als Umschalter ist gewollt. Lokale Testdaten von V7 bleiben (Hartmann: Fragebogen, Checkliste A1-A5, Garantie-Uhr ab 20.09.2026; Roland Graf: Notizen, Wiedervorlagen) |

## Fix-Durchgang FX-V (nach V7), drei Agenten auf getrennten Dateien

| Fixer | Punkte aus "Nacharbeit" | Dateien (Besitz) | Log |
|---|---|---|---|
| FX-V1 Sicherheit (`security-executor`) | V3 Neben 1, 2, 5, 6; V4 Neben 6; V6 "Conversion-Einstellungen" in `einstellungen/actions.ts` | `(auth)/login/**`, `lib/review-url-allowlist.ts` (+Test), `(portal)/einstellungen/actions.ts`, `server/email.ts`, `lib/flash.ts` | `fixes/FX-V1.md` |
| FX-V2 Daten und Betrieb (`executor`, Opus) | V1 REFUTED + Neben (Retention-URL, `treatment_wish`, DSGVO-Export-Audit, Fehler-Logs, `consents.at`); V4 Neben 2, 4, 5, 7, 9 | `server/email-once.ts`, `server/request-notify.ts`, `api/cron/**`, `lib/env.ts`, `worker/processors/purge-retention.ts` (+DB-Test), `api/admin/clinics/[id]/dsgvo/**`, `api/leads/intake/**`, `server/leads.ts`, Migration `0093`, `db/schema.ts` (nur gezielt) | `fixes/FX-V2.md` |
| FX-V3 Oberfläche und Copy (`executor`, Opus) | V2 Neben 1, 2, 3, 5, UNCLEAR; V5 Copy; V6 REFUTED + Copy + Neben; V3 Neben 4; alle V7-Zeilen | `api/requests/export/csv.ts` (+Test), `server/queries/requests.ts` (nur SLA-Filter), Dashboard-Kachel No-Show (Komponente), `anfragen/[id]/actions.ts`, `_components/OnboardingGateGuard.tsx`, `_components/search-storage.ts`, `einstellungen/integrationen/{page.tsx,ads-conversion/page.tsx}`, `lib/search/staticIndex.ts`, `werbebudget/page.tsx`, `admin/garantie/**` (5.6 + Text), `onboarding/fragebogen/actions.ts`, `lib/dashboard-range.ts`, `(portal)/anfragen/page.tsx`, `anfragen/[id]/**`, `api/requests/export/**` | `fixes/FX-V3.md` |

Danach: ein Sonnet-Verifier über `fixes/FX-V*.md`, dann `tsc`, ganze `vitest`-Suite (allein, wegen Speicher), Smoke, `next build` beider Apps mit gestopptem Dev-Server, `REPORT.md`.
