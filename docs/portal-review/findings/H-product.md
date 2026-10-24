# H-product: fehlende Funktionen (Produktlinse)

Methode: Vertrag und Garantie (KANON, Nachtrag 06.10., 06-garantie.md, north-star) gegen den Code geprüft. Seitenliste `src/app/(portal)` und `src/app/admin`, Tabellen in `src/db/schema.ts`, `src/lib/roles.ts`, Navigation in PortalShell und AdminShell. `portal_anleitung.md` liegt nicht im Repo-Root (nicht gefunden). Ranking je Befund: Wert für die erste echte Praxis gegen Aufwand (S/M/L).

## Abdeckungsmatrix Versprechen gegen Portal

| Versprechen | Stand |
|---|---|
| 90-Tage-Uhr, Verzug, Auslöser, Ende (intern) | umgesetzt (Admin Garantie-Uhr: `guarantee_clocks`, `guarantee_delays`, `guarantee_candidate_rejections`, `admin/garantie`) |
| 48-Werkstunden-Regel, Folge 1 bis 3 | umgesetzt (`lib/werkstunden.ts`, `lib/response-time.ts`, `response_enforcement_events`, `admin/rueckruf`, `ResponseFlagBadge`) |
| Herkunft je Anfrage, Messweg-Klassifikation | umgesetzt (`lib/sources.ts`, `requests.utm`), aber ohne Anruf- und Buchungs-Eingang (H-04) |
| Anfragen-Export bei Vertragsende | nur admin-seitiger DSGVO-JSON-Dump (H-09) |
| Freigabe jedes Beitrags (2 Werktage) | nicht im System (H-01) |
| Mitwirkung 3 Werktage, Verzugs-Mail | Checkliste vorhanden, aber Frist, Erinnerung und Mail nicht (H-02, H-03) |
| Sichtbarkeit "Tag X von 90" für die Praxis | bewusst unsichtbar (H-06) |
| Sofort-Benachrichtigung bei neuer Anfrage | nicht vorhanden (H-05) |
| Auswertung bis Umsatz, Kosten je Anfrage, Behandlungsmix | als Kanal-, Kampagnen-, Behandlungs-Aufschlüsselung da, pro Beitrag nicht (H-07) |
| Klon-Löschung 30 Tage nach Vertragsende | nirgends nachgehalten (H-10) |
| Erste Rechnung | kein Rechnungs- oder Auslöser-Datensatz über "bestätigt" hinaus (H-08) |

## Befunde

