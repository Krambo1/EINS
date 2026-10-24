# I: Ballast und toter Code (Linse: Bloat und Dead Code)

Stand: 2026-10-07, nur gelesen, keine Quelldatei geändert. Ergänzend zum Brief gibt es für diese Linse `Art: bloat` (ungenutzter Code/Abhängigkeit, ohne Nutzerwirkung).

Methode und Grenzen:
- `tsc --noUnusedLocals --noUnusedParameters`: Im Arbeitsbaum bricht `tsc` sofort mit Syntaxfehlern ab (siehe I-1). Ich habe eine Kopie von `src/` in den Scratchpad gelegt, `pvs-csv-mapper.ts` dort durch die HEAD-Version ersetzt und damit gemessen. Ergebnis: nur 24 Treffer (siehe I-12), der Code ist hier sauber.
- Importgraph: eigenes Node-Skript über alle `src/**` und `scripts/**` (relative Importe, `@/`-Alias, `import(`, `export ... from`). Next-Konventionsdateien ausgenommen. Exportprüfung per Wortsuche in allen anderen Dateien inklusive Tests, also konservativ (ein Treffer in einem Test zählt als Nutzung).
- Nicht als tot geführt (laufende Arbeit anderer Sitzung): `wiederbehandlungen/*`, `retreatment*`, `0078_*`, `api/pvs/events/*`, `pvs-vendor-config*`, `pvs-config-signature*`, `api/pvs/agent/config/*`. Auch `pvs-csv-parse.ts` (untracked, neu, keine Importer) und `pvs-csv-mapper.ts`/`pvs-csv-aliases.ts` (`planCsvRows`, `autoMatchHeader` ohne Importer) gehören vermutlich dazu: nicht löschen.

---

### I-1: Arbeitsbaum nicht kompilierbar, Platzhalterzeilen in `pvs-csv-mapper.ts`
- Schwere: P1
- Art: bug
- Sicherheit: hoch
- Ort: `src/server/pvs-csv-mapper.ts:278` (`@@DATES@@`), `:339` (`@@AMOUNT@@`)
- Beleg: Zwei Zeilen mit rohem Text `@@DATES@@` und `@@AMOUNT@@` mitten im Modul. `npx tsc --noEmit -p .` liefert `TS1109: Expression expected` an Zeile 287 und 340 und meldet danach keinen einzigen semantischen Fehler mehr (tsc bricht bei Syntaxfehlern vor der Typprüfung ab). `git status`: Datei ist " M", also uncommitted.
- Szenario: Wer jetzt `/ship` oder `next build` ausführt, bekommt einen Build-Fehler; schlimmer: `pnpm typecheck` ist unbrauchbar, jeder weitere Typfehler bleibt unsichtbar, solange die Datei so steht. Sehr wahrscheinlich ein halbfertiger Platzhalter-Ersatz der anderen Sitzung (in Arbeit, andere Sitzung).
- Fix-Vorschlag: Besitzer der Datei muss die Platzhalter durch `normaliseDate`/`parseAmountToCents`-Code ersetzen, bevor irgendjemand shippt. Nicht anfassen, nur der Sitzung melden.

### I-2: `package.json` verweist auf nicht vorhandene Skripte und Konfigurationen
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `package.json:23` (`admin:create` -> `src/scripts/create-admin.ts`), `package.json:20-21` (`db:generate`, `db:studio` brauchen `drizzle.config.ts`), `package.json:15` (`test:e2e` -> `playwright test`)
- Beleg: `src/scripts/create-admin.ts` existiert nicht und nirgends in `git log --all`. Es gibt kein `drizzle.config.ts` (weder im Portal noch im Repo, `git ls-files` leer), kein `src/db/migrations/meta/`. Es gibt keine `playwright.config.ts` und keinen e2e-Ordner. Migrationen sind handgeschriebenes SQL (81 Dateien), `db:migrate` läuft über `src/db/migrate.ts`.
- Szenario: Der erste Admin einer neuen Instanz lässt sich nicht per `pnpm admin:create` anlegen (Reviewer G hat dasselbe gefunden); `pnpm db:generate` würde eine nicht passende Migration erzeugen oder abbrechen.
- Fix-Vorschlag: `admin:create`, `db:generate`, `db:studio`, `test:e2e` aus `package.json` entfernen (oder `create-admin.ts` wirklich schreiben, falls gewollt: dann Funktionsbefund, nicht Bloat). Mit I-4 zusammen erledigen.

### I-3: Ganze Datei ohne Importer: `src/server/queries/lifecycle.ts` und `detail-helpers`-Komponenten
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort: `src/server/queries/lifecycle.ts` (307 Zeilen), `src/app/(portal)/dashboard/_components/detail-helpers.tsx:24-295`
- Beleg: `grep -r "queries/lifecycle"` über `src`, `scripts`, `package.json`: 0 Treffer. Alle sechs Exporte (`responseTimeStats`, `responseTimeSeries`, `aiScoreDistribution`, `weekdayHeatmap`, `hourlyHeatmap`, `cohortRetention`) kommen außerhalb der Datei nirgends vor (`admin/page.tsx` nutzt eine eigene `aiScoreDistribution` aus `queries/admin.ts`). In `detail-helpers.tsx` importieren die drei Nachbarn nur `DataTable` und den Typ `BreakdownTone`; `BreakdownBars`, `FunnelVisualization`, `WeekdayHeatmap`, `HourlyHeatmap`, `ScoreDistribution` (rund 270 von 353 Zeilen) haben null Importer. Der Kommentar in `lifecycle.ts` nennt noch "Detail-mode panels on the Auswertung and Dashboard", die es so nicht mehr gibt.
- Szenario: Kein Nutzerschaden; Ballast und beim Schema-Umbau (Anfragen-Spalten) kompiliert Code mit, den niemand ausführt.
- Fix-Vorschlag: `lifecycle.ts` löschen; in `detail-helpers.tsx` nur `BreakdownTone`, `DataTable`, `DataTableColumn` behalten. Vorher `git grep` auf die Namen wiederholen (Sicherheit hoch).

