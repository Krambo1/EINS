# G: Bugs im Admin-Portal (Break-Review)

Geprüft: `apps/portal/src/app/admin/**`, `app/api/admin/**`, `app/api/public/videos/**`, `server/queries/admin*.ts`, `server/dsgvo.ts`, `server/audit.ts`, `server/outreach-videos.ts`, `lib/outreach-video*.ts`, `server/timeline-journey.ts`, `server/guarantee-clock.ts`, `lib/guarantee-clock.ts`, `server/response-enforcement.ts`, `scripts/setup-intake.ts`. Nur gelesen, nichts ausgeführt (außer Datei-Suche). Reihenfolge: Schaden für Karam im ersten Monat mit 1 bis 5 Praxen.

Kurzantwort auf Auftrag 1 (Neue Praxis end to end): Nur zwei Schritte gehen komplett in der Oberfläche (Garantie-Startdatum, Standard-Journey einsetzen). Alles davor braucht Skript oder SQL, siehe G-01.

---

### G-01: Neue Praxis anlegen und Inhaber einladen ist in der Oberfläche unmöglich
- Schwere: P0
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/clinics/page.tsx` (kein Anlegen-Knopf), `src/app/admin/clinics/[id]/actions.ts` (nur update/archive/unarchive), `src/scripts/setup-intake.ts:93-107`, `scripts/add-demo-login.ts:34`, `src/app/(portal)/einstellungen/actions.ts:24` (`inviteTeamMemberAction` braucht Inhaber-Sitzung), `package.json:23`
- Beleg: Es gibt keine Admin-Action, die `clinics` oder `clinic_users` einfügt. `grep "insert(schema.clinics"` trifft nur Seed und das Skript. `setup-intake.ts` legt die Praxis mit `legal_name = display_name = slug` an, aber keinen Benutzer. `add-demo-login.ts` ist fest auf `DEMO_CLINIC_ID` verdrahtet. Einladen kann nur ein eingeloggter Inhaber (`inviteTeamMemberAction`). `package.json` verweist auf `src/scripts/create-admin.ts`, die Datei existiert nicht.
- Szenario: Karam hat die erste Unterschrift. Er kann Praxis und Inhaber-Login nicht anlegen, ohne `pnpm setup:intake <slug>` gegen die Prod-DB und danach SQL für `clinic_users` (Passwort-Hash oder Magic-Link-Token). Treatments und Standorte kann nur der Inhaber selbst unter Einstellungen anlegen (`einstellungen/actions.ts:350,420`); per Admin nur über "Als Benutzer öffnen", und dann gilt G-10. Vertragsdokumente hochladen: im Admin gibt es nur den Lesezugriff auf Praxis-Uploads (`DateienTab`), keinen Upload. Schritte pro Auftrag 1: Praxis anlegen = Skript. Team/Inhaber einladen = SQL. Standorte/Behandlungen = nur durch Inhaber. Intake verdrahten = Skript plus Handarbeit (G-02). Garantie-Uhr starten = UI (`setSignedOnAction`). Journey = UI (`seedDefaultJourneyAction`). Vertragsdokumente = nicht möglich.
- Fix-Vorschlag: Server-Action `createClinicAction` (Anzeigename, Rechtsname, Slug, Inhaber-E-Mail) in `admin/clinics/actions.ts`: legt Praxis, Inhaber-Zeile und Einladungs-Magic-Link an (Logik aus `inviteTeamMemberAction` wiederverwenden), ruft `applyDefaultJourney` und legt eine leere Garantie-Uhr-Zeile an. Knopf "Neue Praxis" auf `/admin/clinics`. Dazu "Einladung erneut senden" im TeamTab. `create-admin`-Script aus `package.json` entfernen oder schreiben.

### G-02: Zielseiten-Anbindung (Intake-Secret) funktioniert nur lokal und rotiert beim zweiten Lauf still
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/scripts/setup-intake.ts:162-173` (`PORTAL_URL=http://localhost:3001`, Secret nur in lokale `.env.local`), `:67-80` (Praxis-Upsert), `:143-150` (Secret wird bei jedem Lauf neu erzeugt)
- Beleg: Das Klartext-Secret wird nur in `apps/clinic-landing/.env.local` geschrieben und nirgends angezeigt; `PORTAL_URL` ist fest `http://localhost:3001`. In der DB steht nur `access_token_enc`. `portalClinicId` wird in `clinic.ts` gepatcht, mit der UUID aus der DB, auf die `DATABASE_URL` gerade zeigt.
- Szenario: Läuft das Skript gegen die lokale Dev-DB, entsteht eine andere Praxis-UUID als in Prod. Läuft es gegen Prod, steht das Secret in einer lokalen Datei, und Karam muss `PORTAL_INTAKE_SECRET_<SLUG>` und `PORTAL_URL` von Hand in Vercel eintragen. Ein zweiter Lauf (zum Beispiel um die UUID nachzuschlagen) rotiert das Secret in der Prod-DB, die Vercel-Variable passt nicht mehr, und alle Anfragen der Zielseite werden abgelehnt, ohne dass im Admin etwas rot wird (G-14 zeigt die Intake-Zeile ohnehin dauerhaft gelb).
- Fix-Vorschlag: Admin-Seite pro Praxis "Zielseite anbinden": zeigt Praxis-ID, `PORTAL_URL`, Secret einmalig nach Erzeugen mit Knopf "Neu erzeugen" (mit Bestätigung und Warnung). Skript: `PORTAL_URL` aus `APP_ORIGIN`, Rotation nur mit `--rotate`.

