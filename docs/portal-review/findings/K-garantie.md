# K-garantie: Garantie-Logik gegen die geschriebenen Bedingungen

Prüfer: Spezifikations-Review, nur lesen. Stand des Baums: 07.10.2026, unbestätigt, andere Sitzungen schreiben noch.

Quellen: `docs/umbau-ki-organisch/KANON.md` (Abschnitte 5, 6, 6a, 7, 11), `north-star.md`, `06-garantie.md` (Spiegel). Zusätzlich gelesen, weil es der geltende Vertragswortlaut ist: `D:\Desktop\EINS Dokumente\Verträge\Final\EINS-Garantie-Anhang-v2.1.docx` (zitiert als "Anhang") und `EINS_Hauptdienstleistungsvertrag_v1.4.docx` (zitiert als "Hauptvertrag"). Wo Anhang und KANON denselben Satz haben, steht er nur einmal.

Gelesene Fix-Logs: WS1 (C-5/C-6/H-08 Eingang + Kandidatenmail), WS2 (C-14 bleibt, C-17, C-29), WS7 (G-09, G-16, G-21, H-03, H-08, G-12). Ausgeführt: `npx vitest run` auf `lib/guarantee-clock`, `lib/werkstunden`, `lib/response-time`, `lib/sources`, `server/guarantee-clock`, `server/queries/response-time`: 6 Dateien, 94 Tests, alle grün. Eigene Probeläufe (Wegwerf-Test, wieder gelöscht) für DST und Randtage sind unten eingearbeitet.

Rechtsrisiken sind je einmal benannt (K-1, K-8), mit Sicherheit und konkretem Fix, ohne Verweis auf Dritte.

## Konformitätstabelle (korrekt umgesetzt, kein Befund)

| Regel | Beleg |
|---|---|
| 90 Kalendertage, Unterschriftstag = Tag 0, letzter Tag zählt noch | `lib/guarantee-clock.ts:160` (`signedDay + 90`), `:248` (`asOfDay > deadlineDay` beendet erst am Tag danach), `:285` (Anfrage am Fristtag bestätigbar). Probelauf: signiert 2026-07-27 gibt Frist 2026-10-25 |
| Berliner Kalendertage, nicht UTC | `berlinDate` über `Intl` mit `timeZone: "Europe/Berlin"` (`:53-63`), `todayBerlin()` (`server/guarantee-clock.ts:28`), Anfragedatum über `berlinDate(createdAt)` (`:322`). Probe: 2026-10-24T22:30Z gibt 25.10., 2026-10-25T23:30Z gibt 26.10. |
| Sommer-/Winterzeit verschiebt das Fristende nicht | Reine Tageszahl-Arithmetik auf UTC-Mitternacht (`:41-51`), keine Stundenrechnung. 25.10.2026 ist als Fristtag unkritisch |
| Verzug zählt erst nach E-Mail-Mitteilung | `delayCounts` (`:97-99`), `normalizeRanges` verwirft nicht Mitgeteiltes (`:124`); Test `guarantee-clock.test.ts:125` |
| Verzugstage ab Tag nach Mitwirkungsfrist bis Erfüllungstag einschließlich, Überlappungen einmal | `verzugRange` (`:106-113`), `normalizeRanges` (`:121-140`) |
| Verzug/Störung nachträglich änderbar und im Audit | `closeDelayAction`, `markDelayNotifiedAction`, `removeDelayAction` schreiben Vorher/Nachher bzw. den ganzen entfernten Eintrag in derselben Transaktion (`garantie/actions.ts:254-264, 272-287, 295-310`) |
| Messweg nur über `source`, nie UTM/Selbstauskunft/KI-Score | `lib/sources.ts:225-261`; `lib/guarantee-clock.ts` und `server/guarantee-clock.ts` referenzieren kein `ai_*`-Feld |
| Meta-Sofortformular, manuell, PVS-Import, WhatsApp, Selbstauskunft, Unbekannt lösen nicht aus | `sources.ts:241-260`, Anhang § 2 Abs. (3) deckt sich |
| Doppelte Bestätigung / zwei Tabs | `UPDATE ... WHERE qualifying_inquiry_on IS NULL` (`actions.ts:355-362`), PK `clinic_id` (`0075:29`) |
| Bestätigung bleibt, auch wenn die Anfrage später gelöscht wird | `qualifying_inquiry_on` eingefroren, FK `ON DELETE SET NULL` (`0075:35-38`) |
| Aufheben der Bestätigung nach Rechnungsversand gesperrt | `actions.ts:379-382` |
| Abgelehnte Anfrage bleibt abgelehnt, Doppelklick audit-frei | `actions.ts:460-472`, Unique-Index `0075:117` |
| Werkstunden Mo bis Fr 9 bis 18, Beginn außerhalb = nächste Werkstunde, Frist exakt 18:00 bleibt am Tag | `werkstunden.ts:220-239`; Vertragsbeispiel (Mo 10:00 gibt Mo 13:00) getestet (`werkstunden.test.ts:64`). Probe: Fr 23.10.2026 12:00 MESZ plus 48 Werkstunden gibt Fr 30.10. 15:00 MEZ |
| Werkstunden rechnen auf Berliner Wandzeit, DST wirkt nicht | `werkstunden.ts:19-24, 53-74`; Test `werkstunden.test.ts:110` |
| Werktag (Folge 3) = Mo bis Fr ohne bundesweite und NRW-Feiertage, Sitz Köln | `werkstunden.ts:205-209`; Anhang § 2 und Hauptvertrag-Kopf (Köln) stimmen |
| Folge 1 (Einwand fehlender Echtheit/Erreichbarkeit ausgeschlossen), Spam/Duplikat/Bewerbung bleiben immer ablehnbar, Kontaktdaten-Pflicht bleibt | `lib/guarantee-clock.ts:386-407`, Aufruf mit `new Date()` (`actions.ts:442-448`); Nachweis-Ausnahme `otherProof` mit Pflichtnotiz (`:439-441`) |
| Folge 2 (gesondert "nicht beantwortet"/"zu spät", Spam raus, Vorregel-Anfragen ausgenommen) | `lib/response-time.ts:70-92, 110-134`, `RESPONSE_RULE_START` = 06.10.2026 00:00 Berlin (`:24`, 22:00Z korrekt für MESZ) |
| Folge 3 (>= 3 gleichzeitig, Warnung, Ende nächster Werktag, Pause nur wenn dann und jetzt noch >= 3, Fortsetzung sobald Schnappschuss-Anfragen kontaktiert) | `lib/response-time.ts:216-283`, `rueckruf/actions.ts:65-88` mit Advisory-Lock; Tests `response-time.test.ts:121-225` |
| Kontaktversuch: Anruf (jedes Ergebnis), Status außer Spam/Verloren/Neu, PVS-Buchung, Buchungslink-Quelle; Zeitpunkt = Vermerk im Portal | `server/queries/response-time.ts:57-74` |
| KI-Score nirgends als Gate | `grep ai_` in Garantie-Dateien: keine Treffer |
| Copy: beide Grenzen im selben Absatz, "dauerhaft nutzen", kein "garantieren", kein "Urheberrecht" | `faq/content.ts:436, 622, 652, 658, 340`, `onboarding/checkliste/content.ts:785`; keine Treffer für "wir garantieren", "Urheberrecht", "Klinik" in den Praxis-Texten |
| Werbebudget trägt keine Garantie | `faq/content.ts:646`; im Code nirgends modelliert (korrekt, es gibt nichts zu erzwingen) |

