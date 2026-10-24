# Bereich A: Infrastruktur (apps/portal)

Geprüft: alle im Auftrag genannten Dateien, dazu die Zeit-Grep über `src/` (153 Treffer, alle gesichtet), die Aufrufer von `unstable_cache`/`cacheClinicQuery`/`revalidateTag`, `auth/session.ts`, `server/email.ts`, `server/jobs.ts`, `server/clinic-signature.ts`, Worker-Registrierung. Next-Version installiert: 15.5.15 (Quellcode von `revalidateTag` gelesen). Nichts wurde geändert oder ausgeführt.

Kurzantworten auf die neun Fragen:
1. Zeitzonen: nein, nicht sauber. Nur `werkstunden.ts`, `guarantee-clock.ts`, `retreatment.ts`, E-Mail-Templates rechnen in Europe/Berlin. Die gesamte Anzeige (`formatDateTime`), das Dashboard-Fenster "Heute", die KPI-Tagesbuckets und die Uhrzeit-Heatmaps laufen in UTC. A-01 bis A-05.
2. Caches: kein Mandanten-Leck gefunden. Alle `unstable_cache`-Keys enthalten clinicId (nav-badges zusätzlich userId + role). Probleme sind Invalidierung (A-06, A-07) und Prozess-Speicher (A-18).
3. Verbindungen: Layout ist nicht bei jeder Navigation aktiv (siehe A-08), bei einem harten Laden etwa 3 + 6 Abfragen; Neon-Erschöpfung bei einer Praxis unwahrscheinlich (A-14).
4. Fehlerbehandlung: nur `anfragen/error.tsx`, kein `global-error`, kein Sentry. A-09, A-10.
5. Middleware: kein DB-Zugriff, Matcher ok, zwei Randfälle (A-17).
6. Env: Produktion fällt bei fehlenden Werten auf Dev-Treiber zurück, statt zu scheitern (A-11, A-12). Optionale Dienste (OpenAI, Meta, R2-Keys) lassen keine Seite abstürzen.
7. Migrationen: pro Datei transaktional, idempotent über `schema_migrations`, aber ohne Sperre und mit Fallstricken (A-15).
8. Logging: eine JSON-Zeile je Transaktion, Mandant gehasht, aber Klartext-Mail-/Link-Logs in Sonderfällen (A-12, A-19).
9. Health: prüft nur DB und RLS-Rolle (A-13).

---