### I-4: Ungenutzte Abhängigkeiten in `apps/portal/package.json`
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort: `package.json:25-75`
- Beleg (0 Importe in `src/`, `scripts/`, `test/`, Konfigdateien und `packages/ui/src`):
  - `react-hook-form`, `@hookform/resolvers`: 0 Treffer überall.
  - `qrcode`, `@types/qrcode`: 0 Treffer.
  - `axe-core`, `@playwright/test`: 0 Treffer, keine Playwright-Konfiguration (siehe I-2).
  - `pg`, `@types/pg`: `grep 'from "pg"'`/`require("pg")` in `src` und `scripts`: 0 (pg-boss bringt `pg` selbst mit; die Portal-Datenbank läuft über `postgres`).
  - `date-fns`: 0 Importe; nur in `next.config.ts:30` unter `optimizePackageImports` erwähnt ("defensive").
  - 12 Radix-Pakete (`react-accordion`, `dialog`, `dropdown-menu`, `label`, `popover`, `select`, `separator`, `slot`, `switch`, `tabs`, `toast`, `tooltip`), `class-variance-authority`, `clsx`, `tailwind-merge`: Das Portal importiert nichts davon direkt (`grep '@radix-ui' src` leer); `packages/ui/package.json:25-40` deklariert sie selbst. Zusätzlich hat `packages/ui` selbst kein Tooltip-Bauteil, also ist `@radix-ui/react-tooltip` auch dort ungenutzt (`packages/ui/package.json:36`).
  - `drizzle-kit`: ohne Konfiguration nicht lauffähig (I-2); Karam entscheidet, ob er `db:studio` will (Sicherheit mittel).
- Szenario: Größere Installation und Lockfile, mehr Supply-Chain-Fläche; kein Laufzeiteffekt (Tree-Shaking).
- Fix-Vorschlag: Einträge entfernen, danach `pnpm install` im Repo-Root (Lockfile aktualisieren), `pnpm --filter portal typecheck && pnpm --filter portal test`. Radix/`clsx`/`cva`/`tailwind-merge` im Portal nur entfernen, wenn `pnpm build` danach grün ist (pnpm-Hoisting kann einen verdeckten Import sichtbar machen; ich habe keinen gefunden).

### I-5: Ungenutzte Umgebungsvariablen und Flags in `env.ts`
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort: `src/lib/env.ts:154` (`SENTRY_DSN`), `:203` (`NEXT_PUBLIC_SENTRY_DSN`), `:191-199` (`FEATURES`), `:202` (`NEXT_PUBLIC_APP_URL`), `.env.example`
- Beleg: Keine dieser vier Variablen wird außerhalb von `env.ts` gelesen. Es gibt kein `@sentry/*`-Paket. `FEATURES` (Komma-Liste) hat keinen Leser, also gibt es keine Feature-Flags. Zusätzlich: `NEXT_PUBLIC_APP_URL` hat den Default `http://localhost:3001` und würde, falls später doch genutzt, in Prod auf localhost zeigen.
- Szenario: Wer `SENTRY_DSN` in Vercel setzt, glaubt an Fehlerüberwachung, die es nicht gibt.
- Fix-Vorschlag: Die vier Schlüssel aus Schema, `runtimeEnv` und `.env.example` streichen. (Ob Fehlerüberwachung fehlt, ist eine Produktfrage, kein Bloat.)

### I-6: Verwaiste Seiten, nur per URL erreichbar
- Schwere: P3
- Art: bloat
- Sicherheit: mittel
- Ort: `src/app/(portal)/hwg-check/*` (`page.tsx`, `HwgForm.tsx`, `actions.ts`), `src/app/(auth)/login/sent/page.tsx`
- Beleg:
  - `/hwg-check`: kein Link in `PortalShell.tsx`, `staticIndex.ts`, Leitfaden, FAQ (`grep '"/hwg-check'` und `hwg-check` außerhalb des eigenen Ordners: 0). Nur die Berechtigung `tools.hwg_check` in `roles.ts:39` und die Tabelle `hwg_checks` hängen daran (`dsgvo.ts` exportiert/löscht sie mit). `src/server/hwg.ts` wird zusätzlich von `reply-templates.test.ts` genutzt.
  - `/login/sent`: `login/actions.ts:181` leitet auf `/login?sent=1`; niemand navigiert nach `/login/sent` (Kommentare in `admin/forgot-password` und `admin/login/_components/LoginForm.tsx` erwähnen, dass man dort bewusst NICHT mehr hinnavigiert).
- Szenario: Kunden können den HWG-Check nicht finden (Funktion, die sonst nichts nutzt), oder die Seite ist ein vergessener Rest.
- Fix-Vorschlag: `/login/sent` löschen (check first: `?sent=1`-Variante muss die gleiche Meldung zeigen). Für `/hwg-check` Entscheidung Karams: entweder in die Navigation/Suche aufnehmen oder samt `tools.hwg_check`, `hwgChecks` im DSGVO-Export entfernen (Tabelle und Migration NICHT löschen).