## Befunde

### K-1: Eine Verzugs-Mitteilung nach Fristende belebt die abgelaufene Uhr und rechnet rückwirkend
- Schwere: P1
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/lib/guarantee-clock.ts:97-99, 121-140, 154-173`; Test, der es festschreibt: `src/lib/guarantee-clock.test.ts:189` ("revives when a delay inside the window is entered after the deadline passed"); Migration-Kommentar `0075_guarantee_clock.sql:17-19`; Aktionen `garantie/actions.ts:268-289` (beliebiges Mitteilungsdatum)
- Beleg: `delayCounts` verlangt nur `notifiedOn <= asOf`. `computeDeadline` wertet die Verzugsspanne dann komplett ab ihrem Beginn (`from`), nicht ab dem Mitteilungstag. Es gibt keine Prüfung, ob die Mitteilung vor dem (bis dahin bekannten) Fristende ging. Probelauf: signiert 2026-01-05, Verzug 09.01. bis 20.01., mitgeteilt erst 2026-04-10 (fünf Tage nach dem Fristende am 05.04.): Status wechselt von `beendet_ohne_anfrage` auf `laeuft`, Frist 2026-04-17. `checkConfirmable` nimmt dann auch Anfragen vom 06. bis 17.04. an.
- Szenario: Die Praxis hat in Woche 1 die Klon-Aufnahme nicht geliefert, EINS schreibt nichts. Tag 91 ist vorbei, keine Anfrage. Karam trägt am Tag 95 den Verzug ein und sendet die Mitteilung. Die Uhr läuft wieder, eine Anfrage vom Tag 93 wird als erste qualifizierte bestätigt, die erste Rechnung (1.900 € netto) ist "fällig". Anhang § 3 Abs. (2) sagt nur "nur, wenn EINS ihn mitgeteilt hat", § 2 "Verzugstag zählt nur, wenn mitgeteilt"; `06-garantie.md` ("Pflichten der Praxis") sagt ausdrücklich, EINS teile Verzug mit, "sobald er entsteht", und dürfe ihn nicht "stillschweigend sammeln und am Fristende geltend machen". Der Code erlaubt genau das. Rechtsrisiko (Transparenz/Treu und Glauben, § 307 BGB): ich halte es zu etwa 65 % für angreifbar, wenn der Streit genau diesen Fall trifft, weil die Praxis bis zur Mitteilung in Tag 95 davon ausgehen durfte, dass die Zusammenarbeit ohne Kosten endete.
- Fix-Vorschlag: In `computeDeadline` die Spannen nach `notifiedOn` aufsteigend verarbeiten: eine Spanne zählt nur, wenn `notifiedOn <= deadline` in dem Stand, der sich aus den früher mitgeteilten Spannen ergibt (Fristende am Mitteilungstag zählt noch). `normalizeRanges` entsprechend erweitern, Test 189 umdrehen. Zusätzlich in `addVerzugAction`/`markDelayNotifiedAction` eine deutsche Fehlermeldung, wenn die Mitteilung nach dem aktuellen Fristende liegt ("Mitteilung nach Fristende zählt nicht mehr"). Frühwarnung: Tag-14-Hinweis in `adminAttentionCounts` auch für offene, nicht mitgeteilte Mitwirkungen ableiten (siehe K-6).

### K-2: "Bestätigen" prüft weder Kontaktdaten noch Spam-Status, noch ob es die zeitlich erste ist
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch (Lücke im Code), mittel (Auswirkung, weil Karam als Mensch davor sitzt)
- Ort: `src/lib/guarantee-clock.ts:313-331` (`eligibleInquiries`), `src/app/admin/garantie/actions.ts:318-372` (`confirmInquiryAction`), `src/app/admin/garantie/[clinicId]/page.tsx:565-600`
- Beleg: `eligibleInquiries` filtert nur auf Fenster, abgelehnt und Messweg. `InquirySummary` trägt `status`, `contactEmail`, `contactPhone` (`server/guarantee-clock.ts:60-87`), nichts davon wird geprüft. `confirmInquiryAction` prüft Uhr, Messweg, Fenster, nicht abgelehnt. Anhang § 2 Abs. (1): qualifiziert braucht Telefon oder E-Mail; "erste qualifizierte Anfrage" ist die zeitlich erste. Intake lässt beide Kontaktfelder leer zu (`api/leads/intake/route.ts`, `contactEmail`/`contactPhone` optional, `hasPhone: z.boolean()`).
- Szenario: (a) Eine Anfrage ohne Telefon und E-Mail ist die früheste im Fenster, steht als Kandidat [0] und lässt sich mit einem Klick (plus Rückfrage) bestätigen. Die Seite zeigt nur den Hinweis "Keine Kontaktdaten" (`page.tsx:595-598`). (b) Die Praxis hat die Anfrage selbst auf "Spam" gesetzt (`neu` zu `spam` erlaubt, `constants.ts:67`); sie bleibt Kandidat und bestätigbar, obwohl Folge 2 Spam ausnimmt. (c) Karam bestätigt eine spätere Anfrage, während eine frühere gültige offen ist: Der Rechnungsbeginn ("Am Tag dieses Eingangs") wird zu spät gesetzt, ohne Warnung.
- Fix-Vorschlag: `confirmInquiryAction` verweigert mit deutscher Meldung bei: keine Telefon/E-Mail (nach `trim`), `status === "spam"` (Hinweis "Praxis hat als Spam markiert, erst prüfen und ggf. ablehnen"), vorhandener früherer nicht abgelehnter Kandidat (außer Karam bestätigt ausdrücklich per Checkbox "frühere übersprungen" mit Pflichtnotiz im Audit). `eligibleInquiries` setzt `hasContactData` und `isSpamMarked` im Ergebnis, damit die Seite sie als Spalte zeigt und die Kandidatenmail (`request-notify.ts:246`) Kandidaten ohne Kontaktdaten nicht als "Erste Anfrage prüfen" meldet.

### K-3: Testanfragen und Anfragen vor der Unterschrift zählen als Kandidat und als "nicht beantwortet"
- Schwere: P1
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/lib/guarantee-clock.ts:317-324` (Fenster ab Datum der Unterschrift, nicht ab Uhrzeit), `src/lib/response-time.ts:74` und `src/server/response-enforcement.ts:53-60` (Regelstart global ab 06.10., nicht ab Unterschrift der Praxis), `src/lib/guarantee-clock.ts:348-363` (kein Grund "Test")
- Beleg: Die Praxis ist erst ab Vertragsschluss zur Antwortzeit verpflichtet (Hauptvertrag § 5 Abs. (4), Anhang § 6 Abs. (4): "jede Anfrage, die über EINS im Portal eingeht" nach Vertragsschluss). Der Code kennt für Folge 2/3 kein Unterschriftsdatum, nur `RESPONSE_RULE_START`. Der Zielseiten-Test beim Onboarding (Formular mit `source=formular`) ist technisch eine echte Anfrage. Es gibt keinen Admin-Weg, eine Anfrage als Test/Spam zu markieren (Statusänderung ist Sache der Praxis), und die Ablehnungsgründe (`REJECTION_REASONS`) kennen keinen Testeintrag.
- Szenario: Karam und die Praxis testen die Zielseite am Tag der Unterschrift oder vorher (3 Testanfragen). (a) Die erste Testanfrage ist Kandidat [0], löst die Mail "Erste Anfrage prüfen" aus; nur "Spam oder automatisierte Eingabe" passt als Ablehnungsgrund, obwohl es faktisch ein Test ist. (b) Alle drei Tests stehen nach 48 Werkstunden in der Praxis-Auswertung als "von der Praxis nicht beantwortet", und ab drei Stück gilt die Praxis als warnungsfähig (`canWarn`), also Anzeigen-Pause möglich für Anfragen, die nie jemand beantworten konnte. Zusätzlich zählt eine Anfrage am Unterschriftstag vor der Uhrzeit der Unterschrift ins Fenster (`day < from` prüft nur das Datum; Test `guarantee-clock.test.ts:219` verlangt das ausdrücklich), obwohl Anhang § 2 "nach Vertragsschluss" sagt.
- Fix-Vorschlag: (1) `deadlineRows`, `responseInfo`/`attemptInfo` und die Monatsauswertung blenden Anfragen vor `guarantee_clocks.signed_on` (Berliner Mitternacht) aus. (2) Ablehnungsgrund `test_eintrag` ("Test der EINS-Seite, keine echte Person") in `REJECTION_REASONS` und Migration `guarantee_rejections_reason_check`; er zählt wie Spam nicht in Folge 2/3, wenn die abgelehnte Anfrage ein Test ist (Admin-Aktion "Als Test markieren" setzt `status = 'spam'` im Auftrag, mit Audit). (3) Zusätzlich im Kandidatenfenster Anfragen am Unterschriftstag mit Hinweis "Uhrzeit der Unterschrift prüfen" markieren.

