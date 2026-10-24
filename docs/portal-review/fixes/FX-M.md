# FX-M: Datenmenge (aus `findings/M-datenmenge.md`)

## Entscheidung der Hauptsitzung (2026-10-07 21:00): Lesart Statuswechsel

Frage aus `fixes/FX-C.md` Punkt c. Beide alten Varianten (`kpis.ts` per `COALESCE` auf den aktuellen Status, Sweep in `requests-open-queue.ts` "from fehlt = nicht neu") sind falsch für PVS-Zeilen. `pvs-status-derive.ts` schreibt `status_change` mit `meta.source = 'pvs'` und `meta.derivedStatus` (neuer Status), ohne `from`/`to`; dazu gibt es Zeilen "PVS: Umsatz entfernt" ohne jeden Status.

Gültige Lesart:
1. Neuer Status einer Zeile = `meta.to` ?? `meta.derivedStatus`. Hat eine Zeile weder `from` noch `to` noch `derivedStatus`, ist sie kein Statuswechsel und wird ignoriert.
2. Alter Status = `meta.from`, sonst der neue Status des vorherigen Statuswechsels derselben Anfrage (egal wie alt), sonst `'neu'` (jede Anfrage startet als `neu`).
3. Ohne einen einzigen Statuswechsel gilt wie bisher der aktuelle Status (Seed-Zeilen).

## Log