### H-01: Freigabe-Warteschlange für Beiträge fehlt (Versprechen "Kein Beitrag ohne Ihre Freigabe")
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/db/schema.ts` (Tabelle `assets` Zeile ca. 960 hat nur `kind`, `title`, `version`, keinen Status), `src/app/(portal)/medien/page.tsx`, `src/lib/roles.ts` (`assets.upload: []`), Suche nach "freigab/approv" liefert nur Texte und HWG-Formulare
- Beleg: Es gibt keine Tabelle und keine Seite für Beitrags-, Text- oder Anzeigen-Freigabe. `assets` kennt weder `draft`, `freigegeben` noch `geändert`. Das Portal zeigt unter "Medien" nur fertiges Material. KANON 6 sagt zwar "Freigaben laufen für die ersten 3 Kunden per E-Mail", aber dann existiert kein Zeitstempel im System.
- Szenario: Praxis 1 gibt Beiträge per E-Mail oder WhatsApp frei. Karam wertet 2 Werktage, Verzugstage und das dokumentierte "Freigabe-Gate in Textform" (Hauptvertrag § 8 Abs. 4, HWG-Sphärenmodell) aus Postfächern zusammen. Im Streit über Verzug (verlängert die 90 Tage) und über HWG-Kostenverteilung gibt es keinen Nachweis im Portal, obwohl § 7 Nachweis genau das verspricht.
- Fix-Vorschlag: Tabelle `post_approvals` (clinicId, assetId oder Text/Link, caption, `batchId`, `sentAt`, `dueAt` per `werkstunden`/Werktag-Rechnung, `decision` freigegeben/Änderung/offen, `decidedBy`, `decidedAt`, `changeNote`, `hwgNote`). Praxisseite `/freigaben` (zwei große Knöpfe "Freigeben" und "Änderung wünschen", ein Feld). Admin: Wochen-Charge anlegen, Verzug direkt aus überschrittenem `dueAt` ins `guarantee_delays` vorschlagen. Aufwand M. Vorübergehend (S): für Praxis 1 ein Eintrag je Charge in `guarantee_delays`/Audit mit dem E-Mail-Zeitstempel, damit der Nachweis wenigstens einheitlich im System steht.

### H-02: Mitwirkungsfrist (3 Werktage) wird nirgends gerechnet oder erinnert
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/checkliste/content.ts` (A5 "Klon-Aufnahme und Einwilligung geliefert", F5 Einwilligung KI-Abbild und Stimme, B1 bis B3 Zugänge), `src/app/(portal)/_components/ChecklistReminderBanner.tsx`, `src/app/admin/garantie/[clinicId]/page.tsx:341` ("Mitwirkung fällig am" ist ein Freitextdatum), `src/server/guarantee-clock.ts`
- Beleg: Die Checkliste kennt `offen/geliefert/geprueft/entfaellt` und Zeitstempel `deliveredAt`/`verifiedAt`. Die Garantie-Uhr kennt aber keine abgeleitete Fälligkeit "Unterschrift + 3 Werktage" und liest den Checklistenstand nicht. Ein Verzug entsteht nur, wenn Karam ihn von Hand in `guarantee_delays` erfasst. Der Banner zeigt nur eine Restzahl.
- Szenario: Unterschrift Montag. Am Donnerstag fehlt die Klon-Aufnahme. Niemand bekommt einen Hinweis, Karam muss es im Kopf haben. Mit 5 Praxen entgehen Verzugstage oder werden zu spät mitgeteilt (Verzug zählt nur nach E-Mail-Mitteilung, siehe H-03). Jeder nicht erfasste Tag ist ein Tag, an dem EINS die 90 Tage nicht verlängern kann.
- Fix-Vorschlag: In `src/server/guarantee-clock.ts` aus `signedOn` und den Checklisten-Items A5, F5, B1 bis B3 (Pflicht-Mitwirkung) eine Fälligkeit je Item ableiten (Werktage, Feiertage wie in `werkstunden.ts`). Anzeige in `admin/garantie` und `admin/operations` als "überfällig seit X, Verzug noch nicht mitgeteilt". Praxisseitig im Banner "fällig bis Donnerstag". Aufwand M. Tägliche Erinnerungs-Mail braucht den Worker (H-11), die reine Anzeige nicht.

### H-03: Keine Verzugs-Mitteilung im System, nur ein Datum "mitgeteilt am"
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:105,133,166,209` (`notifiedAtFrom(date)` setzt `notifiedAt` aus einem Datum), `src/db/schema.ts` Tabelle `guarantee_delays` (`reason`, `notifiedAt`, kein Empfänger, kein Text, keine Message-ID), `src/app/admin/rueckruf/actions.ts:5-12` ("Nothing is sent from here")
- Beleg: `notifiedAt` ist ein vom Admin eingetipptes Datum (Mitternacht), kein gesendeter oder protokollierter Mailtext. Dasselbe gilt für Warnung und Pause bei der Rückruf-Lage. Die Garantie verlangt: "Ein Verzug verlängert die Frist nur, wenn EINS ihn mitgeteilt hat", im Streitfall braucht es den Beweis von Empfänger, Zeitpunkt und Inhalt.
- Szenario: Eine Praxis bestreitet nach 100 Tagen die Verlängerung ("nie eine Mail bekommen"). Karam hat nur ein Datum im Admin. Der Mailtext liegt, wenn überhaupt, im eigenen Postfach. Mit Verzugsmitteilungen zu Klon, Freigabe, Zugängen und Rückruf-Warnungen sind das viele lose Fäden.
- Fix-Vorschlag: Aktion "Verzug per E-Mail mitteilen" in `admin/garantie/[clinicId]` und "Warnung senden" in `admin/rueckruf`: Vorlage mit fester Formulierung, Versand über `server/email.ts` an `defaultDoctorEmail` und Inhaber, Speichern von `to`, `subject`, `bodyText`, `sentAt`, Resend-ID in neuer Tabelle `clinic_notices` (kind: verzug, warnung_rueckruf, pause, fortsetzung, fristende) und Verknüpfung über `guarantee_delays.noticeId`. `notifiedAt` nur noch daraus ableiten. Der Versand aus der Server Action braucht keinen Worker (direkt senden). Aufwand M, Wert hoch, weil es die Fristverlängerung rechtlich trägt.

### H-04: Messwege Anruf und Buchung haben keinen Eingang
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/lib/sources.ts:119-123` (Kommentar: "reserved for the tracking-number and booking-link integrations"), `src/app/api/leads/intake/route.ts` (einziger Eingang), `src/app/api/webhooks/` (nur `meta/leadgen` und `resend`), keine Tabelle für Anrufe oder Tracking-Nummern
- Beleg: Die Garantie zählt drei EINS-Messwege. Im Code sind nur Formular (und Meta-Lead-Formular) angeschlossen. Es gibt keinen Webhook für eine Tracking-Nummer und keinen für den Buchungslink. Die Checkliste fragt "Nummer für die Anfragen-Übergabe" (E6), aber nichts ordnet einer Praxis eine Tracking-Nummer zu.
- Szenario: Eine ältere Patientin ruft die Tracking-Nummer an und bucht am Telefon. Das kommt nirgends im Portal an, also keine Anfrage, kein Auslöser der ersten Rechnung, und die Praxis sieht sie nicht. Für eine Zielgruppe 40 bis 65 Jahre ist der Anruf wahrscheinlich ein häufiger Weg. Die 90-Tage-Garantie läuft ohne diesen Weg schlechter für beide Seiten.
- Fix-Vorschlag: Minimal (S): Admin-Aktion und Praxis-Aktion "Anruf auf Tracking-Nummer erfassen" legt über `persistLead` eine Anfrage mit `source=tracking_anruf` an (Alias existiert schon). Dafür Feld `clinics.trackingNumber` und Anzeige. Danach (M): Webhook für Telefonanbieter (Anrufprotokoll, Anrufer-ID, Dauer) und Buchungslink-Webhook (Calendly oder Doctolib-Äquivalent). Die Schnittstellenwahl ist offen und gehört Karam (Architekturfrage), aber die manuelle Erfassung blockiert nichts.

