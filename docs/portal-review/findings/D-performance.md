# D: Performance-Review (apps/portal/src)

Lens: Performance. Nur gelesen, nichts geändert. Pfade relativ zu `apps/portal/` (Quellcode unter `src/`).

Hinweise zu den Schätzungen: Alle Zeitangaben sind Schätzungen aus der Anzahl sequenzieller Roundtrips (RT), nicht gemessen. Annahme: Vercel fra1 und Neon im selben Rechenzentrum, RT über den Pooler grob 2 bis 5 ms, kleine Datenmengen. Ein `withClinicContext`-Aufruf kostet 4 RT (BEGIN, set_config, Query, COMMIT, `src/db/client.ts:126-136`). Der eigentliche Schmerz in Produktion ist nicht die warme Latenz, sondern: (a) kalte Vercel-Instanz mit bis zu 10 neuen TLS-Verbindungen pro Pool (`clientOptions`, `max: 10`, zwei Pools super/app), (b) Neon-Compute nach Leerlauf (Autosuspend, Aufwecken 0,5 bis 3 s bei der ersten Query), beides trifft genau den Inhaber, der morgens einmal am Handy aufmacht. Jede eingesparte Query-Welle verkürzt diesen Kaltpfad.

Middleware (`src/middleware.ts`): kein Befund. Edge, nur Regex und Header, kein DB-Zugriff, Matcher schließt `_next`, Statics, vitals, uploads aus. Kosten pro Anfrage vernachlässigbar.

Client-Polling: kein Befund. Es gibt kein Intervall-Polling im Portal außer dem CSV-Wizard (D-17). `/api/notifications` hat keinen Client-Aufrufer, `/api/vitals` ist ein Beacon (Edge, Rate-Limit). Die Suche ist lazy geladen (`PortalShell.tsx:41`, `searchLoaded`) und mit 250 ms entprellt (`GlobalSearchDialog.tsx:160-185`). Die Anfragen-Suche ist mit Debounce versehen (`AnfragenFilters.tsx:88-101`).

Server-only-Leck: kein Befund. `@react-pdf/renderer` (`server/reports/*`), `csv-parse` (`server/pvs-csv-parse.ts`, Worker) und `@aws-sdk` (`server/storage.ts`, dynamischer Import, `serverExternalPackages`) sind von keiner `"use client"`-Datei erreichbar (geprüft per grep über alle Client-Dateien). Charts sind handgeschriebenes SVG in `@eins/ui` (keine Chart-Bibliothek im Bundle). Admin-Ereignisliste ist virtualisiert (`EventsPanel.tsx`, `useVirtualizer`).

---

### D-1: Alle Nav-Links laden die ganze Seite vor (prefetch=true), auf dem Desktop beim ersten Laden jeder Seite
- Schwere: P1
- Art: performance
- Sicherheit: hoch (Mechanismus), mittel (Ausmaß)
- Ort: `src/app/(portal)/_components/PortalShell.tsx:565`, `:618`, `:736`, `:787`; `next.config.ts` (`staleTimes.dynamic: 30`)
- Beleg: `prefetch={exactlyActive ? false : true}` an jedem Sidebar-Link, im Kommentar ausdrücklich als "Full prefetch (page body + layout)" begründet. Alle (portal)-Routen sind dynamisch (Cookies), also wird bei `prefetch={true}` der komplette Server-Render jeder anderen Nav-Seite angestoßen, sobald der Link im Viewport ist. Die Desktop-Leiste ist immer im Viewport. Auf dem Handy liegt der Drawer mit `-translate-x-full` außerhalb, dort feuert es erst beim Öffnen des Drawers (alle Links gleichzeitig).
- Szenario: Inhaber öffnet am Rechner `/anfragen`. Im Hintergrund starten gleichzeitig Renders für Dashboard (nach Zählung unten 25 bis 36 Transaktionen), Werbebudget (7 Transaktionen), Medien, Dokumente, Fortschritt, Bewertungen, Dateien, Leitfaden usw. Das sind je Seitenaufruf grob 10 zusätzliche Funktionsaufrufe und 60 bis 100 Transaktionen auf Neon, jeweils mit eigener Kaltstart-Chance und eigenem 10er-Pool. Das konkurriert um Bandbreite und DB-Verbindungen mit der Seite, die der Nutzer tatsächlich will, und kostet Neon-Rechenzeit ohne Nutzen für Tage, an denen niemand weiterklickt. Die 30-s-staleTime des Router-Cache ändert daran nichts (Prefetch mit `true` wird länger gecacht, aber jeder Seitenaufruf löst neu aus, sobald der Cache leer ist). Zusätzliche Folge: ein Prefetch auf `/fortschritt`, `/medien`, `/dokumente` läuft durch das Layout mit `x-portal-pathname` dieser Seite, also kann `markSectionSeen` (`layout.tsx:66-69`) für eine nur vorgeladene, nie geöffnete Seite die "Neu"-Markierung löschen (Sicherheit niedrig, ob Next das Layout beim Prefetch wirklich erneut rendert; bitte prüfen).
- Fix-Vorschlag: `prefetch` entfernen (Default: nur Skeleton aus `loading.tsx` vorladen) oder auf `false` setzen und stattdessen `router.prefetch` nur für die zwei bis drei meistgenutzten Ziele (Anfragen, Dashboard) nach `requestIdleCallback`. Die Klick-Latenz fängt `loading.tsx` plus `TopProgressBar` ab, wenn die Seitenrenders selbst schneller werden (D-2 bis D-4).