### I-7: Platzhalter-Texte mit offenem TODO erreichen Kunden
- Schwere: P2
- Art: robustness
- Sicherheit: hoch
- Ort: `src/app/(portal)/onboarding/checkliste/content.ts:26-37` (`EINS_CONTACT`), `:222` (A5), `:751` (F6)
- Beleg: `TODO(karam): replace these three placeholders with the real values before go-live`. `metaBmId` ist der Text `"(Ihre EINS-Business-Manager-ID nennen wir Ihnen im Onboarding)"`, `adsEmail` ist `"(diese E-Mail-Adresse nennen wir Ihnen im Onboarding)"`. Beide stehen in den Schritt-für-Schritt-Anleitungen der Checkliste (B1 Meta-Partnereinladung, Google-Ads-/GBP-Einladung). Die anderen beiden TODOs (A5 Übergabeweg der Klon-Aufnahme, F6 Einwilligungsvorlage) sind bewusst offene Entscheidungen, der Text nennt dort laut Kommentar keinen Weg.
- Szenario: Die erste Praxis öffnet die Checkliste und soll "EINS als Partner einladen", bekommt aber keine ID und keine E-Mail-Adresse; sie schreibt Karam oder bricht den Schritt ab.
- Fix-Vorschlag: Die echten Werte in `EINS_CONTACT` eintragen (Karam), oder die Anleitungen so umformulieren, dass der Schritt den Onboarding-Kontakt benennt. TODOs A5/F6 als Entscheidungsliste an Karam geben (keine Wegwerfliste, sie sind sichtbar).

### I-8: Ungenutzte Exporte (tote Funktionen)
- Schwere: P3
- Art: bloat
- Sicherheit: hoch (null Treffer in allen `src`, `scripts`, Tests; Wortsuche; dynamischer Zugriff über Namenstrings ausgeschlossen, da keine String-Registry für diese Namen existiert)
- Ort und Beleg, gruppiert (jeweils nur Deklaration, kein Aufrufer):
  - `src/server/queries/kpis.ts`: `currentMonthSummary`, `lastNDaysSummary`, `kpiDailySeriesWithSparkline`, `noShowRateSeries`
  - `src/server/queries/patients.ts`: `topPatientsByLtv`, `ltvByChannel`
  - `src/server/queries/attribution.ts`: `byChannel`, `byCampaign`
  - `src/server/queries/requests.ts`: `recentRequestsCount`, `totalRequestsInRangeWithComparison`, `totalRequestsDailyInRange`
  - `src/server/queries/assets.ts`: `getAsset`, `getAnimationLibraryEntry`
  - `src/server/queries/anomalies.ts`: `assertAlertOwned`; `forecast.ts`: `getCalibrationHistory`; `patient-feedback.ts`: `patientFeedbackDashboardMetrics`; `treatments.ts`: `categorizeTreatmentWish`
  - `src/server/jobs.ts`: `enqueueCampaignSync`, `enqueueMonthlyReport` (Queues laufen über Zeitpläne)
  - `src/server/pvs-agent-enroll.ts`: `purgeExpiredAgentTokens`; `pvs-link-state.ts`: `countQuarantinedEvents`; `pvs-token.ts`: `bemerkungInstructionFor`
  - `src/lib/formatting.ts`: `formatRelativeDay`, `formatRoasSentence`, `formatMinutes`, `formatDeltaPct`
  - `src/lib/roles.ts`: `requirePermission` (die Aktionen nutzen rohe Rollenvergleiche, siehe I-14); `src/auth/guards.ts`: `optionalSession`; `src/auth/admin.ts`: `revokeOtherAdminSessionsForAdmin`
  - `src/lib/dashboard-range.ts`: `DashboardRangeKey`, `AdminRangeKey`, `DASHBOARD_RANGE_FULL_LABELS`, `DASHBOARD_RANGE_COMPARISON_HINTS`; `lib/chart-data.ts`: `isoDateRangeEndingToday`; `lib/constants.ts`: `CAMPAIGN_LIVE_CACHE_SECONDS`; `lib/sources.ts`: `FORECAST_SOURCES`, `FORECAST_SOURCE_LABELS`; `db/client.ts`: `sqlClientApp`
  - `src/lib/instrument.ts` (51 Zeilen, `timePage`/`timeAction`): ganze Datei ohne Importer.
  - Typen/Konstanten ohne Nutzer: `pvs-events.ts` Event-Typen (`AppointmentCreatedEvent` u. a.), `TONE_TEXT` in `AdminTable.tsx`, `VideoEventKind`, `FORECAST_HORIZON_DAYS`, `ReminderStatus`, `ChecklistItemState`.
- Szenario: Reiner Wartungsballast; jeder Umbau am Schema muss diese Funktionen mitpflegen.
- Fix-Vorschlag: Mechanisch löschen (Liste unten), danach `tsc`, `vitest`.