### H-05: Keine Sofort-Benachrichtigung bei neuer Anfrage
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/api/leads/intake/route.ts:296-310` (nach dem Speichern nur Audit und `enqueueAiScore`), `src/worker/processors/` (kein `new-request-notify`), `src/server/email/templates/` (nur feedback-alert, retreatment-reminder, review-request), Tabelle `notifications` wird nur von sla-check, refresh-oauth und Anomalie-Regeln befüllt (alle Worker), kein `.tsx` liest `notifications`
- Beleg: Weder E-Mail noch Push noch SMS bei einer neuen Anfrage, weder an die Praxis noch an Karam. Die Glocken-API `/api/notifications` existiert, aber keine Komponente ruft sie auf. Einzige Praxis-Anzeige: "Neu"-Zähler in der Navigation, den man erst beim Öffnen des Portals sieht (`(portal)/layout.tsx:138`). Die Regel "48 Werkstunden" setzt voraus, dass die Praxis die Anfrage überhaupt bemerkt.
- Szenario: Eine Patientin füllt abends das Formular aus. Die Inhaberin öffnet das Portal erst am Mittwoch. Ablauf der 48 Werkstunden, "von der Praxis nicht beantwortet" in der Auswertung, und im Extremfall Anzeigenpause, obwohl die Praxis nie erfuhr, dass etwas da ist. Ohne Alarm verfehlt auch Karam die erste qualifizierte Anfrage (Rechnungsauslöser, H-08).
- Fix-Vorschlag: Direkt in `intake/route.ts` nach `status === "inserted"` per `after()` oder `await` eine E-Mail senden (kein Worker nötig): an `defaultDoctorEmail` und alle aktiven `inhaber` plus `frontdesk` mit Name, Behandlung, Telefon als `tel:`-Link, Deep-Link `/anfragen/<id>`, Betreff ohne Gesundheitsdaten ("Neue Anfrage über EINS"). Zweite Mail an Karam (Env `OPERATOR_EMAIL`) mit Praxisname und Messweg. Pro Nutzer abschaltbar (H-12). Aufwand S bis M. Höchster Wert pro Aufwand der ganzen Liste.

### H-06: Praxis sieht ihren Garantie-Stand nicht (Tag X von 90, erste Anfrage ja/nein)
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:20-24` ("the clock must stay invisible to it for now"), `src/app/(portal)/fortschritt/` (Journey-Schritte, keine Uhr), `src/app/(portal)/dashboard/page.tsx`
- Beleg: Die Uhr existiert nur im Admin, bewusst ohne Praxisansicht. Das Versprechen "Jede Anfrage mit Herkunft im Portal" und "Sie sehen sie selbst" ist für Anfragen erfüllt, für den Stand der Frist nicht. KANON 5: "Nachweis: Jede Anfrage steht mit Herkunft im Portal."
- Szenario: Inhaberin fragt am Tag 40, wo sie steht. Es gibt keine Stelle im Portal, die sagt: "Tag 40 von 90, Verzug: 0 Tage, erste qualifizierte Anfrage: noch nicht". Karam beantwortet per Telefon. Für Vertrauen bei Praxen, die schon Agenturen verbrannt haben (north-star), ist das die Nagelprobe. Sie ist auch der beste Hebel, damit die Praxis Mitwirkung (H-02) selbst erledigt.
- Fix-Vorschlag: Karte "Ihr Start" oben im Dashboard und in `/fortschritt`: Tag X von 90 (plus mitgeteilte Verzugstage, mit Link zur Mitteilung aus H-03), offene Mitwirkung mit Fälligkeit, Status "erste qualifizierte Anfrage: ja am Datum / noch nicht". Nur lesen, Daten aus `loadClockFacts`. Das ist eine Entscheidung von Karam (der Kommentar sagt "for now"), aber ohne diese Karte kann die Praxis die zugesagte Transparenz nicht prüfen. Aufwand S bis M. Copy: beide Grenzen ("erste qualifizierte Anfrage über EINS", "90 Tage") im selben Absatz, nie "garantiert".