### K-4: Messweg "Anruf" und "Buchung" haben in der ganzen Codebasis keinen Erzeuger
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/lib/sources.ts:117-123` (Kommentar: "No producer writes the anruf/buchung values yet"), `src/server/queries/response-time.ts:29-30`, `src/app/api/leads/intake/route.ts:119-122` und `lib/constants.ts:111-117` (zulässige `source`: meta, google, formular, manuell, whatsapp), `src/server/queries/admin.ts` (Messwege-Tabelle, WS7 H-13: "keine Anruf-Quelle vorhanden")
- Beleg: Anhang § 2 Abs. (3), § 7 Abs. (2) und Hauptvertrag § 5 Abs. (2) lit. c versprechen drei Messwege, "Protokolle der Tracking-Nummer", "Buchungs-Einträge des EINS-Buchungslinks", und die Praxis darf "die EINS-Tracking-Nummer nicht entfernen". `grep` nach `"anruf"`, `tracking_anruf`, `booking_link` zeigt nur Klassifizierung und Hilfetexte, kein Schreiben in `requests`. Die Intake-Route kann die Werte `anruf`/`buchung` gar nicht annehmen (Enum `REQUEST_SOURCES`).
- Szenario: Die erste Praxis erhält (laut Mitwirkungstext in FAQ/Checkliste) eine Tracking-Nummer oder einen Buchungslink. Ruft eine Patientin dort an oder bucht, entsteht im Portal nichts. Es gibt keinen Nachweis, keine Rechnungsauslösung und die 90 Tage laufen weiter, obwohl die Praxis "Anfragen" bekommt. Spiegelbild: Die Praxis kann nicht entfernen, was es nicht gibt, EINS kann den Nachweis nach § 7 nicht erbringen.
- Fix-Vorschlag: Entscheidung für Karam vor dem Start: entweder (a) für die erste Praxis keine Tracking-Nummer und keinen Buchungslink als Messweg zusagen und Anhang/FAQ-Zeilen für diesen Kunden entsprechend lesen (nur Formular live), oder (b) einen signierten Eingang `POST /api/leads/intake` mit `source: "anruf"`/`"buchung"` (Webhook des Telefonanbieters bzw. Calendly) bauen, `REQUEST_SOURCES` und `SOURCE_LABELS` erweitern. Bis dahin in `/admin/garantie/<id>` den Satz "Messwege live: nur Formular" zeigen, damit Karam keinen Anruf als Auslöser erwartet.

### K-5: KI-Scoring "binnen 60 Minuten" ist Vertragspflicht, läuft in Prod aber nicht
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/server/leads.ts` (`enqueueAiScore` per `after()`, WS1 C-8), `src/app/api/leads/intake/route.ts`; Pflicht: Hauptvertrag v1.4 § 6 Abs. (1) lit. c ("Bewertung jeder eingehenden Anfrage ... innerhalb von 60 Minuten"), gespiegelt in `06-garantie.md` ("Pflichten von EINS", KI-Scoring)
- Beleg: `persistLead` stellt nur ein pg-boss-Job ein. Der Worker ist in Prod bewusst auf 0 (WS1: "Bewertung bleibt in Prod derzeit aus"). Das Scoring entscheidet nie über die Garantie (kein Einfluss auf Rechnung), ist aber eine zugesagte Leistung.
- Szenario: Die erste Praxis erhält Anfragen ohne KI-Kategorie (Filter zeigt "Noch keine Anfrage bewertet", C-7). Nach 60 Minuten ist die Vertragsleistung nicht erbracht; die Praxis hat keinen Anspruch auf Rückerstattung, aber auf die Leistung, und die Aussage in Vertrag und FAQ stimmt nicht.
- Fix-Vorschlag: Vor dem ersten Kunden entweder Worker auf 1 setzen, oder die regelbasierte Bewertung (`worker/processors/score-rules.ts`) synchron in `persistLead` ausführen (Hauptvertrag § 4 Abs. (7) kennt "scoret ausschließlich regelbasiert" als Rückfall), oder die Zusage in Hauptvertrag/FAQ bis zum Worker-Start nicht als erbracht führen. (Worker-Dateien: andere Sitzung, nur gelesen.)

