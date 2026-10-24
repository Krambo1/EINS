# F-break-client: Befunde Kunden-Portal (Lens BUGS)

Umfang: `apps/portal/src/app/(portal)/` (dashboard, werbebudget, onboarding, fortschritt, dateien, dokumente, medien, bewertungen, einstellungen, faq, feedback, hwg-check, leitfaden, _components) plus die aufgerufenen Server-Dateien. Nur gelesen, nichts ausgeführt, nichts geändert. Ausgenommen: `anfragen/**`, Login/Passwort, `wiederbehandlungen/**`.

Hinweis zur Sicherheit der Aussagen: "hoch" = im Code direkt belegt, "mittel" = hängt an Next-/R2-Verhalten, das ich nicht ausgeführt habe, "niedrig" = Vermutung mit Beleg für die Voraussetzung.

Geprüft und bewusst NICHT als Befund: E-Mail mit Großbuchstaben beim Einladen (`clinic_users.email` ist `citext`, `db/schema.ts:165`), UUID-Tampering auf `bewertungen/feedback/[id]` (wird mit Regex abgewiesen), Zeilen-Fremdzugriff über `?id=` (RLS plus `clinicId`-Filter), Mandanten-Prefix bei Upload-Finalize (wird geprüft).

---

## Folgen "Worker in Prod auf 0" (nutzersichtbar in diesem Umfang)

| Funktion | Seite | Folge |
|---|---|---|
| `kpi_daily` wird nur vom Worker gebaut (`worker/processors/kpi-rebuild.ts`), niemand außerhalb des Workers stößt es an (`enqueueKpiRebuild` hat keinen Aufrufer in `app/` oder `server/`) | Dashboard: Umsatz-Kachel, Trichter-Übersicht, No-Show-Quote, Kosten je Anfrage | bleibt 0 oder leer, siehe F-05 |
| `anomaly-scan` | Dashboard "Auffälligkeiten" | Karte sagt "alles im Bereich", obwohl nie gescannt wird, siehe F-06 |
| Review-Sync (Cron) | Dashboard "Reputation", Bewertungen | leer bis jemand "Jetzt abgleichen" klickt, siehe F-25 |
| Kampagnen-Sync | Werbebudget | leer (aber ohne verbundene Konten ohnehin Leerzustand) |
| Monatsreport-Job | Dokumente | kein Monatsreport |
| Forecast-Snapshot | Dashboard-Strip | unkritisch, `ForecastStrip` rechnet live nach (`ForecastStrip.tsx:105-117`) |

---

## P1

### F-01: Kein Fehlerrand im Portal, jede Ausnahme endet auf der englischen Next-Standardseite
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/` (einzige `error.tsx`: `(portal)/anfragen/error.tsx`; kein `(portal)/error.tsx`, kein `global-error.tsx`), `src/auth/guards.ts:15-23`
- Beleg: `find src/app -name error.tsx -o -name global-error.tsx` liefert nur `anfragen/error.tsx`. Server Actions ohne eigenes try/catch (`dateien/actions.ts:61-92`, `dateien/actions.ts:177-222`, `medien/actions.ts:22-135`, `bewertungen/feedback/actions.ts:118-168`, `einstellungen/integrationen/actions.ts:137-273`, `einstellungen/actions.ts:629-657 syncReviewsNowAction`) werfen `ForbiddenError`, `ZodError` oder DB-Fehler ungefangen.
- Szenario: Die Inhaberin tippt 20 Minuten Fragebogen, ihre Sitzung läuft ab oder die DB hat einen Aussetzer, sie klickt "Zwischenspeichern": statt einer deutschen Meldung erscheint die Next-Standardseite ("Application error: a server-side exception has occurred", englisch, ohne Portal-Rahmen). Gleiches bei jedem Server-Render-Fehler auf dem Dashboard (z. B. F-08).
- Fix-Vorschlag: `src/app/(portal)/error.tsx` (deutsch, "Das hat nicht geklappt, Ihre Eingaben bleiben erhalten. Bitte erneut versuchen" plus Reset-Knopf) und `src/app/global-error.tsx` anlegen. Aktionen mit Formularen auf Ergebnisobjekt `{ok:false,error}` umstellen (wie `saveChecklistItem` es schon tut).

### F-02: Fehlermeldungen in Einstellungen zeigen rohe Zod-JSON- und SQL-Texte
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/lib/flash.ts:68-72`, alle `catch`-Blöcke in `src/app/(portal)/einstellungen/actions.ts` (z. B. `:112-116`, `:155-157`, `:206-208`, `:260-262`, `:324-326`, `:392-395`, `:437-439`)
- Beleg: `flashMessageFromError` gibt `err.message` unverändert zurück. Bei `z.object(...).parse(...)` (zod 3.23, `package.json:75`) ist `err.message` ein JSON-String der Issues, bei Drizzle/Postgres-Fehlern ("Failed query: insert into ... params: ...", `duplicate key value violates unique constraint ...`).
- Szenario: Inhaber:in lädt "anna@praxis" (ohne Punkt) ein, legt Behandlung "Brust OP" mit Slug an oder legt ein Kürzel doppelt an: Toast "Einladung fehlgeschlagen" mit Text `[{"validation":"email","code":"invalid_string","message":"Invalid email","path":["email"]}]` oder SQL samt Parametern. Das Cookie hat 4 KB Grenze (`flash.ts:30`); eine lange SQL-Meldung lässt den Toast still ausfallen, dann sieht man gar nichts.
- Fix-Vorschlag: `flashMessageFromError` auf Whitelist umstellen: `ForbiddenError` -> "Dazu fehlt Ihnen die Berechtigung.", `ZodError` -> erste `issue.message` (deutsche Messages setzen), bewusst geworfene `Error` aus eigenem Code über eine `UserFacingError`-Klasse durchlassen, alles andere -> "Aktion fehlgeschlagen. Bitte erneut versuchen.". Postgres-Code `23505` -> "Dieser Eintrag existiert bereits."