### H-07: Auswertung nach Beitrag fehlt, "welcher Beitrag brachte Anfragen"
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/server/queries/attribution.ts` (nur `bySource`, `byChannel`, `byCampaign`, `byTreatment`, `byLocation`), `src/lib/sources.ts:111,229` (`post` aus `utm_content` wird berechnet), einzige Anzeige: `src/app/admin/garantie/[clinicId]/page.tsx:498`
- Beleg: Der Hebel von EINS ("organisch zuerst, dann Anzeigen hinter die Beiträge, die Anfragen bringen" und "Beiträge nach behandelten Patienten bewerten") braucht eine Rangliste je Beitrag. Es gibt keine Abfrage `byPost`, keine Beitrags-Tabelle (keine Stammdaten: Titel, Veröffentlichungsdatum, Kanal, Behandlung, Link), und die Praxis sieht `utm_content` nirgends. `byCampaign` deckt Anzeigen ab, nicht organische Beiträge.
- Szenario: Nach 6 Wochen soll EINS laut Vertrag ein Werbebudget "hinter welche Beiträge" vorschlagen (KANON 4, Ablauf). Karam müsste `requests.utm` von Hand auswerten. Die Praxis kann den Vorschlag nicht nachvollziehen und die monatliche Auswertung "welche Beiträge liefen, welche gestoppt wurden" (KANON 9) ist nicht belegbar.
- Fix-Vorschlag: Tabelle `posts` (clinicId, `utmContent` als Schlüssel, title, channel, treatmentId, publishedAt, stoppedAt, url), Abfrage `byPost` in `attribution.ts` (Anfragen, qualifiziert, Termine, gewonnen, Umsatz je `utm_content`), Karte "Ihre Beiträge" im Dashboard-Detail und im Monatsbericht. Verknüpfung mit H-01 (jede Freigabe erzeugt den Beitrag samt `utm_content`). Aufwand M.

### H-08: Auslöser der ersten Rechnung ohne Folge (keine Benachrichtigung, kein Rechnungsdatensatz)
- Schwere: P1
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/db/schema.ts` `guarantee_clocks` (`qualifyingRequestId`, `qualifyingConfirmedAt`), `src/app/admin/garantie/actions.ts` (Bestätigen), `src/app/admin/operations/page.tsx` und `src/server/queries/admin.ts:1182` (`PendingOperations`: sla, animations, syncErrors, stalledRequests, kein "Kandidat für erste Rechnung")
- Beleg: Der Admin kann eine erste qualifizierte Anfrage bestätigen. Aber: es gibt keinen Hinweis an Karam, dass ein Kandidat wartet, keinen Abrechnungsstart-Tag (`billingStartsOn`, erster bezahlter Leistungsmonat), keinen Rechnungs-/Zahlungsstatus und keine Fälligkeitsübersicht. Auch fehlt eine Vorlage der Werbebudget-Empfehlung, die laut Ablauf mit der ersten Rechnung kommt.
- Szenario: Die erste Anfrage kommt nachts an einem Freitag. Karam bemerkt es am Dienstag, die Rechnung geht später raus, Cashflow verschiebt sich (der Bargeld-Puffer für die ersten 3 Kunden ist laut Garantie-Seite unbeziffert). Umgekehrt kann eine Anfrage, die später als Spam gilt, schon als "Auslöser" gelten, ohne dass etwas die Prüfung erzwingt. Dass der Auslöser einmalig und nachvollziehbar ist, ist der Kern der Garantie.
- Fix-Vorschlag: In `guarantee_clocks` Felder `billingStartsOn`, `firstInvoiceSentOn`, `firstInvoicePaidOn`. Operations-Zeile "Erste Anfrage zu prüfen" (unbestätigte, nicht abgelehnte Anfrage über Messweg, Berlin-Datum), plus Karam-Mail bei Eingang (H-05). Aktion "Rechnung als gesendet markieren". Keine Rechnungserstellung im Portal nötig (Karam rechnet extern, Aufwand S). "Material gehört Ihnen" ab `firstInvoicePaidOn` kann daran hängen (H-09).