### D-2: Dashboard: 25 bis 36 Transaktionen in drei Wellen, nichts davon in einer Transaktion gebündelt
- Schwere: P1
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/dashboard/page.tsx:178-210`, `_components/DashboardTopMetricsEnhanced.tsx:155-198`, `_components/DashboardDetailBundle.tsx:101-127`, `src/server/queries/_cache.ts`
- Beleg: Zählung bei kaltem `unstable_cache` (alle Queries nutzen `withClinicContext`, jede ist eine eigene Transaktion mit 4 RT):
  - Top-Metriken, Welle 1 (`page.tsx:178`): `leadsInRangeWithComparison`, `kpiSummary` x2, `bySource`, `currentGoals`, `requestStatusCounts`, `slaBreachedCount`, `openLeadsForDashboard` = 8 Transaktionen, dazu `getClinicRelationshipStart` (1 Statement). Danach, sequenziell, Welle 2 (`TopMetricsEnhanced:155`): `leadsDailyInRange` x2, `openQueueDailyInRangeWithComparison` x2 (je zwei Statements in der Transaktion), `kpiDailySeriesWithSparklineFresh` x2, `ltvBySource` = 7 Transaktionen. Das ist ein Wasserfall: Welle 2 wartet auf Welle 1, obwohl die Argumente nur vom Range-Parameter abhängen.
  - Detail-Bundle (`DashboardDetailLoader`): erst `kpiSummaryFresh` x2 (2 Transaktionen), dann Welle 2 mit 8 Transaktionen (`latestReviews`, `reviewTrend`, `byLocation`, `listLocations`, `byTreatment` x2, `noShowWindow` x2).
  - Forecast (D-3) 1 Transaktion + 7 Statements, Anomalien 1 Transaktion.
  - Layout (D-4) bis zu 9 Transaktionen bei Badge-Cache-Miss.
  - Summe kalt: 8+7+10+1+1 = 27 Transaktionen auf der Seite plus 8 Einzel-Statements, plus Layout, grob 150 RT. Der Pool hat `max: 10`, es werden also bis zu 10 TLS-Verbindungen aufgebaut und der Rest wartet.
  - Caching: `cacheClinicQuery` hilft nur bei Treffer (30 s bzw. 600 s TTL). Der Worker ist in Prod auf 0, also feuert `revalidateTag('kpi:<id>')` nie; die Karten bleiben bis zu 600 s alt und die Cache-Treffer laufen trotzdem je über einen Vercel-Data-Cache-Lookup (ca. 25 pro Render). Die erste Anfrage jedes Inhabers am Tag (30 s TTL) ist immer kalt.
- Szenario: Inhaber öffnet morgens das Dashboard am Handy, Instanz und Neon kalt. Kritischer Pfad ungefähr: Layout (D-4, 11 RT) dann Top-Metriken 2 Wellen (8 bis 9 RT tief) und parallel Detail 2 Wellen (8 bis 9 RT tief), zusammen 20+ RT tief plus 10 neue TLS-Verbindungen plus ggf. Neon-Aufwachen. Geschätzt 1 bis 2,5 s bis zum letzten Karteninhalt, bis zu 3 bis 5 s bei Neon-Aufwachen. Die Seite streamt zwar per Suspense, aber die Skeletons erscheinen erst nach dem Layout (D-4), und die Karten kommen in Wellen.
- Fix-Vorschlag: (1) Eine einzige `loadDashboardData(clinicId, userId, ranges)`-Funktion, die alle Reads der Top-Metriken UND des Detail-Bundles innerhalb EINES `withClinicContext` mit `Promise.all` ausführt (postgres.js pipelined innerhalb einer Transaktion), statt 27 Transaktionen. Spart ca. 100 RT. (2) Welle 2 aus `TopMetricsEnhanced` in `page.tsx` in dieselbe `Promise.all` ziehen, damit es keine zweite Welle gibt. (3) Das Ergebnis mit `unstable_cache` (30 s, Tag `kpi:<id>`) als Ganzes statt als 25 Einzelschlüssel cachen. (4) Für leere Praxen (0 Anfragen, kein kpi_daily) Karten mit statischem Leerzustand ausliefern und die Queries überspringen (nach erster Query `requestStatusCounts` entscheiden).

### D-3: Forecast-Streifen rechnet bei jedem Dashboard-Aufruf live: 1 Transaktion + 7 Queries, ungecacht, auch für neue Praxen
- Schwere: P1
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/dashboard/_components/ForecastStrip.tsx:99-140`, `src/server/queries/forecast.ts:100-130`, `:170-405`, `src/server/forecast/engine.ts:36`
- Beleg: `loadStripData` liest zuerst `getLatestSnapshot` (eigene `withClinicContext`-Transaktion, 4 RT). Das Snapshot schreibt nur der nächtliche Worker (`processForecastSnapshot`, Cron 03:15); in Prod ist der Worker auf 0, also gibt es nie ein Snapshot und der Pfad "Stale or missing: recompute live" läuft bei jedem Render. `loadForecastInputs` führt dann alle 7 Queries per `Promise.all` aus, bevor `totalWon` geprüft wird (`ForecastStrip.tsx:126-129`): `countWonAllTime`, `queryOpenPipeline` (alle offenen Anfragen als Zeilen, kein LIMIT), `queryStageCloseRates` (korrelierte Unterabfrage auf `request_activities` je Anfrage der letzten 365 Tage), `queryStageDurations`, `queryDsoSamples`, `queryTreatmentRevenue` und `queryClinicMedianRevenue` (alle gewonnenen Anfragen als Zeilen, Median in JS, kein LIMIT). Erst danach kommt der Kaltstart-Check `inputs.totalWon < MIN_SAMPLE_WON` (30). Der Streifen wird dann ohnehin ausgeblendet (`ForecastStrip.tsx:38`). Ab 30 Gewinnen kommt noch die Monte-Carlo-Schleife in der Request (500 Resamples x offene Pipeline, `engine.ts:36`, `:166`) auf der Vercel-CPU dazu.
- Szenario: Die erste echte Praxis hat 0 gewonnene Anfragen. Jeder Dashboard-Aufruf zahlt trotzdem 1 Transaktion (RLS-Snapshot) und danach 7 parallele Queries für einen Streifen, der gar nicht angezeigt wird. Das sind ca. 5 RT tief und 8 DB-Aufrufe, ungecacht, bei jedem Toggle eines Zeitraums und jedem Aufruf. Später, bei mehreren tausend Anfragen, werden `queryStageCloseRates` und die Vollladungen spürbar (hunderte ms), plus CPU der Simulation.
- Fix-Vorschlag: In `loadStripData` zuerst nur `countWonAllTime` (1 Query) ausführen und bei `< MIN_SAMPLE_WON` sofort `null` liefern, ohne `getLatestSnapshot`. Den ganzen Streifen mit `unstable_cache` (Schlüssel `forecast-strip`, clinicId, `revalidate` 600, Tag `kpi:<id>`) cachen. `queryClinicMedianRevenue` und `queryTreatmentRevenue` per SQL (`percentile_cont`) statt Vollladung. Mittelfristig: Snapshot beim ersten Aufruf lazy in `forecast_snapshots` schreiben, solange der Worker aus ist.

