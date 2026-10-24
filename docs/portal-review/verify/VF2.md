# VF2 Abschlussverifikation FX-V3

| WS ID | Ergebnis | Beleg | Satz |
|---|---|---|---|
| FX-V3 V7 5.6 (Garantie-Guard) | CONFIRMED | Hartmann, Ablehnen ohne Haken (Grund "Keine erreichbaren Kontaktdaten"): POST 200, roter Hinweis (tone-bad) "Einwand erst nach einem Kontaktversuch der Praxis möglich.", kein "nicht gefunden" | Guard-Fehler erscheint als roter Hinweis statt 404. |
| FX-V3 Nachtrag middleware (Redirects) | CONFIRMED | clinics/[id] Stammdaten mit ungültiger E-Mail und clinics/neu mit fehlendem Inhaber-Namen, beide per Server-Aktion (SPA, window-Marker blieb): POST 303, Ziel-GET 200, Meldung sichtbar; Log ohne 404 | Redirect-Ziele laden. rueckruf/videos nicht auslösbar (keine Rückruf-Karte, kein Video-Löschformular ohne Daten), Muster identisch. |
| FX-V3 Nachtrag middleware (Host) | CONFIRMED | curl localhost:3007/admin, /admin/clinics, /admin/garantie ohne Header: 404; mit gefälschtem x-forwarded-host admin.localhost:3007: 200, aber Body enthält NEXT_REDIRECT /admin/login (requireAdmin), keine Admindaten | Admin-Zugriff bleibt hinter Admin-Login. |
| FX-V3 V7 6 (Monat) | CONFIRMED | 375 px Dashboard: 8 Umschalter mit "Monat", Range-Zeilen je 1, white-space nowrap, Gruppe 249 px breit, kein horizontaler Scroll (scrollWidth 375) | Label einzeilig in jeder Karte. |
| FX-V3 V2 Neben 3 (No-Show 0 %) | UNCLEAR | Lokal keine No-Show-Daten (Kachel zeigt "noch keine No-Show-Daten"); Code `DashboardDetailBundle.tsx` showYAxis={series.some(rate>0)}, `TrendChart.tsx:89,445,454` kennt die Prop | Nur am Code bestätigt, nicht live gesehen. |
| FX-V3 V2 Neben 2 (SLA-Filter) | CONFIRMED | Liste `/anfragen?slaBreached=1`: 34 Einträge; Dashboard "Offene Anfragen" 34 (+31 weitere); SQL count (status neu, ohne Erstkontakt, sla_respond_by<now) = 34; Prädikate `requests.ts:157-166` und `:845-856` identisch | Zähler und Liste stimmen. Hinweis: Das Dashboard zeigt die SLA-Zahl nur als Ton, die sichtbare 34 ist die Offen-Zahl. |
| FX-V3 V7 3.3 (Einträge) | CONFIRMED | /anfragen zeigt "81 Einträge", Filterliste "34 Einträge" | Plural korrekt; "1 Eintrag" nicht live gesehen. |
| FX-V3 V7 3.9 (Wiedervorlage) | CONFIRMED | Roland Graf, Dialog: leer -> "Bitte wählen Sie Datum und Uhrzeit der Wiedervorlage." (Knopf nicht deaktiviert, Dialog offen); 06.10.2026 10:00 -> "Das Datum der Wiedervorlage liegt in der Vergangenheit. Bitte wählen Sie heute oder einen späteren Tag."; 07.10.2026 00:10 (heute, früher) -> gespeichert, due_at 2026-10-06 22:10 UTC (= 00:10 Berlin) | Alle drei Fälle wie behauptet. Serverseitige Prüfung nicht separat am Dialog vorbei aufgerufen (Code `actions.ts` nicht geprüft). Testzeile verify-VF2 heute gelöscht. |
| FX-V3 V7 3.6 (Verlauf Status) | CONFIRMED | Verlauf Roland Graf: "STATUS-ÄNDERUNG ... Status: Neu → Kontaktiert" | PVS-artige Zeile lokal nicht vorhanden, nicht geprüft. |
| FX-V3 V2 Neben 1 (CSV Telefon) | CONFIRMED | Inhaber-Export (fetch /api/requests/export, 81 Zeilen): Content-Type text/csv utf-8, Telefonzellen alle `="+49 ..."` (Textformel), 0 Zellen mit führendem Apostroph, keine andere Zelle beginnt mit = + - @; `npx vitest run .../csv.test.ts` 6/6; Nachbau der Regex-Logik: "=1+1", "@SUM(A1)", "+cmd|' /C calc'!A0", "\t=1", "=HYPERLINK(..)" bekommen weiter Apostroph | Telefon ohne sichtbares Apostroph, Formeln bleiben neutralisiert. Excel/LibreOffice-Darstellung nicht geprüft. |
| FX-V3 V7 Neben (BOM) | CONFIRMED | Rohbytes des Downloads beginnen mit ef bb bf 45 69 6e ("Ein...") | BOM vorhanden. |
| FX-V3 V7 3.3 (Eintrag) | CONFIRMED | /anfragen?search=Roland zeigt "1 Eintrag"; `anfragen/page.tsx:174` | Einzahl live gesehen. |
| FX-V3 V6 REFUTED (Euro-Wert) | CONFIRMED | ads-conversion live: "Euro-Wert(e)" vorhanden, kein "EUR-Wert"; grep app: keine "EUR-Wert"-Treffer | Copy ersetzt. |
| FX-V3 V6 Copy (ROAS) | CONFIRMED | `staticIndex.ts:382-385` title "Werbeertrag", keywords enthalten "roas" | Titel ohne (ROAS), Suchwort bleibt. Live im Suchfeld nicht geprüft. |
| FX-V3 V6 Copy (CTR) | CONFIRMED (Code) | `werbebudget/page.tsx:284,552` "Klickrate"; Live-Seite zeigt lokal keine Kennzahl (keine Anzeigen-Daten) | Nur am Code gesehen. |
| FX-V3 V6 Copy (Conversion-Einstellungen) | CONFIRMED | Live: Knopf "Einstellungen für Abschluss-Meldungen speichern" auf ads-conversion | Wie behauptet. |
| FX-V3 V5 Copy (weitere Anfrage) | CONFIRMED (Code) | `admin/garantie/[clinicId]/page.tsx:313-315` | Hartmann hat lokal keinen ausgeblendeten Rest, Link live nicht gesehen. |
| FX-V3 V2 UNCLEAR (OnboardingGateGuard) | CONFIRMED (Code) | `OnboardingGateGuard.tsx`: Marke wird bei offener Sperre oder erlaubtem Pfad auf null gesetzt, gleicher gesperrter Pfad ohne Zwischenschritt refresht nur einmal | Ablauf /dashboard -> /onboarding -> /dashboard refresht erneut, Schleifenschutz bleibt. Nicht im Browser (Praxis freigeschaltet). |
| FX-V3 V6 Neben (Fragebogen-Upsert) | CONFIRMED (Code + SQL), Rennen UNCLEAR | `fragebogen/actions.ts:209-221` ON CONFLICT DO NOTHING RETURNING, leer -> CHANGED_ELSEWHERE; UNIQUE `discovery_fragebogen_clinic_uniq` vorhanden; in zurückgerolltem Insert gegen bestehende Hartmann-Zeile: 0 rows, kein Fehler | Echtes paralleles Erstspeichern nicht ausgelöst (Hartmann hat schon eine Zeile). |
| FX-V3 V2 Neben 5 (revokeAdsConsent) | UNCLEAR | nicht geprüft (Anfrage Auftrag nicht genannt) | Nicht Teil der Aufgabenliste. |
| FX-V3 V3 Neben 4 (Kommentar) | UNCLEAR | nicht geprüft | Reiner Kommentar. |
| FX-V3 V7 3.5 (no_change_needed) | UNCLEAR | nicht geprüft | Ausserhalb der 8 Aufgaben. |