### G-03: Praxis-Löschung (Art. 17) scheitert an Fremdschlüsseln, der Audit-Eintrag "gelöscht" steht trotzdem
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/server/dsgvo.ts:258-282`, `src/app/admin/clinics/[id]/dsgvo/actions.ts:326-335`, Migrationen `0006_feedback.sql:13`, `0061_discovery_fragebogen.sql:22`, `0062_asset_checkliste.sql:35,68`, `0066_client_uploads.sql:24`
- Beleg: `eraseClinicData` löscht `clinic_users` (Schritt 3) vor der Praxis. `feedback.submitted_by`, `discovery_fragebogen.submitted_by/updated_by`, `checklist_items.delivered_by/updated_by`, `checklist_files.uploaded_by`, `client_uploads.uploaded_by` verweisen auf `clinic_users(id)` ohne `ON DELETE`. Diese Tabellen sind erst durch das Löschen der Praxis (Cascade) dran, also zu spät. Die Action schreibt das Audit (`dsgvo_erasure`) vor der Löschung (`:326`), außerhalb der Transaktion.
- Szenario: Jede Praxis, die den Fragebogen abgeschickt, eine Checklisten-Datei oder eine Datei an EINS hochgeladen hat (also praktisch jede aktive), löst beim Löschen einen Fehler 23503 aus, die Transaktion rollt zurück, Karam sieht eine rohe 500-Fehlerseite. Im Audit-Log steht trotzdem "dsgvo_erasure" für diese Praxis. Genau das Szenario, das der Kommentar in `dsgvo.ts:213` ausschließen will.
- Fix-Vorschlag: In `eraseClinicData` vor den Benutzern die Tabellen `feedback`, `discovery_fragebogen`, `checklist_items`, `checklist_files`, `client_uploads` (und alle weiteren mit Benutzer-FK) explizit löschen, oder per Migration die FKs auf `ON DELETE SET NULL` stellen. Audit-Eintrag erst nach erfolgreicher Löschung schreiben (oder zwei Einträge: "gestartet", "abgeschlossen"). Ergebnis in Redirect-Meldung zeigen statt `throw`.

### G-04: Löschung entfernt keine Dateien aus R2
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/dsgvo.ts:212-284` (kein Storage-Aufruf), Tabellen `assets`, `documents`, `checklist_files`, `client_uploads`, `animation_instances.storage_key_customized`, `clinic_users.avatar_key`
- Beleg: Die Funktion löscht nur Zeilen. Die Datei-Schlüssel gehen mit den Zeilen verloren, die Objekte bleiben im Bucket.
- Szenario: Vorher-Nachher-Fotos von Patienten und Klon-Aufnahmen (Checkliste, Dateien an EINS) liegen nach "unwiderruflicher Löschung" dauerhaft in R2, ohne dass sie jemand je wieder findet.
- Fix-Vorschlag: Vor dem Transaktions-Delete alle Schlüssel der Praxis einsammeln und nach Commit per `getStorage().delete` entfernen (Prefix `<clinicId>/`). Fehlschläge ins Audit schreiben und in der UI melden.

### G-05: "Praxis archivieren" sperrt die Nutzer nicht und stoppt nichts
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/admin/clinics/[id]/_components/VerwaltungTab.tsx:27-30`, `src/auth/session.ts:179-201`, `src/auth/magic-link.ts:89`
- Beleg: Die Oberfläche sagt "Archivierte Praxen sind für Nutzer gesperrt". `getSessionImpl` joint `clinics`, prüft aber nur `clinic_users.archived_at`. Außerhalb von Admin und Worker liest nichts `clinics.archived_at`. `archiveClinicAction` archiviert weder Benutzer noch widerruft sie Sitzungen.
- Szenario: Offboarding: Karam archiviert eine Praxis nach der Kündigung. Die Mitarbeiter bleiben eingeloggt und können sich weiter anmelden, Anfragen kommen weiter an und tauchen in Summen auf. Gleichzeitig verschwindet die Praxis aus der Garantie-Übersicht (`guarantee-clock.ts:176`) und der Rückruf-Lage (`response-enforcement.ts:77`).
- Fix-Vorschlag: In `getSessionImpl` und beim Login `clinics.archived_at IS NULL` verlangen; `archiveClinicAction` widerruft offene Sitzungen der Praxis. Intake-Route lehnt archivierte Praxen ab. Oder Text in `VerwaltungTab` korrigieren.

### G-06: Admin-Kennzahlen "Anfragen" hängen am nächtlichen Worker, der in Prod aus ist
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/admin.ts:112-198, 532-590, 692-720`, `src/worker/processors/kpi-rebuild.ts`
- Beleg: `platformOverviewMetrics`, `clinicLeaderboard`, `spendRevenueSeries` und die Zusammenfassung der Praxis-Leistung lesen `leads`, `casesWon`, Umsatz aus `kpi_daily`. Diese Tabelle schreibt nur der Worker `kpi-rebuild` (03:00 UTC). Daneben liest `clinicPerformance.bySource` live aus `requests` (`:735-750`).
- Szenario: Worker ist auf 0. Die erste Praxis erhält 12 Anfragen. Übersicht, `/admin/clinics`, Leaderboard und Leistung zeigen 0 Anfragen und "Keine Daten", die Quellenliste in derselben Ansicht zeigt 12. Karam hält das Dashboard für defekt oder zählt falsch.
- Fix-Vorschlag: Für Anzahl Anfragen und Status die Live-Zählung aus `requests` verwenden (wie `pipelineFunnel`), `kpi_daily` nur für Werbebudget und Umsatz. Zusätzlich Hinweis "Stand: letzter Worker-Lauf" mit Zeitstempel anzeigen.