### K-6: Die Mitwirkungsfristen (3 Werktage, 2 Werktage) sind nicht modelliert, Verzug ist reine Handarbeit
- Schwere: P2
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:140-198` (`missedDeadlineOn` ist ein freies Datumsfeld, `[clinicId]/page.tsx:424`), `src/lib/werkstunden.ts:205-209` (`isWerktag` wird nur für Folge 3 benutzt, `grep isWerktag`: keine andere Verwendung)
- Beleg: Nirgends wird aus `signed_on` eine Fälligkeit "3 Werktage nach Unterschrift" berechnet. Auch die "2 Werktage nach Vorlage" hat kein Vorlage-Datum (Beiträge werden per E-Mail geschickt, Anhang § 6 Abs. (1) lit. b). Das System weiß weder, ob Klon-Aufnahme/Einwilligung/Zugänge da sind, noch alarmiert es bei Fälligkeit.
- Szenario: Karam rechnet "3 Werktage" im Kopf. Unterschrift Mi 28.10.2026: richtig ist Mo 02.11. (Do, Fr, Mo; Sa/So zählen nicht), Verzug beginnt 03.11. Ein Tippfehler um einen Tag verschiebt das Fristende um einen Tag, und weil die Mitteilung den Termin nennt (`verzugNoticeText`), steht der falsche Termin in der verbindlichen Mitteilung.
- Fix-Vorschlag: `mitwirkungDueOn(signedOn)` in `lib/werkstunden.ts` (Tag der Unterschrift zählt nicht, `isWerktag` je Tag) und `freigabeDueOn(vorlageOn)`; im Verzug-Formular als Vorbelegung und als Hinweis in `adminAttentionCounts` ("Mitwirkung seit X Tagen fällig, nicht mitgeteilt"). Das Vorlage-Datum als einfaches Feld je Wochen-Versand erfassen.

### K-7: Mitteilungsnachweis ist schwach: rückdatierbar, überschreibt den Beleg, Störung ohne Sendeweg
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:136-138, 182, 225, 268-289, 618-664`; `src/server/email/templates/clinic-notice.ts:23-40`
- Beleg: (1) `markDelayNotifiedAction` akzeptiert jedes gültige Datum (auch vor `from_date`, auch Zukunft), schreibt `notified_at` um 12:00 UTC und lässt `notice_id` unberührt: ein gesendeter, gespeicherter Mailtext kann so ein anderes Mitteilungsdatum bekommen als seine echte Sendezeit. (2) `addStoerungAction` hat keinen Sendeweg, `sendVerzugNoticeAction` lehnt Nicht-Verzug ab (`:626`), die Vorlage `verzugNoticeText` gibt es nur für Verzug; Anhang § 3 Abs. (3) und § 10 verlangen dieselbe E-Mail-Mitteilung für Störungen. (3) Empfänger sind Inhaber plus `defaultDoctorEmail` (`clinic-notices.ts`), Anhang § 3 Abs. (2) verlangt die im Hauptvertrag bezeichnete Adresse. (4) Der Mailtext nennt die ausstehende Mitwirkung (`reason`), aber weder die neue Fristlänge noch das neue Fristende.
- Szenario: Karam hat telefonisch angekündigt und trägt "Selbst gesendet" mit Datum von vorgestern ein. Es gibt keinen Beleg außer dem Audit-Eintrag mit seinem eigenen Datum. Bei einer Plattform-Störung muss er aus dem Mailprogramm senden und ein Datum raten.
- Fix-Vorschlag: `markDelayNotifiedAction`: Datum nicht in der Zukunft, nicht vor `from_date`, und gesperrt, wenn `notice_id` gesetzt ist; Pflichtfeld "Beleg" (Freitext, Message-ID) für manuelle Daten. Vorlage `stoerungNoticeText` und Sendeknopf für `plattform_stoerung`. Mailtext um "Die Frist endet damit am TT.MM.JJJJ" aus `computeDeadline` ergänzen. `noticeRecipients` gegen die im Hauptvertrag vermerkte Adresse abgleichen (Feld je Praxis, falls abweichend).

