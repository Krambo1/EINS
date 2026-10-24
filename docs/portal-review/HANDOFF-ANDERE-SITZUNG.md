# Übergabe an die PVS-/Wiederbehandlungs-Sitzung

Stand 2026-10-07 21:15. Punkte aus dem Portal-Review, die in Dateien dieser Sitzung liegen. Das Review hat sie nicht angefasst. Jede Zeile: Datei, was zu tun ist, Herkunft.

## Fehler und Datenschutz

| Datei | Was | Herkunft |
|---|---|---|
| `worker/processors/pvs-status-derive.ts:563`, `server/pvs-token.ts:70` | Sichtbare Texte: Gedankenstrich und "Lead" (ca. 10x in `pvs-status-derive.ts`) bzw. "ROAS" ersetzen (Anfrage, Werbeertrag). `from`/`to` schreibt die Ableitung inzwischen selbst, das Portal liest ältere Zeilen über `derivedStatus` (erledigt). | WS10 |
| PVS-CSV-Ingest (`server/actions/pvs-csv-upload.ts`, Verarbeitung) | Hochgeladene CSV (Patientenstamm, Rechnungen) nach erfolgreicher Verarbeitung aus R2 löschen (`storage.remove`/`removePrefix` gibt es seit FX-D) oder R2-Lebenszyklusregel für `pvs-csv-uploads/`. Bei Praxislöschung greift `removePrefix` schon. | L-2 |
| `server/jobs.ts:89`, `worker/index.ts:110`, `server/pvs-events.ts`, `worker/processors/pvs-*`, `retreatment-reminder.ts`, `api/pvs/**` | Fehler über `describeErrorForLog` loggen statt rohem `err` / `err.message` (Postgres-`detail` kann Patientendaten enthalten). | L-8 |
| `server/actions/pvs-csv-upload.ts` (~215, `confirmCsvMapping`) | UPDATE ohne `status = 'pending'` im WHERE: zwei gleichzeitige Bestätigungen reihen zweimal ein. Bedingung ergänzen und Zeilenzahl prüfen. | V3 |
| `api/pvs/**` | Client-IP über `trustedIpFromHeaders` aus `@/lib/client-ip` statt linkem `x-forwarded-for`-Eintrag. | I-9 |
| `worker/processors/pvs-reconcile.ts:177` | `toLocaleString` mit `timeZone: DISPLAY_TIME_ZONE` (zeigt sonst UTC). | WS9 TZ |

## Betrieb ohne Worker

| Datei | Was | Herkunft |
|---|---|---|
| `worker/processors/retreatment-reminder.ts` | Läuft nur mit Worker. Direkt sendbar machen und als Schritt in `/api/cron/morning` aufnehmen (Muster: andere Schritte dort). | WS4 |
| `worker/index.ts` | Prozessweite `uncaughtException`/`unhandledRejection`-Handler und harter Timeout im Shutdown. | E-03, E-22 |
| `worker/schedules.ts` | kpi-rebuild-Dispatcher auf Berliner "gestern" (heute `toISOString()`). | WS4 |
| `server/jobs.ts` | `enqueueEmail`-Payload um `idempotencyKey?: string`. | WS4 |

## Oberfläche

| Datei | Was | Herkunft |
|---|---|---|
| `(portal)/wiederbehandlungen/**` | `loading.tsx` im Stil der anderen Ladezustände; `flashMessageFromError(err, "<aktion>")` mit Aktionsnamen. | A-09, WS3 |

## Ballast

- Ungenutzt: `server/jobs.ts` `enqueueCampaignSync`, `enqueueMonthlyReport`; `server/pvs-agent-enroll.ts` `purgeExpiredAgentTokens`; `server/pvs-link-state.ts` `countQuarantinedEvents`; `server/pvs-token.ts` `bemerkungInstructionFor`; `server/pvs-events.ts` sieben nur deklarierte Event-Typen; `worker/processors/pvs-reconcile.ts:1` Importe `isNull`, `lt`; `pvs-agent-enroll.test.ts` `seedExistingLink`; `pvs-link-state.test.ts` `isTx`, `mkDb`; `lib/retreatment.ts` `ReminderStatus`.
- Eigene `DAY_MS` in `lib/retreatment.ts` und `server/pvs-agent-health.ts` durch `DAY_MS` aus `lib/constants.ts` ersetzen.
- `pvs-csv-mapper.ts` (I-1).

## Von dieser Sitzung übernommen (2026-10-08)

- **CSV-Import ohne Worker (Karam-Entscheidung C8):** Diese Sitzung ändert `server/actions/pvs-csv-upload.ts`, `worker/processors/pvs-csv-ingest.ts` (+ Test) und `api/cron/**` (Verarbeitung per `after()` mit atomarer Beanspruchung und Nachholer im Morgenlauf). Stand im Log `fixes/FX-DECISIONS.md`. Bitte vor eigenen Änderungen an diesen Dateien dort lesen. Folge in Ihrer Datei `server/jobs.ts`: `enqueuePvsCsvIngest` hat keinen Aufrufer mehr und kann weg.

## Design (aus der Design-Umsetzung 2026-10-08)

- **Leerzustand Wiederbehandlungen:** Die Seite ist im ersten Monat leer, ohne Hinweis, wann sie sich füllt. Ein Satz wie "Füllt sich, sobald Ihre Praxissoftware verbunden ist und die ersten Behandlungen fällig werden." (genaue Bedingung aus Ihrer Logik). Dazu die Etikett-Regel aus `DESIGN-UMSETZUNG.md` (kein `uppercase`/`tracking-wide`, Etiketten `text-fg-primary font-medium`, mindestens `text-sm`) in `wiederbehandlungen/**`.
- **Englische Etiketten in `admin/pvs-bridge/**`:** "Event-Trace", "External Event-ID", "Event-Kind", "Letztes Event", "Events (24h)". Vorschlag: "Ereignisverlauf", "Externe Ereignis-ID", "Ereignisart", "Letztes Ereignis", "Ereignisse (24 Std.)". Nur Admin-Seiten, keine Eile. Die Design-Umsetzung hat dort nur "Zurückziehen" geändert (jetzt `DangerSubmitButton` mit Rückfrage).

## Migrationsnummern

Review belegt: 0081-0089, 0092, 0094, 0095 (C8, CSV-Import ohne Worker). 0093 gehört dieser Sitzung. Diese Sitzung: 0078-0080, 0090, 0091. Vor jeder neuen Nummer `ls src/db/migrations` prüfen.