### H-09: Material- und Anfragen-Export für die Praxis fehlt
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/clinics/[id]/dsgvo/page.tsx:73` (JSON-Export nur im Admin, `src/server/dsgvo.ts:44 exportClinicData`), `src/app/(portal)/medien/page.tsx` (nur einzelne Dateien), `src/lib/roles.ts` (`assets.download` vorhanden, aber nur je Datei), keine CSV- oder ZIP-Funktion für die Praxis
- Beleg: KANON 7: "Anfragedaten gibt es als Export bei Vertragsende" und "dürfen alles dauerhaft nutzen". Der Export ist ein JSON-Dump über alle Tabellen (Datenauskunft Art. 15), nicht lesbar für eine Praxis und nur von Karam auslösbar. Sammel-Download aller Medien fehlt. Eine Praxis, die nach Fristende (ohne Anfrage) geht, bekommt so nichts Praktisches.
- Szenario: Praxis kündigt am Tag 91. Karam muss JSON von Hand erzeugen, Dateien einzeln aus R2 ziehen und per Link schicken. Bei 5 Praxen und Zeitdruck wird der Export vergessen oder unvollständig, ein Vertragsverstoß.
- Fix-Vorschlag: (1) CSV "Anfragen exportieren" in `/anfragen` für `inhaber` (Name, Kontakt, Behandlung, Messweg, Beitrag, Status, Datum). Aufwand S. (2) Seite "Vertragsende" oder Admin-Aktion "Abschlusspaket": ZIP aus `assets`, `clientUploads` und dem Anfragen-CSV über presigned Links. Aufwand M. (3) Das Klon-Modell und EINS-Vorlagen gehören nicht dazu, das hält die Vorlage fest.

### H-10: Beenden, Einwilligungs-Widerruf und Klon-Löschung ohne Nachhalten
- Schwere: P2
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/db/schema.ts` `guarantee_clocks.manualEndState` (nur `beendet_durch_praxis`, `beendet_plattform_stoerung`, mit `manualEndOn`/`Note`), keine Felder für Klon-Löschfrist, Widerruf der Einwilligung, Einwilligungsdatum
- Beleg: Beenden vor der ersten Rechnung ist erfasst (Datum, Notiz), das automatische Ende nach Fristablauf nicht als eigener Zustand, und es gibt kein Datum "Klon-Modell löschen bis (Ende + 30 Tage)", keinen Stopp-Schalter "Einwilligung widerrufen, alle Klon-Beiträge sofort stoppen" und keinen Nachweis, dass gelöscht wurde. Einwilligung (F5) ist nur eine Checklistenzeile.
- Szenario: Eine Praxis widerruft die Einwilligung. Vertraglich muss EINS sofort stoppen und löschen. Nichts im Portal erinnert Karam, nichts belegt später die Löschung binnen 30 Tagen (Datenschutzvorfall und HWG-Streit hängen daran).
- Fix-Vorschlag: In `guarantee_clocks` oder neuer Tabelle `clone_lifecycle` Felder `consentSignedOn`, `consentRevokedOn`, `contractEndedOn`, `cloneDeleteDueOn` (Ende + 30 Tage, berechnet), `cloneDeletedOn`, `deletedBy`. Zeile in Admin-Operations "Klon-Löschung fällig in X Tagen". Der Zustand "Ende nach Fristablauf" bei Tag 90 plus Verzug wird automatisch angezeigt, nicht nur manuell. Aufwand S.

