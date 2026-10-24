# M: Datenmenge (W5, Performance bei realistischem Volumen)

## Stand

- Seed-Daten in der lokalen DB: NEIN. `seed-load.mjs clean` ist gelaufen; 0 `lasttest-` Praxen, 0 Testnutzer, keine gemintete Session (portal und admin) übrig. Praxen, Nutzer, Anfragen (inkl. f08ce438-0f5f-4532-9fbe-971987abfde4), Verlauf, Patienten, Behandlungen stimmen mit der Ausgangsprüfsumme überein. `log_min_duration_statement` ist zurückgesetzt.
- Messungen fertig: Seitenzeiten Praxisportal (Tabelle unten), Admin-Seiten (ein Lauf, siehe M-4), Postgres-Abfragezeiten und Anweisungszahl für /anfragen und /dashboard, EXPLAIN für `openQueueDaily` und die Anruf-Schlange.
- Nicht gemessen: Admin-Seiten nach dem ersten Lauf (Dev-Server stürzte bei der 17-MB-Antwort von /admin/garantie/[id] ab), EXPLAIN der Admin-Abfragen, `navBadges`. Alle anderen gemessenen Abfragen lagen unter 300 ms (größte: Anfragenliste 70-110 ms, Anruf-Schlange 72 ms, Zähler 10-20 ms).
- Hinweis: Dev-Server liefert wegen Debug-Daten 0,6-0,9 MB je /anfragen; Zeiten und Größen sind Dev-Werte. Grundlast ca. 0,7 s je Seite. Die DB-Zeit je Seite lag bei 30-170 ms, also ist ohne M-1 nicht die Datenmenge der Engpass.
- Dev-Werkzeug: `apps/portal/scripts/seed-load.mjs` (seed/clean, nur localhost).

## Messung Seitenzeiten (Dev-Server localhost:3007, Next dev ohne Prod-Optimierung)

Spalten: kalt = erster Abruf, warm = Median von 3 weiteren (30-s-Cache aktiv), klein = Praxis mit 227 Anfragen, kB = HTML-Größe. Dev-Grundlast liegt bei ca. 0,7 s je Seite.

```
200  cold   2006 warm   1934 small  3086   807KB /anfragen
200  cold    818 warm    806 small   490   177KB /bewertungen
200  cold   1213 warm    667 small   339   120KB /bewertungen/feedback
200  cold   1544 warm   1100 small   567   437KB /dashboard
200  cold    576 warm    767 small   309   100KB /dateien
200  cold    775 warm    748 small   385   212KB /dokumente
200  cold   1394 warm   1463 small   626   427KB /einstellungen
200  cold    869 warm    863 small   407   156KB /einstellungen/integrationen
200  cold    796 warm    777 small   386   130KB /einstellungen/integrationen/ads-conversion
200  cold    799 warm    710 small   321    99KB /einstellungen/integrationen/links
200  cold    753 warm    843 small   317   103KB /einstellungen/integrationen/mapping/locations
200  cold    887 warm    720 small   312   104KB /einstellungen/integrationen/mapping/treatments
200  cold   1211 warm   1108 small   705   198KB /einstellungen/integrationen/setup
200  cold    799 warm    776 small   646    99KB /einstellungen/integrationen/setup/csv
200  cold    735 warm    773 small  1161   112KB /einstellungen/integrationen/setup/gdt-agent
200  cold    816 warm    731 small  1652   111KB /einstellungen/integrationen/setup/healthhub
200  cold    757 warm    792 small  1459   136KB /einstellungen/integrationen/setup/medatixx
200  cold   1091 warm    647 small  1113   109KB /einstellungen/integrationen/setup/n8n
200  cold    907 warm    635 small  1551   101KB /einstellungen/integrationen/setup/red
200  cold   1304 warm    757 small   948   102KB /einstellungen/integrationen/setup/tomedo
200  cold    660 warm    724 small   752   109KB /einstellungen/sicherheit
200  cold   1573 warm   1517 small  1474   217KB /faq
200  cold    779 warm    730 small   411   102KB /feedback
200  cold   1800 warm    906 small   595   245KB /fortschritt
200  cold    449 warm    635 small   445    96KB /hwg-check
200  cold   1348 warm   1363 small   871   415KB /leitfaden
200  cold    556 warm    664 small   482   118KB /leitfaden/pruefung
200  cold    905 warm    770 small   389   190KB /medien
200  cold    780 warm    812 small   411   190KB /onboarding
200  cold    955 warm   1008 small   670   223KB /onboarding/checkliste
200  cold    800 warm    790 small   584   206KB /onboarding/fragebogen
200  cold    642 warm    678 small   409   116KB /werbebudget
200  cold    939 warm    814 small   556   255KB /wiederbehandlungen
200  cold   2002 warm   1922 small  1079   825KB /anfragen?sort=ki
200  cold   2002 warm   2066 small  1180   886KB /anfragen?sort=ltv
200  cold   2542 warm   2353 small  1135   899KB /anfragen?sort=dringlichkeit
200  cold   2098 warm   2273 small  1592   816KB /anfragen?sort=aelteste
200  cold   1891 warm   2023 small   652   640KB /anfragen?status=neu
200  cold   1987 warm   1764 small  1241   721KB /anfragen?status=gewonnen&sort=ltv
200  cold   1797 warm   2007 small  1065   680KB /anfragen?source=meta&aiCategory=hot
200  cold   1712 warm   1683 small   904   640KB /anfragen?stale=1
200  cold   1676 warm   1747 small   794   708KB /anfragen?slaBreached=1
200  cold    967 warm    899 small   421   151KB /anfragen?search=Kontakt%2012345
200  cold    725 warm    787 small   425   124KB /anfragen?search=0170123
200  cold    660 warm    737 small   537   125KB /anfragen?search=zzzz
200  cold   1482 warm   1598 small   518   637KB /anfragen?page=400
200  cold   1566 warm   1739 small  1413   658KB /anfragen?page=800
200  cold   1662 warm   1824 small   530   656KB /anfragen?page=400&sort=ki
200  cold   2181 warm   1836 small   892   639KB /anfragen?page=400&sort=ltv
200  cold   1467 warm   1200 small  1011   297KB /anfragen/<id>
200  cold   4769 warm   1281 small  2137   403KB /dashboard?alle Bereiche=heute
200  cold   1323 warm   1206 small  1408   430KB /dashboard?alle Bereiche=mon
200  cold  11855 warm   1377 small  1368   715KB /dashboard?alle Bereiche=jahr
200  cold  15723 warm  15664 small  1397   588KB /dashboard?alle Bereiche=max
```