### K-8: "Ende nach Fristablauf" ist nur ein Status, keine Folge: keine Mitteilung, keine Klon-Löschfrist
- Schwere: P2
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/lib/guarantee-clock.ts:248` (abgeleiteter Status), `src/server/clinic-notices.ts:15` (`NoticeKind` enthält `"fristende"`, es gibt keinen Absender), `src/server/queries/admin.ts:2083-2100` (Alarm nur für laufende Uhren), `src/app/api/leads/intake/route.ts` (nimmt Anfragen auch nach Fristende an)
- Beleg: Anhang § 5 Abs. (2): Zusammenarbeit endet "mit Ablauf der Frist automatisch", § 9 Abs. (2): Klon-Modell spätestens 30 Tage nach Vertragsende löschen. `grep -i klon` in Admin/Server: kein Löschtermin, keine Erinnerung. Weder `beendet_ohne_anfrage` noch `beendet_durch_praxis` löst eine Aktion aus (Portal-Zugang, Zielseite, Intake bleiben aktiv, keine Mitteilung an die Praxis).
- Szenario: Tag 91 vergeht ohne Anfrage. Niemand erfährt es, die Zielseite nimmt am Tag 120 eine Anfrage an, die Praxis denkt, der Vertrag laufe, und der 30-Tage-Löschtermin für das Gesichts- und Stimmenmodell wird nirgends getrackt. Ein später "gerettetes" Weiterlaufen ohne Rechnung ist vertraglich nicht vorgesehen.
- Fix-Vorschlag: `adminAttentionCounts` zählt neu `beendet_ohne_anfrage` ohne Fristende-Mitteilung; Mail-Vorlage "Ende der Zusammenarbeit" (`kind: "fristende"`) mit Absende-Button; Spalte `klon_delete_by` (= Ende plus 30 Tage) in `guarantee_clocks` oder abgeleitet, als Aufgabe in der Garantie-Übersicht. Intake nach Fristende nicht blockieren (Anfrage nicht verlieren), aber im Admin gelb markieren.

### K-9: Praxis ohne Unterschriftsdatum bleibt unsichtbar, keine Kandidatenmail
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/server/guarantee-clock.ts:301-311` (Kandidaten nur bei vorhandener Uhr), `src/server/queries/admin.ts:2083-2097` (Status `ohne_startdatum` wird nicht gezählt), `src/server/request-notify.ts:240-247` (`if (!g || g.confirmed) return;`), `src/app/admin/clinics/actions.ts:51-54, 106` (Datum optional beim Anlegen)
- Beleg: Ohne `guarantee_clocks`-Zeile ist `eligible` leer, die Mail "Erste Anfrage prüfen" geht nie raus (auch nicht, wenn `OPS_ALERT_EMAIL` und `ADMIN_EMAILS` beide leer sind, `request-notify.ts:241-242` kehrt still zurück).
- Szenario: Die erste Praxis wird angelegt, das Datum vergessen. Erste Anfrage kommt, Karam bekommt keinen Hinweis, die Navigation zeigt keine Garantie-Zahl. Er merkt es erst beim Öffnen der Garantie-Seite.
- Fix-Vorschlag: `ohne_startdatum` bei aktiver, nicht archivierter, nicht-Demo-Praxis in `adminAttentionCounts` zählen; bei fehlender Empfängeradresse in `notifyOperatorIfFirstInquiryCandidate` loggen und `ops-alerts` auslösen statt stilles Return; Eingangsmail an Karam bei Anfrage ohne Uhr: "Praxis hat kein Unterschriftsdatum".

### K-10: "Herkunft im Portal" für die Praxis nur als Rohdaten, Messweg gar nicht
- Schwere: P2
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:245` (zeigt `SOURCE_LABELS[source]`), `:606-646` (UTM nur als Roh-Tabelle in einem Akkordeon), `src/app/(portal)/anfragen/page.tsx:300-304`
- Beleg: Anhang § 7 Abs. (1) und Kanon "Jede Anfrage mit Herkunft im Portal": "Eingangszeitpunkt und Herkunft (Messweg und, soweit zuordenbar, Beitrag/Anzeige)". `classifyAttribution` wird in `(portal)` nicht verwendet (nur im Dashboard-Diagramm und im Admin). Die Praxis sieht "Zielseiten-Formular" oder "Meta / Instagram"; Profil-Link, DM-Link, Beitrag oder Anzeige sind nur über rohe `utm_*`-Felder erkennbar. Das ist zugleich der Nachweis im Streitfall. Dazu fehlt ein Rechnungsbaustein: Anhang § 4 Abs. (3) verlangt, dass die Rechnung "Datum, Messweg und Herkunft der auslösenden Anfrage" nennt, die Seite zeigt sie, liefert aber keinen kopierbaren Text.
- Szenario: Die Praxis bestreitet, dass die auslösende Anfrage über EINS kam. Das Portal der Praxis zeigt "Zielseiten-Formular" ohne Kanal/Beitrag; Karam muss aus dem Admin argumentieren.
- Fix-Vorschlag: In Anfrage-Detail und -Liste `classifyAttribution` anzeigen (Messweg-Label, Kanal-Label, Beitrag/Kampagne aus `campaign`/`post`). In `[clinicId]/page.tsx` unter "Rechnung fällig" einen Block "Angaben für die Rechnung" (Datum Berlin, Messweg, Kanal, Beitrag) zum Kopieren.

### K-11: FAQ-Satz "An diesem Tag beginnt Ihr erster bezahlter Leistungsmonat" verweist auf den falschen Tag
- Schwere: P2
- Art: copy
- Sicherheit: hoch
- Ort: `src/app/(portal)/faq/content.ts:646`
- Beleg: "... Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt. An diesem Tag beginnt Ihr erster bezahlter Leistungsmonat." Der Bezug von "An diesem Tag" ist grammatisch der Tag 90 bzw. das Ende. Gemeint ist der Tag der ersten qualifizierten Anfrage (Anhang § 4 Abs. (2)).
- Szenario: Eine Inhaberin liest, dass nach 90 Tagen ohne Anfrage ein bezahlter Monat beginnt; Transparenzproblem (Anhang-Vorspann nennt § 307 Abs. 1 S. 2 BGB ausdrücklich).
- Fix-Vorschlag: Satz umstellen: "Am Tag der ersten qualifizierten Anfrage über EINS beginnt Ihr erster bezahlter Leistungsmonat. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt." (Beide Grenzen bleiben im selben Absatz.)

### K-12: `source: "formular"` ist reine Selbstangabe des signierenden Absenders
- Schwere: P2
- Art: security
- Sicherheit: niedrig
- Ort: `src/app/api/leads/intake/route.ts:119-122, 332, 352`, `src/lib/sources.ts:121`
- Beleg: Die Route akzeptiert `source` aus dem Body (Enum plus Aliase, `SOURCE_ALIASES` nennt "n8n recipes, partner integrations"), signiert wird nur mit dem Praxis-Secret. Jeder Produzent mit diesem Secret kann `formular` senden, also auch ein Formular der Praxis-Website. Anhang § 2: Website-Formular ist kein Messweg.
- Szenario: Eine n8n-Anbindung für das Website-Formular der Praxis verwendet das Praxis-Secret und `source=formular`. Diese Anfrage wird zum Kandidaten für die erste Rechnung.
- Fix-Vorschlag: Für `formular` verlangen, dass `sourceUrl` auf einen Host der EINS-Zielseiten-Domains zeigt (Allowlist in `env`), sonst `source` auf `website` herabstufen (`ENTRY_FREMD`); Allowlist-Prüfung zusätzlich in `classifyAttribution`-Aufrufer im Admin als Warnhinweis. Aussage mit niedriger Sicherheit, weil das Secret heute nur `clinic-landing` bekommt.

### K-13: Offener Verzug hat keine Obergrenze und keinen Alterungshinweis
- Schwere: P3
- Art: robustness
- Sicherheit: hoch
- Ort: `src/lib/guarantee-clock.ts:121-127` (offene Spanne zählt bis `asOf`)
- Beleg: Probelauf: signiert 2026-01-05, offener Verzug ab 09.01., mitgeteilt 12.01., "heute" 2027-01-01: Status `laeuft`, Frist 2027-03-29, `daysLeft 87`. Entspricht dem Wortlaut (Verzug verlängert, keine Obergrenze), aber die Uhr wird so nie "beendet".
- Szenario: Eine Praxis liefert die Zugänge nie. Die Uhr bleibt ewig "Läuft", EINS trägt Arbeit ohne Ende und Rechnung.
- Fix-Vorschlag: Nur Hinweis, kein Vertragswechsel: Garantie-Übersicht zeigt "Verzug seit N Tagen offen" ab 30 Tagen; Entscheidung über Kündigung bleibt bei Karam.

### K-14: Rückruf-Lage: Warnmail wird vor dem Ereignis gespeichert, Warntext ohne Pflichtsatz, "nur solange Anzeigen laufen" nicht geprüft
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/admin/rueckruf/actions.ts:93-119`, `src/lib/response-time.ts:299-322`
- Beleg: `sendClinicNotice` (`:95`) läuft in der Transaktion vor dem Insert (`:109`). Scheitert der Insert, hat die Praxis eine Warnung, die nirgends als Ereignis steht, und die Pause lässt sich nicht stützen. Der Warntext sagt "Ihre Garantie bleibt davon unberührt", aber nicht wörtlich "Das ist keine Bedingung der Garantie" (KANON 11: immer so nennen). Folge 3 gilt "nur, solange bezahlte Anzeigen laufen"; `canPause` prüft das nicht (organisch startende Praxis: Pause aufnehmbar ohne Anzeigen).
- Szenario: Selten (DB-Fehler nach Versand); für die erste Praxis ohne Anzeigen kann Karam eine Pause "buchen", die nichts pausiert.
- Fix-Vorschlag: Ereignis zuerst als `pending` schreiben, Mail senden, danach bestätigen (oder Mail nach Commit senden und Fehler als Notiz speichern). Satz "Das ist keine Bedingung der Garantie." in `warningEmailText`. Feld "Bezahlte Anzeigen laufen" je Praxis oder Hinweis auf der Seite.