### I-9: Doppelte Client-IP-Erkennung, mehrere Kopien nehmen den spoofbaren linken XFF-Eintrag
- Schwere: P2
- Art: security
- Sicherheit: hoch
- Ort: `src/app/api/leads/intake/route.ts:170-175,207-208`, `src/app/api/vitals/route.ts:38-39`, `src/app/api/pvs/agent-enroll/route.ts:51`, (in Arbeit, andere Sitzung) `src/app/api/pvs/agent/config/route.ts:44-49`, `agent/failure-summary/route.ts:42-47`, `agent/heartbeat/route.ts:278-283`, `events/route.ts:37-42`, `events/batch/route.ts:59-64`, `health/route.ts:27-34`
- Beleg: `src/lib/client-ip.ts` (`trustedIpFromHeaders`) erklärt ausdrücklich, dass der linkeste `x-forwarded-for`-Eintrag vom Client fälschbar ist und nimmt `x-real-ip`, sonst den rechtesten Eintrag. Die genannten Routen machen dagegen `(xff ?? x-real-ip ?? "").split(",")[0]`, also genau den linken Eintrag. Dagegen nutzen 12 andere Stellen (`review-tokens/*`, `retreatment-tokens/*`, `auth/*`) den Helfer korrekt.
- Szenario: Ein Angreifer sendet `X-Forwarded-For: <beliebig>` und umgeht die IP-Drosseln `leads-intake-ip` (600/10 min), `pvs-health-ip` und die der PVS-Routen (auf Vercel hängt die Plattform die echte IP rechts an, der Client kann links frei vorgeben). Zusätzlich landen gefälschte IPs im DSGVO-Nachweis der Einwilligung (`requestMeta.ip` in `leads/intake`).
- Fix-Vorschlag: In allen genannten Dateien `trustedIpFromHeaders(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"))` aus `@/lib/client-ip` benutzen (eine Zeile, keine neue Logik). Die PVS-Dateien nach der Sitzung der anderen Hand anfassen.

### I-10: Doppelte Hilfsfunktionen (Konsolidierungsliste)
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort und Beleg:
  - `formatBytes`/`formatFileSize`: 7 Kopien mit leicht unterschiedlichem Verhalten (`(portal)/dateien/actions.ts:290`, `dateien/page.tsx:133`, `dateien/UploadForm.tsx:364`, `medien/page.tsx:494` (Dezimalkomma), `onboarding/checkliste/ChecklisteForm.tsx:642`, `admin/clinics/[id]/_components/ChecklisteTab.tsx:337`, `DateienTab.tsx:138`, `admin/videos/_components/VideoUploadCard.tsx:421` (ohne `B`-Zweig)). Behalten: neue Funktion in `src/lib/formatting.ts` mit `de-DE`-Dezimalkomma (wie `medien/page.tsx`).
  - `escapeHtml`: inline-Ketten `replace(/&/g,...)` in `dateien/actions.ts:260`, `medien/actions.ts:102`, `admin/start-impersonation/route.ts:149`, `server/email/templates/feedback-alert.ts:111`; zentrale Version `server/email.ts:304` existiert. Behalten: die aus `email.ts` (in eine Datei `lib/html.ts` ziehen, falls Import in Routen stört).
  - `formatEuro`/`formatPct`: `worker/anomaly/rules.ts:533-546` baut eigene Formatter (`toFixed` plus Regex); `lib/formatting.ts` hat `formatEuro` (Intl, `€`) und `formatPercent`. Behalten: `lib/formatting.ts`. Achtung: Ausgabe weicht in Rundung ab (`rules.ts` zeigt immer 2 Nachkommastellen), also Tests der Anomalie-Texte prüfen.
  - UUID-Regex: 5 Kopien (`anfragen/[id]/page.tsx:68`, `bewertungen/feedback/[id]/page.tsx:47`, `admin/garantie/[clinicId]/page.tsx:55`, `server/outreach-videos.ts:40`, `admin/pvs-bridge/events/page.tsx:288`). Behalten: ein `isUuid` in `lib/` (z. B. `lib/ids.ts`) oder `z.string().uuid()` (48 Stellen nutzen es schon).
  - `DAY_MS`/`MS_PER_DAY`: 6 eigene Konstanten (`guarantee-clock.ts:33`, `retreatment.ts:61`, `werkstunden.ts:33`, `pvs-agent-health.ts:80`, `anomaly/rules.ts:30`, `TimelineList.tsx:13`) und 30 Stellen mit `86400000`/`24*60*60*1000` inline. Eine `DAY_MS` in `lib/constants.ts`.
  - Telefonnummern: `CallQueue.tsx:371` (WhatsApp-Link, `0` -> `49`), `score-rules.ts:165` (nur Ziffern prüfen), `meta-capi.ts:62` (Hash). Drei Zwecke, aber `meta-capi.hashPhone` hasht Rohziffern ohne Landesvorwahl-Normalisierung (`0171...` bleibt `0171...`); Meta erwartet E.164. Behalten: gemeinsame `normalizePhoneE164` in `lib/` und in `hashPhone` benutzen (Match-Qualität der Meta-Ereignisse; Sicherheit mittel).
  - `sha256Hex`: `lib/crypto.ts:52` und `server/pvs-config-signature.ts:74` (in Arbeit, andere Sitzung); `meta-capi.ts:52` `sha256Lower`. Behalten: `lib/crypto.ts`.
  - Zeitzone: Daten werden an 20 Stellen mit `toLocaleDateString("de-DE", {...})` ohne `timeZone` gerendert (z. B. `dashboard/page.tsx:131`, `fragebogen/page.tsx:73`, `FragebogenTab.tsx:83`, `monthly-pdf.tsx:141`). Auf Vercel ist die Server-Zeit UTC: zwischen 00:00 und 02:00 Berliner Zeit zeigt das gestern. `lib/formatting.ts` hat bereits `dateFormatter`; prüfen, ob dort `timeZone: "Europe/Berlin"` gesetzt ist, und die Einzelfälle auf `formatDate`/`formatBerlinDateTime` (`werkstunden.ts:276`) umstellen. Sicherheit mittel (Auswirkung nur nahe Mitternacht).
  - Pluralisierung: 26 Stellen mit `=== 1 ? "Datei" : "Dateien"`; kein Hilfsmittel. Nur sinnvoll als `plural(n, "Datei", "Dateien")` in `lib/formatting.ts`, wenn sowieso angefasst wird.