### D-4: Layout blockiert jede Navigation: 2 sequenzielle ungecachte Gate-Queries, zweiwelliger Badge-Bundle, Session-Schreibzugriff pro Request
- Schwere: P1
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/layout.tsx:58-80`, `src/server/queries/onboardingGate.ts:36-60`, `src/server/queries/navBadgesCache.ts:44-99`, `src/server/queries/navBadges.ts:35-60`, `src/server/queries/timeline.ts`, `assets.ts:71`, `documents.ts:229`
- Beleg: Das Layout hat keine Suspense-Grenze. Der Kopf der Seite (und damit jedes `loading.tsx`) erscheint erst, wenn das Layout durch ist. Kritischer Pfad bei jeder Navigation eines Inhabers:
  1. `requireSession` (1 Statement, JOIN über 3 Tabellen, plus fire-and-forget UPDATE, siehe D-5).
  2. `getOnboardingGateStatus` (nur Inhaber): zwei sequenzielle Statements (`discoveryFragebogen`, dann `checklistItems`), ungecacht, bei jeder Navigation, auch lange nachdem das Gate komplett ist (`onboardingGate.ts:36-60`). Die Seite `/onboarding` führt dieselben Queries danach nochmal aus (D-9).
  3. Auf `/fortschritt`, `/medien`, `/dokumente` zusätzlich `markSectionSeen` (1 Transaktion, awaited) vor dem Badge-Bundle (`layout.tsx:66-69`).
  4. `getNavBadges` (`unstable_cache`, 30 s, pro Nutzer): bei Treffer billig, bei Miss zwei Wellen: Welle 1 sind `countNewRequests`, `countNewPatientFeedback`, `hasUserPassedLeitfadenQuiz` und je einmal `sectionBadgeThreshold` für Fortschritt, Medien, Dokumente (alle eigene Transaktion), Welle 2 sind die drei `has*`-Queries (`navBadgesCache.ts:64-85`, die Threshold-Abfrage läuft jeweils VOR der eigentlichen Query). Das sind 9 Transaktionen, 2 tief. Der Cache wird außerdem bei jedem Öffnen einer Anfrage (`markRequestViewed`), jedem `markSectionSeen` invalidiert, die nächste Navigation zahlt dann die 9 Transaktionen.
- Szenario: Inhaber klickt von Anfragen auf Dashboard. Vor dem ersten Byte: Session 1 RT, Gate 2 RT, Badges im günstigen Fall 2 Cache-Lookups, im ungünstigen 8 RT tief. Warm geschätzt 60 bis 200 ms nur für das Layout, kalt (Instanz/Neon) deutlich über 1 s, danach erst fängt die Seite an.
- Fix-Vorschlag: (1) Gate-Ergebnis in `getOnboardingGateStatus` mit `React.cache` und `unstable_cache` (Tag `gate:<clinicId>`, `revalidateTag` in den Fragebogen-/Checklisten-Actions) cachen; wenn `gateComplete && checklistComplete`, sofort true. Und die zwei Statements per `Promise.all` oder als ein Statement mit zwei Subselects. (2) `sectionBadgeThreshold` in dieselbe Transaktion wie die jeweilige `has*`-Query ziehen (eine Transaktion statt zwei) oder alle 6 Badge-Queries in EINEN `withClinicContext` mit `Promise.all` (eine Transaktion, 1 Welle). (3) `markSectionSeen` aus dem Render-Pfad nehmen (`after()` oder Client-Beacon) und den Override der Pille (`layout.tsx:142-154`) beibehalten. (4) Optional: Badges in einer Suspense-Grenze um die Sidebar streamen, damit die Seite nicht auf sie wartet.

### D-5: Session-Lookup schreibt bei jedem Request ein UPDATE (auch bei Prefetches und Server Actions)
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/auth/session.ts:206-213`, Admin analog `src/auth/admin.ts:216-220`
- Beleg: `void db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, row.sessionId))` bei jedem Aufruf von `getSession` (einmal pro Render dank `cache()`, aber pro Request). Auf Vercel kann eine nicht abgewartete Promise nach Abschluss der Antwort eingefroren werden; wenn nicht, belegt sie eine Pool-Verbindung während der Seite.
- Szenario: Jede Navigation, jeder API-Aufruf, jeder Server Action und (mit D-1) jeder Prefetch schreibt eine Zeile in `sessions` (WAL, Zeilenversion, Autovacuum-Druck), ohne dass es den Nutzer betrifft. Bei 10 Prefetches pro Seitenaufruf sind das 10 Updates auf dieselbe Zeile.
- Fix-Vorschlag: Nur schreiben, wenn der Wert älter als 5 Minuten ist: `UPDATE sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`, und per `after()` aus `next/server` statt `void`. Dafür `lastSeenAt` im SELECT mitladen oder die Bedingung in SQL belassen (kein zusätzlicher RT).