### G-07: Monatsvergleich auf der Übersicht stellt den angefangenen Monat gegen den vollen Vormonat
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/admin.ts:121-125, 189-199, 256-279`
- Beleg: `aggregateKpiRange(monthStart, today)` gegen `aggregateKpiRange(priorMonthStart, priorMonthEnd)`, dann `pctDelta(current, prior)`.
- Szenario: Am 7. eines Monats stehen 7 Tage gegen 30 Tage. Anfragen, Umsatz und Budget zeigen rund minus 75 % in Rot ("bad"), jeden Monat bis etwa zum 25. Bei einer einzigen Praxis ist das das einzige, was auf der Startseite steht. Zusätzlich: Hat der Vormonat 0 (erster Monat), liefert `pctDelta` `{value: 0, tone: "neutral"}` ohne `suppressed`, die Kachel zeigt "0 % vs. Vormonat" statt "neu". Zeitgrenzen sind UTC, nicht Berlin.
- Fix-Vorschlag: Vormonat auf dieselbe Tageszahl kürzen (`priorMonthStart` bis `priorMonthStart + (today.day - 1)`), oder Delta ausblenden, solange weniger als 15 Tage vergangen sind. Bei `prior === 0` `suppressed: true` setzen.

### G-08: Rückruf-Lage: Doppelklick erzeugt zwei Warnungen, keine Bestätigung, Frist in der Mail kann veraltet sein
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/admin/rueckruf/actions.ts:39-81`, `src/app/admin/rueckruf/page.tsx:152-155, 215-232`
- Beleg: `record()` liest `lage`, prüft `canWarn`/`canPause`, fügt dann ein. Keine Transaktion, keine eindeutige Sperre, im Formular kein Pending-Zustand (`<form action>` mit normalem `Button`). Der Kommentar in `:56` nennt als Risiko, dass eine zweite Warnung die Heilungsfrist verschiebt. Die Warn-Mail (`warningEmailText`, Frist `endOfNextWerktag(now)`) wird beim Rendern der Seite berechnet, der Eintrag aber mit `now` beim Klick gespeichert.
- Szenario: Doppelklick (oder Reload der Aktion): zwei `warnung`-Ereignisse mit leicht verschiedenen Zeiten; welche zählt für die Frist, hängt von `evaluateEnforcement`. Karam lässt die Seite über Nacht offen, kopiert die Mail mit Frist "Ende Dienstag", klickt "Warnung vermerken" am Mittwoch: vermerkte Frist (Donnerstag) und versandte Frist (Dienstag) weichen ab, das ist gerade bei der Anzeigen-Pause der Beweis. "Anzeigen-Pause vermerken" und "Fortsetzung" haben ebenfalls keine Rückfrage.
- Fix-Vorschlag: Client-Wrapper mit `useFormStatus` (Knopf sperren) und `confirm` für Warnung und Pause. In `record()` Insert und Prüfung in einer Transaktion mit `pg_advisory_xact_lock(hashtext(clinicId))`. Die Frist der Mail als Hidden-Feld mitschicken und bei Abweichung ablehnen.