- Szenario: Abweichende Formate für dieselbe Größe auf verschiedenen Seiten (`1,5 MB` vs `1.5 MB`), Fehler müssen mehrfach behoben werden.
- Fix-Vorschlag: siehe "Konsolidierungsliste" unten, je Zeile eine Datei zum Behalten.

### I-11: Ungenutzte Konfiguration und tote Skripte in `src/scripts` und `scripts`
- Schwere: P3
- Art: bloat
- Sicherheit: mittel
- Ort: `src/scripts/enable-template-review.ts`, `preview-review-email.ts`, `send-review-email.ts`, `test-review-system.ts`, `verify-review-test.ts`, `trigger-anomaly-scan.ts`; `scripts/smoke-pvs-health.ts`, `scripts/add-demo-login.ts`
- Beleg: Kein Eintrag in `package.json`, keine Verweise außer in den Skripten selbst und im Review-Mail-Test-Strang (`preview-review-email.ts` verweist auf `test-review-system.ts`, `enable-template-review.ts`). `verify-review-test.ts` wird gar nicht erwähnt. `smoke-pvs-health.ts` nutzt laut Kopf einen Phase-4-Test auf `:3001`. `add-demo-login.ts` ist ein dokumentiertes Prod-Einmalskript (Fail-closed ohne `DEMO_LOGIN_PASSWORD`), von Reviewer G als einziger Weg erwähnt, einen Login zu bekommen.
- Szenario: Dev-Werkzeuge liegen neben Produktcode in `src/scripts` (wird mitkompiliert und in `tsc` geprüft).
- Fix-Vorschlag: Die sechs Review-Mail-/Anomalie-Skripte nach `scripts/` verschieben oder löschen, wenn Karam sie nicht mehr braucht (check first; sie schreiben in Datenbanken). `add-demo-login.ts` und `smoke-routes.mjs` (untracked, neu) behalten.

### I-12: Ungenutzte Importe und Variablen (tsc-Auszug)
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort (24 Treffer, nach Datei gruppiert):
  - `(portal)/dashboard/_components/DashboardDetailBundle.tsx:75` (`locWin`), `DashboardTopMetricsEnhanced.tsx:76` (`openSummary`)
  - `(portal)/einstellungen/integrationen/links/page.tsx:10` (`Button`), `mapping/locations/page.tsx:9` und `mapping/treatments/page.tsx:9` (`Badge`), `setup/csv/_wizard.tsx:3,24` (`useTransition`, `UploadResult`), `setup/page.tsx:18` (`Cog`)
  - `admin/animations/actions.ts:4` (`and`), `admin/clinics/[id]/_components/LeistungTab.tsx:44` (`cppTone`), `admin/clinics/[id]/page.tsx:10` (`AI_CATEGORIES`), `admin/pvs-bridge/page.tsx:4` (`schema`)
  - `api/files/[...path]/route.ts:26` (`req`, Parameter)
  - `db/schema-pvs.ts:17` (`date`), `db/schema.ts:28` (`pgEnum`), `db/seed.ts:41` (`ClientSql`)
  - `server/queries/patients.ts:2` (`gte`, `isNotNull`)
  - `worker/processors/db-backup.ts:71` (`dc`), `worker/processors/pvs-reconcile.ts:1` (`isNull`, `lt`)
  - Tests: `pvs-agent-enroll.test.ts:360`, `pvs-link-state.test.ts:114,165`
- Szenario: Reiner Lärm; `db-backup.ts:71` (`dc` ungelesen) lohnt einen Blick, ob das Backup-Skript eine Variable berechnet und dann nicht benutzt.
- Fix-Vorschlag: Importe entfernen. `db-backup.ts` zuerst lesen.

### I-13: Legacy-Zweige und "Kompatibilität" ohne Aufrufer
- Schwere: P3
- Art: bloat
- Sicherheit: mittel
- Ort: `dashboard/_components/detail-helpers.tsx:86-87` (Prop "kept for API compatibility with old callers"), `leitfaden/content.ts:1088,1108` ("legacy page"), `api/files/[...path]/route.ts` und `api/uploads/route.ts` (in Prod mit `STORAGE_DRIVER=r2` immer 404, nur lokal nutzbar), `api/leads/intake/route.ts:32,51,246` (Legacy-Payload-Felder), `api/pvs/events/route.ts:88` (Kind-Aliase), `api/admin/pvs/events/[id]/replay/route.ts:20-70` (`allowLegacy=1` für unsignierte Alt-Zeilen vor Migration 0060)
- Beleg: Nach `grep` keine BullMQ/Redis/ioredis-Reste im Code (nur Migrationskommentare); keine `otpauth`/TOTP-Reste außer erklärenden Kommentaren (`auth/admin.ts:20,32`, `env.ts:391`) und einem FAQ-Schlagwort `totp` in `faq/content.ts:497` (harmlos). Kein auskommentierter Code gefunden (heuristische Suche nach `// const|await|return|if (` leer). Keine Drehtag-/Monatsmedien-/"Klinik"-Treffer in `src` (außer dem Hinweis im Kommentar `faq/content.ts:11`).
- Szenario: Der `allowLegacy`-Pfad ist in Prod relevant, solange Altzeilen existieren; bei einer neuen Datenbank ohne Altzeilen ist er toter Pfad.
- Fix-Vorschlag: `detail-helpers.tsx`-Prop löschen (erledigt sich mit I-3). Die Leser der Legacy-Felder (`leads/intake`) nur entfernen, wenn alle Zielseiten (`clinic-landing`, Meta-Leadgen) auf das neue Format sind (check first). Rest belassen.