### F-03: Fragebogen: bei Fehler im Speichern ist die ganze Eingabe weg
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/fragebogen/FragebogenForm.tsx:41-50`
- Beleg: `startTransition(async () => { const result = await saveDiscoveryAction({ answers, submit }); ... })` ohne try/catch. Wirft die Action (`requireSession` -> Redirect bei abgelaufener Sitzung, `ForbiddenError`, DB-Fehler), propagiert die Ausnahme aus der Transition in den Fehlerrand (F-01). Kein Autosave, keine lokale Sicherung (`localStorage` kommt in der Datei nicht vor). Der Fragebogen dauert laut `DISCOVERY_INTRO` 15 bis 20 Minuten.
- Szenario: Inhaberin füllt 18 Minuten lang aus, Sitzung abgelaufen (oder Handy im Funkloch: `fetch` der Action wirft), klickt "Antworten einreichen": Fehlerseite, alle Antworten weg. Das ist der Pflicht-Einstieg (Gate), die erste Erfahrung der ersten Praxis.
- Fix-Vorschlag: In `persist` try/catch, bei Fehler `setState({kind:"error", message:"Speichern fehlgeschlagen, Ihre Eingaben sind noch da. Bitte erneut versuchen."})`. Zusätzlich Antworten debounced in `localStorage` spiegeln (mit try/catch) und beim Mount mergen.

### F-04: Fragebogen: Entwurf-Speichern aus altem Tab hebt "eingereicht" auf, letzter Schreiber gewinnt still
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/fragebogen/actions.ts:131-155` (insbesondere `:133` `status: submit ? "eingereicht" : "entwurf"`), `FragebogenForm.tsx:36`
- Beleg: Jede Speicherung ersetzt `answers` komplett durch den Clientstand und setzt bei `submit:false` den Status auf `entwurf`, egal ob die Zeile schon `eingereicht` ist. Keine Versionsprüfung (`updatedAt` wird nicht verglichen).
- Szenario: Tab A reicht ein (Seite wechselt auf Lesemodus). Tab B (Handy und PC, oder zweite Person) steht noch auf dem alten Formular und klickt "Zwischenspeichern": Status springt zurück auf `entwurf`, die Antworten aus Tab A werden mit dem veralteten Stand überschrieben, die Admin-Seite sieht "Entwurf". `submittedAt` bleibt gesetzt, das Gate bleibt offen, aber EINS arbeitet auf Antworten, die die Praxis so nie eingereicht hat. Keine Warnung.
- Fix-Vorschlag: In der Action `updatedAt` des geladenen Stands mitschicken und bei Abweichung `{kind:"error", message:"Der Fragebogen wurde inzwischen an anderer Stelle geändert. Bitte laden Sie die Seite neu."}` liefern. Draft-Speicherung auf einer `eingereicht`-Zeile ablehnen (nur über `reopenDiscoveryAction`).

### F-05: Trichter, Umsatz und No-Show widersprechen den Anfragen-Kacheln, weil sie nur vom Worker leben
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/kpis.ts:44-84`, `kpis.ts:342-379`, `kpis.ts:454-498`; `src/app/(portal)/dashboard/page.tsx:202-203` (Umsatz), `:296-299` (Trichter); `DashboardDetailBundle.tsx:583-584` (`const empty = top === 0`) und `:623-640` (Kosten je Anfrage); `src/worker/processors/kpi-rebuild.ts:117` (einzige Schreibstelle)
- Beleg: Die Anfragen-Kachel liest live aus `requests` (`requests.ts:770-835`), die Trichter-Übersicht summiert `kpi_daily.leads`. `enqueueKpiRebuild` wird außerhalb des Workers nirgends aufgerufen (`grep` in `app/` und `server/` leer).
- Szenario: Erste echte Praxis bekommt in Woche 1 vier Anfragen. Kachel oben: "4 Anfragen". Direkt darunter die Trichter-Übersicht: "Im gewählten Zeitraum sind noch keine Anfragen eingegangen." Umsatz bleibt 0 €, auch wenn ein Patient als `gewonnen` markiert ist, No-Show-Quote sagt "keine Daten". Wirkt wie ein kaputtes Produkt, und der Trichter ist die Kernaussage des Portals.
- Fix-Vorschlag: Trichter-Stufen und Kosten je Anfrage (nur Anfragen/Termine/Beratungen/gewonnen) aus `requests` live berechnen (wie `leadsInRangeWithComparison`), `kpi_daily` nur für Spend/Rollups verwenden. Alternativ in der Anfrage-Mutation (Status-Update und Intake) `enqueueKpiRebuild` ersetzen durch einen synchronen Kurz-Rebuild für heute. Bis der Worker läuft: Umsatz-Kachel und No-Show-Karte ausblenden oder mit "wird nachts berechnet" kennzeichnen.

### F-06: "Auffälligkeiten" meldet "Alle Kennzahlen im erwarteten Bereich. Wir melden uns, wenn etwas abweicht", obwohl der Scan nicht läuft
- Schwere: P1
- Art: ux-flow
- Sicherheit: hoch
- Ort: `src/app/(portal)/dashboard/_components/AnomalyAlertsWidget.tsx:81-93`, `src/server/queries/anomalies.ts:43`
- Beleg: Leerzustand-Text ist fest; Datenquelle ist `dashboard_alerts`, befüllt nur vom Anomaly-Scan-Worker (in Prod auf 0).
- Szenario: Brandneue Praxis mit 0 Anfragen oder echtem Einbruch: Karte zeigt grüner Punkt und zusichernden Text. Es wird nichts überwacht, "Wir melden uns" ist falsch.
- Fix-Vorschlag: Karte ausblenden, solange der Scan nicht läuft (z. B. `dashboard_alerts` hat noch nie eine Zeile oder letzter Scan-Zeitpunkt fehlt), oder Text neutral: "Hier erscheinen Hinweise, sobald genügend Daten vorliegen."

### F-07: "Monatsziel festlegen" ist ein Sackgassen-Schritt, es gibt nirgends eine Eingabe
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/page.tsx:177-185`, `dashboard/_components/DashboardTopMetricsEnhanced.tsx:283-285` und `:354-356`, `werbebudget/page.tsx:186-191`
- Beleg: `schema.goals` wird im gesamten Portal nur gelesen (`kpis.ts:196-211`, `campaigns.ts:237-251`); Schreibzugriffe gibt es nur in `db/seed.ts:451,539`. Onboarding-Schritt zeigt "Zur Übersicht" (`/dashboard`), die Erklärpopups sagen "Das Monatsziel pflegen Sie in den Einstellungen", in `einstellungen/` kommt "Monatsziel" nicht vor.
- Szenario: Inhaber:in folgt dem Schritt, landet auf dem Dashboard, findet kein Ziel-Feld, liest in der Kachel "pflegen Sie in den Einstellungen", sucht dort ebenfalls vergeblich. Der Onboarding-Schritt wird nie grün. Werbebudget zeigt dauerhaft "Monatsziel: Kein Ziel", die Fortschrittsbalken (`progress`) und Ampeln auf den Kacheln erscheinen nie.
- Fix-Vorschlag: Entweder Formular "Monatsziel" in `einstellungen/page.tsx` mit Server Action (Metrik leads/revenue/spend, `periodStart/End` = laufender Monat, automatische Fortsetzung) bauen, oder Schritt und beide Erklärtexte entfernen und das Ziel intern (Admin) setzen lassen.