### G-09: Garantie-Bestätigung: letzter Klick gewinnt, abgelehnte Anfrage kann bestätigt bleiben, keine Rückfrage
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:222-263` (confirm), `:289-331` (reject), `:265-282` (undo)
- Beleg: `confirmInquiryAction` prüft `clock.qualifyingInquiryOn` aus einem vorherigen Lesevorgang und schreibt dann `UPDATE ... WHERE clinic_id = ?` ohne `AND qualifying_inquiry_on IS NULL`. `rejectInquiryAction` prüft nicht, ob `requestId === clock.qualifyingRequestId`; `onConflictDoNothing` schreibt bei bereits abgelehnter Anfrage nichts, das Audit "reject" aber trotzdem. Alle Garantie-Knöpfe sind einfache Formulare ohne Bestätigung und ohne Pending-Zustand. `undoConfirmationAction` kennt keinen Rechnungsstand (es gibt keinen "Rechnung gestellt"-Zustand im System).
- Szenario: Zwei Tabs oder zwei Admins bestätigen Anfrage A und B gleichzeitig: beide Prüfungen bestehen, B überschreibt A, `qualifying_confirmed_by/at` ändern sich still, der Rechnungsstart verschiebt sich auf Datum von B. Ablehnen der bereits bestätigten Anfrage: Eintrag in `guarantee_candidate_rejections`, Uhr zeigt weiter "Rechnung fällig" mit genau dieser Anfrage. Aufheben der Bestätigung nach Rechnungsstellung ist ohne Warnung möglich.
- Fix-Vorschlag: `WHERE clinic_id = ? AND qualifying_inquiry_on IS NULL` und bei 0 betroffenen Zeilen Fehlermeldung; in `rejectInquiryAction` `fail` wenn `qualifyingRequestId === requestId`; Audit nur bei echter Änderung; JS-Bestätigung für confirm/undo/manual-end; Feld "Rechnung gestellt am" und Sperre für Undo danach.

### G-10: "Als Benutzer öffnen" ist Vollzugriff, Änderungen erscheinen als die Praxis-Person
- Schwere: P1
- Art: security
- Sicherheit: mittel
- Ort: `src/app/api/auth/start-impersonation/route.ts`, `src/auth/impersonation.ts:121-130`, Gate nur in `src/app/(portal)/layout.tsx:59,95,134` (Banner, Tour)
- Beleg: Außer Banner und Tour wird `impersonatedByAdminId` nirgends ausgewertet (`grep impersonatedByAdminId` in Actions und `writeAudit`-Aufrufen: keine Treffer). Die Sitzung hat die volle Rolle des Zielbenutzers (Inhaber).
- Szenario: Karam öffnet die Praxis als Inhaber, um zu sehen, "was die sehen", klickt in Anfragen auf "Kontaktiert" oder ändert einen Status. Das setzt `first_attempt_at`/Status und damit Rückruf-Lage, Garantie-Ablehnungsgründe (`rejectionAllowed` liest den Kontaktversuch) und Audit-Zeilen mit dem Namen der Praxisperson als Akteur. Der Nachweis der Praxis ist verfälscht, ohne dass es erkennbar ist. Einladungen, Löschungen und Passwortänderungen sind ebenfalls möglich.
- Fix-Vorschlag: In Server-Actions und `requireSession`-Mutationen bei `impersonatedByAdminId !== null` standardmäßig ablehnen (Nur-Lesen) oder Audit mit `diff.impersonatedBy` markieren; Audit-Akteur als "admin:<mail> als <user>" schreiben. Kontaktversuche aus Impersonation nie zählen.

### G-11: Animation "ausgeliefert": Benachrichtigung hängt am Worker, Doppelmail, Lieferung nur per Hand-Schlüssel
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/admin/animations/actions.ts:45-80`, `src/server/jobs.ts:142-152`, `src/app/admin/operations/_components/AnimationenQueue.tsx:20,90-98`
- Beleg: Die Karte verspricht "Status-Wechsel auf Bereit benachrichtigt automatisch". `enqueueEmail` legt nur einen pg-boss-Job an. Es gibt keinen Schutz gegen erneutes "ready" (Mail und `deliveredAt` werden jedes Mal neu gesetzt). Der Speicher-Schlüssel wird als Freitext eingetragen, ohne Prüfung, dass das Objekt existiert oder unter dem Praxis-Präfix liegt; im Admin gibt es keinen Upload dafür.
- Szenario: Worker 0: Karam markiert "ausgeliefert", die Praxis erhält nie eine Mail und denkt, es sei nichts passiert. Sobald der Worker startet, gehen alle gestauten Mails auf einmal raus; ein doppelter Klick schickt zwei. Ein Tippfehler im Schlüssel liefert der Praxis eine tote Datei.
- Fix-Vorschlag: Status nur von `requested`/`in_production` auf `ready` ändern lassen (`WHERE status <> 'ready'`), Mail nur bei echtem Wechsel; Schlüssel per `storage.head` prüfen; Upload-Feld statt Freitext; im UI sichtbar machen, wenn der Worker nicht läuft.