### H-11: Alles, was Erinnerung heißt, hängt am Worker (Folgen bei Worker 0)
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/worker/schedules.ts:35-57` (Cron: slaCheck, reviewRequestTick, anomalyScan, retreatmentReminderTick, monthlyReport), `src/worker/processors/sla-check.ts` (einzige Praxis-Benachrichtigung bei Fristüberschreitung), `src/app/api/leads/intake/route.ts:303-310` (AI-Score nur über Queue), keine anderen Auslöser
- Beleg (Folgen, bewusst entschieden, aber nutzersichtbar): Solange der Worker auf 0 steht, laufen nicht: KI-Score der Anfragen (Spalten leer, "KI-Score bleibt getrennt" ändert den Auslöser nicht), SLA-Hinweis, Anomalie-Warnungen im Dashboard, Bewertungsanfrage-Mails und Wiederbehandlungs-Erinnerungen, Monatsbericht-PDF, Umsatz-Abgleich und alle Sync-Jobs für Meta und Google (Werbebudget-Seite bleibt leer). Das Versprechen "Auswertung monatlich im Portal" und "Bewertungsanfragen, Nachfassen" ist damit ohne Worker nicht erfüllt.
- Szenario: Die erste Praxis startet, Anzeigen laufen noch nicht. Es kommt die erste Anfrage, aber ohne Worker: kein Score, kein Hinweis, keine Mail. Die Praxis sieht eine unscharfe Liste, und Karam bemerkt nicht, was fehlt.
- Fix-Vorschlag: Vor dem Start der ersten Praxis den Worker auf 1 setzen (Betriebsentscheidung, nicht Code). Zusätzlich die zwei einfachsten Pfade ohne Queue lösen: neue-Anfrage-Mail direkt im Request (H-05), Verzugs- und Warnmails direkt aus Server Actions (H-03). Admin-Seite "Systemstatus" zeigt, welche Cron-Jobs zuletzt gelaufen sind (H-13).

### H-12: Kein "Was ist heute zu tun" für die Praxis, keine Benachrichtigungseinstellungen
- Schwere: P1
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/app/(portal)/dashboard/page.tsx:174` (`dueFollowups` nur als Kachel), `src/app/(portal)/anfragen/page.tsx`, `src/app/(portal)/einstellungen/page.tsx` (Profil, Team, Verbindungen, keine Benachrichtigungswahl), `src/server/queries/followups.ts`
- Beleg: Das Dashboard zeigt Kennzahlen und fällige Nachfass-Termine, aber keine einzelne Aufgabenliste: neue Anfragen mit Restzeit bis 48 Werkstunden, heute fällige Rückrufe, Beiträge zur Freigabe, offene Checklisten. Es gibt keine Auswahl, welche Rolle welche Mail bekommt (z. B. Inhaberin nur "Beiträge zur Freigabe", Empfang "neue Anfragen und Rückrufe").
- Szenario: Eine Inhaberin (55) zwischen zwei Patienten am Handy öffnet das Portal und sieht Diagramme. Sie braucht eine Zeile: "2 Anfragen warten, 1 Beitrag zur Freigabe". Der Empfang bekommt mit Standardeinstellung Mails, die nur die Inhaberin betreffen, oder gar keine.
- Fix-Vorschlag: Oberste Karte "Heute" im Dashboard aus bestehenden Abfragen (Anfragen `neu` mit Restzeit aus `response-time`, `dueFollowups`, Freigaben aus H-01, `ChecklistReminderBanner`). Tabelle `notification_prefs` (userId, kind, email bool) und Seite unter Einstellungen mit 4 Schaltern. Aufwand M. Der Funktionsumfang bleibt klein: keine Push-App.