### I-14: Rollenprüfungen uneinheitlich
- Schwere: P3
- Art: robustness
- Sicherheit: mittel
- Ort: `src/lib/roles.ts:73` (`requirePermission`, ungenutzt) gegenüber `(portal)/einstellungen/actions.ts:46,143,230`, `integrationen/actions.ts:44,93`, `anfragen/page.tsx:63-64`, `bewertungen/page.tsx:49`, `werbebudget/page.tsx:67`, `einstellungen/page.tsx:59`, `(portal)/layout.tsx:59,94`
- Beleg: Die Rechtematrix `PERMISSIONS` (`roles.ts:9`) mit `can()` wird bei Seiten und Medien-Aktionen genutzt, daneben 11 Stellen mit rohem `session.role === "inhaber"`. Eine Änderung der Matrix (z. B. Marketing darf Integrationen) greift dort nicht.
- Szenario: Matrix und Code laufen auseinander, die Regel "wer darf Integrationen ändern" steht an zwei Orten.
- Fix-Vorschlag: Für die Aktionen eine Permission anlegen (`integrations.manage`, `team.manage`) und `requirePermission` benutzen. Kleiner Aufwand, aber Verhalten unverändert halten (nur Inhaber).

### I-15: Stray-Dateien im Portal-Root
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort: `apps/portal/leitfaden.pdf` (111 KB, getrackt), `apps/portal/review-preview.html`, `review-preview-bare.html` (untracked, ignoriert über `.gitignore:58`), `apps/portal/storage/` (32 MB, ignoriert über `.gitignore:14`, enthält Test-Uploads und `outreach-videos/*.mp4`), `tsconfig.tsbuildinfo` (529 KB, ignoriert), `.next-3007/` (ignoriert), `.node-version` und `.nvmrc` (Duplikate, beide `20`)
- Beleg: `leitfaden.pdf` wird nirgends referenziert (`grep` über `src`, `scripts`, Docker, `RUN.md`: nur das Skript `pdf:leitfaden` schreibt dorthin, `seed.ts` erzeugt die Datei selbst). Die HTML-Vorschauen sind Ausgaben von `preview-review-email.ts` (Standardpfad `./review-preview.html`). `public/eins-mark.png` hat im Portal und in `docs`/Repo außerhalb alter Worktrees keine Referenz.
- Szenario: Kein Schaden; der Repo wirkt unaufgeräumt und `leitfaden.pdf` driftet gegen den Inhalt in `leitfaden/content.ts`.
- Fix-Vorschlag: `git rm apps/portal/leitfaden.pdf` (Ausgabeort des Skripts auf `storage/` oder `out/` setzen), `public/eins-mark.png` entfernen (check first: eventuell Fremdnutzung per URL, z. B. in E-Mails; `env.ts:299-303` nutzt nur `eins-logo.png` und `star-rating.svg`). `.nvmrc` und `.node-version` auf eine reduzieren.

### I-16: `public/pvs-bridge/tomedo-lua` ist aus dem Portal nicht verlinkt
- Schwere: P3
- Art: bloat
- Sicherheit: niedrig
- Ort: `public/pvs-bridge/tomedo-lua/*`, `setup/tomedo/page.tsx`
- Beleg: Keine Referenz in `src`; nur die Bridge-Tests (`apps/bridge/agent/src/db-adapters/cross-path-dedup.test.ts:15`) lesen die Dateien direkt aus `public/`. Das n8n-Template dagegen ist verlinkt (`setup/n8n/page.tsx:41`).
- Szenario: Kein Schaden; unklar, ob die Kunden die Lua-Hooks je erreichen sollen.
- Fix-Vorschlag: Nicht löschen (Testfixture). Entscheiden, ob die Tomedo-Seite sie verlinken soll.

### I-17: Sichtbare Copy-Regelverstöße im Portal
- Schwere: P3
- Art: copy
- Sicherheit: hoch
- Ort: Gedankenstriche in sichtbaren Texten, rund 100 Zeilen (Auszug: `(portal)/anfragen/_components/CallQueue.tsx:69`, `bewertungen/feedback/page.tsx:96,143`, `bewertungen/feedback/[id]/page.tsx:33,176`, `integrationen/ads-conversion/page.tsx:124,135`, `integrationen/setup/page.tsx:49,68,77,120`, `setup/n8n/page.tsx:66`, `_reveal.tsx:18`, `mapping/*/_mapping-row.tsx:57,60`, `server/reports/monthly-pdf.tsx:141`); Anglizismen: `dashboard/_components/BreakdownStackChart.tsx:46,373,485`, `DashboardDetailBundle.tsx:782`, `DashboardTopMetricsEnhanced.tsx:350` (`ROAS`), `integrationen/ads-conversion/page.tsx:27` ("Conversion-Tracking"), `:224` ("Landingpage"), `:124` ("Lead-Events"), `ChecklisteTab`-Verwandte `admin/clinics/[id]/_components/LeistungTab.tsx:101` ("Spend")
- Beleg: Suche `grep -rn "—" src` (ohne Kommentarzeilen und Tests) ergibt 128 Zeilen; viele sind Platzhalter `"—"` für leere Werte (bleiben vertretbar, kein Satzzeichen), der Rest sind echte Satzstriche. Regel laut `CLAUDE.md`: kein U+2014, Werbeertrag statt ROAS, Zielseite statt Landingpage, Anfrage statt Lead.
- Szenario: Kunden sehen Stilbruch gegenüber der Marketing-Seite; kein Funktionsproblem.
- Fix-Vorschlag: Einmal alle sichtbaren Texte per Skript prüfen (Platzhalter-`"—"` für leere Zellen auf `-` oder "keine Angabe" stellen, Satzstriche durch Komma/Doppelpunkt ersetzen), ROAS -> Werbeertrag, "Conversion-Tracking" -> "Abschluss-Messung".