### D-6: Anfrage-Detail: dreistufiger Wasserfall, awaited Schreibzugriff, danach Neu-Rendern nach jeder Aktion
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:82`, `:105`, `:110-141`, `src/server/queries/requests.ts:535-612`, `src/app/(portal)/anfragen/[id]/actions.ts:45-49`
- Beleg: Phase A `getRequestWithActivities` (eine Transaktion; darin erst die Anfrage, dann vier Queries parallel, davon `firstAttemptAt` als separates SELECT auf `requests` statt Spalte der ersten Query, `Activities` ohne LIMIT). Phase B `await markRequestViewed(...)`: eine eigene Schreib-Transaktion (4 RT), nur beim ersten Öffnen, aber blockierend. Phase C `Promise.all` aus `siblingRequests` (Transaktion mit zwei sequenziellen Statements), `patientLifetimeRevenue` (Transaktion), `auditLog` (Superuser, siehe D-7), `pvsLink` (Superuser, hängt nur an `clinicId`), `listFollowupsForRequest` (Transaktion). `pvsLink`, `auditLog` und `followups` hängen nicht von Phase A ab. Danach ruft jede Mutation `revalidateLead` auf (`revalidatePath` für Detail, `/anfragen`, `/dashboard`), die Aktions-Antwort rendert die ganze Detailseite inklusive Layout-Nebenfolgen neu, bevor die UI sich aktualisiert.
- Szenario: Rezeption öffnet eine neue Anfrage. Layout (D-4) dann A (ca. 5 bis 6 RT), dann B (4 RT, nur beim ersten Mal), dann C (ca. 5 RT): 14 bis 20 sequenzielle RT, geschätzt 100 bis 250 ms warm, über 1 s kalt. Jede Statusänderung zahlt danach nochmal die komplette Kette.
- Fix-Vorschlag: `markRequestViewed` in `after()` verschieben (Badge wird ohnehin per Cache-Invalidierung korrigiert). Phase-C-Queries, die nur `id`/`clinicId` brauchen (`audit`, `pvsLink`, `followups`, `siblingRequests`), im selben `Promise.all` wie Phase A starten, und A, `siblingRequests`, `followups`, `patientLifetimeRevenue` in EINER `withClinicContext`-Transaktion bündeln. `firstAttemptAt` als zusätzliche Spalte in die Haupt-Query. `request_activities` auf z. B. 200 begrenzen. Nach Mutationen statt `revalidatePath` für `/dashboard` nur `revalidateTag('kpi:<id>')` plus `invalidateNavBadges`.

### D-7: audit_log wird pro Anfrage-Aufruf über `entity_id` gelesen, ohne passenden Index, und jeder Aufruf schreibt eine weitere Zeile
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/[id]/page.tsx:122-137`, `src/db/schema.ts:1072-1083`, `src/db/migrations/0001_initial.sql:289-290`
- Beleg: Abfrage `WHERE entity_id = $1 AND entity_kind = 'request' ORDER BY created_at DESC LIMIT 20` auf der Superuser-Verbindung ohne `clinic_id`. Vorhandene Indizes: `(clinic_id, created_at DESC)` und `(action)`. Keiner kann `entity_id` bedienen, also Sequential Scan über die ganze Tabelle. Gleichzeitig schreibt dieselbe Seite bei jedem Aufruf per `after(() => writeAudit({ action: "view" ... }))` eine neue Zeile (`page.tsx:~92`), die Tabelle wächst also mit jedem Öffnen und die Abfrage wird linear langsamer.
- Szenario: Nach wenigen Monaten mit 20 Anfragen am Tag und mehrfachen Öffnungen liegt `audit_log` bei mehreren zehntausend Zeilen, jeder Detailaufruf scannt sie alle (10 bis 50 ms), alle Praxen gemeinsam (der Scan geht über alle Mandanten).
- Fix-Vorschlag: Migration `CREATE INDEX audit_log_entity_idx ON audit_log (entity_kind, entity_id, created_at DESC);` und `clinic_id` in die Bedingung aufnehmen. Optional "view"-Einträge aus der angezeigten Historie ausfiltern (sie füllen die 20 Zeilen ohnehin).

### D-8: Dashboard "Offene Anfragen": Kreuzprodukt Tage x Anfragen mit korrelierter Unterabfrage, bei "Max" 1825 Tage, zweimal (aktuell und Vorperiode)
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/server/queries/requests.ts:1000-1075`, `src/lib/dashboard-range.ts` (`max: 1825`), `DashboardTopMetricsEnhanced.tsx:155-198`
- Beleg: `generate_series(from, to, 1 day)` CROSS JOIN `requests r` mit je Tag und Zeile einer Unterabfrage auf `request_activities` (`ORDER BY created_at ASC LIMIT 1`). Aufwand ist Tage x Anfragen. Bei Zeitraum "Max" sind das 1825 Tage, und die Vorperiode (`openPriorQueue`) rechnet nochmal 1825 weitere Tage. Das Kommentarfeld nennt es selbst "the heaviest dashboard query". Der Link "Im gewählten Zeitraum keine Anfragen" in `page.tsx:233-243` schaltet alle vier Karten auf "Max".
- Szenario: Praxis mit 1.500 Anfragen klickt auf "Max": 2 x 1825 x 1.500 = 5,5 Mio. Zeilenauswertungen mit Index-Probe, grob 3 bis 10 s auf einer Funktion (statement_timeout 15 s). Selbst im Standardzeitraum "Mon" sind es nur 30 Tage, also unkritisch.
- Fix-Vorschlag: `from` auf den frühesten Anfragezeitpunkt der Praxis begrenzen (`getClinicRelationshipStart` liegt bereits gecacht vor) statt 1825 Tage Leerlauf. SQL umbauen auf ereignisbasiert: je Anfrage Intervalle mit `LAG/LEAD` über `status_change`-Aktivitäten und dann pro Tag zählen (ein Durchlauf), oder `kpi_daily` um `open_count` ergänzen (nächtlicher Worker, in Prod aber aus, deshalb zunächst die SQL-Variante).

### D-9: Onboarding-Startseite (erste Seite der neuen Praxis): 7 sequenzielle Statements, dazu dieselben Gate-Queries nochmal aus dem Layout
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/page.tsx:44-93`, `src/app/(portal)/layout.tsx:58-62`, `src/server/queries/onboardingGate.ts`
- Beleg: Sieben `await db.select(...)` hintereinander (`clinics`, Teamzahl, `platformCredentials`, `assets`, `goals`, `discoveryFragebogen`, `checklistItems`), keine Abhängigkeit untereinander, kein `Promise.all`. `discoveryFragebogen` und `checklistItems` liest das Layout für denselben Request bereits (`getOnboardingGateStatus`), ohne `React.cache`-Wiederverwendung.
- Szenario: Der Inhaber der neuen Praxis landet nach dem Login auf `/onboarding` und wird bei geschlossenem Gate von jeder anderen Seite hierher umgeleitet. 3 (Layout) + 7 (Seite) = 10 sequenzielle RT allein für diese Seite. Warm ca. 40 bis 80 ms, kalt mit Neon-Aufwachen das Mehrfache, ausgerechnet der erste Eindruck.
- Fix-Vorschlag: Die sieben Reads in `Promise.all`; `getOnboardingGateStatus` mit `React.cache` umhüllen und die Seite ihr Ergebnis (`fragebogenSubmitted`, Checklisten-Status) wiederverwenden lassen. `select()` auf `clinics` nur auf benötigte Spalten.