### K-15: Feiertage der Werkstunden: Vereinigung aller Länder, Text sagt "am Sitz Ihrer Praxis"
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `src/lib/werkstunden.ts:9-13, 138-152, 185-187`, `src/app/(portal)/faq/content.ts:118`
- Beleg: Der Code überspringt Feiertage jedes Bundeslands (Frauentag BE/MV, Weltkindertag TH, Reformationstag, Buß- und Bettag SN, Augsburger Friedensfest). Anhang § 2 und FAQ sagen "gesetzliche Feiertage am Sitz der Praxis". Praxisfreundlich (Frist nie zu früh, wie der Kommentar sagt), also kein Geldrisiko, aber die Fristberechnung ist länger als vertraglich, und der Praxis-Text beschreibt eine andere Rechnung.
- Fix-Vorschlag: Entweder `clinics.state` (Land) aufnehmen und den Sitz-Kalender benutzen, oder im Text "ohne gesetzliche Feiertage, die in einem Bundesland gelten" ergänzen. Entscheidung bei Karam; heutige Rechnung ist die sichere.

### K-16: Mehrere Garantie-Aktionen sind nicht atomar oder werfen bei Rennen eine 500
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/admin/garantie/actions.ts:476-491, 497-555` (`undoRejectionAction`, `setManualEndAction`, `clearManualEndAction`: Änderung und `audit()` getrennt), `:345-362` und `:521-531` (Gegenspieler ohne `WHERE`)
- Beleg: WS7 G-16 hat Bestätigen, Verzug, Datum usw. atomar gemacht, diese drei nicht. `confirmInquiryAction` setzt nicht `manual_end_state IS NULL` ins `WHERE`, `setManualEndAction` nicht `qualifying_inquiry_on IS NULL`: ein Rennen trifft den CHECK `guarantee_clocks_single_outcome` (`0075:63-65`) und endet im Fehlerrahmen statt in einer deutschen Meldung.
- Fix-Vorschlag: Die drei Aktionen auf `db.transaction` mit `auditTx` umstellen; `WHERE`-Bedingungen ergänzen und `returning` prüfen.

### K-17: Fenster wird nach nachträglicher Änderung des Unterschriftsdatums nicht neu geprüft
- Schwere: P3
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/app/admin/garantie/actions.ts:104-130`, `src/lib/guarantee-clock.ts:245-246`
- Beleg: `setSignedOnAction` sperrt nur, wenn die bestätigte Anfrage vor dem neuen Datum liegt (`:109`). Wird das Datum früher gesetzt, kann die bestätigte Anfrage nach dem neuen Fristende liegen; `computeClock` bleibt trotzdem `rechnung_faellig` (`:246`). Auch nach vermerktem Rechnungsversand ist das Datum änderbar.
- Fix-Vorschlag: In `setSignedOnAction` mit `checkConfirmable`-Logik gegen `qualifyingInquiryOn` prüfen und bei `first_invoice_sent_on` sperren (wie bei der Bestätigung).

### K-18: Gedankenstriche in der Monatsauswertung an die Praxis
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `src/server/reports/monthly-pdf.tsx:81, 98, 105`
- Beleg: `{clinicName} — {monthName}` und `"—"` als Platzhalter (U+2014). Regel 2 im Projekt-CLAUDE.md. Der PDF-Abschnitt zur Antwortzeit selbst (`:120-135`) ist textlich korrekt.
- Fix-Vorschlag: Komma oder `-`, Platzhalter "k. A.".

