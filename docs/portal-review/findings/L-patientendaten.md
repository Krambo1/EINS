# Befunde Bereich L: Patientendaten, Austrittsstellen, Löschung, Einwilligung

Geprüft: `apps/portal/src` (Schema, Logs, E-Mail, Drittanbieter, URLs, Speicher, Nebentabellen, Browser-Speicher, DSGVO-Löschung, Aufbewahrung) und `apps/clinic-landing`. Nur gelesen, nichts geändert, nichts ausgeführt. Stand: ungemergter Baum nach Fix-Welle WS1 bis WS9. Pfade relativ zu `apps/portal/src/` bzw. `apps/clinic-landing/`. Bereits als behoben gemeldete Punkte (WS1 Mail ohne Patientendaten, WS3 Fehlerprotokoll, WS4 `email_send_log`, WS7 Löschung/Export) sind nicht neu berichtet, außer wo die Behebung unvollständig ist.

## 1. Inventar: wo Patientendaten liegen

Patientendaten = Name, E-Mail, Telefon, Freitext, Behandlung, Quiz, Budget, Einwilligungen samt IP, Bewertungstext, PVS-Daten.

| Tabelle | Spalten mit Patientenbezug | Zweck |
|---|---|---|
| `requests` (`db/schema.ts:602`) | `contact_name/email/phone`, `treatment_wish`, `budget_indication`, `message`, `ai_signals` (jsonb, enthält `quiz.notes`, `quiz.city`, `quiz.sourceUrl`, Einwilligungs-Booleans), `raw_payload` (jsonb, kompletter Original-Body, `:672`), `utm`, `fbclid/gclid/wbraid/gbraid/fbc/fbp`, `click_user_agent`, `click_ip_anon` (`:708-725`), `dsgvo_consent_at/ip` (`:668-671`), `ads_consent_at/version/revoked_at` (`:734`), `ai_reasoning`, `converted_revenue_eur` | Anfrage, Einwilligungsnachweis, Anzeigen-Zuordnung |
| `request_activities` | `body` (Notizen des Teams), `meta` | Verlauf |
| `request_followups` | `note` | Wiedervorlage |
| `patients` (`:403`) | `email`, `phone`, `full_name`, `dob`, `gender`, `external_id`, `pvs_patient_id`, Umsatz | Patientenstamm aus PVS/Verknüpfung |
| `pvs_patient_map`, `linking_failures` | `pvs_patient_id`, `pvs_patient_snapshot` (jsonb mit Stammdaten), `candidates` | PVS-Verknüpfung |
| `pvs_event_log` (partitioniert) | `payload` (jsonb, Patient-/Termin-/Rechnungsereignisse) | PVS-Ereignisse |
| `pvs_csv_uploads` + R2-Datei | `original_filename`, `mapping_json`, `error_summary`; Datei = Roh-CSV mit Patientenstamm/Rechnungen | CSV-Import |
| `review_email_schedule` (`:501`) | `review_email`, `review_patient_name`, `review_treatment_label`, Bewertungswert, Klickzeiten | Bewertungsanfrage |
| `patient_feedback` (`:1537`) | `free_text`, `contact_email`, `contact_name`, `rating`, `internal_note` | private Rückmeldung |
| `retreatment_cycles` (`:2021`) | `patient_id`, `reminder_email`, `treatment_id`, `token`, Umsätze | Wiederbehandlung (andere Sitzung) |
| `email_suppression` | `email` | Sperrliste (bewusst Klartext) |
| `ads_conversion_outbox` (`:1140`) | `request_id`, Rechnungsbetrag, `response_body` (Antwort der Plattform), `user_data_snapshot` (nur Boolesche Flags, gut) | Meldung an Google/Meta |
| `audit_log` (`:1063`) | `actor_email`, `ip_address`, `user_agent`, `diff` (mit wenigen Ausnahmen ohne Patientendaten, siehe L-14) | Protokoll |
| `geocode_cache` | Stadtname aus `quiz.city` (ohne Praxis-Bezug) | Entfernungsbewertung |
| `feedback` (Team an EINS) | `message`, `page_url` (frei, kann `?search=Name` enthalten) | Rückmeldung der Praxis |
| `email_send_log`, `notifications`, `kpi_*`, `forecast_snapshots`, `dashboard_alerts` | keine Patientendaten (Schlüssel, Zähler, Summen). `notifications` wird von nichts beschrieben (grep: nur Lesen/Markieren) | Nebentabellen |
| `pgboss.job` | Nutzlast fast überall nur IDs (`server/jobs.ts:103-271`), Ausnahme `email-send` (Empfänger, Betreff, Text, nur Team/Ops) | Warteschlange |
| R2 | Schlüssel `<clinicId>/<scope>/<uuid>.<ext>` (`server/uploads.ts:45`), `pvs-csv-uploads/<clinicId>/<uuid>.csv` (`server/actions/pvs-csv-upload.ts:116`): keine Namen in Schlüsseln, Originaldateinamen nur in der DB | Dateien |

## 2. Austrittsstellen

**Logs.** Alle `console.*`-Stellen durchgesehen (rund 170).
- Sauber: `instrumentation.ts:21-33` (Pfad ohne Query, `describeErrorForLog`), `server/api.ts:168-176`, `lib/flash.ts:95-101`, Intake `app/api/leads/intake/route.ts:219-226` (nur Feldpfade), `:377-380` (nur `err.message`), `db/client.ts:141-149` (Etikett, Millisekunden, Hash der Praxis-ID, keine Anfragen), `app/api/vitals/route.ts:59` (nur Pfad ohne Query), Landing `app/api/lead/route.ts:257` (Slug und Grund), `app/api/rum/route.ts:46` (Pfad, Statistik-Einwilligung).
- Unsauber: rohe Fehlerobjekte, siehe L-8; Empfängeradresse in `worker/processors/email-send.ts:55-57`, siehe L-14.
- Konsolen-E-Mail-Treiber (`server/email.ts:76-90`, druckt Empfänger, Text, Links) läuft in Produktion nie (`:303-309`).