### H-13: Kein Integrations- und Systemstatus für Karam mit mehreren Praxen
- Schwere: P2
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/app/admin/integrations/page.tsx`, `src/app/admin/operations/page.tsx`, `src/server/queries/admin.ts:1182` (`syncErrors` ist die einzige Fehlerzahl), `src/worker/processors/pvs-agent-health-scan.ts`, `/api/health`
- Beleg: Es gibt Fehler je Sync, PVS-Agent-Gesundheit und eine Health-Route. Es gibt keine eine Seite: "Praxis A: Meta-Token läuft in 5 Tagen ab, Meta-Lead-Webhook letzte Anfrage vor 12 Tagen, Worker zuletzt gelaufen vor 2 Stunden, Tracking-Nummer ohne Anruf seit 30 Tagen". Der Eingang der Messwege (Formular, Webhook) wird nicht auf Stille überwacht.
- Szenario: Das Formular einer Zielseite bricht still (Fehler in der Praxis-Domain). Anfragen gehen verloren, keiner merkt es, die 90 Tage laufen. "Messwege betreiben" ist eine vertragliche Pflicht von EINS (Pflichten-Tabelle).
- Fix-Vorschlag: Admin-Ansicht "Messwege" je Praxis: Zeitpunkt der letzten Anfrage je Messweg, Testanfrage-Knopf (legt Anfrage mit Flag `isTest` an und löscht sie wieder), Warnung "keine Anfrage seit N Tagen trotz laufender Beiträge". Aufwand M. Benötigt das Ende von H-04 für Anruf und Buchung.

### H-14: Keine Teamnotizen- oder Zuweisungs-Oberfläche für den Empfang
- Schwere: P2
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/db/schema.ts` `requests.assignedTo` (Spalte vorhanden), `src/app/(portal)/anfragen/` (Suche nach `assignedTo` ohne Treffer in der UI), `src/app/(portal)/anfragen/[id]/actions.ts` (`addNote`, `logCall`, `scheduleFollowup`, `changeStatus` vorhanden)
- Beleg: Notizen, Anrufprotokoll, Nachfass-Termine und Status sind vorhanden. Eine Zuweisung "Wer ruft zurück" existiert in der Datenbank, ist in `/anfragen` aber nirgends bedienbar oder filterbar. Es gibt keine Ansicht "Meine Anfragen".
- Szenario: Zwei Empfangskräfte sehen dieselbe Liste und rufen eine Anfrage doppelt an, oder keine tut es, weil jede denkt, die andere macht es. Bei einer 48-Werkstunden-Regel mit Folgen ist das ein echtes Risiko.
- Fix-Vorschlag: Zuweisungs-Auswahl (`assignedTo`) auf Listen- und Detailseite, Filter "Mir zugewiesen", Hinweis in der Zeile. Aufwand S.

### H-15: Weiterleitung nach Preis (niedrig zur Online-Buchung, hoch zum Team am Telefon) hat keine Umsetzung im Portal
- Schwere: P2
- Art: missing-feature
- Sicherheit: mittel
- Ort: `src/worker/processors/treatment-tiers.ts` (Behandlungsstufen vorhanden), `src/app/(portal)/einstellungen/integrationen/links/page.tsx`, `src/lib/sources.ts` (Buchungslink-Messweg ohne Eingang, H-04), `src/server/queries/requests.ts`
- Beleg: Die Preisstufe wird im Worker bestimmt, aber im Portal gibt es keine Regel "Stufe niedrig: Buchungslink an Patientin senden" und "Stufe hoch: Anruf durch das Team, priorisiert". Das Anfragenbild zeigt Score und Status, nicht die Route. Hinweis: Teil des Versprechens in Ebene 3 (KANON 3).
- Szenario: Eine Anfrage für Botox (niedrig) landet in derselben Warteschlange wie ein Facelift (hoch). Der Empfang weiß nicht, dass der erste Fall über den Buchungslink erledigt wäre und der zweite sofort ein Telefonat braucht.
- Fix-Vorschlag: Spalte "Weg" in der Anfragenliste (Telefon / Buchungslink senden) aus der Behandlungsstufe, Aktionsknopf "Buchungslink per E-Mail oder WhatsApp senden" (Vorlage mit `calendly`/Buchungs-URL aus `clinics`). Aufwand M. Erst nach H-04, weil die Buchung sonst nicht zurückfließt.

### H-16: Schreibe-Rolle Marketing ohne Aufgabe, Rollenmodell passt nicht zum Betrieb
- Schwere: P3
- Art: missing-feature
- Sicherheit: niedrig
- Ort: `src/lib/roles.ts` (Rollen `inhaber`, `marketing`, `frontdesk`, fast alle Rechte für alle drei)
- Beleg: Für eine Praxis mit 1 bis 5 Behandlern gibt es in der Regel nur Inhaber und Empfang. Es gibt kein Recht "darf Freigaben erteilen" (Inhaber:in oder ärztliche Leitung) getrennt vom Rest. Sobald H-01 gebaut ist, darf `frontdesk` Beiträge nicht freigeben, weil die Verantwortung beim Arzt liegt (HWG-Gate).
- Szenario: Die Empfangskraft klickt "Freigeben" auf einen Beitrag mit Aussage, die der Arzt nicht gesehen hat. Im HWG-Streit zählt die Freigabe als Entscheidung der Praxis (§ 8 Abs. 4 Sphärenmodell).
- Fix-Vorschlag: Neues Recht `posts.approve: ["inhaber"]` in `roles.ts` und in H-01 an dieses Recht binden. Aufwand S, gemeinsam mit H-01 umzusetzen.