### F-08: `/werbebudget?days=abc` (oder `?days=1&days=2`) gibt 500
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/(portal)/werbebudget/page.tsx:62`, `src/server/queries/kpis.ts:161-176`, `src/server/queries/campaigns.ts:28-31,93-95`
- Beleg: `const days = Math.max(7, Math.min(90, Number(params.days ?? 30)))` -> bei `NaN` bleibt `NaN` (`Math.min(90,NaN)` ist `NaN`). `from.setDate(to.getDate() - NaN)` ergibt Invalid Date, `from.toISOString()` wirft `RangeError`. Bei Array-Parametern ebenso (`Number(["1","2"])`).
- Szenario: Eingetippter oder von einem Lesezeichen/Link-Vorschauprogramm veränderter Parameter; führt zusammen mit F-01 zur Standardfehlerseite. Hohe Wahrscheinlichkeit gering, aber trivial reproduzierbar und Teil der Prüfliste.
- Fix-Vorschlag: `const raw = Number(Array.isArray(p) ? p[0] : p); const days = [7,30,90].includes(raw) ? raw : 30;`. Gleiche Härtung für `api/kpis/route.ts` (siehe F-28).

### F-09: Alle Uhrzeiten, Tagesgrenzen und die Begrüßung laufen in UTC statt Europe/Berlin
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/lib/formatting.ts:41-53` (kein `timeZone`), `src/lib/dashboard-range.ts:83-94` (`setHours` lokal = UTC auf Vercel), `src/app/(portal)/dashboard/page.tsx:43-49,114,130-136` (`getHours`), `onboarding/fragebogen/page.tsx:73-85` (`toLocaleDateString` ohne `timeZone`)
- Beleg: Kein `Europe/Berlin` in `formatting.ts`. `germanGreeting` nutzt `d.getHours()` des Servers.
- Szenario: (a) Dateien, Dokumente, Feedback, Medien: Datum/Uhrzeit mit `formatDateTime` ist 1 bis 2 Stunden früher als die Wanduhr. Ein Upload um 00:30 Uhr trägt den Vortag. (b) Begrüßung: 06:30 Berlin (04:30 UTC) heißt "Gute Nacht", 11:30 Berlin heißt noch "Guten Morgen", 17:30 Berlin "Guten Tag", Datum zwischen 0 und 2 Uhr zeigt gestern. (c) "Heute" und "Mon" beginnen um 02:00 Berlin (Sommerzeit); eine Anfrage um 01:00 Uhr zählt zum Vortag.
- Fix-Vorschlag: In `formatting.ts` beide `Intl.DateTimeFormat` mit `timeZone: "Europe/Berlin"`. Begrüßung über `Intl.DateTimeFormat(..., {hour:"numeric", hourCycle:"h23", timeZone})`. `dashboardRangeWindow` Tagesgrenzen in Berlin berechnen (gibt es schon in `lib/guarantee-clock.ts:54-60`, wiederverwenden).

### F-10: Standorte (und andere `cacheClinicQuery`-Listen) bleiben nach Anlegen/Archivieren bis zu 10 Minuten alt
- Schwere: P1
- Art: bug
- Sicherheit: mittel (hängt an Verhalten von `revalidatePath` gegenüber `unstable_cache`)
- Ort: `src/server/queries/locations.ts:38-42`, `src/server/queries/_cache.ts:100-117` (Tag nur `kpi:<clinicId>`, TTL 600 s), `src/app/(portal)/einstellungen/actions.ts:405-440` und `:442-474` (nur `revalidatePath("/einstellungen")`), Leser `einstellungen/page.tsx:103`
- Beleg: `createLocationAction`/`archiveLocationAction` rufen weder `revalidateTag("kpi:<id>")` noch eine eigene Invalidierung auf. `unstable_cache`-Einträge werden von `revalidatePath` nach meinem Kenntnisstand nicht geleert.
- Szenario: Inhaber:in legt "Standort Süd" an, bekommt "Standort angelegt", die Liste zeigt ihn nicht (Cache), sie klickt nochmal und hat zwei gleiche Standorte; die Dashboard-Karte "Standorte" (`showLocations = locations.length > 1`, `DashboardDetailBundle.tsx:103-117`) erscheint erst nach Ablauf.
- Fix-Vorschlag: In beiden Actions im `finally` `revalidateTag(\`kpi:${session.clinicId}\`)` ergänzen oder `listLocations` ungecacht lassen (Einstellungen brauchen keinen Cache). Vor dem Fix kurz prüfen, ob der Effekt in Prod wirklich auftritt.