**E-Mails.**
- "Neue Anfrage" (`server/email/templates/new-request.ts`, `server/request-notify.ts:148-160`): Entscheidung 3 ist eingehalten. Inhalt: Behandlung, Quelle, Eingangszeit (Berlin), Praxisname, Link `/anfragen/<id>`. Kein Name, keine Kontaktdaten, kein Freitext. Einzige Patienteneingabe ist das Behandlungs-Etikett (auf 60 Zeichen gekürzt) im Betreff, siehe L-13. Empfänger: aktive inhaber/frontdesk, Sperrliste beachtet.
- "Erste Anfrage prüfen" an `OPS_ALERT_EMAIL` (`request-notify.ts:251-271`, `new-request.ts:93-110`): Praxisname, Messweg, Eingangszeit, Admin-Link. Keine Patientendaten. Sauber.
- Feedback-Alarm (`server/email/templates/feedback-alert.ts`): nur Sterne, Praxis, Link. Name/Kontakt/Text ausdrücklich nicht. Sauber.
- Mitteilungen an die Praxis (`clinic-notice.ts`): nur Zählungen und Daten. Sauber.
- Ops-Alarme (`server/ops-alerts.ts:97-117`): Praxisname und -ID, Art, Titel, `body`. Aufrufer geben Fixtexte, Zähler oder `lastError` (500 Zeichen aus `pvs_sync_status.last_error`, kann Fremdsystem-Fehlertext enthalten, Ursprung PVS-Cloud-Abruf, andere Sitzung) weiter. Kein bekannter Patientenfeld-Pfad.
- An Patient:innen: (a) Bewertungsanfrage `worker/processors/review-request.ts:257-269` mit Vorname, Behandlung, Praxisname, Token-Link `landing/r/<token>?rating=N`, Abmeldelink `APP_ORIGIN/api/review-tokens/<token>/unsubscribe`; Absender `"<Praxis> via EINS" <team@eins.ag>` oder `review_email_from` (`:285-290`). (b) Wiederbehandlungs-Erinnerung (andere Sitzung). (c) Landing: Double-Opt-in-Mail (`apps/clinic-landing/lib/doi.ts:142-250`, siehe L-9).
- Resend-Aufruf (`server/email.ts:158-173`): `from, to, subject, html, text, replyTo, headers`. Keine `tags`, keine `metadata`. Idempotenzschlüssel enthalten keine Patientendaten (`new-request/<requestId>/<hash(to)>`, `review-request/<rowId>`).

**Drittanbieter.**
- Google (Offline-Conversion): `worker/processors/oci-purchase.ts:60-120`. Gate `googlePurchaseSkipReason` (`lib/ads-report-gate.ts:57-62`): Einwilligung aktiv UND gclid/wbraid/gbraid, Prüfung zum Sendezeitpunkt (Widerruf stoppt). Gesendet: Klick-Kennung, Zeit, Betrag, Währung, Bestellnummer, SHA-256 von E-Mail und Telefon. Entspricht dem entschiedenen Regelwerk. Sauber.
- Meta (Server, Kauf): per Konstante aus (`lib/ads-report-gate.ts:27`, `capi-purchase.ts:56-59`), siehe L-15. Wenn an, würde zusätzlich ein Hash des vollen Namens als `fn` gehen (`capi-purchase.ts:103-104`).
- Meta (Server, Lead) in der Landing (`apps/clinic-landing/app/api/lead/route.ts:318-346`): nur qualified, nur Einwilligung `adsMeasurement`, nur bezahlter Meta-Klick; E-Mail/Telefon/Vorname gehasht, gekürzte IP, UA, nur Herkunfts-URL ohne Pfad, kein `custom_data`. Sauber. `/api/track` (PageView): nur Origin, gekürzte IP, UA.
- Browser-Tags: Meta-Pixel gehärtet (`autoConfig false`, nur PageView). Google/TikTok nicht, siehe L-7.
- OpenAI (`worker/processors/ai-score.ts:84-112, 175-190`): nur mit `aiProcessingConsent` im gespeicherten `ai_signals` (nur Notizen, ohne Name). Worker in Produktion aus, also derzeit keine Übermittlung.
- Nominatim (OpenStreetMap, `server/geocode/nominatim.ts:117-141`): der Stadtname der Anfrage geht als Suchbegriff an einen öffentlichen Dienst und steht bei Fehlern im Log (`:138-141`). Grob (nur Ort), P3, nur bei laufendem Worker.
- CRM-Webhook der Zielseite (`apps/clinic-landing/lib/crm/raw.ts`): voller Datensatz (Name, E-Mail, Telefon, Notizen, Einwilligungen, `meta` mit utm/fbc/fbp/UA), siehe L-16. Bei `_template` ist keine URL gesetzt (`clinics/_template/clinic.ts:188`).

**URLs und Query-Strings.** Suchbegriffe (Patientennamen, Telefon, E-Mail) liegen in `GET /api/search/leads?q=` und `/anfragen?search=`, siehe L-5. CSV-Export ist GET mit denselben Filtern, Antwort `private, no-store`, Export wird auditiert ohne Suchtext (`app/api/requests/export/route.ts:79-115`), Zellen gegen Formeln gesichert (`csv.ts:13`). Links in E-Mails tragen nur UUIDs oder opake Tokens (Ausnahme: DOI-Token, L-9). Weiterleitungen: `Referrer-Policy: strict-origin-when-cross-origin` auf beiden Apps (`apps/portal/next.config.ts:50`, `apps/clinic-landing/next.config.mjs:21`).

**Speicher (R2).** Schlüssel ohne Namen (siehe oben). Abruf-URLs: Dateien 30 min, Dokumente 10 min, Admin 5 min, Checkliste 1 h (Standard, `server/storage.ts:169, 223`). Öffentlicher Bucket: nur wenn `R2_PUBLIC_BASE` gesetzt, siehe L-11. Datenbank-Sicherung im selben Bucket, siehe L-3.

**Nebentabellen.** `audit_log`: Diffs fast durchgehend ohne Patientendaten (Muster `{ status }`, `{ note: true }`, `hasFreeText`, Filter nur als Ja/Nein). Ausnahmen L-14. `email_send_log`: nur Schlüssel (Monatsbericht-Schlüssel enthält Team-Adresse). `notifications`: leer. `kpi_*`/`forecast_*`/`dashboard_alerts`: Aggregate. pg-boss-Nutzlasten: IDs.

**Browser.** `localStorage`: Suchverlauf und Anheftungen mit Patientendaten, siehe L-1. Fragebogen-Sicherung (`FragebogenForm.tsx:36-52`): Praxisantworten, kein Patientenbezug. Theme: harmlos. ⌘K-Index: statisch (Navigation, Kennzahlen); Anfragen nur per API.