## Befunde

### M-1: Dashboard "Offene Anfragen": `openQueueDaily` rechnet Tage x alle Anfragen mit korreliertem Teilselect
- Schwere: P0 (Dashboard-Bereiche Jahr und Max bei einer Praxis mit 20.000 Anfragen unbenutzbar)
- Art: performance
- Sicherheit: hoch (gemessen)
- Ort: `apps/portal/src/server/queries/kpis.ts:290-340` (`openQueueDailyUncached`), Aufruf in `apps/portal/src/app/(portal)/dashboard/page.tsx` (`openQueueDaily` zweimal: aktuelles und Vergleichsfenster)
- Beleg: `FROM days LEFT JOIN requests r ON r.clinic_id = ...` ohne Zeitgrenze und je Tag-Anfrage-Paar ein `SELECT ... FROM request_activities ... LIMIT 1`. EXPLAIN (ANALYZE), 365 Tage, lasttest-gross: Nested Loop 7.300.000 Zeilen, SubPlan 4.556.928 Aufrufe, 13,7 Mio Buffer-Treffer, Execution Time 10.374 ms. Dashboard-Abruf (Seite komplett): Bereich Mon 1,1 bis 1,6 s, Jahr 11,9 s kalt, Max 15,7 s (auch warm 15,7 s, der 30-s-Cache greift dort nicht). Postgres-Log: eine einzelne Abfrage mit 11,3 s (Max), weitere 1,7 s und 1,6 s (Jahr, Vergleichsfenster). Auf Neon (kleinere Rechenleistung, Vercel-Zeitlimit) eher schlechter.
- Szenario: Inhaber mit einem Jahr Anfragen schaltet auf "Jahr" oder "Max": Seite bleibt 12 bis 16 s leer, Serverless-Funktion kann ins Zeitlimit laufen; gleichzeitig hält die Abfrage eine Pooler-Verbindung belegt.
- Fix-Vorschlag: `openQueueDailyUncached` ersetzen durch die vorhandene, schon sparsame Variante `openQueueDailyInRangeWithComparison` (`requests.ts`, ein Durchlauf über Anfragen und Statuswechsel in JS via `openCountsAtPoints`) oder den Statusverlauf in SQL einmal per Window/`LATERAL` je Anfrage statt je Tag berechnen. Der Fensterbereich "Max" (1825 Tage) sollte auf das Alter der ältesten Anfrage gekappt werden (`generate_series` ab `min(created_at)`).

### M-2: Anfragen-Seite "Jetzt anrufen": Sortierung über alle offenen Anfragen mit korrelierten Teilselects
- Schwere: P2
- Art: performance
- Sicherheit: hoch (gemessen)
- Ort: `apps/portal/src/server/queries/requests.ts:~520-600` (`nextCallQueueLeads`), `response-time.ts` (`firstAttemptAtSql`)
- Beleg: Bei 3.854 offenen Anfragen (neu/kontaktiert/nicht erreicht/Termin) wertet die Abfrage für jede Zeile zwei Teilselects aus (3.854 Schleifen, 11.880 Buffer) und sortiert dann Top-6: 70 bis 78 ms bei jedem Seitenaufruf von /anfragen (nicht gecacht).
- Szenario: Unter 300 ms, aber wächst linear mit der offenen Schlange; bei Praxen, die Anfragen nie schließen, mit der Zeit mehrere hundert ms auf jedem /anfragen-Aufruf.
- Fix-Vorschlag: `first_attempt_at` als Spalte auf `requests` führen (beim Schreiben von Anruf/Statuswechsel setzen) oder die Schlange auf Anfragen der letzten 30 Tage plus fällige Wiedervorlagen begrenzen.