### D-10: Einstellungen: sieben sequenzielle Queries, "recentAudit" sortiert aufsteigend (zeigt die ältesten 20 Einträge)
- Schwere: P2
- Art: performance (und data-correctness)
- Sicherheit: hoch
- Ort: `src/app/(portal)/einstellungen/page.tsx:61-125`, besonders `:121`
- Beleg: `clinic`, `consumeIntakeSecretFlash`, `consumeReviewSyncFlash`, `teamRows`, `credentials`, `Promise.all([treatments, locations])`, `recentAudit` laufen nacheinander. `.orderBy(schema.auditLog.createdAt).limit(20)` ist ASC, die Karte "letzte Aktivitäten" zeigt also die ältesten 20 Einträge der Praxis und wird mit der Zeit nie aktuell. Dazu: `select()` auf `clinics` und `clinicUsers` lädt alle Spalten in den Seitenrender.
- Szenario: Jeder Aufruf der Einstellungen zahlt 6 sequenzielle Statements plus 2 Transaktionen (ca. 15 RT). Und der Inhaber sieht in der Aktivitätsliste Einträge vom ersten Tag statt von heute.
- Fix-Vorschlag: Alles unabhängige in ein `Promise.all` (die zwei Cookie-Flash-Reads zuerst, sie sind synchron in der Sache). `desc(schema.auditLog.createdAt)` für `recentAudit`. Spalten explizit auswählen.