## 3. Befunde

### L-1: Suchverlauf und Anheftungen speichern Patientenname, E-Mail und Behandlung dauerhaft im Browser, ohne Bezug zu Nutzer oder Praxis und ohne Löschung beim Abmelden
- Schwere: P1
- Art: security
- Sicherheit: hoch
- Ort: `app/(portal)/_components/GlobalSearchDialog.tsx:41-43, 79-82, 192-194`; Quelle der Felder `app/api/search/leads/route.ts:35-45`; Abmelden `app/api/auth/logout/route.ts:8-33`
- Beleg: `pushRecent(item)` schreibt bei jedem Treffer `{id, title, subtitle, href}` in `localStorage["eins-portal-search-recent"]` (5 Einträge) und Anheften in `...-pinned` (10). Bei Anfragen ist `title` der Patientenname (oder E-Mail/Telefon) und `subtitle` "Behandlung · E-Mail". Der Schlüssel ist global, nicht pro Nutzer/Praxis. Weder Logout noch Sitzungsende noch Impersonation löschen ihn (kein `removeItem`, kein `Clear-Site-Data`, grep ohne Treffer).
- Szenario: Empfangs-PC mit mehreren Mitarbeiterinnen: nach dem Abmelden zeigt die Palette der Nächsten (ohne Anmeldung nicht, aber nach Anmeldung als anderer Nutzer, auch Rolle mit weniger Rechten, z. B. nach Rollenwechsel) die zuletzt gesuchten Patientennamen mit E-Mail und Wunschbehandlung. Karam öffnet per "Als Nutzer ansehen" Praxis A, dann Praxis B im selben Browser: die Palette von B zeigt Patient:innen von A (Mandantenübergriff im Client). Gesundheitsbezogene Angabe (Behandlung) plus Identität liegt unverschlüsselt auf der Platte.
- Fix-Vorschlag: In `GlobalSearchDialog.tsx` den Schlüssel um `session.userId` und `clinicId` erweitern (Props vom Server) oder, besser, nur IDs speichern und Titel beim Öffnen per API nachladen. Zusätzlich beim Abmelden und beim Start/Ende einer Impersonation `localStorage.removeItem` für beide Schlüssel (kleine Client-Komponente im Logout-Menü, bzw. `Clear-Site-Data: "storage"` als Header der Logout-Antwort in `logout/route.ts`).

### L-2: Hochgeladene PVS-CSV-Dateien (Patientenstamm, Rechnungen) bleiben unbegrenzt im Speicher
- Schwere: P1 (andere Sitzung, `worker/processors/pvs-csv-ingest.ts`)
- Art: security
- Sicherheit: hoch
- Ort: `server/actions/pvs-csv-upload.ts:116-117`, `worker/processors/pvs-csv-ingest.ts:72-76`, einzige Löschstellen von Speicherobjekten sind `dateien/actions.ts`, `checkliste/actions.ts`, `avatar-actions.ts`, `server/dsgvo.ts:257`, `outreach-videos.ts:238` (grep `.remove(`)
- Beleg: Der Upload legt `pvs-csv-uploads/<clinicId>/<uuid>.csv` in R2 ab, der Ingest liest die Bytes (`read(upload.storageKey)`) und löscht sie nie. Die Datei enthält die Roh-CSV der Praxis (Namen, Geburtsdaten, Termine, Rechnungen). Aufgeräumt wird nur bei kompletter Praxislöschung (`server/dsgvo.ts:149-153` sammelt `pvs_csv_uploads.storage_key`).
- Szenario: Eine Praxis lädt zum Start den Patientenstamm-Export hoch. Die Datei bleibt, solange die Praxis Kundin ist, und danach bis jemand manuell löscht. Sie ist die vollständigste Kopie von Patientendaten im ganzen System und wird durch keine Aufbewahrungsregel erfasst. Mit Worker aus (Produktion heute) wird sie nicht einmal verarbeitet und liegt ungenutzt dort.
- Fix-Vorschlag: Im Ingest nach `status='completed'` (oder 7 Tage nach Upload) `getStorage().remove(storageKey)` ausführen und `storage_key` nicht mehr als Quelle behalten (Spalte leeren, `original_filename` bleibt). Zusätzlich R2-Lifecycle-Regel für das Präfix `pvs-csv-uploads/` (30 Tage).

### L-3: Datenbank-Sicherung mit allen Patientendaten liegt im selben R2-Bucket, mit erratbarem Namen, ohne Aufbewahrungsfrist im Code und außerhalb jeder Löschung
- Schwere: P1 (P0, sobald `R2_PUBLIC_BASE` gesetzt oder der Bucket öffentlich lesbar ist)
- Art: security
- Sicherheit: hoch (Code), mittel (Betriebszustand)
- Ort: `worker/processors/db-backup.ts:40, 66-83`, `worker/schedules.ts:40`, `server/storage.ts:11, 76-78, 133-138`
- Beleg: Schlüssel `backups/portal-YYYY-MM-DD.sql.gz` (Datum erratbar), Ablage `PutObject` in `R2_BUCKET` mit den App-Zugangsdaten, nur `ServerSideEncryption: AES256`. Kommentar im Code (`:79-82`): Aufbewahrungsregel müsse "in der R2-Konsole" gesetzt werden. `storage.ts:11` sagt: bei gesetztem `R2_PUBLIC_BASE` ist der Bucket "public-read".
- Szenario: (1) Wird je `R2_PUBLIC_BASE` gesetzt (für Avatare vorgesehen), ist `https://<public>/backups/portal-2026-10-08.sql.gz` ohne Anmeldung abrufbar: kompletter Datenbankabzug mit allen Praxen und Patienten, Passwort-Hashes, verschlüsselten Zugangsdaten. (2) Auch ohne öffentlichen Zugriff: DSGVO-Löschung (`server/dsgvo.ts`) erreicht Sicherungen nicht, und ohne Lebenszyklusregel liegt jede gelöschte Praxis unbegrenzt weiter in den Abzügen. (3) Wer die App-Zugangsdaten (R2-Key) kennt, liest alles.
- Fix-Vorschlag: Sicherungen in einen eigenen privaten Bucket mit eigenem Schlüssel (nur Schreibrecht für die App), nie `R2_PUBLIC_BASE` darauf; Lebenszyklusregel 30 Tage; Clientseitige Verschlüsselung (z. B. `age`/GPG-Schlüssel nur bei Karam) im Prozess vor dem Upload; in `docs` festhalten, dass eine Praxislöschung erst nach Ablauf der Sicherungsfrist vollständig wirkt. Solange der Worker aus ist, läuft dieser Job nicht: dann gilt nur Neons eigenes Zeitpunkt-Backup (Aufbewahrungsdauer im Neon-Plan prüfen).