| ID | Status | Dateien | Was und warum |
|---|---|---|---|
| M-1 | fixed | `server/queries/kpis.ts`, `server/queries/requests.ts`, `server/queries/requests-open-queue.ts` (+ `.test.ts`) | `openQueueDaily` (Dashboard "Offene Anfragen") ist jetzt `openQueueDailyInRangeWithComparison` (re-export in kpis.ts, gleiche Rückgabe `{dates, counts, current, prior, deltaPct}`, gleicher 30-s-Cache); das alte SQL mit Teilselect je Tag x Anfrage und der falsche Kommentar "UTC-Tag" sind weg. Lesart der Hauptsitzung umgesetzt: neuer Status = `to ?? derivedStatus`, Zeilen ohne from/to/derivedStatus fallen VOR dem `LAG` raus (Hinweis der Hauptsitzung zu "PVS: Umsatz entfernt" ist damit erfüllt und getestet), alter Status = `from ?? LAG(neuer Status) OVER (PARTITION BY request_id ORDER BY created_at, id) ?? 'neu'`, ohne Statuswechsel der aktuelle Status. Ein SQL-Durchlauf über die Statuswechsel der Praxis + ein Sweep in JS. Tagespunkte (Berliner Tagesende, Vergleichsanker = letzte ms vor Berliner Mitternacht des ersten Tages) als reine Funktion `openQueuePoints`. Tests: 12 grün (PVS ohne from, Umsatz-Zeile ignoriert, Umsatz-Zeile zwischen zwei PVS-Wechseln, erster Wechsel ohne from = ab neu, prevTo aus der Zeit vor dem Fenster, manuelle Wechsel unverändert, Zufallsvergleich gegen Referenz, Sommerzeitende 25.10.2026). Gleichheit mit dem alten SQL (Einmal-vitest gegen lokale DB mit Seed, danach gelöscht): 8 Praxen inkl. lasttest-gross (32.714 manuelle Statuswechsel) x 8 Fenster (Mon, Vorperiode, Jahr, Vorjahr, Max 1825 Tage, Sommerzeitende 2025, Sommerzeitbeginn 2026, Okt. 2026) = 64 Fenster, 0 Abweichungen. Messung lasttest-gross, Dev-Server :3007, kalt/warm: vorher `/dashboard?rOpen=jahr` 12.669 / 594 ms, `rOpen=max` 15.259 / 15.382 ms; nachher `rOpen=jahr` 913 / 746 ms, `rOpen=max` 1.008 / 685 ms, alle Bereiche Max 859 / 786 ms. Statuswechsel-Abfrage EXPLAIN ANALYZE: 42-90 ms (lasttest-gross, Hash Join), 1,4 ms bei einer kleinen Praxis (Index `request_activities_request_created_idx`), daher keine Migration. |
| M-4 | fixed | `app/admin/garantie/[clinicId]/page.tsx` (`guarantee-clock.ts` unverändert) | "Weitere mögliche Anfragen" zeigt die 20 frühesten, darunter Link "Weitere N Anfragen anzeigen" (`?alle=1#weitere`, gleicher Linkstil wie "Alle Praxen", öffnet die Liste aufgeklappt); die Überschrift nennt weiter die Gesamtzahl, Vorschlag und Entscheidungsformulare der gezeigten Einträge unverändert. `inquiriesInWindows` NICHT gekürzt: der Messweg-Filter läuft in JS (`classifyAttribution`), Vorschlag und Gesamtzahl brauchen alle Zeilen, die Abfrage hat schon die Sicherheitsgrenze 5.000 je Praxis und braucht bei 3.885 Anfragen im Fenster ca. 20 ms (EXPLAIN); der Engpass war das Rendern. Messung lasttest-gross (Admin-Host, Dev-Server), kalt/warm: Uhr 700 Tage: Standard 4.062 / 1.217 ms, 721 KB; `?alle=1` 14.946 / 14.839 ms, 9 MB (bewusst so, nur auf Klick). Uhr auf 60 Tage gesetzt (Testdaten, wie W5: vorher 17,7 MB, 39 s, Server abgestürzt): 1.516 / 1.479 ms, 699 KB. |
| M-3 | no_change_needed | keine (`anfragen/page.tsx`, `requests.ts` geprüft) | Auf /anfragen gibt es nichts zusammenzulegen: die Seite ruft als Zähler nur `aiCategoryCounts` (schon eine Abfrage, 30-s-Cache); `requestStatusCounts`/`slaBreachedCount`/`countNewRequests` laufen nur auf /dashboard und in `navBadgesCache.ts`. Gemessen (lasttest-gross, warmer Cache, `log_statement=all` kurz an, danach `RESET`, geprüft `none`): ein Abruf /anfragen = 1 Sitzungsabfrage + 3 Onboarding-Gate-Abfragen ohne Transaktion + 4 `withClinicContext`-Transaktionen (Liste mit Zählung, Anruf-Schlange, Wiedervorlagen, eine weitere), `pg_stat_database` 15-29 Transaktionen je Abruf inkl. Messskript. Die vielen Transaktionen aus W5 stammen aus dem kalten Cache und dem Portal-Layout (Nav-Badges), nicht aus dieser Seite. |
| M-2 | fixed | `server/queries/requests.ts` (`nextCallQueueLeads`) | Ursache genauer als im Befund: Drizzle schrieb die beiden korrelierten Teilselects (erster Kontaktversuch, nächste Wiedervorlage) zusätzlich in jeden ORDER-BY-Ausdruck, Postgres wertete dadurch je offener Anfrage bis zu 7 Teilselects statt 2 aus (8 SubPlans im Plan). Jetzt eine innere Abfrage, die beide Werte einmal je Zeile berechnet (`OFFSET 0` als Planer-Grenze, sonst zieht Postgres die Unterabfrage wieder hoch), außen dieselbe Sortierung über die Spalten, gleiche Grenze `limit`. Keine Begrenzung auf 30 Tage, keine Migration. Gleichheit: Ergebnis-IDs der alten und der neuen (vom Dev-Server erzeugten) Abfrage für lasttest-gross identisch (Top 6 und Top 200). Messung lasttest-gross, 3.865 offene Anfragen, EXPLAIN ANALYZE: vorher 91-140 ms, nachher 22-27 ms (2 SubPlans, 26.180 statt 60.821 Buffer); im Postgres-Log beim echten Seitenabruf 23-41 ms. |
| M-5 | skipped | keine | Laut Auftrag keine Maßnahme: Admin-Seiten erst auf einem Prod-Build messen, Dev-Zeiten sind nicht aussagekräftig. |