### I-18: Große Dateien (nur nach Risiko)
- Schwere: P3
- Art: bloat
- Sicherheit: hoch
- Ort und Einschätzung (Top 10 nach Zeilen):
  1. `src/db/schema.ts` (2087): ein Drizzle-Schema, Größe normal, kein Handlungsbedarf.
  2. `src/server/queries/admin.ts` (1939): alle Admin-Abfragen in einer Datei, viele Duplikate bei Zeitfenster-Logik (`startOfDayUtc`); Teilung nach Seiten würde Merge-Konflikte zwischen Sitzungen senken.
  3. `src/worker/processors/pvs-status-derive.ts` (1278): Kernlogik Umsatz/Status, bereits mit Tests; in Arbeit (andere Sitzung), nicht anfassen.
  4. `src/server/pvs-events.ts` (1202): Event-Anwendung; in Arbeit (andere Sitzung).
  5. `(portal)/leitfaden/content.ts` (1164): reine Inhaltsdaten, harmlos.
  6. `src/server/queries/requests.ts` (1084): Anfragenliste mit vielen Filtern; trägt Seitenladezeit, zweitgrößtes Performance-Risiko, aber kein Splitting nötig.
  7. `(portal)/einstellungen/page.tsx` (1025): eine Serverseite mit allen Einstellungsblöcken; jede Einstellung lädt alle Daten (Performance-Risiko, nicht Bloat); Aufteilen in Unterseiten wäre sinnvoll.
  8. `dashboard/_components/DashboardDetailBundle.tsx` (991): Detailansicht, enthält den ungenutzten `locWin`.
  9. `onboarding/checkliste/content.ts` (903): Inhaltsdaten.
  10. `scripts/pvs-seed-staging.ts` (894): Hilfsskript, harmlos.
- Szenario: Kein akutes Risiko; die Ausnahme sind die zwei in Arbeit befindlichen PVS-Dateien (Merge-Konflikte).
- Fix-Vorschlag: Keiner jetzt.

### I-19: `src/auth/index.ts` ohne Importer
- Schwere: P3
- Art: bloat
- Sicherheit: mittel
- Ort: `src/auth/index.ts`
- Beleg: Sammelexport (`export * from "./session"` usw.); `grep "@/auth'"`/`"@/auth\""` und `from "@/auth"`: 0. Alle nutzen die Untermodule (`@/auth/guards`, `@/auth/session`).
- Szenario: Der Sammelexport zieht beim Import `admin.ts` (jose, JWT) mit in Client-nahe Bündel, falls ihn jemand irrtümlich nutzt.
- Fix-Vorschlag: Datei löschen.

---

## Safe deletion list (mechanisch ausführbar, danach `tsc` und `vitest`)

Nur Löschungen mit Sicherheit hoch. Migrationen NIE anfassen.

Dateien:
1. `apps/portal/src/server/queries/lifecycle.ts` (0 Importer, I-3)
2. `apps/portal/src/lib/instrument.ts` (0 Importer, I-8)
3. `apps/portal/src/auth/index.ts` (0 Importer, I-19)
4. `apps/portal/leitfaden.pdf` (`git rm`, 0 Verweise, I-15)