### L-4: Es gibt keine Aufbewahrungsfristen: Anfragen, Spam, Patienten, Rückmeldungen, Klick-Kennungen, PVS-Ereignisse bleiben für immer, auch nach Vertragsende
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `worker/processors/purge-audit.ts:24-51` (einziger Bereinigungsjob), `lib/constants.ts:336`, `app/api/cron/daily/route.ts:82`, `worker/processors/pvs-partition-rotate.ts:20-25` (Kommentar: "keep forever"), `server/leads.ts:176-205`
- Beleg: Bereinigt werden nur `audit_log` (24 Monate), abgelaufene `admin_tokens`, `rate_limits` (> 1 Tag), `magic_links` (> 7 Tage). Alles andere wird nie nach Alter gelöscht: `requests` (auch `status='spam'`, abgelehnte, verlorene), `request_activities`, `patients`, `patient_feedback`, `review_email_schedule`, `linking_failures` (mit Stammdaten-Schnappschuss), `pvs_event_log`, `email_send_log`, `sessions` (IP, UA), `impersonation_tokens`. Klick-Kennungen (`fbclid`, `gclid`, `fbc`, `fbp`, `click_user_agent`, `click_ip_anon`) werden nur bis zum Ende des Zuordnungsfensters (laut Schema-Kommentar 90 Tage) gebraucht, bleiben aber dauerhaft. Archivierte Praxen (`clinics.archived_at`) behalten alles; gelöscht wird nur auf manuellen Admin-Knopf (`server/dsgvo.ts`).
- Szenario: Ein Jahr nach Vertragsende (oder 5 Jahre nach einer Spam-Anfrage eines Dritten) liegen dessen Name, E-Mail, Freitext mit Gesundheitsangaben und Einwilligungs-IP weiter in der Datenbank und in jedem Sicherungsabzug. Bei einem Auskunfts- oder Löschverlangen gibt es keine Obergrenze und keine Automatik; bei einem Datenleck ist die Schadenmenge maximal.
- Fix-Vorschlag: Neuer Schritt `purge-retention` in `purge-audit.ts` (läuft über den Vercel-Cron auch ohne Worker), Fristen als Konstanten in `lib/constants.ts`: Spam-Anfragen 90 Tage; Klick-Kennungen/UA/`click_ip_anon` auf NULL nach 90 Tage; `sessions` abgelaufen + 30 Tage, `impersonation_tokens` abgelaufen + 7 Tage, `email_send_log` > 90 Tage; Praxis archiviert + 90 Tage: `eraseClinicData` automatisch auslösen, nachdem der Export bereitgestellt wurde (Nordstern: "Anfragedaten als Export zum Vertragsende"). Frist für aktive Praxen ist Karams Entscheidung; Vorschlag: Anfragen ohne Termin/Behandlung/Gewinn 24 Monate nach Eingang anonymisieren (Name, E-Mail, Telefon, Nachricht, `ai_signals.quiz.notes`, `raw_payload` auf NULL, Zähler bleiben). Den Kommentar in `pvs-partition-rotate.ts` ("DSGVO requires us to expire lead-related PII after 2 years") einlösen: Partitionen älter als 24 Monate trennen und löschen.

### L-5: Suchbegriffe (Patientennamen, Telefonnummern, E-Mail-Adressen) stehen in URLs und damit in Plattform-Zugriffsprotokollen und im Browserverlauf
- Schwere: P2
- Art: security
- Sicherheit: mittel (ob Vercel die Query in den Laufzeitprotokollen mitschreibt, ist plattformabhängig, ich gehe davon aus)
- Ort: `app/(portal)/_components/GlobalSearchDialog.tsx:163`, `app/api/search/leads/route.ts:16-30`, `app/(portal)/anfragen/_components/AnfragenFilters.tsx:91-108`, `app/(portal)/anfragen/_lib/list-params.ts:41-70`, Link zum Export (`api/requests/export`)
- Beleg: Palette ruft `fetch("/api/search/leads?q=" + term)`, Liste setzt `?search=<Name>` per `router.replace` (Browserverlauf, Lesezeichen, "Zurück"), CSV-Export hängt dieselben Parameter an. Eigene Logzeilen sind sauber (nur Pfad), die Plattform-Zugriffslogs und Erweiterungen/Proxys sehen die volle URL. Der Audit-Eintrag des Exports ist korrekt (`route.ts:101-115`).
- Szenario: Empfang sucht "Frau Müller 0171...": der Begriff liegt in Vercel-Logs (an eine Log-Senke weitergeleitet), im Verlauf des Praxis-PCs und, bei Link-Teilen, in Chats. Eine Namenssuche nach einer Behandlung ist zudem Gesundheitsbezug.
- Fix-Vorschlag: Palette auf `POST /api/search/leads` mit JSON-Body (gleiche Berechtigungsprüfung, `withApi` unterstützt Methoden). Für `/anfragen`: Suchfeld per Server Action/Formular-POST in ein Cookie oder Zustand legen statt in die URL; alternativ Suchtext nicht in `router.replace` schreiben, sondern nur clientseitig filtern und beim Export per POST schicken. Mindestens den Export auf POST umstellen.