### A-01: Alle angezeigten Zeitstempel erscheinen in UTC (1 bis 2 Stunden falsch)
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/lib/formatting.ts:41-52` (`dateFormatter`, `dateTimeFormatter`), `:116-128` (`formatDate`, `formatDateTime`); 72 Aufrufe, z. B. `src/app/(portal)/anfragen/[id]/page.tsx:247-256`, `src/app/(portal)/anfragen/page.tsx:322`
- Beleg: `new Intl.DateTimeFormat("de-DE", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" })` ohne `timeZone`. Im Repo gibt es weder `TZ=` noch eine andere Zeitzonen-Konfiguration (Grep über `src`, `next.config.ts`, `vercel.json`). Vercel-Funktionen laufen in UTC; auf Vercel lässt sich `TZ` zudem nicht setzen.
- Szenario: Eine Anfrage geht um 23:30 Berlin ein. Die Detailseite zeigt "Eingegangen: 21:30" (Sommerzeit) bzw. 22:30 (Winterzeit). "Frist" (Werkstunden-basiert, intern korrekt in Berlin berechnet) wird 1 bis 2 Stunden zu früh angezeigt, der Inhaber sieht also eine Frist, die nicht zu seinem Kalender passt. Betrifft jede Seite mit Datum/Uhrzeit (Anfragen, Bewertungen, Dateien, Fortschritt, Nachfassen, Einstellungen). Zusätzlich erscheinen Datumswerte zwischen 00:00 und 02:00 Berlin mit dem Vortag (`formatDate`).
- Fix-Vorschlag: In `formatting.ts` beiden Formattern `timeZone: "Europe/Berlin"` geben (ein Zeichen pro Formatter). Dasselbe für die `toLocaleDateString("de-DE")`-Aufrufe in `onboarding/fragebogen/page.tsx:73,81`, `admin/.../FragebogenTab.tsx`, `ChecklisteTab.tsx:344`, `DateienTab.tsx:147`, `server/reports/*-pdf.tsx`. Danach ein Test mit festem Datum (23:30 UTC im Sommer und Winter).

### A-02: Dashboard-Fenster "Heute" und Begrüßung laufen in UTC
- Schwere: P1
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/lib/dashboard-range.ts:83-95`; `src/app/(portal)/dashboard/page.tsx:43-49,131-136`; `src/server/queries/kpis.ts:197,237-238`; `src/server/queries/campaigns.ts:216-219`; `src/server/queries/admin.ts:40-50,114-115,437,483,537,679,1396`
- Beleg: `dashboardRangeWindow` setzt `to.setHours(23,59,59,999)` und `from.setHours(0,0,0,0)` in Server-Ortszeit (= UTC). `germanGreeting(d)` nutzt `d.getHours()`, die Datumszeile `now.toLocaleDateString("de-DE", ...)` ohne `timeZone`. `currentGoalsUncached` bildet "heute" über `new Date().toISOString().slice(0,10)`.
- Szenario: (a) Um 00:30 Berlin (22:30 UTC) zeigt die Karte "Heute" noch den Vortag; Anfragen von 00:00 bis 02:00 Berlin (Sommerzeit) landen im Fenster des Vortags, und die Datumszeile im Header zeigt bis dahin das alte Datum. (b) Die Begrüßung ist verschoben: um 06:30 Berlin (04:30 UTC) "Gute Nacht", um 23:30 Berlin (21:30 UTC) noch "Guten Abend". (c) `spendPaceProjection` rechnet am 1. des Monats bis 02:00 Berlin noch mit dem Vormonat. (d) Monatsziele wechseln um 02:00 statt 00:00.
- Fix-Vorschlag: Eine kleine Hilfsdatei `src/lib/berlin-time.ts` (bereits vorhanden als Muster in `guarantee-clock.ts:54-60`, `retreatment.ts:73`) mit `berlinDateString(d)`, `berlinStartOfDay(d)`, `berlinHour(d)` verwenden und `dashboardRangeWindow`, `germanGreeting`, Datumszeile, `currentGoals`, `currentMonthSummary`, `spendPaceProjection` darauf umstellen. Die Cache-Normalisierung `dateOnly` in `_cache.ts:63-65` mitziehen.

### A-03: KPI-Tagesbuckets (`kpi_daily`, Verlaufsreihen) nach UTC-Datum statt Berlin-Datum
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/worker/processors/kpi-rebuild.ts:45,60-64`; `src/server/queries/requests.ts:512-529,1008-1012`; `src/server/queries/admin.ts:1424-1429`; `src/lib/chart-data.ts:44-52`; `src/server/queries/kpis.ts:366-375`
- Beleg: `to_char(${schema.requests.createdAt}::date, 'YYYY-MM-DD')` und `GROUP BY createdAt::date` (Sitzungs-Zeitzone der Neon-Verbindung, UTC). `inboundCountSeries` und `leadsDailyInRange` benutzen ausdrücklich `AT TIME ZONE 'UTC'`.
- Szenario: Abendliche Zielseiten-Anfragen (Spitzenzeit 21:00 bis 01:00 Berlin) werden zwischen 00:00 und 02:00 Berlin dem Vortag zugerechnet; Tagesverläufe, `kpi_daily.leads` und Tagesgrenzen der Wochen-Heatmap passen nicht zu dem, was der Inhaber im Kalender sieht. Summen über längere Zeiträume stimmen weiterhin.
- Fix-Vorschlag: Überall `(created_at AT TIME ZONE 'Europe/Berlin')::date` verwenden (Worker-Rebuild, `requests.ts`, `admin.ts`), die Achsen in JS aus dem Berlin-Datum bauen statt aus `toISOString().slice(0,10)`. Nach der Umstellung `kpi_daily` einmal neu aufbauen lassen (Worker aktuell 0, siehe A-16).

### A-04: Uhrzeit- und Wochentag-Heatmaps in UTC
- Schwere: P2
- Art: data-correctness
- Sicherheit: hoch
- Ort: `src/server/queries/lifecycle.ts:165,176` (`extract(dow ...)`), `:207,217` (`extract(hour ...)`)
- Beleg: `extract(hour from ${schema.requests.createdAt})` ohne `AT TIME ZONE`.
- Szenario: "Wann kommen Anfragen herein" ist um 1 bis 2 Stunden verschoben, Spitzen um 23:00 Berlin erscheinen bei 21:00 oder 22:00; Mitternachtsanfragen erscheinen am Vortag (Wochentag-Heatmap). Der Inhaber leitet daraus Erreichbarkeits-Entscheidungen ab.
- Fix-Vorschlag: `extract(hour from (created_at AT TIME ZONE 'Europe/Berlin'))` und analog `dow`.

### A-05: `formatRelativeDay` und weitere Tageslogik auf dem Server in UTC; Hydrations-Abweichung in Client-Komponente
- Schwere: P2
- Art: data-correctness
- Sicherheit: mittel
- Ort: `src/lib/formatting.ts:155-190`; `src/app/(portal)/anfragen/[id]/_followups.tsx:1,6,63,113` (`"use client"` + `formatDateTime`); `src/server/queries/forecast.ts:485,509` (`date_trunc('week', ...)`); `src/server/queries/lifecycle.ts:255-266` (Kohorten-Wochen)
- Beleg: `target.setHours(0,0,0,0); today.setHours(0,0,0,0)` in Serverzeit. `_followups.tsx` ist ein Client-Component und ruft `formatDateTime` auf: der Server rendert in UTC, der Browser hydriert in Berlin.
- Szenario: (a) Zwischen 00:00 und 02:00 Berlin steht bei Nachfass-Terminen "Morgen" für heute Fällige und "Heute" für gestern Fällige. (b) Beim ersten Laden der Anfrage-Detailseite weicht der Text der Nachfass-Zeiten zwischen Server-HTML und Client ab: Hydration-Fehler in der Konsole, React rendert die Boundary neu (kurzes Flackern). (c) Wochen-/Kohortengrenzen (Montag 00:00) liegen 1 bis 2 Stunden falsch.
- Fix-Vorschlag: Mit A-01/A-02 beheben (feste `timeZone` in allen Formattern gleicht Server und Client an), `formatRelativeDay` auf Berlin-Datum umstellen, `date_trunc` mit `AT TIME ZONE 'Europe/Berlin'` einklammern.

### A-06: Tag-Invalidierung durch den Worker kann nie wirken, KPI-Cache bis zu 10 Minuten alt
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/server/queries/_cache.ts:123-134`; `src/worker/processors/kpi-rebuild.ts:151-153`; Next `revalidate.js` (`Invariant: static generation store missing`)
- Beleg: `invalidateClinicKpiCache` ruft `revalidateTag` im Worker-Prozess (Fly, kein Next-Request-Kontext) auf. In Next 15.5 wirft `revalidate()` dort `Invariant: static generation store missing`; der `catch` loggt nur eine Warnung. Der Kommentar in `_cache.ts` räumt "best-effort" ein, die Praxis ist aber: der Tag wird nie gelöscht.
- Szenario: Nach dem nächtlichen Rebuild (03:00 UTC) bleiben Dashboard-Zahlen für bis zu `DEFAULT_REVALIDATE_S = 600` s alt (kpiSummary, Verläufe, Attribution). Kein akuter Schaden, aber die Dokumentation verspricht "Sekunden".
- Fix-Vorschlag: Entweder TTL ehrlich als einzige Strategie dokumentieren oder einen kleinen Endpunkt `/api/internal/revalidate` (Secret-Header) bauen, den der Worker nach dem Rebuild aufruft und der `revalidateTag` im Next-Kontext ausführt.

### A-07: `markSectionSeen` im Layout: `revalidateTag` während des Renderns wirft, Fehler wird verschluckt
- Schwere: P2
- Art: bug
- Sicherheit: hoch
- Ort: `src/app/(portal)/layout.tsx:66-69`; `src/server/queries/navBadges.ts:61-90`; `src/server/queries/navBadgesCache.ts:115-123`
- Beleg: `markSectionSeen` wird beim Rendern des Layouts aufgerufen und ruft `invalidateNavBadges` → `revalidateTag`. In Next 15.5 wirft `revalidate()` bei `workUnitStore.phase === 'render'` (`Route ... used "revalidateTag ..." during render which is unsupported`). `invalidateNavBadges` fängt das (`catch {}`), also passiert nichts; zusätzlich schluckt `markSectionSeen` jeden Fehler.
- Szenario: Der Nutzer öffnet "Medien". Die Zeile `user_nav_section_views` wird gestempelt, das gecachte Badge-Bundle (30 s) wird aber nicht geleert. Das Layout überschreibt den Pill für den aktuellen Bereich (`section !== "medien"`), aber beim Wechsel auf eine andere Seite innerhalb von 30 s steht "Neu" bei Medien wieder da. Der Kommentar im Layout (Z. 141-147) behauptet das Gegenteil, die Annahme ist also falsch.
- Fix-Vorschlag: Das Stempeln in eine Server Action oder einen Route Handler auslagern (dort ist `revalidateTag` erlaubt), aufgerufen per `useEffect` aus einer kleinen Client-Komponente im Bereich; oder den Badge-Bundle-Cache entfernen und den Pill direkt aus der DB rechnen (6 billige Index-Abfragen, ohnehin nur bei hartem Laden).

### A-08: Logik im Layout (Onboarding-Sperre, Badges, Stempeln) läuft nur bei hartem Laden, nicht bei Klicks im Portal
- Schwere: P1
- Art: bug
- Sicherheit: mittel (Next-Verhalten "geteilte Layouts werden bei Soft-Navigation nicht neu gerendert", nicht im Browser verifiziert)
- Ort: `src/app/(portal)/layout.tsx:47-70` (Pfad-Header, Gate, `markSectionSeen`), `:75-79` (Badges); `src/middleware.ts:30-34` (`x-portal-pathname`); `src/server/queries/onboardingGate.ts:91-99`
- Beleg: Das Gate (`redirect("/onboarding")`) sitzt ausschließlich im Layout; die einzige weitere Erwähnung ist ein Kommentar in `onboarding/page.tsx:101`. Der Pfad kommt aus einem Header, den die Middleware pro Request setzt. `staleTimes.dynamic = 30` (`next.config.ts`) verstärkt das.
- Szenario: Ein Inhaber mit offener Onboarding-Pflicht lädt das Portal (Landung auf `/onboarding`) und klickt dann in der Seitenleiste auf "Anfragen" oder "Dashboard": der Client holt nur das Seitensegment, das Layout läuft nicht erneut, das Gate greift nicht, die Daten-Tabs sind trotz offener Pflicht erreichbar (erst Reload sperrt wieder). Gleiches gilt für die Badge-Zahlen: eine neue Anfrage erzeugt den "Neu"-Pill erst bei hartem Laden oder nach einer Server Action mit `revalidatePath`; `markSectionSeen` für Fortschritt/Medien/Dokumente feuert bei Klick-Navigation nicht.
- Fix-Vorschlag: Zuerst im Browser prüfen (Netzwerk-Tab: wird bei Klick auf einen Sidebar-Link der Layout-Teil mitgeliefert?). Wenn nicht: Gate in einen gemeinsamen Guard `requireOnboarded(pathname)` in jeder Daten-Seite (oder in `requireSession` mit Pfad-Parameter) verlegen, Badges per Client-Polling (`router.refresh()` alle 60 s) oder `usePathname`-Effekt auffrischen.

### A-09: Kein `error.tsx` außer bei Anfragen, kein `global-error`: Datenbankfehler zeigen die nackte Next-Fehlerseite
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/` (Glob: nur `(portal)/anfragen/error.tsx`; keine `error.tsx` in `(portal)`, `(auth)`, `admin`, keine `global-error.tsx`)
- Beleg: `find src/app -name error.tsx -o -name global-error.tsx` liefert ausschließlich `(portal)/anfragen/error.tsx`. `not-found.tsx` gibt es nur im Root. `loading.tsx` fehlt in `(portal)/{hwg-check,onboarding,wiederbehandlungen,dateien}` und in `admin/{animations,videos,...}` (nicht vollständig geprüft für Admin).
- Szenario: Neon-Compute wacht gerade auf oder ein Timeout (`connect_timeout: 10`, `statement_timeout: 15000`) trifft Dashboard, Fortschritt, Einstellungen oder Onboarding: der Nutzer sieht die Standardseite "Application error: a server-side exception has occurred (Digest: ...)", ohne Seitenleiste, ohne Zurück-Knopf, englisch. Dasselbe, wenn eine Server Action wirft (Fehler wird in React geworfen und landet im Root-Boundary). Für eine neue Praxis, die das Portal zum ersten Mal öffnet, ist das der schlechteste Moment.
- Fix-Vorschlag: `src/app/(portal)/error.tsx` (innerhalb der Shell, Muster: `anfragen/error.tsx`), `src/app/global-error.tsx` (eigenes `<html>`) und `src/app/admin/error.tsx` anlegen, jeweils deutscher Text mit "Erneut versuchen" und Digest-Zeile ("Fehlernummer ...") für Rückfragen. `loading.tsx` für `onboarding`, `wiederbehandlungen`, `dateien`, `hwg-check` ergänzen.

### A-10: Fehler werden kaum protokolliert; Sentry konfiguriert, aber nie eingebunden; Roh-Fehlertexte im Toast
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/lib/env.ts:131` (`SENTRY_DSN`), kein `instrumentation.ts`/`@sentry` im Projekt (`package.json`, Grep über `src`); `src/lib/instrument.ts` (`timePage`/`timeAction`: 0 Aufrufer); `src/lib/flash.ts:68-71`; `src/app/(portal)/einstellungen/actions.ts:112-113,182-183,217-218,274-275,315-316` (15 Aufrufer von `flashMessageFromError`, keiner mit `console.error`); `src/server/api.ts:158-165`
- Beleg: `flashMessageFromError` gibt `err.message` unverändert zurück, die `catch`-Blöcke loggen nichts. `mapError` loggt `console.error("[api] unhandled error:", err)` ohne Route, Klinik, Nutzer. Es gibt kein `onRequestError`.
- Szenario: (a) Beim Einladen eines Teammitglieds scheitert ein INSERT: im Toast erscheint z. B. `duplicate key value violates unique constraint "clinic_users_email_key"` oder ein englischer Treiber-Text, in den Logs steht nichts, Karam erfährt nie davon. (b) Ein Fehler in einem Server Component taucht nur als Next-Standardzeile ohne Mandanten-Bezug auf; niemand wird benachrichtigt (kein Sentry, keine Alarme). (c) `SENTRY_DSN` zu setzen bewirkt nichts.
- Fix-Vorschlag: `src/instrumentation.ts` mit `onRequestError` anlegen, der eine JSON-Zeile `{kind:"error", route, digest, clinicId-hash}` schreibt (oder Sentry einbinden); `flashMessageFromError` nur für `ForbiddenError`/eigene `UserFacingError` Text durchreichen, sonst generische deutsche Meldung plus `console.error` mit Aktionsname; `mapError` um `request.nextUrl.pathname` und Session-Hash erweitern.

### A-11: Produktion fällt bei fehlender Konfiguration auf Dev-Werte zurück (localhost-Links, Konsolen-E-Mail, lokaler Speicher)
- Schwere: P1
- Art: robustness
- Sicherheit: hoch
- Ort: `src/lib/env.ts:14` (`APP_ORIGIN` Default `http://localhost:3001`), `:28` (`CLINIC_LANDING_ORIGIN` Default `http://localhost:3002`), `:60` (`EMAIL_DRIVER` Default `console`), `:72` (`STORAGE_DRIVER` Default `local`); `src/server/email.ts:243-262`
- Beleg: Keine dieser Variablen wird in Produktion geprüft; `warnSuspiciousEnv()` warnt nur für Admin-IPs und `resend.dev`. `getEmailSender` fällt bei `EMAIL_DRIVER=resend` ohne Key auf `ConsoleEmailSender` zurück (Warnung einmal pro Prozess).
- Szenario: Fehlt in einem neuen Vercel-Projekt oder nach Umbenennung eine dieser Variablen, "funktioniert" alles: Einladungen und Magic-Links werden still in die Vercel-Logs geschrieben und der Versand meldet Erfolg (der Nutzer sieht "Link gesendet", nie kommt eine Mail); Links in Mails zeigen auf `http://localhost:3001`; Bewertungslinks für Patienten zeigen auf `localhost:3002`; Uploads gehen an den lokalen Datenträger (auf Vercel schreibgeschützt, Fehler erst beim Hochladen).
- Fix-Vorschlag: In `env.ts` ein `superRefine` bzw. in `warnSuspiciousEnv` eine harte Prüfung für `NODE_ENV === "production"` (außerhalb von `SKIP_ENV_VALIDATION`): `APP_ORIGIN` nicht localhost und `https`, `CLINIC_LANDING_ORIGIN` nicht localhost, `EMAIL_DRIVER === "resend"` mit Key, `STORAGE_DRIVER === "r2"` mit Keys; sonst Start verweigern (`throw`). Außerdem Konsolen-Treiber in Produktion nicht zulassen.

### A-12: Konsolen-E-Mail-Treiber schreibt Magic-Link-URLs (Anmelde-Token) und Empfänger in die Produktions-Logs
- Schwere: P2
- Art: security
- Sicherheit: mittel (nur im Fehlkonfigurations-Fall nach A-11, dann aber voll)
- Ort: `src/server/email.ts:67-78`; `src/auth/magic-link.ts:116-118,165-167`
- Beleg: `console.log(input.to)`, `console.log(input.text)` und die extrahierte URL (`urlMatch[0]`). In `magic-link.ts` stehen zusätzlich Klartext-E-Mail und rohe `clinic=<uuid>` in Logzeilen, entgegen der Hash-Regel in `db/client.ts:108-115`.
- Szenario: Läuft der Konsolen-Treiber in Produktion, steht jeder gültige Anmelde-Link im Logstrom (Vercel-Logs, jede Log-Drain-Senke) und kann von jedem mit Log-Zugriff innerhalb der Gültigkeit eingelöst werden.
- Fix-Vorschlag: Konsolen-Treiber in Produktion verbieten (A-11) bzw. nur `to` und Betreff loggen, nie Text/URL; in `magic-link.ts` die E-Mail kürzen (`a***@domain`) und `clinicLogId` verwenden.

### A-13: Health-Endpunkt prüft weder Migrationsstand noch Worker noch E-Mail; Kaltstart-Fehlalarm
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/api/health/route.ts:41-67`
- Beleg: Geprüft werden nur `SELECT 1` (Superuser-Verbindung, 2-s-Timeout) und die einmalig memoisierte Rollenprüfung. Der Kommentar verspricht "migrations table looks sane", im Code fehlt das. Nichts zu pg-boss (letzter Job, Alter der Queue), `schema_migrations` oder Resend.
- Szenario: Der Code wird vor der Migration ausgerollt (Memory: Prod-DB stand schon einmal hinter dem Web-Code): Health bleibt grün, Seiten werfen 500 wegen fehlender Spalten. Der Worker ist tot oder auf 0: Health grün, Anfragen werden nicht bewertet, keine Bewertungs-Mails. Ein ruhender Neon-Compute braucht mehrere Sekunden: `db_timeout` nach 2 s liefert 503 und kann einen Uptime-Alarm auslösen, obwohl die App nach dem Aufwachen gesund ist.
- Fix-Vorschlag: Zusätzlich `SELECT max(version) FROM schema_migrations` gegen eine Konstante `EXPECTED_MIGRATION` prüfen (im Build aus dem Ordner erzeugt), Worker-Liveness als `info` (nicht blockierend): `SELECT max(completed_on) FROM pgboss.job` älter als 30 min, `checks.worker = "idle"`; Timeout auf 5 s, ein Wiederholungsversuch.

### A-14: Verbindungs- und Abfragekosten: zwei Pools je Instanz, jede Transaktion mit mehreren Roundtrips
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `src/db/client.ts:36-47,95-106`; `src/auth/session.ts:158-210`; `src/server/queries/onboardingGate.ts:36-60`; `src/server/queries/navBadgesCache.ts:50-80`; `src/app/(portal)/layout.tsx:59-79`
- Beleg: `clientOptions` setzt `max: 10` für beide Clients (super + app), also bis zu 20 Verbindungen je Instanz. Jede `withClinicContext` öffnet `BEGIN`, `set_config`, Abfrage, `COMMIT` (4 Roundtrips, Neon-Pooler im Transaktionsmodus). Ein harter Seitenaufruf macht: `getSession` (1 Abfrage + fire-and-forget `UPDATE sessions` bei jedem Request), Gate für Inhaber (2 sequentielle Abfragen, ungecacht), `markSectionSeen` (1 Transaktion, nur in drei Bereichen), Badge-Bundle bei Cache-Miss (6 parallele Transaktionen), Kopfdaten (gecacht) plus die Seite selbst (Dashboard laut Kommentar ~15 Abfragen).
- Szenario: Für eine Praxis kein Problem (Neon-Pooler hat deutlich mehr Client-Slots als Last). Spürbar wird es bei Kaltstart plus aufwachender Neon-Compute (Verbindungsaufbau pro Pool bis `connect_timeout: 10`) und mit der Schreibabfrage `UPDATE sessions SET last_seen_at` bei jedem Seitenaufruf (Write-Amplifikation, Tabellen-Bloat). Unter Fluid Compute teilen mehrere gleichzeitige Anfragen eine Instanz, der Pool-Deckel von 10 greift dann bei Dashboard-Streaming.
- Fix-Vorschlag: `lastSeenAt` nur schreiben, wenn der Wert älter als 5 Minuten ist (Bedingung im SQL `WHERE last_seen_at < now() - interval '5 minutes'`); Gate-Status in einer Abfrage (`LEFT JOIN`/Unterabfragen) holen und 60 s pro Klinik cachen; `max` des Super-Pools auf 3 senken (nur Session, Auth, Rate-Limit).

### A-15: Migrations-Runner: keine Sperre, doppelte Nummer 0015, `CONCURRENTLY`-Pfad nicht atomar
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/db/migrate.ts:36-65`; `src/db/migrations/0015_*.sql` (drei Dateien); `src/db/migrations/0005_request_activities_created_idx.sql`
- Beleg: Reihenfolge ist `readdir().sort()` auf dem Dateinamen; "angewendet" wird je Dateiname geführt. Normaler Pfad: `sql.begin` mit `tx.unsafe(body)` plus `INSERT INTO schema_migrations` in einer Transaktion (gut: atomar je Datei, mehrfach lauffähig). Es gibt keinen `pg_advisory_lock`. Drei Dateien tragen die Nummer 0015 (`drop_trustpilot`, `feedback_public_redirect`, `user_avatar`), sie laufen alphabetisch. Der Regex `NO_TX_PATTERN` erkennt `CONCURRENTLY` auch in Kommentaren (die 0005-Datei enthält es im Kommentar und im Statement); der unverpackte Pfad führt den ganzen Text als Mehrfach-Statement aus, und `INSERT` kommt separat.
- Szenario: (a) Zwei gleichzeitige `db:migrate` (zwei Terminals, CI plus lokal) wenden dieselbe Migration doppelt an; ohne `IF NOT EXISTS` bricht die zweite mit halbem Zustand ab. (b) Eine nachträglich eingefügte Datei mit kleinerem Namen läuft stillschweigend "zu spät" nach bereits angewendeten (kein Ordnungs-Check). (c) Eine Migration, die `CONCURRENTLY` nur im Kommentar erwähnt, aber Tabellen ändert, läuft ohne Transaktion und bleibt bei einem Fehler halb angewendet. (d) Eine frische Datenbank (Testumgebung, Notfall-Wiederherstellung) hängt an der Reihenfolge der drei 0015-Dateien. Eine parallele Sitzung legt gerade `0078` an: bei Namenskollision gleiche Nummer, beide laufen, aber ohne Reihenfolge-Garantie.
- Fix-Vorschlag: `SELECT pg_advisory_lock(727274)` am Anfang, `pg_advisory_unlock` im `finally`; Regex auf Zeilen ohne führendes `--` beschränken (Kommentare entfernen); Warnung/Abbruch, wenn eine nicht angewendete Datei lexikographisch vor der höchsten angewendeten liegt; Test `migrations.test.ts`, der doppelte Präfixe außer den bekannten drei 0015 verbietet. Hinweis: `sql` ohne `prepare:false` gegen eine `-pooler`-URL (die `DATABASE_URL` in Prod ist laut Memory die Pooler-URL) kann an Prepared Statements scheitern; vorsichtshalber `prepare: false` setzen.

### A-16: Folgen des abgeschalteten Workers (nutzersichtbar)
- Schwere: P1
- Art: missing-feature
- Sicherheit: hoch (Code), mittel (Auswirkung je Seite)
- Ort: `src/worker/index.ts:103-137` (alle 26 Queues), `src/worker/schedules.ts:36-125`, `src/server/jobs.ts:44-58`, `src/app/api/leads/intake/route.ts:303-312`, `src/server/review-tokens.ts:356`, `src/server/queries/kpis.ts:55-70,229-240`
- Beleg: Producer sind "send-only" (`migrate:false, supervise:false, schedule:false`), alles läuft nur über den Fly-Worker. Jeder Enqueue-Fehler wird zu `null` geschluckt.
- Szenario (alles in Produktion mit Worker auf 0): (1) Neue Anfragen erhalten nie KI-Kategorie und -Score (`ai-score`): Vorqualifizierung, Routing und Heiß/Warm/Kalt-Anzeige bleiben leer. (2) `kpi_daily` wird nur nachts durch `kpi-rebuild` gefüllt: alles, was `kpiSummary`/`currentMonthSummary`/`kpiDailySeries` aus `kpi_daily` liest (Leads, Werbeausgaben, Umsatz, Werbeertrag), bleibt leer oder auf dem Stand des letzten Laufs; live aus `requests` gerechnete Karten sind davon nicht betroffen (Dashboard-Reviewer prüfen die Zuordnung). (3) Keine Bewertungsanfragen per E-Mail (`review-request`, `email-send`), keine monatliche Auswertung als PDF (`monthly-report`), keine Wiederbehandlungs-Erinnerungen (`retreatment-reminder`/`refresh`). (4) `sla-check`: keine Überfällig-Hinweise, keine Benachrichtigungen. (5) `sync-meta/google`, `refresh-oauth`, Google-Bewertungs-Abgleich, `forecast-snapshot`, `anomaly-scan`, CAPI/OCI-Purchase laufen nicht. (6) `purge-audit` (auch `rate_limits`, abgelaufene Sitzungen) und `db-backup` (nächtliches Backup nach R2, `db-backup.ts:38`) laufen nicht: es gibt kein App-eigenes Backup, nur Neon-PITR. (7) pg-boss-Jobs, die Web-Prozesse einreihen, stauen sich auf und laufen beim Hochfahren des Workers alle auf einmal (E-Mails mit altem Zeitbezug).
- Fix-Vorschlag: Vor dem Start der ersten Praxis den Worker auf 1 setzen (bewusst entschiedene Lage, aber die Liste oben für die Entscheidung nutzen); bis dahin im Portal dort, wo die Daten fehlen, einen ehrlichen Leerzustand ("Wird nachts berechnet") statt 0 anzeigen; Health-Check (A-13) um Worker-Alter erweitern.

### A-17: Middleware: Admin-Sperre und Pfad-Header lassen sich über Pfade mit Punkt umgehen
- Schwere: P3
- Art: security
- Sicherheit: mittel
- Ort: `src/middleware.ts:49-51` (`/\.[^/]+$/`), `:70-73`, `:107-109`
- Beleg: Jeder Pfad, der mit `.xxx` endet, gibt sofort `NextResponse.next()` zurück, ohne die Regeln "Admin nur auf `admin.*`" und ohne `x-portal-pathname` zu setzen.
- Szenario: Auf dem Praxis-Host liefert `/admin/clinics/<id>.json` oder `/admin/foo.bar` die Admin-Routen an Next weiter (statt `/404`), der Pfad-Header ist client-kontrolliert. Zugriffsschutz liegt weiter in `getAdminSession` in den Admin-Seiten und Admin-Cookies sind host-gebunden, der praktische Schaden ist gering, die "Defense in depth" aus dem Kommentar greift aber nicht. Umgekehrt trägt der Header bei Punkt-Pfaden Nutzerdaten (Gate-Entscheidung im Layout, `isGateAllowedPath`).
- Fix-Vorschlag: Statische Dateien nur über den Matcher ausnehmen (Endungs-Liste `.svg|.png|.woff2|...`) oder die Punkt-Prüfung erst nach der Admin-Pfad-Sperre ausführen; `x-portal-pathname` immer überschreiben.

### A-18: Prozesslokale Caches sind über Serverless-Instanzen hinweg falsch (HMAC-Secret, Vitals-Limit)
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/server/clinic-signature.ts:24-60,101-116,138`; `src/app/api/vitals/route.ts:23-37,40-43`
- Beleg: `secretCache` (Map, 30 s TTL) speichert auch `null` (kein Secret vorhanden). `invalidateSignatureSecretCache` leert nur die Map der eigenen Instanz. Vitals-Limit pro Isolate; IP kommt aus dem linkesten `x-forwarded-for`-Eintrag (`split(",")[0]`), den der Client frei wählen kann (anders als `client-ip.ts`, das den Fehler kennt).
- Szenario: (a) Erster PVS- oder Formular-Aufruf direkt nach dem Anlegen oder Drehen eines Secrets: Instanz B kennt noch `null` bzw. das alte Secret und lehnt bis zu 30 s mit 401 ab; die Retry-Logik der Agenten fängt das vermutlich ab (nicht geprüft), das Verhalten ist aber nicht deterministisch. (b) Ein Angreifer rotiert `X-Forwarded-For` und umgeht das 60-pro-Minute-Limit der Vitals-Senke: unbegrenzt frei gestaltbare Logzeilen (`route`, `id` bis 256/128 Zeichen) in den Vercel-Logs.
- Fix-Vorschlag: Negativ-Einträge (`null`) nicht cachen oder nur 2 s; Rotation über eine `updated_at`-Spalte prüfen statt TTL; in `vitals/route.ts` `x-real-ip` bevorzugen (Vercel überschreibt ihn) und `route` auf bekannte Präfixe beschränken.

### A-19: Eine Logzeile je Transaktion: Volumen und Kosten
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/db/client.ts:128-152`; `src/app/api/vitals/route.ts:57-66`
- Beleg: `console.log(JSON.stringify({kind:"db", ...}))` bei jeder `withClinicContext`, auch bei `ms <= 50` (`level: "info"`); Mandant als 12-stelliger Hash, `label` ohne personenbezogene Daten (stichprobenhaft geprüft, keine Interpolation von E-Mail/Telefon in Labels). Dazu eine `kind:vitals`-Zeile je Core-Web-Vital und Seitenaufruf.
- Szenario: Ein Dashboard-Aufruf erzeugt ca. 25 bis 30 `kind:db`-Zeilen plus 5 Vitals. Bei einer Praxis harmlos; bei Logs-Drain oder Pro-Log-Kontingent summiert es sich und überdeckt echte Warnungen.
- Fix-Vorschlag: `info`-Zeilen nur ausgeben, wenn `process.env.DB_LOG_ALL === "1"`; `warn` (> `DB_SLOW_MS`) immer. `DB_SLOW_MS` von 50 auf 250 anheben, 50 ms schlagen für Neon über Netzwerk schon bei normalen Transaktionen an.

### A-20: Teure/wartungsanfällige Cache-Schlüssel: Datums-Normalisierung nach UTC, `JSON.stringify` für Objekte
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/server/queries/_cache.ts:62-96`
- Beleg: `dateOnly(d) = d.toISOString().slice(0,10)` (UTC); alle anderen Objekt-Argumente über `JSON.stringify` (Schlüsselreihenfolge abhängig vom Aufrufer). `keyByUser` ist standardmäßig aus, die Rolle ist nie Teil des Schlüssels.
- Szenario: Kein Mandanten-Leck: clinicId ist Pflicht und wird zur Laufzeit geprüft (`throw` bei leer). Gleichwertige Aufrufe mit verschiedener Schlüsselreihenfolge erzeugen Doppel-Einträge; sobald eine gecachte Abfrage rollenabhängig filtert (z. B. Frontdesk sieht keine Umsatzzahlen), würde die Rolle des ersten Aufrufers allen zugutekommen. Heute gibt es keine solche Abfrage (alle 33 `cacheClinicQuery`-Aufrufer sind mandantenweit gleich).
- Fix-Vorschlag: Kommentar in `_cache.ts` um die Regel "nie rollenabhängige Abfragen hier cachen" ergänzen und `opts.role` als optionalen Schlüssel einführen; Objekt-Schlüssel stabil sortieren.

### A-21: `getSession` schreibt bei jedem Aufruf (jede Seite, jede Server Action)
- Schwere: P3
- Art: performance
- Sicherheit: hoch
- Ort: `src/auth/session.ts:200-208`
- Beleg: `void db.update(schema.sessions).set({ lastSeenAt: new Date() })...` bei jeder Auflösung; `React.cache` entlastet nur innerhalb eines Renderings.
- Szenario: Jeder Seitenaufruf und jede Aktion erzeugt ein UPDATE auf `sessions`; auf Serverless kann der nicht erwartete Promise nach dem Response eingefroren werden und beim nächsten Aufruf der Instanz nachlaufen (Verbindung belegt, Warnungen). Siehe A-14 für den Fix.
- Fix-Vorschlag: wie A-14 (nur schreiben, wenn älter als 5 Minuten).

### A-22: Kein `statement_timeout`-Nachweis über den Pooler; Funktionslaufzeit nicht gesetzt
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/db/client.ts:37-46` (`connection: { statement_timeout: 15000 }`), `vercel.json` (ohne `maxDuration`), nur `api/pvs/events/batch/route.ts:31` setzt `maxDuration = 60`
- Beleg: `statement_timeout` wird als Startparameter an die Verbindung gegeben. Ob der Neon-Pooler (PgBouncer, Transaktionsmodus) Startparameter durchreicht, ist nicht belegt (nicht geprüft; wenn er sie ablehnt, bräche jede Verbindung, da die App läuft, wird er vermutlich ignoriert oder akzeptiert).
- Szenario: Ist der Wert wirkungslos, hängt eine blockierte Abfrage (Sperre, Neon-Aufwachen) bis zum Funktions-Timeout; ohne `maxDuration` gilt der Plan-Standard (Hobby 10 s, Pro 15 s ohne Fluid), also Abbruch mitten in einer Server Action (Avatar-Upload 2 MB, CSV-Import, PDF-Erzeugung).
- Fix-Vorschlag: In Prod einmal `SHOW statement_timeout` über `dbApp` im Health-Check prüfen (Wert in `checks`), sonst `SET LOCAL statement_timeout` in `withClinicContext` neben `set_config`; `export const maxDuration = 30` für Upload-/CSV-/PDF-Routen.

### A-23: Env-Kleinigkeiten: `ADMIN_EMAILS`-Warnung pro Import, `env`-Import beim Build
- Schwere: P3
- Art: robustness
- Sicherheit: niedrig
- Ort: `src/lib/env.ts:352-408`; `src/db/client.ts:88-99`
- Beleg: `db`/`dbApp` werden beim Import erzeugt (`appClient()` wirft in Produktion ohne `DATABASE_URL_APP`), also schon im `next build`, wenn `NODE_ENV=production` und die Variable fehlt. Optionale Schlüssel (OpenAI, Meta, R2-Keys, Google) lassen keine Seite abstürzen (nur `has…()`-Prüfungen).
- Szenario: Preview-Deployments ohne `DATABASE_URL_APP` brechen den Build ab; das ist gewollt (Sicherheitsbremse), aber die Fehlermeldung nennt nicht, dass `SKIP_ENV_VALIDATION` den Build nicht rettet.
- Fix-Vorschlag: Fehlermeldung um den Hinweis "in Vercel für Preview setzen" ergänzen. Kein Handlungsdruck.

### A-24: Flash-Cookie wird bei hartem Neuladen innerhalb von 30 Sekunden erneut gezeigt
- Schwere: P3
- Art: ux-flow
- Sicherheit: mittel
- Ort: `src/middleware.ts:55-61`; `src/lib/flash.ts:34-42`
- Beleg: Das Cookie wird nur bei GET mit `accept: text/html` gelöscht; die Server Action setzt es mit `maxAge: 30`.
- Szenario: Nach "Einladung verschickt" lädt der Nutzer die Seite per F5 neu: Toast erscheint ein zweites Mal (Cookie wird erst bei dieser Antwort gelöscht). Kosmetisch.
- Fix-Vorschlag: Toast-Id im `sessionStorage` merken und doppelte Ids ignorieren (die `id` ist bereits vorhanden).

---

## Design-Kritik (nur Kritik)

- Die Next-Standard-Fehlerseite (A-09) ist nicht nur ein Robustheits-, sondern auch ein Markenproblem: englisch, ohne Logo, ohne Rückweg. Für 40- bis 65-jährige Inhaber:innen ist das ein Abbruchpunkt.
- `flashMessageFromError` (A-10) kann Treiber-Fehler im Toast anzeigen; die Texte sind für diese Zielgruppe unverständlich.
- Die Datumszeile im Dashboard-Header und die Zeitstempel (A-01/A-02) sind zusätzlich klein (`text-sm`, `text-fg-secondary`); die Fristzeit ist für den Inhaber eine Entscheidungsgröße und verdient mehr Gewicht.

## Zusammenfassung

Anzahl: P0 0, P1 7 (A-01, A-02, A-08, A-09, A-10, A-11, A-16), P2 10 (A-03 bis A-07, A-12 bis A-15, A-18), P3 7 (A-17, A-19 bis A-24). Insgesamt 24 Befunde.

Die 3 dringendsten Punkte:
1. A-01/A-02: Alle Uhrzeiten, das Dashboard-Fenster "Heute" und die Begrüßung laufen in UTC und sind 1 bis 2 Stunden falsch; `timeZone: "Europe/Berlin"` in `formatting.ts` plus eine Berlin-Zeit-Hilfe für die Fenster beheben das.
2. A-09/A-10: Es gibt kein `error.tsx` (außer Anfragen), kein `global-error` und keine Fehlerüberwachung; ein Datenbankfehler zeigt die nackte englische Next-Seite, Aktionsfehler erscheinen roh im Toast und werden nicht geloggt.
3. A-11/A-16: Produktion fällt bei fehlender Konfiguration still auf Dev-Verhalten zurück (E-Mails nur im Log, localhost-Links), und mit Worker 0 fehlen KI-Score, KPI-Aufbau, Bewertungs-Mails und Backups.