## Zusammenfassung
CONFIRMED 20 (davon 5 nur am Code), REFUTED 0, UNCLEAR 4 (No-Show-Kachel live mangels Daten, Fragebogen-Rennen, revokeAdsConsent, 3.5/Kommentar nicht geprüft).
Hinweis: Das erste Ablehnen-Klicken per Maus schickte keinen POST (Koordinaten/versteckter Tab, Hydration erst nach Screenshot); mit requestSubmit kam POST 200 und roter Hinweis. Kein Befund der App.

## Nebenbefunde
- `apps/portal/src/app/(portal)/einstellungen/integrationen/page.tsx:479` "Conversion-Einstellungen öffnen" und die Seite ads-conversion (Titel "Conversion-Tracking", "Conversion-Action") behalten Anglizismen; der Fix deckte nur den Speichern-Knopf ab.
- Mit gefälschtem `x-forwarded-host: admin.*` ist `/admin/login` (und alle /admin-Seiten) von der Praxis-Host-Adresse aus erreichbar; Admindaten bleiben hinter `requireAdmin` (307 /admin/login), also nur Reichweite, kein Datenabfluss. Auf Vercel setzt die Plattform den Header; hinter einem Proxy, der ihn durchreicht, gilt das nicht.
- Roland Graf hat altes Testdaten-Wiedervorlage 01.01.2020 (verify-Past) aus der Zeit vor dem Fix; Status unverändert Kontaktiert.