### L-6: Einwilligungsnachweis ist unvollständig: kein Wortlaut/Version für die Datenschutz-Einwilligung, KI- und Werbe-Einwilligung ohne Zeitpunkt, Alters-Bestätigung nicht gespeichert, Meta-Anfragen ohne Nachweis
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch (Befund), mittel (rechtliche Tragweite: Nachweis nach Art. 7 Abs. 1 DSGVO; ich halte die Lücke für real, aber mit verfügbarer Gegenbeweislage der Landing-Seite für beherrschbar)
- Ort: `server/leads.ts:187-188, 201-204`, `db/schema.ts:668-671, 734`, `apps/clinic-landing/lib/portal-intake.ts:44, 193-194`, `apps/clinic-landing/app/api/lead/route.ts:55-70`, `app/api/webhooks/meta/leadgen/route.ts:213-226`
- Beleg: `dsgvo_consent_at` ist der Eingangszeitpunkt (`new Date()`, Kommentar `leads.ts:185-186`), es gibt keine Spalte für Fassung/Hash des Datenschutz-/Einwilligungstextes. Nur die Anzeigen-Einwilligung hat `ads_consent_version` (`lead` kommt aus `ADS_CONSENT_VERSION = "2026-10-06"`). `marketingConsent` und `aiProcessingConsent` stehen als Boolean in `ai_signals.quiz` (jsonb), ohne Zeit/Version, `ageGate` (Pflicht im Formular) wird nie an das Portal gesendet. Für Meta-Lead-Anfragen ist `dsgvo_consent_ip` NULL und `dsgvoConsentAt` = Webhook-Zeit; der Meta-Formulartext ist nicht erfasst.
- Szenario: Eine Patientin behauptet, nie zugestimmt zu haben, oder verlangt Nachweis der KI-Einwilligung vor Übermittlung ihrer Notizen an OpenAI: Das Portal kann nur "Zeitpunkt des Eingangs" und "Boolean true" zeigen, nicht welchen Text sie sah. Der Wortlaut der Datenschutz-Einwilligung kann sich ändern, ohne dass alte Datensätze zuordenbar bleiben.
- Fix-Vorschlag: Landing sendet `consentVersions: { privacy, ai, marketing, ageGate }` (konstante Versionen wie `ADS_CONSENT_VERSION`, `lib/ads-consent.ts` als Vorbild). Portal: neue Spalten (Migration) `privacy_consent_version`, `ai_consent_at`, `marketing_consent_at` oder ein `consents jsonb` mit `{kind, version, at}`; `dsgvo_consent_at` aus dem Landing-Zeitstempel, nicht `new Date()`. Meta-Anfragen: Spalte `consent_basis = 'meta_leadform'` mit Formular-ID, die `formId` steht schon im Audit (`leadgen/route.ts:258`).

### L-7: Google- und TikTok-Browser-Tags der Zielseiten melden die volle Seitenadresse (nennt die Behandlung); Google-Tag hat erweiterte Conversions an
- Schwere: P2
- Art: security
- Sicherheit: mittel (ob Seitenadresse und Titel gesendet werden, folgt aus dem Standardverhalten von `gtag config`/`ttq.page()`; geprüft nur im Code, nicht im Netzwerk)
- Ort: `apps/clinic-landing/components/tracking/google-ads.tsx:31-38`, `apps/clinic-landing/components/tracking/tiktok-pixel.tsx:67`, Gegenbeispiel `meta-pixel.tsx:42-60`
- Beleg: `gtag('config', adsId, { 'allow_enhanced_conversions': true })` ohne `send_page_view: false` und ohne `page_location`-Kürzung; `ttq.page()` ohne Einschränkung. Das Meta-Pixel wurde bewusst gehärtet (`autoConfig false`, nur PageView, `/api/track` nur Origin) mit der Begründung "Seitenadressen dürfen keinen Gesundheitsbezug verraten" (`api/track/route.ts:12-17`). Die URL der Seite ist `/<praxis>/<behandlung>`. `allow_enhanced_conversions` erlaubt, je nach Einstellung im Google-Ads-Konto ("automatische Erkennung"), das Auslesen von E-Mail/Telefon aus dem Formular im Browser. Diese Tags laden bei jedem Besucher mit Cookie-Einwilligung "Marketing", unabhängig von bezahltem Klick und von der separaten Anzeigen-Einwilligung (die nur den Lead/Kauf steuert).
- Szenario: Besucher stimmt dem Cookie-Banner zu, besucht `/dr-x/brustvergroesserung`: Google (und TikTok, falls konfiguriert) erhalten Seitenadresse, Titel, Browser-Kennungen. Der Besucher hat die gesonderte Gesundheitsangaben-Einwilligung nicht gegeben. In der Vorlage sind die IDs `undefined`, das Risiko tritt erst mit der ersten Praxis auf, die Google Ads einträgt.
- Fix-Vorschlag: `gtag('config', adsId, { send_page_view: false, allow_enhanced_conversions: false, page_location: location.origin, page_title: 'Zielseite' })`, Conversion nur über das bestehende `Lead`-Ereignis (schon hinter der Anzeigen-Einwilligung). TikTok: `ttq.page()` entfernen oder ganz deaktivieren, solange der Einwilligungstext nur Meta und Google nennt (`lib/ads-consent.ts`, siehe Kommentar `pre-qualifier/index.tsx:306-309`).

### L-8: Mehrere Stellen schreiben rohe Fehlerobjekte ins Log, Postgres-Fehler tragen Zeilenwerte im `detail`
- Schwere: P2
- Art: security
- Sicherheit: mittel (Eigenschaft von postgres.js: `detail` ist ein aufzählbares Feld, im Quelltext von `lib/error-log.ts:3-9` ebenfalls so beschrieben; nicht ausgeführt)
- Ort: `worker/index.ts:110`, `server/jobs.ts:89`, `server/audit.ts:108`, `server/pvs-events.ts:462, 593, 627, 659, 694, 761, 788, 1118` (andere Sitzung), `worker/processors/pvs-*.ts` (andere Sitzung), `worker/processors/review-request.ts:138-141`, `worker/processors/retreatment-reminder.ts:97-101` (andere Sitzung), `app/api/pvs/events/route.ts:298` und weitere PVS-Routen (andere Sitzung), `auth/session.ts:296`, `app/api/auth/google/callback/route.ts:85`
- Beleg: WS3 hat `instrumentation.ts`, `server/api.ts` und `lib/flash.ts` auf `describeErrorForLog` umgestellt. Die genannten Stellen übergeben weiter `err` als zweites Argument von `console.error`. Node druckt dabei aufzählbare Felder wie `detail` ("Key (email)=(max@mustermann.de) already exists.") und `where`. `review-request.ts:138` gibt nur `err.message` aus, das bei Resend-Fehlern die Empfängeradresse enthalten kann.
- Szenario: Ein Job (Bewertung, PVS-Ereignis mit Patientenstamm, Wiederbehandlung) scheitert an einer Eindeutigkeitsverletzung: die Logzeile enthält E-Mail oder Namensbestandteile. In Produktion läuft der Worker aktuell nicht, die Web-Stellen (`audit.ts`, `jobs.ts`, `session.ts`) laufen sofort.
- Fix-Vorschlag: Überall `describeErrorForLog(err)` (JSON-Zeile `kind:...`) statt `err`; ein ESLint-Regel-Eintrag (`no-restricted-syntax` für `console.error(..., err)`) oder ein dünner Helfer `logError(tag, err)` in `lib/error-log.ts`. PVS-/Worker-Dateien an die andere Sitzung weitergeben.