### D-11: `withClinicContext`: 4 Roundtrips pro Aufruf, jede Query eine eigene Transaktion
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/db/client.ts:116-149`
- Beleg: `dbApp.transaction(async (tx) => { await tx.execute(set_config...); return fn(tx); })`. postgres.js sendet BEGIN, wartet, sendet set_config, wartet, sendet die Query(s), wartet, COMMIT. Es gibt 71 Aufrufstellen in `server/queries/*`, viele für einzelne einfache Reads.
- Szenario: Siehe D-2 bis D-4; jede eingesparte Transaktion spart 4 RT, jede Transaktion mit einer Query kostet 3 RT reinen Overhead.
- Fix-Vorschlag: (1) `set_config` und die erste Query pipelinen: `const cfg = tx.execute(set_config); const r = await fn(tx); await cfg;` (postgres.js sendet beide ohne Warten, Reihenfolge auf einer Verbindung bleibt erhalten, RLS sieht den Wert). Spart 1 RT pro Aufruf. (2) Eine Hilfsfunktion `withClinicBatch(clinicId, userId, [fn1, fn2, ...])`, die mehrere Reads in einer Transaktion per `Promise.all` ausführt, und die Seiten (Dashboard, Werbebudget, Anfragen) darauf umstellen. Vor (1) einen Test mit RLS-Policy schreiben, der bei vertauschter Reihenfolge fehlschlägt.

### D-12: Werbebudget: 7 Transaktionen auch für eine Praxis ohne Integration
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/werbebudget/page.tsx:69-81`, `:323-340`, `src/server/queries/campaigns.ts`, `kpis.ts:156-190`
- Beleg: `campaignLiveSummary`, `campaignDailyByPlatform` (meta, google), `syncHistory` (meta, google), `campaignsForPeriod` (2 Statements), `spendPaceProjection` (2 Statements) sind alle eigene `withClinicContext`-Transaktionen, parallel gestartet, plus `platformCredentials` auf Superuser. `noIntegrations` wird erst danach aus `creds` berechnet (`:92`), die Queries laufen trotzdem.
- Szenario: Neue Praxis ohne Meta/Google: 7 Transaktionen, 28 RT, bis zu 7 der 10 Pool-Verbindungen belegt, die alle leer zurückkommen. Warm ca. 40 bis 80 ms, kalt mehr.
- Fix-Vorschlag: Zuerst `creds` laden (1 Statement). Wenn leer, nur den Leerzustand rendern und keine der sieben Queries ausführen. Sonst die sieben in eine Transaktion bündeln (D-11).

### D-13: Meta-Logo: zwei Dateien mit je ca. 277 KB (gzip) werden beide geladen, nur eine ist sichtbar
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/_components/Brand.tsx:29-30`, `:42-58`, `public/Meta_lockup_positive primary_RGB.svg` und `..._negative primary_white_RGB.svg` (je 374 KB roh)
- Beleg: `BrandLogo brand="meta"` rendert zwei `<img>` (hell und dunkel), die per CSS-Klasse ein- bzw. ausgeblendet werden. `display:none`-Bilder werden trotzdem geladen. `gzip -c` auf die Datei ergibt 277.147 Bytes, die SVG enthält eingebettete Rasterdaten (base64). `BrandLogo` und `SourceLabel` hängen an jeder Anfragen-Zeile mit Meta-Quelle, an den Quellen-Karten im Dashboard und am Werbebudget (26 Aufrufstellen).
- Szenario: Inhaber öffnet am Handy die Anfragenliste mit Meta-Leads: zusätzlich ca. 550 KB Transfer für ein 20-px-Logo, auf Mobilfunk 1 bis 3 s Zusatzlast und Cache-Revalidierung bei jedem Besuch (`public/` ohne langes `max-age`).
- Fix-Vorschlag: SVG neu exportieren ohne Raster (üblich 5 bis 15 KB) oder als Inline-Komponente wie die anderen Icons (`ICONS` in `Brand.tsx`). Mindestens nur eine Variante laden (`<picture>` mit `prefers-color-scheme` ist wegen `data-theme` nicht passend, daher per Klasse nur das aktive `src` rendern) und `loading="lazy"`.

### D-14: Checkliste: Server Action mit `revalidatePath` PLUS `router.refresh()` (doppeltes Neu-Rendern)
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/checkliste/ChecklisteForm.tsx:182-193`, `:240`, `:252`, `src/app/(portal)/onboarding/checkliste/actions.ts:237-238`, `:410-411`, `:505-506`
- Beleg: Nach `saveChecklistItem` (Action mit `revalidatePath("/onboarding/checkliste")` und `revalidatePath("/onboarding")`, die die aktuelle Seite schon in der Aktions-Antwort neu rendert) ruft der Client zusätzlich `router.refresh()`, also nochmal eine volle RSC-Anfrage mit Layout-Pfad (D-4) und den Seitenqueries. Gleiches Muster in `FragebogenForm.tsx:50` (dort nur beim Absenden, unkritisch).
- Szenario: Jede der mindestens ca. 15 Checklistenpunkte, die der neue Inhaber ausfüllt, erzeugt zwei Server-Renders statt einem, jeweils mit Gate-Queries, Badge-Prüfung und Dateiliste. Auf dem Handy spürbar als Sprung nach dem Speichern.
- Fix-Vorschlag: `router.refresh()` entfernen (die Action revalidiert bereits). Alternativ optimistisches Update im Client und Revalidierung nur über das Tag.

### D-15: Mutationen invalidieren per `revalidatePath("/dashboard")`, Dashboard-Daten bleiben trotzdem bis 30 s bzw. 600 s alt
- Schwere: P2
- Art: performance / data-correctness
- Sicherheit: mittel
- Ort: `src/app/(portal)/anfragen/[id]/actions.ts:45-49`, `src/app/(portal)/dashboard/_components/anomaly-actions.ts:42`, `:64`, `src/server/queries/_cache.ts:40-65`, `requests.ts` (`requestStatusCounts`, `slaBreachedCount`, `openLeadsForDashboard`: 30 s), `kpis.ts` (`kpiSummary`, `byTreatment`, `latestReviews`: 600 s)
- Beleg: `revalidatePath` löscht den Router-Cache des Clients und rendert die Seite neu, aber die serverseitigen `unstable_cache`-Einträge sind nur per Tag `kpi:<id>` invalidierbar und das ruft nur der Worker auf (in Prod aus). Nach `logCall`/Statuswechsel rendert das Dashboard also neu (volle Kosten D-2) und zeigt weiterhin die alten Zahlen der Kacheln "Offene Anfragen" und SLA bis zu 30 s lang, KPI-Kacheln bis zu 10 Minuten.
- Szenario: Rezeption setzt eine Anfrage auf "kontaktiert" und wechselt zum Dashboard: Die Kachel "Offene Anfragen" und die Dringlichkeitsliste zeigen die alte Zahl. Gleichzeitig hat der Wechsel einen vollständigen, teuren Re-Render bezahlt, der nichts Neues zeigt.
- Fix-Vorschlag: In `revalidateLead` zusätzlich `revalidateTag('kpi:<clinicId>')` aufrufen (macht die 30-s-Kacheln sofort frisch) und `revalidatePath("/dashboard")` weglassen (der Router-Cache läuft in 30 s ohnehin ab; das Tag reicht für die Daten). `invalidateNavBadges` bei Statuswechseln.

### D-16: Admin: `pendingOperationCounts` (5 Queries) läuft in jedem Layout-Render und auf der Startseite ein zweites Mal
- Schwere: P2
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/admin/layout.tsx:59`, `src/app/admin/page.tsx:74`, `src/server/queries/admin.ts:1190-1244`
- Beleg: Das Admin-Layout ruft `pendingOperationCounts()` bei jeder Navigation (5 parallele Statements, darunter zwei COUNTs über `requests` ohne `clinic_id`), und die Admin-Startseite ruft es in ihrem `Promise.all` noch einmal auf. Kein `React.cache`, kein `unstable_cache`. Dazu bündelt die Startseite 9 Aufrufe (davon `platformOverviewMetrics` mit 5 intern) auf dem 10er-Pool, und `pipelineFunnel`, `aiScoreDistribution`, `responseTimeRanking` filtern nur über `created_at` (kein Index auf `requests(created_at)`, nur `(clinic_id, created_at)`), das ist ein Seq Scan über alle Mandanten.
- Szenario: Karam öffnet die Admin-Übersicht: 10 statt 5 Zählabfragen, 13 parallele Statements auf 10 Verbindungen (Queueing), jede Admin-Navigation zahlt die 5 Zählungen erneut. Bei heute einer Praxis unauffällig, wächst linear mit den Anfragen aller Praxen.
- Fix-Vorschlag: `export const pendingOperationCounts = cache(impl)` (React) und zusätzlich `unstable_cache` mit 30 s. Auf der Startseite das Ergebnis aus dem Cache nutzen. Index `requests(created_at)` bzw. `(status, created_at)` ergänzen, sobald mehrere Praxen aktiv sind.

### D-17: CSV-Import-Wizard pollt alle 2 s ohne Ende per Server Action, obwohl der Worker aus ist
- Schwere: P2
- Art: performance / robustness
- Sicherheit: mittel
- Ort: `src/app/(portal)/einstellungen/integrationen/setup/csv/_wizard.tsx:133-149`, `src/worker/processors/pvs-csv-ingest.ts`
- Beleg: `setInterval(... getCsvUploadStatus ..., 2000)` läuft, solange `status` nicht `completed` oder `failed` ist. Die Verarbeitung läuft nur im pg-boss-Worker (in Prod 0). Der Status bleibt `pending`, die Schleife endet nie, solange das Fenster offen ist. Jede Runde ist ein Server-Action-POST durch Middleware, `getSession` (mit D-5-Schreibzugriff) und eine DB-Abfrage.
- Szenario: Praxis lädt eine CSV hoch (Wizard funktioniert technisch), sieht "wird verarbeitet" und lässt den Tab offen: 30 POSTs pro Minute, jeder mit Session-Lookup und UPDATE, ohne Aussicht auf Fortschritt. Folge der Worker-Abschaltung und eines fehlenden Abbruchs.
- Fix-Vorschlag: Maximal 5 Minuten pollen, dann Hinweis "Verarbeitung dauert länger, wir melden uns"; Intervall nach 30 s auf 10 s strecken (Backoff). Nutzersichtbaren Hinweis, solange der Worker aus ist.

### D-18: Medien-Seite: alle Dateien ohne Seitenlimit, Originalbilder ohne `loading="lazy"`, `<img>` ohne Maße
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/app/(portal)/medien/page.tsx:200-232`, `src/server/queries/assets.ts:16-30`
- Beleg: `listAssets` ohne LIMIT, jedes Asset als `<img src={a.url}>` (Originaldatei, kein Thumbnail) oder `<video preload="metadata">` mit `controls`, ohne `loading="lazy"`, `decoding`, `width/height`. Keine `next/image` (Bildoptimierung) im ganzen Portal außer SVG-Logos.
- Szenario: Das Team lädt Beiträge mit 3 bis 8 MB Fotos hoch. Die Medienseite am Handy lädt alle Originale gleichzeitig, auf Mobilfunk mehrere Sekunden, mit Layoutsprüngen. Jedes `<video preload="metadata">` ist zusätzlich ein Range-Request pro Karte.
- Fix-Vorschlag: `loading="lazy" decoding="async"` und `aspect-video` Container sind schon da (Platz bleibt reserviert); Thumbnails serverseitig (R2 Variante) oder `next/image` mit `sizes`. `listAssets` mit Limit 60 plus "Mehr laden".

### D-19: Anfragenliste: Filterleiste (2 ungecachte Transaktionen) wird bei jeder Filter-/Suchänderung mit neu gerendert
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/app/(portal)/anfragen/page.tsx:112-124`, `src/server/queries/treatments.ts:24`, `requests.ts:649-662`
- Beleg: `FiltersLoader` (`listTreatments` + `aiCategoryCounts`, beide ungecacht, jeweils eigene Transaktion) liegt in derselben Seite wie die Liste; `router.replace` bei jedem Suchbegriff (nach 250 ms Debounce) und jedem Filterklick rendert die Seite neu und führt beide Queries erneut aus, obwohl sie von Filtern unabhängig sind. `aiCategoryCounts` zählt ohne Fenster alle Anfragen einer Praxis.
- Szenario: Tippen in die Suche: pro Anfrage 3 Transaktionen statt 1 (Liste), 8 RT zusätzlich ohne Nutzen.
- Fix-Vorschlag: Beide mit `cacheClinicQuery` (30 s, Tag `kpi:<id>`) cachen, `aiCategoryCounts` in die Listen-Transaktion legen (`listRequests`), `listTreatments` mit 5-Minuten-Cache (Tag `treatments:<id>`).

### D-20: Globale Suche: `listRequests` mit Zähl-Query und Antwort-Unterabfragen für 6 Treffer, `ILIKE '%…%'` auf vier Spalten ohne Trigram-Index
- Schwere: P3
- Art: performance
- Sicherheit: mittel
- Ort: `src/app/api/search/leads/route.ts:35-39`, `src/server/queries/requests.ts:105-230`
- Beleg: Typeahead ruft `listRequests(..., { limit: 6 })`, das zusätzlich `count(*)` mit demselben Filter, den `firstAttemptAtSql()`-Subselect pro Zeile und zwei LEFT JOINs ausführt; Suchbegriff `%term%` über `contact_name`, `contact_email`, `contact_phone`, `treatment_wish` ohne `pg_trgm`. Bei jeder Tastenfolge (250 ms Debounce) läuft das.
- Szenario: Bei einigen tausend Anfragen je Praxis wird jede Suche ein Scan über alle Zeilen der Praxis (index `requests_clinic_idx` grenzt nur auf den Mandanten ein), 20 bis 80 ms plus 4 RT, pro Tastenpause.
- Fix-Vorschlag: Eigene schlanke Query `searchRequestsLite` (nur `id`, `contactName`, `contactEmail`, `treatmentWish`, `LIMIT 6`, kein Count, kein Join), später `CREATE EXTENSION pg_trgm` und GIN-Index auf die Textspalten, sobald eine Praxis über 5.000 Anfragen hat.

### D-21: Anomalien und Forecast-Eingaben laden ganze Tabellenbereiche ohne LIMIT und sortieren/aggregieren in JS
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/server/queries/anomalies.ts:46-72`, `src/server/queries/forecast.ts:131-165`, `:345-405`, `src/server/queries/kpis.ts:112-125` (`select()` über bis zu 1825 Tage), `:344-380`
- Beleg: `getActiveAlerts` holt alle aktiven Alerts (`select()` ohne LIMIT), sortiert in JS und schneidet auf 5 (`limit` wird nur in JS angewendet). `queryOpenPipeline` und `queryClinicMedianRevenue` laden alle Zeilen für Median/Zählung in JS (statt `percentile_cont`). `kpiDailySeries` ist `select()` mit allen Spalten und bis zu 1825 Zeilen; `kpiDailySeriesWithSparklineFresh` cached zusätzlich `rows` im Data-Cache, obwohl die Dashboard-Kachel nur `.sparklines` liest (`DashboardTopMetricsEnhanced`).
- Szenario: Heute unkritisch (kleine Mengen). Nach einem Jahr: 365 vollständige kpi_daily-Zeilen je Kachel und Cache-Eintrag, Alerts-Liste wächst, da Worker-Dedupe nur nach Kind greift.
- Fix-Vorschlag: `ORDER BY CASE severity ... DESC, created_at DESC LIMIT $limit` in SQL; Median per `percentile_cont(0.5)`; `kpiDailySeries` auf benötigte Spalten; `kpiDailySeriesWithSparklineUncached` ohne `rows` zurückgeben.

### D-22: Client-Bundle: `driver.js` (+ CSS) und Schritt-Daten im Root-Layout, Checklisten- und FAQ-Inhalte als Client-Importe
- Schwere: P3
- Art: performance
- Sicherheit: mittel
- Ort: `src/app/(portal)/_components/tour/TourProvider.tsx:13-16`, `src/app/(portal)/layout.tsx:12`, `src/app/(portal)/onboarding/checkliste/ChecklisteForm.tsx:40`, `src/app/(portal)/onboarding/fragebogen/FragebogenForm.tsx:14`, `src/app/(portal)/faq/_components/FaqBrowser.tsx:13`
- Beleg: `TourProvider` (Client) wickelt das gesamte Portal und importiert `driver` statisch samt `driver.css`, `tour.css`, `coreSteps`, `chapterSteps`; läuft auf jeder Portalseite, auch für Teamrollen ohne Tour. `checkliste/content.ts` (37 KB roh) und `fragebogen/content.ts` (14 KB) kommen als Client-Import in die Formulare (genau die ersten Seiten der neuen Praxis), `faq/content.ts` (49 KB) in `FaqBrowser`. `react-easy-crop` kommt statisch über `AvatarUploader` in die Einstellungen-Route, auch wenn niemand ein Bild wählt. Schriften: vier `localFont`-Gewichte (je 26 KB) werden alle vorab geladen (`src/app/layout.tsx:6-15`).
- Szenario: Je ca. 10 bis 25 KB (gzip) zusätzliches JavaScript auf Mobilfunk, nirgends ein Blocker, aber auf jedem Seitenaufruf beim ersten Besuch.
- Fix-Vorschlag: `driver.js` per `await import("driver.js")` in `start()` laden; `AvatarUploader`s Cropper mit `next/dynamic` erst beim Öffnen des Dialogs. Inhalte aus `content.ts` nur serverseitig lesen und die Form bekommt nur die nötigen Felder als Props. Schrift-Preload auf Roman und Medium beschränken (`preload: false` für Light/Bold).

### D-23: Admin-Leads: Zählung und Aggregat laufen als zwei getrennte Vollscans plus die Seite
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/server/queries/admin.ts:942-1010`, `src/app/admin/clinics/[id]/page.tsx` (Tab "leads" ruft `globalLeads`), `admin.ts:816-826` (`goalCurrentValue` je aktivem Ziel)
- Beleg: `globalLeads` führt drei Statements mit identischem WHERE aus (Liste, `count(*)`, Aggregat mit `array_agg(distinct currency)`), davon zwei JOINs auf `clinics`. `clinicPerformance` macht je aktivem Ziel ein weiteres Statement (N+1, aber N < 5).
- Szenario: Unerheblich bei einer Praxis, bei 10 Praxen mit je einigen tausend Anfragen drei Scans pro Seitenaufruf.
- Fix-Vorschlag: Zählung und Aggregat in einem Statement (`count(*) OVER ()` bzw. ein Aggregat-Statement mit `count(*)`), `goalCurrentValue` in einer Query mit `FILTER`.

---

## Folgen "Worker auf 0" aus Performance-Sicht (nutzersichtbar, nicht als Fehler gemeldet)

- `kpi_daily` wird nur vom Worker gebaut. Kacheln, die darauf lesen (`kpiSummary` Umsatz und Offene-Anfragen-Kachel, Trichter-Übersicht, No-Show-Quote, Umsatz-Sparkline, Admin-Kennzahlen) zeigen 0, und `revalidateTag('kpi:<id>')` aus dem Worker feuert nie. Die Anfragen-Zahlen (`leadsInRangeWithComparison`, `bySource`, `byTreatment`, `byLocation`) lesen live aus `requests` und sind korrekt.
- Forecast-Snapshot fehlt, dadurch jeder Aufruf live (D-3). Anomalie-Scan fehlt, das Widget bleibt leer. Werbebudget-Sync (`campaign_snapshots`) fehlt, die Seite zeigt Leerzustand. CSV-Import bleibt `pending` (D-17). Bewertungs-Sync fehlt. Alle anderen Queue-Aufträge (Mails, Erinnerungen) sind außerhalb meines Auftrags.

## Zusammenfassung

Anzahl: P0 0, P1 4, P2 14, P3 5 (gesamt 23).

Die drei dringendsten Punkte:
1. D-1 und D-4: Jeder Nav-Link lädt per `prefetch={true}` die komplette dynamische Seite vor (Desktop sofort), und das Layout blockiert jede Navigation mit ungecachten Gate-Queries (2 sequenziell) und einem zweiwelligen Badge-Bundle (bis 9 Transaktionen).
2. D-2 und D-3: Das Dashboard braucht bei kaltem Cache 25 bis 36 Transaktionen in drei Wellen (ca. 150 RT) und rechnet den Forecast-Streifen bei jedem Aufruf live (1 Transaktion + 7 Queries), obwohl er bei 0 gewonnenen Anfragen gar nicht erscheint. Ein einziger gebündelter `withClinicContext` mit `Promise.all` plus ein früher `totalWon`-Check spart den Großteil.
3. D-6, D-7 und D-9: Die täglichen Pfade Anfrage-Detail und Onboarding-Start enthalten sequenzielle, voneinander unabhängige Queries, einen awaited Schreibzugriff beim Öffnen (`markRequestViewed`), und einen `audit_log`-Lookup per `entity_id` ohne Index.