### M-3: Sehr viele Einzelabfragen und Transaktionen je Seite (Latenz zu Neon)
- Schwere: P2
- Art: performance
- Sicherheit: mittel
- Ort: `apps/portal/src/db/client.ts` (`withClinicContext`), Seiten `dashboard`, `anfragen`
- Beleg: Postgres-Log bei einem Abruf: /anfragen 53-98 Anweisungen in 12-17 Transaktionen (jede mit BEGIN, set_config, Abfrage, COMMIT), /dashboard 141 Anweisungen in 31 Transaktionen, Dashboard-Bereich Max 1.324 Anweisungen (286 Transaktionen) für mehrere Abrufe; Datenbankzeit je Seite nur 30 bis 130 ms.
- Szenario: lokal unauffällig. Auf Neon mit 2-5 ms je Round-Trip kostet jede Transaktion mindestens 4 Round-Trips (parallel über mehrere Verbindungen, aber der Pooler hat begrenzte Slots): jede Seite bekommt 100 bis 300 ms Netz-Zusatz, bei vielen gleichzeitigen Nutzern Warteschlange am Pooler.
- Fix-Vorschlag: Abfragen einer Seite in eine `withClinicContext`-Transaktion bündeln (eine Transaktion, `Promise.all` auf `tx` ist bei postgres.js sequenziell, daher eher gezielt zusammenfassen: Zähler `aiCategoryCounts`, `requestStatusCounts`, `slaBreachedCount`, `countNewRequests` als eine Abfrage mit `FILTER`).

### M-4: Admin-Garantie-Detailseite rendert alle möglichen Anfragen ungekappt
- Schwere: P2
- Art: performance
- Sicherheit: hoch (gemessen, mit unrealistisch vollem Fenster)
- Ort: `apps/portal/src/app/admin/garantie/[clinicId]/page.tsx:283` (`others.map`), `apps/portal/src/server/guarantee-clock.ts:174` (`inquiriesInWindows`)
- Beleg: Je Anfrage im 90-Tage-Fenster ein Block mit Details und Entscheidungsformular, ohne Seitengrenze. Uhr 700 Tage: 20.000 Anfragen, 9 MB, 15 s. Uhr 60 Tage (3.752 Anfragen): 17,7 MB, 39 s, danach lokaler Dev-Server beendet. Ein echtes Fenster hat ca. 100-500 Anfragen (eine Praxis mit Werbebudget), das wären 0,5-3 MB.
- Szenario: Karam öffnet die Garantie-Uhr einer anfragestarken Praxis bevor eine Anfrage bestätigt ist: sehr große, langsame Seite. Nach der Bestätigung (Normalfall) verschwindet das Problem.
- Fix-Vorschlag: `others` auf 20 Einträge kappen ("weitere N Anfragen anzeigen" per Suchparameter) oder nur Anfragen mit Messweg anzeigen.

### M-5: Admin-Seiten sind in Dev bei 50 Praxen 1-4 s, /admin/clinics 1,2 MB HTML
- Schwere: P3
- Art: performance
- Sicherheit: niedrig
- Ort: `/admin/clinics`, `/admin/garantie`, `/admin` (Übersicht), `/admin/integrations`, `/admin/users`
- Beleg: Messung 50 Praxen, Dev-Server: `/` 2,7 s kalt / 1,5 s warm (894 KB), `/clinics` 3,0 s / 1,8 s (1,3 MB), `/garantie` 3,5 s / 1,1 s, `/integrations` 2,3 s / 4,0 s (807 KB), `/rueckruf` 4,1 s kalt, `/users` 2,1 s. Die Datenbankzeit wurde für Admin nicht einzeln gemessen (Server fiel aus), deshalb unklar, wie viel davon Dev-Overhead ist.
- Szenario: Karam wartet bei jedem Admin-Klick 1-4 s; bei Prod-Latenz zu Neon vermutlich ähnlich.
- Fix-Vorschlag: nach Messung auf Prod-Build gezielt prüfen (`admin.ts` `adminIntegrationHealth`, `adminAllUsers`); keine Maßnahme bis dahin.

## Zusammenfassung

Anzahl: P0 1, P1 0, P2 3, P3 1.
1. M-1 (P0): `openQueueDaily` im Dashboard braucht bei 20.000 Anfragen 10 s (Jahr) bis 16 s (Max); Fix: vorhandene Ein-Durchlauf-Variante aus `requests.ts` verwenden.
2. M-4 (P2): `/admin/garantie/[clinicId]` rendert alle möglichen Anfragen ungekappt (bis 17 MB), Kappung auf 20 Einträge.
3. M-2 (P2): Anruf-Schlange wertet pro offener Anfrage Teilselects aus (72 ms bei 3.854 offenen, wächst linear).
Sonst blieb jede gemessene Abfrage unter 300 ms; Seiten /anfragen und alle statischen Routen 0,6-2 s im Dev-Server (Datenbankzeit 30-170 ms).