### L-9: Double-Opt-in-Link der Zielseite enthält die E-Mail-Adresse im Klartext (nur Base64) in der URL
- Schwere: P2
- Art: security
- Sicherheit: hoch
- Ort: `apps/clinic-landing/lib/doi.ts:55-62, 79-89`, `apps/clinic-landing/app/api/lead/route.ts:288-300`, `apps/clinic-landing/app/api/lead/marketing-optin/route.ts`
- Beleg: `signDoiToken` gibt `base64url(JSON.stringify({e: email, c, t, id, x})) + "." + hmac` zurück, die URL ist `/api/lead/confirm-marketing?t=<token>`. Nur die Signatur schützt, nicht die Vertraulichkeit; `claims.e` und `claims.t` (Behandlungs-Slug) sind für jeden lesbar.
- Szenario: Die URL steht in der Patientenmail (gewollt), aber auch im Zugriffsprotokoll der Landing-Plattform (Query-String), in Mail-Scannern/Link-Prüfern des Empfängers und im Browserverlauf. Sie verknüpft E-Mail-Adresse und gewünschte Behandlung für jeden mit Zugriff auf diese Logs.
- Fix-Vorschlag: Claims mit AES-256-GCM verschlüsseln (Schlüssel aus `DOI_SIGNING_SECRET` per HKDF) statt nur zu signieren; Behandlung entfällt aus dem Token (Webhook bekommt sie über `eventId`). Alternativ nur `eventId` + HMAC im Link und E-Mail serverseitig im CRM-Webhook nachschlagen lassen.

### L-10: Bewertungsanfragen an Patient:innen gehen von der gemeinsamen Adresse `team@eins.ag` und ohne Bestätigung der Praxis zur Rechtsgrundlage
- Schwere: P2
- Art: robustness
- Sicherheit: mittel (Rechtslage: Bewertungsanfrage per E-Mail zählt als Werbung; ohne Einwilligung greift nur die Bestandskunden-Ausnahme nach § 7 Abs. 3 UWG mit Hinweis bei Adresserhebung; ich halte sie hier für wahrscheinlich anwendbar, aber die Praxis muss den Hinweis tatsächlich geben)
- Ort: `worker/processors/review-request.ts:257-269, 285-290`, `lib/env.ts:59` (`EMAIL_FROM` Standard `EINS <team@eins.ag>`), `app/(portal)/einstellungen/actions.ts:700-772`
- Beleg: Absender `"<Praxis> via EINS" <team@eins.ag>` (oder `review_email_from`, "admin-set", Standard leer). Dieselbe Domain verschickt Anmeldelinks und Passwort-Zurücksetzen. Für Wiederbehandlungs-Erinnerungen gibt es `retreatment_consent_attested` (`db/schema.ts:141`, Praxis bestätigt die Rechtsgrundlage), für Bewertungsanfragen nur den Schalter `review_request_enabled`.
- Szenario: (1) Spam-Beschwerden von Patient:innen auf `eins.ag` verschlechtern die Zustellung der Login-Mails (dieselbe Absenderdomain, `bounced/complained` sperrt nur die Einzeladresse, `email_suppression`). (2) Eine Patientin beschwert sich, die Praxis hat sie nie auf Mails hingewiesen: es gibt keine Bestätigung der Praxis im System.
- Fix-Vorschlag: Eigene Sendedomain für Patientenmail (z. B. `mail.eins.ag`, getrennte Resend-Domain) als Standard in `reviewFrom()`; Schalter `review_request_enabled` nur aktivierbar, wenn die Praxis in den Einstellungen bestätigt, dass Patient:innen bei Adresserhebung auf Bewertungs-/Servicemails hingewiesen werden (neue Spalte `review_consent_attested`, Text wie bei `retreatmentConsentAttested`).

### L-11: Bei gesetztem `R2_PUBLIC_BASE` werden alle Dateiarten dauerhaft öffentlich ausgeliefert, auch Dokumente, Kundendateien und Checklisten-Uploads
- Schwere: P2
- Art: security
- Sicherheit: mittel (bedingt: heute bewusst nicht gesetzt)
- Ort: `server/storage.ts:133-146` (`urlFor` liefert bei gesetzter Basis die öffentliche URL ohne Signatur), Aufrufer `app/(portal)/dokumente/page.tsx:98`, `dateien/page.tsx:46`, `onboarding/checkliste/page.tsx:49`, `app/api/admin/files/[...path]/route.ts:59`
- Beleg: Es gibt keine Unterscheidung nach Sensibilität: `urlFor(key)` gibt bei gesetztem `R2_PUBLIC_BASE` für jeden Schlüssel die unsignierte Adresse zurück; die Ablaufzeit-Parameter (`expiresInSeconds: 600/1800`) wirken dann nicht. Die Schlüssel sind UUIDs (nicht erratbar), die URLs stehen aber in Seitenquelltext, Browserverlauf und Verlauf von Erweiterungen unbegrenzt gültig.
- Szenario: Jemand setzt die Variable (Avatar-Anzeige auf der Kundenseite), und plötzlich haben Monatsberichte mit Praxiszahlen, Patientenlisten aus der Checkliste und Kundenuploads dauerhaft gültige öffentliche Links; ein weitergegebener Link bleibt für immer gültig.
- Fix-Vorschlag: `R2_PUBLIC_BASE` nur für ein eigenes öffentliches Präfix/Bucket (`avatars/`) zulassen: `publicUrlFor` prüft das Präfix, alles andere geht immer über signierte URLs. Zusammen mit L-3 festschreiben, dass `backups/` nie unter die öffentliche Basis fällt.