### G-12: Nichts im Admin warnt vor Tag 90, vor neuen Anfragen oder vor offenen Kandidaten
- Schwere: P2
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/admin/page.tsx`, `src/app/admin/_components/AdminShell.tsx:98-113,321` (Badge nur "operations"), `src/app/admin/operations/page.tsx`
- Beleg: Die Startseite zeigt Werbebudget, Werbeumsatz, CPL, ROAS (`MetricStrip.tsx`) und bei organischem Start überall "–". Der Operations-Badge zählt `slaBreaches + animations + syncErrors + stalledRequests`; Garantie (Kandidat prüfen, Resttage weniger als 14) und Rückruf (3 offene) sind nicht enthalten.
- Szenario (Auftrag 2): Karam sieht morgens weder neue Anfragen seit gestern noch, welche Praxis in zehn Tagen Fristende hat. Er muss Garantie-Uhr und Rückruf-Lage einzeln aufrufen. Ein "Kandidat prüfen" bleibt unbemerkt, die Rechnung startet verspätet.
- Fix-Vorschlag: Startseite oben mit drei Zeilen: neue Anfragen seit gestern pro Praxis, Praxen mit `daysLeft <= 14` oder `hasCandidate`, Rückruf mit `overdueOpen >= 3`. Daten liefern `listGuaranteeOverview` und `listRueckrufLage` schon. Badge in der Navigation für beide.

### G-13: Admin-Posteingang "Anfragen" zählt Demo, Spam, archivierte Praxen und kann keine Anfrage öffnen
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/server/queries/admin.ts:926-1030, 285-340, 342-430, 1190-1260`, `src/app/admin/leads/page.tsx`, `src/app/admin/_components/LeadsTable.tsx`
- Beleg: `globalLeads`, `pipelineFunnel`, `aiScoreDistribution`, `slaBreachLeaderboard`, `responseTimeRanking`, `pendingOperationCounts` filtern weder `clinics.archived_at` noch `status <> 'spam'` noch die Demo-Praxis aus. Das Praxis-Filterfeld in `leads/page.tsx:79` blendet archivierte aus, die Liste nicht. Zeilen verlinken nur auf die Praxis, nicht auf die Anfrage; kein "neu seit letztem Besuch".
- Szenario: Die Demo-Praxis ("Praxis Dr. Demo") mit Seed-Anfragen und Spam fließen in Pipeline, SLA-Verstöße und Antwortzeiten ein; "Aktive Praxen 1/2" zählt Demo mit. Karam sieht eine SLA-Verletzung, die zu einer archivierten Praxis gehört, und kann sie nicht schließen.
- Fix-Vorschlag: Einheitlicher Basisfilter `clinics.archived_at IS NULL AND clinics.is_demo = false` (Feld ergänzen oder Slug `_template`/Demo-ID ausschließen) in allen Cross-Clinic-Abfragen; Spam standardmäßig ausblenden; Link auf die Anfrage der Praxis (`?tab=leads&search=`).

### G-14: Integrations-Übersicht und Onboarding zählen die Zielseiten-Zeile als Plattform
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/admin.ts:1718-1770, 1860-1870, 1190-1230`, `src/app/admin/integrations/page.tsx:20-26`
- Beleg: `adminIntegrationHealth` liest alle `platform_credentials`, darunter `platform='intake'` (von `setup-intake.ts:147`). Diese Zeile hat nie `last_synced_at` und `expires_at`, also immer Ton `warn` ("Beobachten") und zählt zu "Veraltet". `credSet` für `hasIntegration` im Onboarding enthält ebenfalls jede Zeile.
- Szenario: Eine brandneue Praxis steht sofort als "Integration verbunden" im Onboarding und dauerhaft gelb unter Integrationen, obwohl weder Meta noch Google verbunden sind. Echte Zielseiten-Gesundheit (letzte Anfrage, letzter Fehler) fehlt, sodass G-02 unbemerkt bleibt.
- Fix-Vorschlag: `intake` aus beiden Abfragen ausnehmen oder eigene Spalte "Zielseite: letzte Anfrage vor X Tagen" aus `requests` ableiten. Onboarding-Stufen auf den organischen Weg ausrichten (Fragebogen, Checkliste, Klon-Aufnahme, Freigabe) statt Anzeigenkonten und Schulungsquiz.

### G-15: Datenauskunft unvollständig, im Speicher aufgebaut, Audit vor Erfolg
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/dsgvo.ts:19-203`, `src/app/api/admin/clinics/[id]/dsgvo/export/route.ts:21-45`
- Beleg: `DsgvoExport` enthält nicht: `request_followups`, `checklist_*`, `discovery_fragebogen`, `client_uploads`, `feedback`, `retreatment_cycles`, `guarantee_*` (bewusst), `email_suppression`, `clinic_timeline_entries`, `dashboard_alerts`, `ads_conversion_outbox`. Alles wird mit `JSON.stringify(payload, null, 2)` in einem Aufruf aufgebaut, `pvs_event_log` und `requests` ungekappt. `writeAudit` steht vor `exportClinicData`; bei ungültiger UUID wirft `zod.parse` eine 500.
- Szenario: Eine Patientenauskunft über die Praxis ist unvollständig, ohne dass das jemand merkt. Bei großem Ereignisprotokoll läuft die Funktion in Zeit- oder Speichergrenzen, der Audit-Eintrag "export" steht trotzdem. Eine Auskunft oder Löschung für einzelne Patientinnen und Patienten gibt es im Admin gar nicht (nur ganze Praxis).
- Fix-Vorschlag: Export aus Schema-Metadaten ableiten (alle Tabellen mit `clinic_id`), Test, der neue Tabellen erzwingt. Streaming oder NDJSON für große Tabellen. Audit nach Erfolg. Funktion "Patient/in exportieren oder löschen" nach E-Mail/Telefon.