### F-11: "Geheimnis rotieren" ohne Rückfrage macht sofort alle Zielseiten-Formulare unwirksam
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/einstellungen/page.tsx:604-608`, `src/app/(portal)/einstellungen/actions.ts:690-733`
- Beleg: Einzelklick `<form action={rotateIntakeSecretAction}>`, die Action ersetzt `accessTokenEnc` und leert den Cache, ohne Übergangszeit. Der Hinweistext (`:597-602`) sagt selbst: "sonst werden Anfragen bis dahin abgelehnt". Zum Vergleich: der n8n-Pfad fragt nach (`setup/n8n/_reveal.tsx:18`).
- Szenario: Eine Inhaberin liest "Geheimnis", klickt neugierig, ab da werden Formularanfragen der Zielseite abgelehnt (Anfragen gehen verloren, Garantie-Uhr läuft ohne Messweg), sie kann das neue Geheimnis nicht in die Zielseiten-Konfiguration eintragen (technisch, bei EINS).
- Fix-Vorschlag: Rotation nur für EINS-Admin oder zumindest mit Bestätigungsdialog plus Doppelgeheimnis-Übergang (altes Geheimnis 24 h parallel gültig).

### F-12: R2-Upload braucht Bucket-CORS für `PUT`, im Repo ist nichts dazu dokumentiert oder prüfbar
- Schwere: P1
- Art: robustness
- Sicherheit: niedrig (nicht ausführbar geprüft)
- Ort: `src/lib/upload-client.ts:197-228`, `src/server/uploads.ts:265-289`, `src/server/storage.ts:188-214`
- Beleg: Browser-`XMLHttpRequest` `PUT` auf eine R2-Presigned-URL (anderer Origin) mit `Content-Type`-Header löst Preflight aus. In `docs/` und `apps/portal` steht keine CORS-Konfiguration (`grep -ri AllowedOrigins` nur in einer fremden Route).
- Szenario: Ist CORS am Bucket nicht gesetzt, schlagen ALLE Uploads (Dateien an EINS, Checkliste AVV, Logo) mit "Verbindung unterbrochen" (`uploadErrorText`, `xhr.onerror`) fehl, obwohl die Verbindung in Ordnung ist. AVV-Upload ist Gate-Blocker A1.
- Fix-Vorschlag: Vor Start der ersten Praxis einen echten Upload in Prod testen und die CORS-Regel (Origin `https://portal.eins.ag`, Methoden `PUT, GET, HEAD`, Header `content-type`, `ExposeHeaders: ETag`) in `docs/` festhalten.

### F-13: DSGVO-Löschung entfernt keine Dateien aus R2, Export (Art. 15) lässt Praxis-Daten aus
- Schwere: P1
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/server/dsgvo.ts:36-260` (kein `getStorage()`), `src/app/admin/clinics/[id]/dsgvo/actions.ts`
- Beleg: `eraseClinicData` löscht Zeilen (`assets`, `documents`, `client_uploads` über Kaskade), aber kein einziges Objekt in R2. Betroffen: Klon-Aufnahmen, Einwilligungs-PDFs, Checklisten-Dateien, Avatare (`avatars/<userId>.<ext>`), Dokumente. `exportClinicData` (`:76-190`) enthält weder `client_uploads`, `checklist_items`, `checklist_files`, `discovery_fragebogen`, `clinic_timeline_entries`, `leitfaden_quiz_attempts` noch `feedback`.
- Szenario: Eine Praxis kündigt, EINS löscht sie "vollständig". Die Objekte (u. a. Gesichts-/Stimmaufnahmen, versprochene Löschung "spätestens 30 Tage nach Vertragsende" laut `north-star.md`) bleiben unbegrenzt im Bucket, nur ohne Verweis darauf. Der Export ist unvollständig.
- Fix-Vorschlag: Vor dem `delete` alle `storage_key`-Spalten (`assets`, `documents`, `client_uploads`, `checklist_files`, `clinic_users.avatar_key`, `animation_instances.storage_key_customized`) einsammeln und nach Commit per `getStorage().remove` löschen (Fehler loggen, Liste im Audit-Eintrag). Export um die fehlenden Tabellen ergänzen. Rechtliche Einordnung ist deine Entscheidung; technisch ist die Lücke eindeutig.

---

## P2

### F-14: Onboarding-Gate und "Neu"-Pillen hängen am Layout, das bei Klicks innerhalb des Portals nicht neu läuft
- Schwere: P2
- Art: bug
- Sicherheit: mittel
- Ort: `src/app/(portal)/layout.tsx:58-69` (Gate-Redirect, `markSectionSeen`), `src/server/queries/navBadges.ts:61-90`
- Beleg: Die Gate-Prüfung und `markSectionSeen` stehen ausschließlich im geteilten Layout. In der App-Router-Teilrenderung wird ein Layout bei Navigation zwischen Seiten darunter nicht erneut ausgeführt; `markSectionSeen` wird nirgends sonst aufgerufen (`grep`). Die Seitenkomponenten selbst prüfen das Gate nicht.
- Szenario: (1) Inhaber:in mit offenem Gate klickt in der Seitenleiste auf "Übersicht": das Layout läuft nicht neu, die Seite lädt, das Gate hat nicht gegriffen. Nur harte Aufrufe (Reload, Link von außen) werden umgeleitet. (2) "Neu"-Pille an Medien/Dokumente/Fortschritt verschwindet nach Klick nicht, erst nach Reload.
- Fix-Vorschlag: Gate zusätzlich in den Seiten (z. B. kleiner Helfer `requireGateOpen()` in `requirePermissionOrRedirect`) prüfen. `markSectionSeen` aus der jeweiligen Seite (oder einem kleinen Client-Effekt per Action) aufrufen. Vor Umbau im Browser verifizieren.

### F-15: Medien: alte Versionen werden mitangezeigt; interne Felder sichtbar; Notiz ohne Längengrenze wirft
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/assets.ts:12-28` (Kommentar behauptet "only the latest of each lineage", Code filtert nicht auf `supersedesId`), `app/(portal)/medien/page.tsx:279-298` (MIME, "Mux ID", Version), `medien/page.tsx:384-390` (`<textarea name="note">` ohne `maxLength`), `medien/actions.ts:14,27-30` (`max(1000)` -> `Input.parse` wirft)
- Beleg: `schema.assets.supersedesId` existiert (`db/schema.ts:869`), `listAssets` wählt alle Zeilen.
- Szenario: EINS lädt Version 2 eines Beitrags hoch: beide, v1 und v2, erscheinen als Karten, Praxis veröffentlicht evtl. die alte. Karten zeigen "MIME: video/mp4", "Mux ID: ...". Bei Notiz >1000 Zeichen: Fehlerseite (F-01), Text weg. Doppelklick auf "Anpassung anfordern": zwei parallele Upserts, der zweite kann an der Unique-Constraint scheitern.
- Fix-Vorschlag: In `listAssets` `NOT EXISTS (select 1 from assets a2 where a2.supersedes_id = assets.id)` ergänzen. MIME/Mux-ID aus der Praxis-Ansicht entfernen. `maxLength={1000}` am Textarea, Action auf `safeParse` mit deutschem Fehler. `useFormStatus`-Disable am Button.