### L-12: Die DSGVO-Löschung erreicht verwaiste Uploads, Warteschlangen-Zeilen, Sicherungen und Empfänger nicht
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `server/dsgvo.ts:128-153, 199-213, 253-262`, `server/uploads.ts:45-60`, `worker/processors/db-backup.ts`
- Beleg: Gelöscht werden alle Zeilen mit `clinic_id` (aus dem Katalog), Speicherobjekte nur über Schlüssel aus DB-Zeilen. Nicht erfasst: (a) Objekte, die per Presigned-PUT hochgeladen, aber nie abgeschlossen wurden (kein DB-Eintrag, Schlüssel `<clinicId>/<scope>/<uuid>`), WS7 räumt das bei Videos selbst als "Speicherleiche" ein; (b) `pgboss.job`-Zeilen mit `requestId`/`clinicId` (nur IDs, `email-send` mit Team-Text), bleiben bis pg-boss selbst aufräumt; (c) Sicherungen (L-3); (d) bei Resend, Meta, Google, OpenAI bereits übermittelte Daten (nicht löschbar durch uns). Erfolgsmeldung nennt nur fehlgeschlagene bekannte Schlüssel.
- Szenario: Eine Praxis wird gelöscht und erhält die Meldung "vollständig". Ein Abbruch beim Upload (häufig am Handy) hinterlässt Patientenfotos oder Checklisten-Dateien im Bucket, die niemand je wiederfindet.
- Fix-Vorschlag: In `Storage` eine `list(prefix)`-Methode ergänzen und in `eraseClinicData` zusätzlich `<clinicId>/` und `pvs-csv-uploads/<clinicId>/` komplett leeren. Erfolgsmeldung um den Satz ergänzen: "Sicherungen laufen nach N Tagen aus; bei Resend/Google/Meta bereits übermittelte Daten sind nicht Teil dieser Löschung." `pgboss.job` mit `data->>'clinicId'`/zugehörigen `requestId`s nachziehen (SQL auf Schema `pgboss`, falls vorhanden).

### L-13: Behandlungs-Etikett im Betreff der "Neue Anfrage"-Mail ist Patienteneingabe (bei Meta-Formularen Freitext) und wird nur gekürzt
- Schwere: P3
- Art: security
- Sicherheit: mittel
- Ort: `server/email/templates/new-request.ts:30-36, 39`, `server/request-notify.ts:149`, `app/api/webhooks/meta/leadgen/route.ts:341-347`, `server/leads.ts:178`
- Beleg: `treatment: req.treatmentWish ?? req.quizTreatment`, `cleanTreatmentLabel` kürzt auf 60 Zeichen, entfernt nichts weiter. Auf der Zielseite stammt der Wert aus einer Auswahlliste, bei Meta-Lead-Formularen aus dem Feld `treatment/behandlung/service/interest` (Freitext möglich). Der Betreff erscheint auf Sperrbildschirmen und im Resend-Protokoll. WS1 hat das als offene Entscheidung 7 gemeldet.
- Szenario: Ein Patient trägt im Meta-Formular "Brustvergrößerung, bin Brigitte Meier, 0171..." ein. Betreff und Vorschau enthalten das. Mit Zielseiten-Auswahl tritt das nicht auf.
- Fix-Vorschlag: `renderNewRequestEmail` nimmt für den Betreff nur Behandlungsnamen, die zu einer aktiven Zeile in `treatments` passen (`requests.treatment_id`), sonst "Neue Anfrage über EINS"; Freitext nur im Portal.

### L-14: Einzelne Protokollstellen nehmen E-Mail-Adressen im Klartext auf
- Schwere: P3
- Art: security
- Sicherheit: hoch
- Ort: `app/api/webhooks/resend/route.ts:162-170`, `worker/processors/email-send.ts:55-57`, `app/(auth)/login/actions.ts:195-200`
- Beleg: Resend-Webhook schreibt `diff: { email, reason, ...}` für jede Praxis, in der die Adresse als Patient/Anfrage vorkommt, in `audit_log` (24 Monate); der Job loggt `to=${job.to}`; Magic-Link-Anforderung schreibt `diff: { email }` (beliebige eingegebene Adresse). Löschung einer Praxis setzt `diff` auf NULL (`dsgvo.ts:224`), aber die Webhook-Zeilen sind clinic-bezogen, also ebenfalls erfasst. Rest bleibt bis zur Frist.
- Szenario: Eine Patientenadresse, die hart bounct, steht bis zu 24 Monate im Protokoll der Praxis und im Export.
- Fix-Vorschlag: In `diff` nur `emailHash` (SHA-256 mit Pepper) oder `domain`; Logzeile nur `clinic` und `reason`.

### L-15: Meta-Kaufmeldung hängt an einer Code-Konstante, nicht an der Fassung des Einwilligungstextes
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `lib/ads-report-gate.ts:27, 45-50`, `worker/processors/capi-purchase.ts:56-59, 102-104`, `apps/clinic-landing/lib/ads-consent.ts:6-27`
- Beleg: `META_PURCHASE_REPORTING = false as boolean`. Der Einwilligungstext sagt: Meta erfährt nur die Anfrage, Google zusätzlich Behandlung und Betrag. Würde jemand die Konstante auf `true` stellen, gingen Beträge an Meta auch für alle bisherigen Einwilligungen (Version `2026-10-06`), und es würde der Hash des vollen Namens als `fn` gesendet.
- Szenario: Kurzfristiger Schalter "Meta wieder an" macht aus einer gültigen Einwilligung eine ungültige für Meta-Kaufereignisse.
- Fix-Vorschlag: In `metaPurchaseSkipReason` zusätzlich `adsConsentVersion` gegen eine Liste von Fassungen prüfen, die Meta-Kauf ausdrücklich nennen (`META_PURCHASE_CONSENT_VERSIONS`), und `hashName` nur auf das erste Wort anwenden.

### L-16: Zielseiten-Webhook an das Praxis-CRM ist unsigniert und enthält Klick-Kennungen und alle Einwilligungsfelder
- Schwere: P3
- Art: security
- Sicherheit: mittel
- Ort: `apps/clinic-landing/lib/crm/adapter.ts:18-48`, `apps/clinic-landing/lib/crm/raw.ts`, `apps/clinic-landing/app/api/lead/route.ts:271-274`
- Beleg: `normalizedLead` sendet Name, E-Mail, Telefon, Stadt, Notizen, Einwilligungen und `meta` (utm, `fbc`, `fbp`, UA, Seitenadresse) per POST an die konfigurierte URL (n8n/Make/Zapier-typisch), unabhängig davon, ob die Anzeigen-Einwilligung vorliegt, ohne HMAC (anders als der Portal-Weg). `isAllowedWebhookUrl` prüft nur das Ziel.
- Szenario: Wer die Webhook-URL kennt, kann gefälschte Anfragen einspeisen; der Empfänger erhält Marketing-Kennungen, die er nicht braucht.
- Fix-Vorschlag: `meta.fbc/fbp/ua` und `consents.adsMeasurement*` aus dem Webhook-Body entfernen, `X-EINS-Signature` wie beim Portal-Relay ergänzen.