### G-16: Audit-Spur der Garantie ist pro Praxis nicht auffindbar, Audit überlebt Löschung mit personenbezogenen Daten
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/admin/garantie/actions.ts:49-57`, `src/app/admin/rueckruf/actions.ts:72-78`, `src/app/admin/audit/page.tsx:73-75`, `src/server/audit.ts:421-449`
- Beleg: Garantie- und Rückruf-Audit werden bewusst ohne `clinicId` geschrieben. Der Audit-Filter nach Praxis sucht `eq(auditLog.clinicId, id)` und verlangt eine eingetippte UUID (ungültig = 500 durch Postgres-Fehler `22P02`). `writeAudit` verschluckt Fehler (`catch` nur Log) und läuft nach der Änderung, nicht in derselben Transaktion. Nach `eraseClinicData` bleiben alle Audit-Zeilen der Praxis mit `actor_email`, `ip_address`, `diff` stehen.
- Szenario: Streit über Fristverlängerung: Karam findet die Einträge nur über `entity=guarantee_clock` und muss die Praxis-ID aus `entity_id` lesen. Fällt der Audit-Insert wegen Verbindungsfehler aus, ist die Änderung an der Frist ohne Spur. Nach Art. 17 bleiben IP-Adressen und E-Mails der Praxis-Mitarbeiter im Log.
- Fix-Vorschlag: Praxis-Auswahlfeld statt UUID, Filter auch auf `entity_id` für Garantie/Rückruf. Für Garantie-Mutationen Audit in derselben Transaktion schreiben und bei Fehler abbrechen. Beim Löschen `actor_email`/`ip_address`/`diff` der Praxis-Zeilen anonymisieren.

### G-17: Fortschritt: vorbefüllte Schritte lassen sich nur mit erfundenem Datum bearbeiten
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/app/admin/clinics/[id]/_components/FortschrittTab.tsx:97-111,200-215`, `src/app/admin/clinics/[id]/actions.ts:106-112,162-187`
- Beleg: Die Standard-Journey legt Einträge mit `event_date NULL`, `phase_label`, `sort_order` an (`timeline-journey.ts:268-282`). Das Bearbeiten-Formular hat `eventDate required`, `TimelineUpdateSchema` verlangt `z.string().min(1)` und setzt das Datum immer.
- Szenario: Karam will nur den Status von "Klon-Aufnahme" auf "erledigt" setzen. Das Formular zwingt ein Datum auf, der Eintrag wird damit in der Praxis-Ansicht umsortiert oder anders dargestellt als die relativen Phasen.
- Fix-Vorschlag: `eventDate` optional, bei leer `null` lassen; separate Schnellaktion "Status ändern" ohne Datumsfeld.

### G-18: Videoseiten-Zählung: Link-Scanner, Wiedergabe-Beacon von Dritten und "intern" über URL
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/app/api/public/videos/[slug]/events/route.ts:66-95`, `src/server/outreach-videos.ts:483-502, 289-336`, `src/lib/outreach-video.ts:247-261, 279-284`, `src/lib/outreach-video-hash.ts`
- Beleg: Jeder, der den Slug kennt, kann bis zu 300 Beacons pro 10 Minuten pro IP mit frei gewählter `s`-Sitzungs-ID senden, jede neue ID zählt als eigener "Aufruf". Es gibt keine User-Agent-Filterung für Bots, `deviceFromUserAgent` kennt nur mobile/tablet/desktop. "Geräte" = Anzahl verschiedener (UTC-Tag, IP, UA)-Hashes, also dasselbe Gerät an zwei Tagen zählt doppelt. Das Intern-Flag `i` kommt vom Client (`?intern=1`).
- Szenario: Mail-Sicherheitsdienste (Defender Safe Links, Proofpoint) öffnen den Link in einem Headless-Browser mit JavaScript und lösen `open` (eventuell `play`) aus: Karam sieht "Aufruf" Sekunden nach Versand. Wird die Adresse mit `?intern=1` aus der Browserleiste statt über "Link kopieren" weitergegeben, zählt der Empfänger nie. Wiederholte Besuche an mehreren Tagen blähen "Geräte" auf.
- Fix-Vorschlag: Bot-UAs und Datacenter-Netze (`HeadlessChrome`, bekannte Scanner) beim Speichern als `internal` markieren; Aufruf erst zählen, wenn mindestens `play` oder 3 Sekunden Verweildauer; "Geräte" über 7-Tage-Fenster statt Tag; `i` nur erlauben, wenn ein vom Server signiertes Cookie vom Admin existiert. In der Tabelle "Aufrufe" und "gestartet" getrennt erklären.

### G-19: Zwei verschiedene Definitionen von "im Rückstand" im Admin
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/server/queries/admin.ts:342-365, 1190-1215` (SLA: `sla_respond_by < now()`, Status `neu`) gegen `src/server/response-enforcement.ts` / `lib/response-time.ts` (48 Werkstunden, Kontaktversuch)
- Beleg: Operations und Leaderboard nutzen `slaRespondBy` (Wanduhr, ab Eingang, `SLA_HOURS` in `server/leads.ts:143`) und `status = 'neu'`; Rückruf-Lage und Garantie nutzen Werkstunden und `firstAttemptAt`. Setzt die Praxis den Status auf "kontaktiert", ohne dass ein Versuch erfasst ist, verschwindet sie aus der SLA-Liste, bleibt aber in der Rückruf-Lage offen (und umgekehrt).
- Szenario: Karam sieht in Operations "0 SLA-Verstöße" und in Rückruf-Lage "4 offen ohne Kontaktversuch" für dieselbe Praxis, oder umgekehrt, und entscheidet auf der falschen Basis über eine Warnung.
- Fix-Vorschlag: Operations-SLA-Liste auf `attemptInfo`/Werkstunden umstellen oder klar beschriften ("interne Zielzeit") und die Garantie-relevante Zahl daneben zeigen.