Im Code (je Datei Deklaration entfernen, ggf. dann ungenutzte Importe):
5. `src/app/(portal)/dashboard/_components/detail-helpers.tsx`: `BreakdownBarRow`, `BreakdownBars`, `FunnelStage`, `FunnelVisualization`, `WeekdayHeatmap`, `HourlyHeatmap`, `ScoreDistribution` (Zeilen 24-295); behalten: `BreakdownTone`, `DataTable`, `DataTableColumn`
6. Funktionen aus I-8: `queries/kpis.ts` (`currentMonthSummary`, `lastNDaysSummary`, `kpiDailySeriesWithSparkline`, `noShowRateSeries`), `queries/patients.ts` (`topPatientsByLtv`, `ltvByChannel`), `queries/attribution.ts` (`byChannel`, `byCampaign`), `queries/requests.ts` (`recentRequestsCount`, `totalRequestsInRangeWithComparison`, `totalRequestsDailyInRange`), `queries/assets.ts` (`getAsset`, `getAnimationLibraryEntry`), `queries/anomalies.ts` (`assertAlertOwned`), `queries/forecast.ts` (`getCalibrationHistory`), `queries/patient-feedback.ts` (`patientFeedbackDashboardMetrics`), `queries/treatments.ts` (`categorizeTreatmentWish`), `server/jobs.ts` (`enqueueCampaignSync`, `enqueueMonthlyReport`), `lib/formatting.ts` (`formatRelativeDay`, `formatRoasSentence`, `formatMinutes`, `formatDeltaPct`), `auth/guards.ts` (`optionalSession`), `auth/admin.ts` (`revokeOtherAdminSessionsForAdmin`), `lib/chart-data.ts` (`isoDateRangeEndingToday`), `lib/constants.ts` (`CAMPAIGN_LIVE_CACHE_SECONDS`), `lib/sources.ts` (`FORECAST_SOURCES`, `FORECAST_SOURCE_LABELS`), `lib/dashboard-range.ts` (`DASHBOARD_RANGE_FULL_LABELS`, `DASHBOARD_RANGE_COMPARISON_HINTS`, `DashboardRangeKey`, `AdminRangeKey`), `db/client.ts` (`sqlClientApp`), `server/pvs-agent-enroll.ts` (`purgeExpiredAgentTokens`; Datei in Arbeit, nur nach Rücksprache), `server/pvs-link-state.ts` (`countQuarantinedEvents`), `server/pvs-token.ts` (`bemerkungInstructionFor`)
7. Ungenutzte Importe und Variablen aus I-12 (alle 24 Stellen; zuerst `db-backup.ts:71` lesen)
8. `package.json` Abhängigkeiten aus I-4 (außer `drizzle-kit`): `react-hook-form`, `@hookform/resolvers`, `qrcode`, `@types/qrcode`, `axe-core`, `@playwright/test`, `pg`, `@types/pg`, `date-fns` (plus `"date-fns"` aus `next.config.ts:30`), die 12 `@radix-ui/*`, `class-variance-authority`, `clsx`, `tailwind-merge`; dazu `packages/ui/package.json`: `@radix-ui/react-tooltip`. Danach `pnpm install` im Root und `pnpm --filter portal build`.
9. `package.json` Skripte: `admin:create`, `db:generate`, `db:studio`, `test:e2e` (I-2)
10. `env.ts` + `.env.example`: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `FEATURES`, `NEXT_PUBLIC_APP_URL` (I-5)

Check first (nicht mechanisch):
- `src/app/(auth)/login/sent/page.tsx` (I-6), `src/app/(portal)/hwg-check/*` (I-6, Karams Entscheidung)
- `src/scripts/*` Review-Mail-Skripte (I-11), `public/eins-mark.png` (I-15), `.nvmrc`/`.node-version` (I-15)
- `drizzle-kit` (I-4)

## Konsolidierungsliste (braucht Urteil)

| Thema | Behalten | Ersetzen | Hinweis |
|---|---|---|---|
| Client-IP | `lib/client-ip.ts: trustedIpFromHeaders` | 9 Routen (I-9) | Sicherheitsrelevant, zuerst `leads/intake`, `vitals`, `agent-enroll`; PVS-Routen nach der anderen Sitzung |
| Dateigröße | neue `formatBytes` in `lib/formatting.ts` (Dezimalkomma) | 7 Kopien | UI-Ausgaben ändern sich minimal (Punkt -> Komma) |
| HTML-Escaping | `escapeHtml` aus `server/email.ts` | 4 inline-Ketten | In `lib/html.ts` auslagern |
| Euro/Prozent | `lib/formatting.ts` | `worker/anomaly/rules.ts:533-546` | Anomalie-Tests (Text) anpassen |
| UUID-Test | `z.string().uuid()` oder `lib/ids.ts` | 5 Regexe | |
| Tageslänge | `DAY_MS` in `lib/constants.ts` | 6 Konstanten, 30 Inline-Stellen | |
| Telefon | gemeinsame E.164-Normalisierung | `meta-capi.hashPhone`, `CallQueue.waMeHref`, `score-rules.phoneValid` | `hashPhone` ohne `+49`-Normalisierung verschlechtert Meta-Zuordnung |
| Datum/Zeitzone | `lib/formatting.ts` Formatter mit `timeZone: "Europe/Berlin"` | 20 `toLocaleDateString("de-DE")` ohne Zeitzone | UTC-Server |
| Rollenprüfung | `can`/`requirePermission` | 11 rohe `session.role`-Vergleiche | Verhalten gleich halten |
| Pluralisierung | optional `plural()` in `lib/formatting.ts` | 26 Ternaries | niedriger Nutzen |
| E-Mail-Versand | bereits zentral (`server/email.ts`, ein Resend-/Nodemailer-Pfad) | nichts | gut so |
| CSV-Parser | `csv-parse` nur in einer Datei, `pvs-csv-parse.ts` (neu) | nichts | gut so |

## Zusammenfassung

Anzahl: P0: 0, P1: 1, P2: 3, P3: 15 (19 Befunde).

Die drei dringendsten Punkte:
1. I-1: `pvs-csv-mapper.ts` enthält die rohen Platzhalter `@@DATES@@` und `@@AMOUNT@@`, `tsc` und Build brechen, bis die andere Sitzung sie ersetzt.
2. I-9: Neun API-Routen (u. a. `leads/intake`) nehmen den fälschbaren linken `X-Forwarded-For`-Eintrag statt `trustedIpFromHeaders`, die IP-Drosseln lassen sich umgehen.
3. I-7: Die Onboarding-Checkliste schickt Kunden zu Anleitungen mit Platzhaltertexten statt echter EINS-Business-Manager-ID und E-Mail-Adresse (offenes `TODO(karam)`).