### K-19: Konflikte zwischen `06-garantie.md` und KANON/Anhang (Dokumentnotiz)
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `C:\Users\karam\Documents\Claude\Projects\EINS\context\06-garantie.md` (Kopfblock, "Zweck dieser Seite", "Format 3", "Rechtliche Risiken und Anwalts-Pflicht", "Vor der ersten Unterschrift")
- Beleg: (1) Der Spiegel sagt "hat diese Seite Vorrang" (Zeile "Wenn etwas auf der Website ... widerspricht"), der Kopf desselben Dokuments sagt, der Anhang v2.1 sei maßgeblich, KANON nennt sich "einzige Quelle". Drei Vorrangregeln. (2) Der Spiegel verlangt "Anwalts-Termin ist Pflicht ... vor der ersten Unterschrift"; das ist nach Karams Entscheidung (kein Anwalt) überholt und darf nicht weitergegeben werden. (3) Der Spiegel nennt unter "Pflichten von EINS" "Reaktionszeit unter 24 Stunden" und "KI-Scoring binnen 60 Minuten", KANON schweigt dazu, der Hauptvertrag § 6 Abs. (1) hat beides (siehe K-5).
- Fix-Vorschlag: Spiegel aktualisieren: eine Vorrangregel (Anhang vor KANON vor Spiegel), Anwalts-Absätze als "offene Punkte, die Karam selbst entscheidet" kennzeichnen, KANON um die zwei Service-Level ergänzen.