## Rangfolge (Wert für die erste Praxis gegen Aufwand)

| Rang | ID | Titel | Aufwand | Warum jetzt |
|---|---|---|---|---|
| 1 | H-05 | Mail bei neuer Anfrage (Praxis und Karam) | S bis M | Ohne sie läuft die 48-Werkstunden-Regel gegen die Praxis, und Karam verpasst den Rechnungsauslöser |
| 2 | H-03 | Verzugs- und Warnmail im System versenden und protokollieren | M | Fristverlängerung gilt nur mit Mitteilung, Beweislage heute ein eingetipptes Datum |
| 3 | H-01 + H-16 | Freigabe-Warteschlange mit Rolle | M | Kern des Versprechens "Kein Beitrag ohne Ihre Freigabe", Nachweis für Verzug und HWG |
| 4 | H-06 | Stand "Tag X von 90" für die Praxis | S bis M | Vertrauen, steuert die Mitwirkung |
| 5 | H-02 | Fälligkeit der Mitwirkung aus Checkliste ableiten | M | Verzugstage gehen sonst verloren |
| 6 | H-08 | Auslöser erste Rechnung: Hinweis, Abrechnungsstart | S | Cashflow, einmalige und nachvollziehbare Auslösung |
| 7 | H-04 | Anruf und Buchung als Messweg erfassen | S manuell, M Webhook | Zwei von drei Messwegen sonst ohne Eingang |
| 8 | H-09 | CSV-Export Anfragen und Abschlusspaket | S, dann M | Vertragsversprechen bei Ende |
| 9 | H-07 | Auswertung je Beitrag | M | Kern des Produkts (organisch zuerst, Werbebudget dahinter), erst nach den ersten Anfragen nötig |
| 10 | H-12, H-14 | "Heute"-Liste, Benachrichtigungswahl, Zuweisung | M, S | Alltag von Inhaberin und Empfang ab Woche 2 |
| 11 | H-11 | Worker auf 1 vor Start | Betrieb | Ohne Worker fehlen Score, SLA-Hinweis, Monatsbericht, Syncs |
| 12 | H-10, H-13, H-15 | Klon-Löschfrist, Messweg-Überwachung, Weiterleitung nach Preisstufe | S, M, M | Wichtig, aber erst ab Monat 2 bis 3 |

## Bewusst nicht gemeldet

SEO, einzeln verkaufte Leistungen, zugesagte Zahlen, TOTP, Rechnungs-Erzeugung im Portal (Karam rechnet extern), Chat mit der Praxis (Feedback-Seite und "Dateien an EINS" decken Rückkanal ab), Push-App (E-Mail genügt in Monat 1).

## Design-Kritik (nur Kritik)

- Die Seitenleiste führt 20 Menüpunkte für eine Praxis am ersten Tag (Übersicht, Fortschritt, Anfragen, Wiederbehandlungen, Werbebudget, Bewertungen, Medien, Dokumente, Dateien, Leitfaden, FAQ, Feedback, Einstellungen). Für eine Inhaberin zwischen zwei Patienten zählt am Handy nur "Anfragen" und, nach H-01, "Freigaben". Hinweis nur zur Hierarchie, nicht ändern.
- Wiederbehandlungen und Werbebudget sind in Monat 1 leer (keine PVS, kein Werbebudget). Diese Punkte sollten im Leerzustand erklären, wann sie sich füllen, statt leer zu wirken.

## Zusammenfassung

Anzahl: P0 0, P1 11 (H-01 bis H-09, H-11, H-12), P2 4 (H-10, H-13, H-14, H-15), P3 1 (H-16).

Die 3 dringendsten Punkte:
1. H-05: Es gibt keine Mail an die Praxis und an Karam bei neuer Anfrage, daher läuft die 48-Werkstunden-Regel ungeschützt und der Rechnungsauslöser kann unbemerkt bleiben.
2. H-03: Verzug und Warnung werden nur als eingetipptes Datum "mitgeteilt" erfasst, nicht als gesendeter und protokollierter Text, was die Fristverlängerung im Streitfall nicht trägt.
3. H-01: Eine Freigabe-Warteschlange für Beiträge mit Zeitstempel fehlt, sie ist die Grundlage für "Kein Beitrag ohne Ihre Freigabe", für Verzug bei Freigaben und für den HWG-Nachweis.