### F-16: Checkliste: Links ohne Prüfung, "www.dropbox.com/..." wird in der Admin-Ansicht zum relativen Link
- Schwere: P2
- Art: bug
- Sicherheit: mittel
- Ort: `src/app/(portal)/onboarding/checkliste/actions.ts:105` (`out.link = v.trim().slice(0,2000)`), `src/app/admin/clinics/[id]/_components/ChecklisteTab.tsx:263,279-283` (`<a href={link}>`)
- Beleg: Keine Schema-/URL-Prüfung für `link`. Leute tippen "drive.google.com/..." ohne `https://`.
- Szenario: Inhaber:in fügt Link ohne Schema ein, Status wird `geliefert`, EINS klickt in der Admin-Ansicht und landet auf `admin.eins.ag/clinics/<id>/drive.google.com/...` (404). Beliebige Schemata (`javascript:`, `data:`) werden gespeichert; React 19 blockiert `javascript:`-Hrefs, aber `data:`/`file:` nicht.
- Fix-Vorschlag: In `sanitizeAnswer` Link normalisieren: ohne Schema `https://` voranstellen, nur `http(s)` zulassen, sonst deutscher Feldfehler (`validateChecklistFields` erweitern, Format `url`).

### F-17: Uploads: keine Größen-/Typprüfung am fertigen Objekt (Dateien an EINS), Waisen, Wiederholen-Knopf tot
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/dateien/actions.ts:112-171` (kein Limit auf `head.size`, kein Typ-Recheck; Gegenstück: `onboarding/checkliste/actions.ts:330-335` prüft das), `dateien/UploadForm.tsx:452-460,609-613`, `src/server/uploads.ts:297-303`
- Beleg: Der Presigned-`PUT` kann keine Größe erzwingen; `createClientUploadTargetsAction` prüft nur die vom Client genannte `size`. `verifyUploadedObject` akzeptiert jedes `size > 0`. In `UploadForm` wird bei `!fin.ok` kein Stand zurückgesetzt (alle "done"), erneuter Versand mint neue Schlüssel und lädt alles nochmal hoch (Waisen in R2). Der Senden-Knopf ist deaktiviert, sobald nur noch Zeilen mit Status "error" übrig sind (`filter(status !== "error").length === 0`), "Bitte erneut hochladen" verlangt Entfernen und Neuauswahl.
- Szenario: (a) Bearbeitete Browser-Anfrage lädt 5 GB `.mp4` auf den signierten Schlüssel (Speicherkosten, Inhaberkonto vorausgesetzt). (b) Leitungsabbruch während der Finalisierung: Dateien liegen in R2, DB hat nichts, Wiederholung erzeugt Dubletten. (c) Eine von drei Dateien scheitert, der Nutzer kann sie nicht per Knopf erneut senden.
- Fix-Vorschlag: In `finalizeClientUploadsAction` `head.size > uploadLimitForExtension(ext)` -> `remove` und `failed`. Fehlerzeilen bei erneutem Senden mitsenden (`staged.filter(s => s.status !== "done")`) und Knopf aktiv lassen. Für Waisen ein Aufräum-Job (Objekte unter `*/uploads/` ohne DB-Zeile, älter 24 h) einplanen.

### F-18: Checkliste/Fragebogen in zwei Tabs: Stand wird nicht neu geladen, Einfügen kann an Unique-Constraint scheitern
- Schwere: P2
- Art: robustness
- Sicherheit: mittel
- Ort: `onboarding/checkliste/ChecklisteForm.tsx:154-156` (`useState(state.answer)` ohne Resync nach `router.refresh()`), `checkliste/actions.ts:156-226` (`select` dann `insert`), `:343-399`
- Beleg: Zwei parallele Erst-Speicherungen desselben Punkts lesen beide `existing = undefined` und fügen beide ein. Das zweite `insert` wirft (`(clinic_id,item_id)` eindeutig, vermutet); der Client fängt keine Ausnahme (`persist` in `ChecklisteForm.tsx:182-193` hat kein try/catch). `useState` hält den alten Stand, wenn EINS den Punkt inzwischen auf "geprüft" gesetzt hat oder ein zweiter Nutzer ändert; Speichern überschreibt und setzt "geprüft" zurück.
- Szenario: Inhaber und Assistenz arbeiten parallel an der Checkliste: stille Überschreibung, gelegentlich Fehlerseite.
- Fix-Vorschlag: `onConflictDoUpdate` statt Select/Insert. `key={updatedAt}` an der Karte setzen, damit sich der Stand nach Refresh erneuert. try/catch um alle `start(async …)`-Blöcke.

### F-19: HWG-Check meldet "sauber" bei typischen Verstößen (Regex-Lücken)
- Schwere: P2
- Art: bug
- Sicherheit: hoch
- Ort: `src/server/hwg.ts:46-132`
- Beleg: `\b` in JS-Regex ist ASCII-only und braucht Wortzeichen auf einer Seite. Konkret: `/\b(rabatt|\-\s*\d+\s*%|sale|angebot)\b.{0,40}\b(...)/` trifft "-20 % auf Botox" nicht, weil zwischen Leerzeichen und `-` keine Wortgrenze liegt. `garantie|garantiert` trifft "Garantie", nicht "garantierte Ergebnisse"/"Garantien". `vorher[-\s]?nachher` trifft "Vorher/Nachher", "Vorher- und Nachher-Bilder", "Before & After" nicht. `risikofrei` ja, "ohne Risiko" nein (nur "ohne risiken").
- Szenario: Marketing prüft "Jetzt -20 % auf Botox, garantierte Ergebnisse, Vorher/Nachher ansehen": Ergebnis `clean` mit grünem Haken. Das Werkzeug erzeugt falsche Sicherheit für Praxen, die HWG-Fehler teuer abmahnen.
- Fix-Vorschlag: Muster ohne `\b` vor Nicht-Wortzeichen, Stämme statt Vollwörter (`garantier\w*`, `vorher\W+(?:und\W+)?nachher`, `before\W*(?:&|and)?\W*after`), Test-Datei mit 20 Positiv-/Negativbeispielen anlegen. Ergebnistext von "sauber" auf "keine der geprüften Muster gefunden" (der Text steht schon in `HwgForm.tsx:78`, Kopfzeile prüfen).

### F-20: Behandlung anlegen: technisches "Kürzel (slug)", kein Treffer ohne Stichwörter, Dubletten als Rohfehler
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `einstellungen/page.tsx:794-806`, `einstellungen/actions.ts:333-370` (`SlugSchema`), `src/server/queries/treatments.ts:52-81`
- Beleg: Pflichtfeld Slug mit `pattern="[a-z0-9\-]+"`; "Brust-OP" scheitert. Kategorisierung sucht nur in `keywords`, nicht im Namen; Feld ist optional.
- Szenario: Inhaberin legt "Lid-OP" an (Browser meldet Muster, englisch/technisch), ohne Stichwörter angelegt matcht die Behandlung nie, alle Anfragen bleiben "Sonstige". Zweite "Botox" mit gleichem Slug: Rohfehler (F-02).
- Fix-Vorschlag: Slug serverseitig aus dem Namen erzeugen (Umlaute, Eindeutigkeit mit Zähler), Feld entfernen. Name immer als Stichwort mitzählen.

### F-21: Team- und Löschaktionen ohne Bestätigung; keine Einladung erneut senden
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `einstellungen/page.tsx:726-737` (Entfernen), `:834`, `:890` (Behandlung/Standort archivieren), `:1008` (Werbekonto trennen), `dateien/page.tsx:507-516` (Datei löschen), `einstellungen/actions.ts:24-116` (Invite)
- Beleg: Alle sind einfache `<form action=…>` ohne Rückfrage. `inviteTeamMemberAction` legt die Zeile vor `issueMagicLink` an (`:70-94`); scheitert der Versand, steht "bereits eingetragen" (`:62-64`) beim nächsten Versuch. Es gibt keinen "Einladung erneut senden"-Knopf; abgelaufene Links sind eine Sackgasse (Workaround: Entfernen, neu einladen).
- Szenario: Fehlklick auf "Entfernen" sperrt eine Mitarbeiterin sofort; Fehlklick auf Mülleimer neben einer Datei löscht sie samt R2-Objekt unwiderruflich (jede Rolle, auch Dateien anderer Nutzer). Einladung geht in Spam, Praxis kommt nicht weiter.
- Fix-Vorschlag: Kleiner Client-Confirm (`window.confirm` genügt, wie `n8n/_reveal.tsx`). "Erneut senden" pro Zeile mit Status "Einladung offen".

### F-22: "Kosten je Anfrage 0 €" bei organischem Start; Behandlungs- und Kampagnenzahlen zählen Spam mit
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `kpis.ts:81` (`spend / leads` = 0), `DashboardDetailBundle.tsx:631-633`; `attribution.ts:304,240` (`count(*)` ohne `status <> 'spam'`), `campaigns.ts:123-126`
- Beleg: Der Start ist laut `north-star.md` organisch, Spend ist 0, `costPerLead` wird `0` statt `null` (nur `leads > 0` geprüft) und als "0 €" gerendert. `bySourceUncached` filtert Spam (`:74`), `byTreatmentUncached` nicht.
- Szenario: Praxis sieht "Kosten je Anfrage 0 €" (wirkt wie Fehler oder Wunder), Summe der Behandlungs-Anfragen ist größer als die Anfragen-Kachel.
- Fix-Vorschlag: `costPerLead: spend > 0 && leads > 0 ? … : null`, Anzeige "–" (oder "kein Werbebudget"). Überall `count(*) FILTER (WHERE status <> 'spam')`.

### F-23: Rolle `frontdesk` sieht Umsatz, Cashflow-Forecast, Werbebudget samt Konto-ID und rohe Sync-Fehler
- Schwere: P2
- Art: security
- Sicherheit: mittel
- Ort: `src/lib/roles.ts:11-12,24-25` (`dashboard.view.full`, `campaigns.live`, `reports.view` für alle Rollen), `dashboard/page.tsx:112-160` (nur `requireSession`), `werbebudget/page.tsx:60`, `werbebudget/page.tsx:426-435` (Konto-ID, `cred.lastSyncError`)
- Beleg: Rezeption (`defaultLandingPath` schickt sie auf `/anfragen`) kann `/dashboard` und `/werbebudget` direkt aufrufen: Umsatz, Pipeline-Wert, Werbebudget, Behandlungsumsätze, Konto-ID, englische Roh-Fehlermeldungen der Plattform-API.
- Szenario: Eine Praxis will Umsatzzahlen nicht der Rezeption zeigen. Ob das gewollt ist, ist Produktentscheidung; bei "gewollt" fehlt die Dokumentation, bei "nicht gewollt" ist es ein Datenleck innerhalb der Praxis.
- Fix-Vorschlag: Entscheiden; falls nicht gewollt: `dashboard.view.full` und `campaigns.live` auf `inhaber, marketing` setzen und Umsatz-/Forecast-Karten dahinter gaten. `lastSyncError` nur für Inhaber, auf deutschen Standardtext mappen.

### F-24: "Offene Anfragen"-Verlauf: Kreuzprodukt Tage x Anfragen mit korrelierter Unterabfrage, bei "Max" mehrere Sekunden
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/server/queries/requests.ts:1007-1032`, aufgerufen zweimal je Render (`DashboardTopMetricsEnhanced.tsx:~150-170`: aktuelles und Vorfenster)
- Beleg: `generate_series` über bis zu 1825 Tage `CROSS JOIN requests`, je Zeile eine Unterabfrage auf `request_activities`. Zwei Aufrufe, Vorperiode eingeschlossen (Max = 5 Jahre + 5 Jahre).
- Szenario: Nach einigen Monaten Betrieb (1.000+ Anfragen) wählt die Inhaberin "Max": 1.825 x 1.000 x 2 = 3,6 Mio Unterabfragen, Kachel läuft in die Funktionslaufzeit.
- Fix-Vorschlag: Statusverläufe einmal laden und die Tageszähler in Node per Sweep berechnen, oder Fenster für diese Kachel auf 365 Tage deckeln.