### G-20: Eingabe- und Parameterfehler führen zu 500 statt Meldung
- Schwere: P3
- Art: robustness
- Sicherheit: hoch
- Ort: `src/server/queries/admin-shared.ts:22-28`, `src/app/admin/clinics/[id]/page.tsx:107`, `src/app/admin/audit/page.tsx:73`, `src/app/admin/leads/page.tsx:46`, `src/app/admin/clinics/[id]/dsgvo/actions.ts:312-323`, Action-Schemas in `clinics/[id]/actions.ts:29-31,127,176`
- Beleg: Nicht-UUID in `/admin/clinics/<id>`, `?clinicId=` (Leads, Audit) erreicht Postgres und wirft `22P02`. Fehlerfälle in Actions sind `throw new Error("validation failed…")` (Praxis-Stammdaten, Fortschritt, Löschen mit falschem Slug `confirmation_mismatch`) und enden in der Fehlerseite, anders als die Garantie-Actions mit `?fehler=`.
- Szenario: Tippfehler im Slug beim Löschen ist ein Absturz der Seite, kein Hinweis "Slug stimmt nicht". Eine bereits gelöschte Praxis im Browserverlauf liefert 500 statt 404.
- Fix-Vorschlag: `z.string().uuid().safeParse` vor DB-Zugriff mit `notFound()`; einheitliches `fail()`-Muster mit Redirect und Meldung; Slug-Vergleich ohne Groß-/Kleinschreibung.

### G-21: Datumsvalidierung der Garantie-Uhr lässt widersprüchliche Zustände zu
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/app/admin/garantie/actions.ts:59-81, 340-380`
- Beleg: `setSignedOnAction` prüft nur gegen eine bestätigte Anfrage, nicht gegen `manual_end_on` (Unterschrift nach dem manuellen Ende ist möglich). `setManualEndAction` erlaubt ein Enddatum in der Zukunft; `computeClock` stoppt dann erst, wenn der Tag erreicht ist, der Status zeigt aber sofort "beendet". `closeDelayAction`/`markDelayNotifiedAction` löschen oder ändern ohne Rückfrage; "Eintrag entfernen" (`removeDelayAction`) ist endgültig und verschiebt die Frist rückwirkend.
- Szenario: Eine versehentlich entfernte Verzug-Zeile (ein Klick, ohne Bestätigung) verkürzt die Frist um Tage, im Audit steht nur die ID.
- Fix-Vorschlag: Prüfung `endedOn >= signedOn` auch in `setSignedOnAction`, Enddatum höchstens heute, Bestätigung bei Entfernen, `diff` mit Von/Bis/Grund im Audit.

### G-22: Video-Lebenszyklus: kein Löschen, fehlende Datei wird nicht erkannt, verwaiste Uploads
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/server/outreach-videos.ts:190-197, 419-476`, `src/app/admin/videos/_components/VideoUploadCard.tsx:121-166`, `src/app/api/public/videos/[slug]/route.ts`
- Beleg: Nur Archivieren, kein Löschen von Zeile und R2-Objekt (2-GB-Dateien bleiben). `getPublicVideo` signiert die URL, ohne zu prüfen, ob das Objekt noch existiert. Schlägt `createOutreachVideoAction` nach dem Upload fehl (`not_uploaded`, Netz), bleibt das Objekt verwaist und der Upload muss komplett wiederholt werden. Archiviert = 404 (gut), Ereignisse für archivierte Videos werden still verworfen.
- Szenario: Ein Objekt fehlt (manuell gelöscht): die Empfängerin sieht einen leeren Player. Die Seite auf eins.ag muss den 404 der API sauber anzeigen und darf die Antwort nicht cachen, sonst läuft die 6-Stunden-URL ab (Website-Seite, nicht geprüft).
- Fix-Vorschlag: "Endgültig löschen" mit R2-Delete; im Admin-Detail "Datei prüfen" per `head`; Finalize wiederholbar machen (Schlüssel im Formular behalten).