### K-20: Es gibt keinen Weg, einen Kontaktversuch per E-Mail oder WhatsApp zu vermerken
- Schwere: P3
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/server/queries/response-time.ts:17-18` ("no writer exists yet"), `src/db/schema.ts:800` (Activity-Arten `email`, `whatsapp`)
- Beleg: Entschieden ist, dass gesendete E-Mail/WhatsApp zählt (Anhang § 2 "Kontaktversuch" nennt E-Mail oder Nachricht). Im Portal geht das nur über den Status "Kontaktiert". Kein Schreiber für `kind = 'email'/'whatsapp'` (`grep`: keiner). Wer schreibt und nur wa.me klickt, hat keinen Vermerk.
- Fix-Vorschlag: Schaltfläche "E-Mail/WhatsApp gesendet" im Cockpit, die eine `request_activities`-Zeile schreibt; Text "Das zählt als Kontaktversuch." wie bei C-30.

## Fehlende Tests

Abgedeckt: 90-Tage-Rechnung, Tag 0, Verzugsspannen, Mitteilungsregel, Last-Day, Status-Übergänge (`guarantee-clock.test.ts`), Werkstunden inkl. Vertragsbeispiel, Ostern/Pfingsten/Weihnachten, Herbst-DST (`werkstunden.test.ts`), Folge 1/2/3 (`response-time.test.ts`), Quellenklassifikation (`sources.test.ts`), Form des Kontaktversuch-SQL (`queries/response-time.test.ts`, nur Textform des SQL). Nicht abgedeckt: alle Server-Aktionen unter `src/app/admin/garantie/**` und `src/app/admin/rueckruf/**` (es gibt dort keine Testdatei), `todayBerlin()`, Intake-zu-Messweg, SQL gegen echte Daten.

Konkrete Fälle (Eingabe gibt Erwartung):

DST und Tagesgrenzen (`lib/guarantee-clock.test.ts`):
1. `computeDeadline("2026-07-27", [], "2026-07-27").deadline` gibt `2026-10-25`; `computeClock` mit `today "2026-10-25"` gibt `laeuft`, `daysLeft 0`; mit `today "2026-10-26"` gibt `beendet_ohne_anfrage`. (Die Frist endet auf dem 25-Stunden-Tag der Zeitumstellung.)
2. `eligibleInquiries` mit Fenster `signedOn 2026-07-27, deadline 2026-10-25` und Anfragen `createdAt`: `2026-10-24T22:00:00Z` (25.10. 00:00 MESZ) drin; `2026-10-25T22:59:59Z` (25.10. 23:59:59 MEZ) drin; `2026-10-25T23:00:00Z` (26.10. 00:00 MEZ) draußen; `2026-10-24T21:59:59Z` (24.10.) drin und früher sortiert.
3. Frühjahr: `signedOn 2026-03-28` gibt Frist `2026-06-26`; Anfrage `2026-03-27T22:59:59Z` (27.03. 23:59:59 MEZ) draußen, `2026-03-27T23:00:00Z` (28.03. 00:00) drin.
4. `berlinDate(new Date("2026-10-25T00:30:00Z"))` gibt `2026-10-25` und `berlinDate(new Date("2026-10-25T01:30:00Z"))` (zweites 02:30) gibt `2026-10-25`; `2026-03-29T00:59:59Z` gibt `2026-03-29`, `2026-03-29T01:00:00Z` (03:00 MESZ) gibt `2026-03-29`.
5. `todayBerlin()` mit `vi.useFakeTimers` auf `2026-10-24T22:30:00Z` gibt `"2026-10-25"` (Serverzeit UTC), auf `2026-10-25T23:30:00Z` gibt `"2026-10-26"`.
6. `inquiryScanRange("2026-07-27", "2026-10-25")` enthält `2026-10-25T22:59:59Z` und `2026-07-26T23:30:00Z` (Randanfragen am Berliner Tagesanfang/-ende).
7. `checkConfirmable`: Anfrage am Fristtag `2026-10-25` (Berlin) bestätigt am `2026-10-26` gibt `ok`; Anfrage `2026-10-26 00:00` Berlin gibt "nach Fristablauf".

Verzug und Mitteilung (`lib/guarantee-clock.test.ts`, nach Fix von K-1):
8. Signiert `2026-01-05`, Verzug `2026-01-09` bis `2026-01-20`, mitgeteilt `2026-04-10`, heute `2026-04-10`: erwartet `beendet_ohne_anfrage`, `delayDays 0` (heute: `laeuft`, Frist 2026-04-17). Gleiche Daten mit Mitteilung `2026-04-05` (Fristtag): zählt, Frist `2026-04-17`.
9. Zwei Verzüge, der zweite mitgeteilt erst nach dem durch den ersten verlängerten Fristende: nur der erste zählt.
10. Verzug mit `to: null`, mitgeteilt, `today` 400 Tage später: `delayDays` wächst, Status `laeuft` (dokumentiert das Verhalten aus K-13).
11. `verzugRange("2026-10-30", "2026-10-30")` gibt `null`; `("2026-10-30", "2026-10-31")` gibt `{from "2026-10-31", to "2026-10-31"}`.

Werktage und Fälligkeiten (`lib/werkstunden.test.ts`, nach K-6):
12. `mitwirkungDueOn("2026-10-28")` gibt `2026-11-02`; `("2026-10-30")` gibt `2026-11-04`; `("2026-12-24")` gibt `2026-12-30` (25./26.12. Feiertag, Wochenende); `("2026-06-01")` gibt `2026-06-05` (Fronleichnam 04.06. ist NRW-Feiertag).
13. `isWerktag("2026-11-01")` false (Sonntag, auch NRW-Feiertag), `isWerktag("2026-11-02")` true; `isWerktag("2027-03-08")` true (Frauentag nicht NRW) während `isAnyStatutoryHoliday("2027-03-08")` true (dokumentiert den Unterschied aus K-15).
14. `responseDeadline` für `2026-10-24T20:00:00Z` (Sa 22:00 MESZ): `2026-11-02T12:00` Berlin (Start Mo 26.10. 09:00 MEZ, 5 volle Tage, 3 Stunden Rest).
15. `endOfNextWerktag` für Fr `2026-10-23T15:00:00Z`: Berliner Mitternacht nach Mo 26.10. = `2026-10-26T23:00:00Z`; für Sa `2026-10-31T10:00:00Z`: `2026-11-02T23:00:00Z`; für Do `2026-12-24T10:00:00Z`: Mo 28.12. Ende (25./26.12. frei) = `2026-12-28T23:00:00Z`.
16. `overdueOpenAt` und `evaluateEnforcement` über die Umstellung: Warnung `2026-10-23T14:00:00Z`, Cure-Ende `2026-10-26T23:00:00Z`, zwei der drei Anfragen kontaktiert um `2026-10-26T22:59:59Z`: `overdueAtCureDeadline 1`, Warnung verbraucht.

Bestätigen und Ablehnen (neue Serveraktions-Tests, DB-Test wie `clinic-notices.db.test.ts`):
17. `confirmInquiryAction` mit Anfrage ohne Telefon und E-Mail, mit `status = 'spam'`, mit früherem offenen Kandidaten, vor `signed_on`, am Unterschriftstag vor der Uhrzeit: jeweils Redirect mit `?fehler=` und keine Änderung an `guarantee_clocks` (nach K-2/K-3).
18. Zweimal parallel bestätigen: genau ein Audit-Eintrag, zweiter Aufruf bekommt die Meldung "bereits bestätigt". Bestätigen und `setManualEndAction` parallel: keine 500, eine deutsche Meldung (K-16).
19. `rejectInquiryAction` mit Grund `keine_kontaktdaten` und Anfrage mit E-Mail ohne Kontaktversuch nach Fristende: Redirect "Einwand ausgeschlossen"; mit `otherProof` und Notiz unter 5 Zeichen: Fehler; mit Notiz: erlaubt.
20. `undoConfirmationAction` nach `setInvoiceSentAction`: gesperrt; nach `clearInvoiceAction`: erlaubt.

Intake und Messweg (`api/leads/intake`):
21. Gültig signierter Body mit `source: "landing_form"` wird `formular` (Messweg), `meta_lead_ads` wird `meta` (kein Messweg), `manual` wird `manuell` (kein Messweg), `anruf` wird 400 (heute nicht erlaubt, siehe K-4), `source: "formular"` mit `sourceUrl` der Praxis-Website: Erwartung nach K-12 `website`.
22. `classifyAttribution`-Tabelle für jede `REQUEST_SOURCES`-Quelle gegen `MESSWEGE` (nur `formular` löst aus), Utm `utm_medium=profil_link` und `dm` mit `source=formular` bleiben Messweg `formular`, `source=instagram` bleibt kein Messweg.

Kontaktversuch gegen echte Daten (DB-Test statt SQL-String):
23. `firstAttemptAtSql` gegen echte Zeilen: `call` mit Ergebnis "Mailbox" zählt; `status_change` mit `meta.to = 'kontaktiert'` zählt; mit `meta.to = 'spam'`, `'verloren'`, `'neu'` und ohne `to`-Schlüssel (nicht PVS) zählt nicht; `source = 'buchungslink'` zählt zum `created_at`; PVS-`status_change` ohne `to` zählt.

Antwortzeit und Spam:
24. Anfrage `createdAt = 2026-10-05T21:59:59Z` hat keine Frist, `2026-10-05T22:00:00Z` hat sie; mit künftigem `signed_on` der Praxis (nach K-3) hat eine Anfrage vor der Unterschrift keine Frist.
25. Anfrage von `neu` auf `spam` und zurück auf `neu` nach Fristende: erscheint wieder als `nicht_beantwortet` (dokumentiert das Verhalten).

Kopie und Texte:
26. Textwächter-Test für Praxis-Texte (`faq/content.ts`, `onboarding/**/content.ts`, `clinic-notice.ts`, `response-time.ts` `warningEmailText`, `monthly-pdf.tsx`): kein U+2014, kein "Klinik", kein "garantieren", kein "Urheberrecht"; jeder Absatz mit "90 Tag" enthält "erste qualifizierte Anfrage über EINS"; der Absatz, der "bezahlter Leistungsmonat" enthält, enthält "erste qualifizierte Anfrage" vor "90 Tagen" (fängt K-11 ab). Es gibt schon `onboarding-content.test.ts:51` mit der Em-Dash-Regel nur für Onboarding.

## Zusammenfassung

- Anzahl: P0 0, P1 5 (K-1 bis K-5), P2 7 (K-6 bis K-12), P3 8 (K-13 bis K-20).
- Kernlogik (90 Tage, Tag 0, Berliner Tage, DST-Unempfindlichkeit, Messweg nur über `source`, KI-Score ohne Einfluss, Folge 1/2/3, Werkstunden) stimmt mit KANON und Anhang überein; 94 Tests grün.
- Dringend 1: K-1, eine Verzugs-Mitteilung nach Fristende belebt die abgelaufene Uhr rückwirkend (Test `guarantee-clock.test.ts:189` schreibt es fest), gegen den Sinn "nicht stillschweigend sammeln".
- Dringend 2: K-2/K-3, "Bestätigen" prüft weder Kontaktdaten noch Spam-Status noch "zeitlich erste", und Testanfragen vor/am Unterschriftstag zählen als Kandidat und als "von der Praxis nicht beantwortet".
- Dringend 3: K-4/K-5, Messweg Anruf und Buchung haben keinen Erzeuger, und das vertraglich zugesagte KI-Scoring binnen 60 Minuten läuft mit Worker 0 nicht.