Abschluss-Prüfung: `npx tsc --noEmit -p .` ohne Fehler (gesamtes Portal); `npx vitest run src/server/queries src/lib/guarantee-clock` 69 grün, 1 übersprungen (opt-in DB-Test); `seed-load.mjs clean` gelaufen ("cleaned 50 clinics"), danach geprüft: 0 `lasttest-` Praxen, 0 `lasttest-` Nutzer, 0 Mess-Sitzungen (Portal und Admin), `log_statement` = none, `log_min_duration_statement` = -1; Wegwerf-Dateien (`scripts/_fxm-measure.mjs`, `_fxm-equality.db.test.ts`) gelöscht; `node scripts/smoke-routes.mjs http://localhost:3007`: 0 failing checks.

## Braucht andere Datei

- Erledigt durch die Hauptsitzung (21:50): `forecast.ts` nutzt an allen 6 Stellen `COALESCE(a.meta->>'to', a.meta->>'derivedStatus')`; SQL gegen lokale DB geprüft, tsc sauber.

- `server/queries/forecast.ts` (`queryStageCloseRates`, Stufen-Dauer ~Zeile 280): liest nur `meta->>'to'`. Ältere PVS-Zeilen haben nur `meta.derivedStatus`, ihre Stufen (Termin, Beratung, behandelt) fehlen dort also; Fix wäre `COALESCE(meta->>'to', meta->>'derivedStatus')` an beiden Stellen. Neue PVS-Zeilen sind nicht betroffen: `pvs-status-derive.ts` schreibt seit "Pass 2" bereits `from`/`to` (Zeile ~1384), dort ist nichts mehr nötig.
- `server/queries/response-time.ts` (`firstAttemptAtSql`): wertet `meta->>'source' = 'pvs'` als Kontaktversuch, also auch die Zeile "PVS: Umsatz entfernt" (from = to = aktueller Status). Nur relevant, wenn so eine Zeile vor jedem echten Kontaktversuch liegt; nicht geändert (nicht Teil von M-2, Verhalten sollte gleich bleiben).
- Dashboard: `requestStatusCounts` und `slaBreachedCount` (beide `requests.ts`, gecacht) könnten zu einer Abfrage mit `FILTER` werden; Aufruf in `dashboard/page.tsx` außerhalb der Open-Queue-Verdrahtung, daher nicht gemacht. `navBadgesCache.ts` (Nav-Badges auf jeder Seite) gehört nicht zu FX-M.

## Migration

Keine. `0093` nicht belegt. Die Statuswechsel-Abfrage nutzt `request_activities_request_created_idx` (kleine Praxis 1,4 ms) bzw. einen Hash Join (große Praxis 42-90 ms); die Anruf-Schlange braucht nach dem Umbau keinen neuen Index.

## Offene Entscheidungen für Karam

- Lesart nach dem letzten Statuswechsel: wie bisher gilt danach der aktuelle Status der Anfrage (nicht der `to` des letzten Wechsels). Bei sauberen Daten ist das dasselbe; nur bei Anfragen, deren Status ohne Verlaufszeile geändert wurde, weicht es ab. So belassen, weil der Spaltenwert die Wahrheit ist.
- Eine Zeile mit nur `from` (ohne `to`/`derivedStatus`) gibt der nächsten Zeile ohne `from` den Vorgänger-Status "unbekannt", sie fällt dann auf `neu` zurück (wörtlich nach der Regel). Kommt bei den heutigen Schreibstellen nicht vor.

## Nicht getestet

- Echte PVS-Daten (lokal gibt es 0 Statuswechsel ohne `from`/`to`); der PVS-Pfad ist nur über die Unit-Tests der Sweep-Funktion und den identischen SQL-Filter abgedeckt, nicht gegen eine DB mit PVS-Zeilen.
- Neon/Prod-Build: alle Zeiten sind Dev-Server + lokales Postgres.
- `/admin/garantie/<id>`: Entscheidungsformulare (Bestätigen/Ablehnen) nicht abgeschickt, nur Rendern gemessen.
- Kaltes `/dashboard` ohne Range-Parameter: 2,8-4 s beim ersten Abruf nach einem Code-Wechsel ist Dev-Kompilierung, nicht gesondert untersucht.