### G-23: Listen: Seitenzähler hinter dem Ende, Suchmuster mit Platzhaltern, Duplikate beim Wiederholen
- Schwere: P3
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/admin/_components/LeadsTable.tsx:44-47, 168-195`, `src/server/queries/admin.ts:1015-1025, 1655-1665`, `src/app/admin/videos/actions.ts:31-45`
- Beleg: `?page=99` bei 3 Seiten zeigt "Seite 99 von 3", leere Tabelle und nur "Zurück" auf 98. `ilike('%' + search + '%')` ohne Escape von `%` und `_`. `createOutreachVideoAction` hat keinen Schutz gegen doppeltes Absenden (zwei Zeilen, zwei Slugs für dieselbe Datei).
- Szenario: Lesezeichen auf eine späte Seite nach dem Löschen von Anfragen führt in eine Sackgasse; Suche nach "50%" liefert alles.
- Fix-Vorschlag: `page` auf `totalPages` begrenzen, Suchtext escapen, Schlüssel eindeutig machen (`UNIQUE (storage_key)`).

### G-24: Statische Admin-Datei-Route: lokaler SVG-Pfad und fehlendes Audit
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: `src/app/api/admin/files/[...path]/route.ts:39-82`
- Beleg: Mit R2 wird ohne Praxis-Prüfung und ohne Audit auf eine 300-Sekunden-URL weitergeleitet. Im lokalen Treiber wird `image/svg+xml` inline mit Admin-Origin ausgeliefert (Praxis-Upload).
- Szenario: In Prod nur die fehlende Spur, wer welche Praxis-Datei geöffnet hat. Lokal könnte ein hochgeladenes SVG im Admin-Origin Skript ausführen.
- Fix-Vorschlag: `Content-Disposition: attachment` für SVG, `writeAudit({action: "download"})` mit Praxis-ID aus dem Schlüssel.

### G-25: Sichtbare Texte verstoßen gegen die Copy-Regeln
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: `src/app/admin/_components/LeadsTable.tsx:129-132` (`uppercase tracking-wide`, rohe Werte "hot/warm/cold"), `src/app/admin/clinics/[id]/_components/TeamTab.tsx:94-96`, `src/app/admin/operations/page.tsx:16` ("Operations"), `src/app/admin/clinics/page.tsx:62-70` ("Health: alle"), `src/app/admin/leads/page.tsx` ("Ungescort", "Cases", "Trichter"), `src/app/admin/_components/MetricStrip.tsx` (CPL, ROAS)
- Beleg: Versal-Klassen und englische Begriffe in sichtbaren Texten.
- Szenario: Nur Karam sieht es; trotzdem gegen die Projektregeln ("Werbeertrag", "Abschluss", keine Großbuchstaben-Labels).
- Fix-Vorschlag: Labels aus `lib/constants` (z. B. `AI_CATEGORY_LABELS`) benutzen, `uppercase` entfernen, "Operations" zu "Aufgaben", "Health" zu "Zustand", "Ungescort" zu "Ohne Bewertung".

---

## Folgen des abgeschalteten Workers (Zusammenstellung)
- G-06: Kennzahlen "Anfragen", Umsatz, Fälle auf Übersicht, Praxis-Liste, Leaderboard bleiben 0.
- G-11: Mail "Animation bereit" kommt nicht an und staut sich.
- Ebenfalls pg-boss-abhängig (nicht im Detail geprüft): Audit-Bereinigung (`purge-audit`), Anomalie-Scan, Prognose-Snapshots; Garantie- und Rückruf-Seiten laufen ohne Worker und sind davon nicht betroffen.

## Design-Kritik (nur Kritik)
- Die Startseite ist für bezahlte Anzeigen gebaut (Budget, CPL, ROAS) und zeigt bei organischem Start nur Striche. Die wichtigsten Zahlen für Karam (Tag X von 90, offene Kandidaten, Rückruf) sind zwei Klicks entfernt.
- Gefährliche Knöpfe (Löschen, Pause vermerken, Bestätigung aufheben, Verzug entfernen) sehen aus wie normale Knöpfe (`variant="outline"`) und haben keinen Zustand nach dem Klick. Das Löschen hat wenigstens Slug-Eingabe.
- Tabellen mit `min-w-[820px]` und `min-w-[860px]` (Garantie, Rückruf, Videos) scrollen auf dem Handy seitlich, die Resttage-Spalte ist dort verdeckt.
- Admin-Kopfzeilen nutzen lange erklärende Untertitel (Rückruf-Lage, Garantie-Uhr), die auf kleinen Bildschirmen die eigentliche Tabelle nach unten drücken.

## Zusammenfassung
Anzahl: P0 = 1, P1 = 10, P2 = 8 (G-12 bis G-19), P3 = 6 (G-20 bis G-25). Gesamt 25.

Dringendste Punkte:
1. G-01: Praxis und Inhaber lassen sich im Admin nicht anlegen und einladen, Onboarding braucht Skript und SQL, Vertragsdokumente gar nicht.
2. G-03/G-04/G-05: Löschung bricht an Fremdschlüsseln ab (und schreibt trotzdem "gelöscht" ins Audit), lässt Dateien in R2 liegen, und "Archivieren" sperrt die Nutzer nicht.
3. G-06/G-07/G-09: Startseiten-Zahlen hängen am abgeschalteten Worker und vergleichen angefangenen mit vollem Vormonat; Garantie-Bestätigung ist nicht gegen Doppelklick oder Ablehnen der bestätigten Anfrage abgesichert.