### F-25: Reputation: Link "Erste Bewertung hinzufügen" führt ins Leere; "Jetzt abgleichen" läuft inline und wirft ungefangen
- Schwere: P2
- Art: ux-flow
- Sicherheit: hoch
- Ort: `DashboardDetailBundle.tsx:187-199`, `einstellungen/actions.ts:629-657`, Kommentar `:858-860` ("Manual review-snapshot entry was removed")
- Beleg: Dashboard-Leerzustand fordert zum manuellen Hinzufügen auf, Eingabe wurde entfernt. `syncReviewsNowAction` ruft `syncAllReviewsForClinic` ohne try/catch auf (externe HTTP-Aufrufe), Fehler -> F-01; mit Worker auf 0 ist das der einzige Weg, Bewertungen zu bekommen.
- Szenario: Praxis klickt "Erste Bewertung hinzufügen", landet auf Bewertungen ohne Eingabe. "Jetzt abgleichen" bei Netz-/Plattformfehler: Fehlerseite statt Meldung.
- Fix-Vorschlag: Link-Text auf "Bewertungsplattformen verbinden" ändern. Action in try/catch, Ergebnis `outcomes` auch bei Fehler flashen.

### F-26: Fragebogen-Budgetfeld: `parseEuroAmount` verträgt Unsinn
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `onboarding/fragebogen/content.ts:380-387`, `FragebogenForm.tsx:304-326`
- Beleg: Nimmt den Teil vor dem ersten Komma und entfernt alle Nicht-Ziffern. "1.5" (englisch) -> 15 €, "2000 bis 3000" -> 20003000, "ca. 3 Mio" -> 3. Gespeichert wird der Rohtext, die Bestätigung "Geplant: 15 € pro Monat" erscheint nur live.
- Szenario: Inhaberin tippt "2000-3000", Systeme lesen später 20003000 oder 2000 uneindeutig. Eingabe mit Cent ("1.500,50 €") wird korrekt zu 1500 geparst, aber der Rohtext mit Komma landet in der DB.
- Fix-Vorschlag: Strenge Regex `^\d{1,3}(\.\d{3})*(,\d{1,2})?\s*€?$|^\d+$`, sonst Fehler. Beim Speichern die normalisierte Zahl als String ablegen.