## 4. Löschung und Aufbewahrung im Überblick

Löscht die Praxis-Löschung (WS7, `server/dsgvo.ts`) alles aus Abschnitt 1? DB: ja für jede Tabelle mit `clinic_id` (Katalog, auch `pvs_event_log` als partitionierte Tabelle, `email_send_log`, `ads_conversion_outbox`, `patient_feedback`), `request_activities` über Kaskade, `magic_links` über E-Mail (`:208-210`). Audit: Zeilen der Praxis bleiben mit `action/entity/time`, IP/UA/diff/Mitarbeiter-E-Mail werden entfernt. Speicher: alle bekannten Schlüssel (7 Quellen). Nicht erreicht: L-12 (Verwaistes, Warteschlange, Sicherungen, Drittanbieter). Zu `geocode_cache` (Stadtnamen ohne Praxis-Bezug): ohne `clinic_id`, harmlos.

Nach Alter bereinigt wird: `audit_log` (24 Monate), abgelaufene Admin-Tokens, Rate-Limit-Zeilen (> 1 Tag), Magic-Links (> 7 Tage). Läuft über den Vercel-Cron sonntags auch ohne Worker (`app/api/cron/daily/route.ts:82`). Nicht bereinigt: alles andere (L-4).

**Pro-Person-Löschung/Auskunft (offene Entscheidung, kein Befund).** Sie müsste folgende Fundstellen je Person (Schlüssel E-Mail/Telefon/`patient_id`) abdecken: `requests` (`contact_*`, `message`, `treatment_wish`, `ai_signals.quiz.notes/city`, `raw_payload`, `ai_reasoning`, Klick-Kennungen), `request_activities.body`, `request_followups.note`, `patients` samt `pvs_patient_map`, `linking_failures.pvs_patient_snapshot`, `pvs_event_log.payload`, `review_email_schedule`, `patient_feedback` (`contact_*`, `free_text`), `retreatment_cycles.reminder_email`, `audit_log.diff` (L-14), Datei im R2 (CSV, falls Person darin), `email_suppression` (bewusst behalten: Sperrliste als Nachweis, nur Hash). Außerdem Drittanbieter: bei Google/Meta gesendete Hashes, Resend-Protokoll. Der Freitext liegt dreifach (`message`, `ai_signals.quiz.notes`, `raw_payload`), ein Entfernen muss alle drei treffen.

## 5. Einwilligung

- `dsgvo_consent_at` + anonymisierte IP (`inet`, letztes Oktett 0, `apps/clinic-landing/lib/meta-capi.ts:102-115`, WS1 C-11): vorhanden. Wortlaut/Version: nein (L-6).
- Anzeigen-Einwilligung: Zeitpunkt (Serverzeit), Fassung (`ads_consent_version`), Widerruf (`ads_consent_revoked_at`, nur von der Praxis erfassbar, `app/(portal)/anfragen/[id]/actions.ts:568`). Meldungen an Google sind im Code strikt an Einwilligung + Google-Klick-Kennung gebunden, geprüft zum Sendezeitpunkt (`worker/processors/oci-purchase.ts:73-76`). Meta-Lead aus der Landing: Einwilligung + bezahlter Meta-Besuch (`route.ts:318-325`). Nur das Formular der Zielseite kann die Einwilligung setzen (`intake/route.ts:350-356`). Gate und Reihenfolge entsprechen der Entscheidung vom 2026-10-06.
- KI-Einwilligung: Boolean in `ai_signals`, im Worker vor dem OpenAI-Aufruf geprüft (`ai-score.ts:79-92, 175-190`).
- Marketing-Einwilligung: stufenweise über Double-Opt-in der Zielseite, Bestätigung nur im Webhook (nicht im Portal gespeichert).

## 6. Geprüft und in Ordnung

- Entscheidung 3 (Mail an die Praxis ohne Patientendaten) im Code und in den Tests umgesetzt, `escapeHtml` auf alle Felder, Link nur UUID.
- Resend: keine `tags`/`metadata`, keine Anhänge, Idempotenzschlüssel ohne Klartext (nur Hash des Empfängers).
- Landing: `/api/track` nur PageView/Origin; Meta-Lead nur mit Einwilligung; RUM nur mit Statistik-Einwilligung; keine Behandlung in Tags; Portal-Relay schreibt keine Patientendaten ins Log.
- Speicherschlüssel ohne Namen; Abruf-Zeiten kurz; Lokal-Datei-Routen in Produktion gesperrt (WS3 B-29).
- `audit_log`-Diffs: meist Schlüsselwörter, Zähler, Ja/Nein.
- CSV-Export: Berechtigung, Audit, `no-store`, Formelschutz.
- Praxis-Löschung: Test `server/dsgvo.db.test.ts` laut WS7 grün (nicht erneut ausgeführt).

## Zusammenfassung

Anzahl: P0 0, P1 4, P2 8, P3 4 (16 Befunde, davon L-2 und Teile von L-8 in Dateien der anderen Sitzung).

Die drei dringendsten Punkte:
1. L-1: Patientenname, E-Mail und Wunschbehandlung stehen dauerhaft im `localStorage` (Suchverlauf/Anheftungen), ohne Nutzer-/Praxis-Schlüssel und ohne Löschung beim Abmelden oder bei "Als Nutzer ansehen".
2. L-3 und L-4: Die Datenbank-Sicherung (alle Patientendaten) liegt im selben R2-Bucket mit erratbarem Namen (P0, sobald `R2_PUBLIC_BASE` gesetzt wird), und es gibt außer dem Audit-Log keinerlei Aufbewahrungsfrist; Spam, Altanfragen und archivierte Praxen bleiben für immer.
3. L-2: Hochgeladene PVS-CSV-Dateien mit Patientenstamm und Rechnungen werden nach der Verarbeitung nie gelöscht.