---

## P3

### F-27: Mapping-Aktionen ohne Eingabeprüfung und Mandantenprüfung der Ziel-ID
- Schwere: P3
- Art: security
- Sicherheit: niedrig
- Ort: `einstellungen/integrationen/actions.ts:203-273`
- Beleg: `portalTreatmentId`/`portalLocationId`/`setStatus` kommen unvalidiert vom Client; Schreiben über `db` (umgeht RLS) mit Filter nur auf die Mapping-Zeile. Ob ein FK oder Check den Mandanten absichert, ist aus dem Code nicht ersichtlich.
- Szenario: Ein Inhaber mit fremder UUID kann ein Mapping auf fremde Behandlung setzen (UUID müsste bekannt sein); ungültiger `setStatus` -> DB-Fehler -> F-01.
- Fix-Vorschlag: zod-Schema mit `uuid().nullable()` und `enum`; vorab prüfen, dass die Ziel-Zeile zur `clinicId` gehört.

### F-28: `/api/kpis` mit formal gültigem, aber unmöglichem Datum gibt 500
- Schwere: P3
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/api/kpis/route.ts:18-29`
- Beleg: Regex `^\d{4}-\d{2}-\d{2}$` lässt `2026-13-45` zu; `new Date("2026-13-45T00:00:00Z")` ist Invalid Date, `from > to` ist `false`, anschließend `toISOString()` wirft.
- Fix-Vorschlag: `Number.isNaN(from.getTime())` prüfen und 422 liefern; Spannweite deckeln.

### F-29: Zeitleiste lässt Einträge mit unbekanntem Status unsichtbar fallen
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `fortschritt/_components/TimelineList.tsx:215-227,241-258` (Filter nur auf drei Statuswerte; der "geplant"-Fallback in `TimelineCard:140-144` wird nie erreicht)
- Szenario: Admin legt Eintrag mit neuem Status an: Praxis sieht ihn nirgends; sind alle Einträge so, zeigt die Seite leer, aber ohne EmptyState.
- Fix-Vorschlag: Unbekannte Status in "Als Nächstes" einsortieren.

### F-30: Cookie wird in Server-Komponente gelöscht (Flash für Review-Sync und Intake-Geheimnis)
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `einstellungen/actions.ts:659-675` (`consumeReviewSyncFlash`) und `:735-745` (`consumeIntakeSecretFlash`), aufgerufen aus `einstellungen/page.tsx:69-72`
- Beleg: `jar.delete(...)` in einem Server-Render. `lib/flash.ts:50-52` begründet selbst, dass Next 15 das in Server Components verbietet und dafür die Middleware verwendet.
- Szenario: Im Zweitrender (zweiter Tab, GET, Reload innerhalb von 5 Minuten nach Rotation) kann `delete` werfen: Einstellungen-Seite 500 bis das Cookie abläuft; das neue Geheimnis wird nicht angezeigt. Nach der Action selbst funktioniert es vermutlich.
- Fix-Vorschlag: Wie beim Action-Flash über Middleware oder per Server Action beim Anzeigen entfernen.

### F-31: Copy-Regeln und Rechtshinweise im Kundentext
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: Gedankenstriche U+2014 im sichtbaren Text: `bewertungen/feedback/page.tsx:56,96,143`, `bewertungen/feedback/[id]/page.tsx:33,144,176,236`, `einstellungen/integrationen/setup/page.tsx:49,68`, `.../setup/n8n/_reveal.tsx:18`, `.../gdt-agent/page.tsx:65`, `.../ads-conversion/page.tsx:124,135`. Versalien (`uppercase`): `ForecastStrip.tsx:53`, `AnomalyAlertsWidget.tsx:130,146`, `bewertungen/page.tsx`, `PlatformTile.tsx`, `BreakdownStackChart.tsx`, `detail-helpers.tsx`, `medien/page.tsx:340`. Anglizismen: "ROAS" (`DashboardTopMetricsEnhanced.tsx:~269,~290`, Treatment-Tabelle), "Reputation", "Pace"/"Hochrechnung (Pace)" (`werbebudget/page.tsx:152`), "CPL"/"Impressions"/"CTR", "Cashflow-Forecast", "Pipeline-Wert", "Baseline" (`AnomalyAlertsWidget.tsx:~46`), "Conversion-Einstellungen", "Mon" als Zeitraum-Label (`dashboard-range.ts:41-46`, mehrdeutig). Interne Felder "MIME", "Mux ID" (`medien/page.tsx:283-297`).
- Rechtshinweise: `leitfaden/content.ts:1040` ("AGB vor Auslieferung anwaltlich prüfen lassen"), `:1106` ("anwaltliche Prüfung der Skripte und AGB-Passagen"), `hwg-check/HwgForm.tsx:44,78`, `hwg-check/page.tsx:41` ("juristische Freigabe", "keine Rechtsberatung"). Das sind veraltete Verweise im Sinne deiner Regel (kein Anwalt als Lösung); sie stehen im Kundentext.
- Fix-Vorschlag: Texte bereinigen, die Stellen als offene Punkte für dich behandeln, nicht als Empfehlung an Kunden weitergeben.

---

## Design-Kritik (nur Kritik)

- Werbebudget: Die Hero-Zeile hat `grid-cols-3` ab 0 px mit `text-3xl` Zahlen (`werbebudget/page.tsx:~395`); bei 375 px und Beträgen ab "12.345 €" brechen oder überlappen die drei Spalten. Die Kampagnen-Tabelle hat 8 Spalten und scrollt auf dem Handy horizontal.
- Dashboard: Zeitraum-Kürzel "Mon" liest sich wie ein Wochentag; "Heute" auf einer neuen Praxis zeigt fast immer leere Diagramme. Alle Zeitraumschalter sind pro Karte, die Zuordnung der Karten zueinander (4 Fenster) ist für Nicht-Techniker verwirrend.
- Dateien: Papierkorb-Symbol (16 px) ohne Fläche und ohne Bestätigung, Tippziel unter 44 px (`dateien/page.tsx:507-516`), direkt neben "Von EINS gesehen".
- Einstellungen: Formulare im Raster `md:grid-cols-[1fr_1fr_1.5fr_auto]` fallen auf dem Handy auf eine Spalte, "Kürzel (slug)" ist für die Zielgruppe unverständlich (siehe F-20).
- Fortschritt: Karten für relative Phasen ohne Datum zeigen nur "Woche 1 bis 2", keine Aussage zum Stand.
- Fragebogen: 40+ Felder auf einer Seite ohne Fortschrittsanker oder Abschnittsnavigation; auf dem Handy ein sehr langer Scroll ohne Zwischenspeichern (F-03).

---

## Zusammenfassung

Anzahl: P0 = 0, P1 = 13, P2 = 13, P3 = 5 (31 Befunde, F-01 bis F-31).

Dringendste Punkte:
1. F-01 und F-03: Es gibt keinen Fehlerrand, ein einziger Server-Fehler oder Sitzungsablauf lässt den Pflicht-Fragebogen der ersten Praxis komplett verschwinden.
2. F-05, F-06, F-07: Trichter, Umsatz und "Auffälligkeiten" hängen am abgeschalteten Worker bzw. fehlen ganz (Monatsziel hat keine Eingabe), das Dashboard widerspricht sich ab der ersten Anfrage.
3. F-09, F-02, F-10: Alle Zeiten sind UTC, Fehlertoasts zeigen rohes JSON/SQL, und neu angelegte Standorte erscheinen bis zu 10 Minuten nicht.
