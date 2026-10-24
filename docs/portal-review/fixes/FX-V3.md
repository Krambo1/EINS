# FX-V3 Oberfläche und Copy

| ID | Ergebnis | Dateien | Satz |
|---|---|---|---|
| V7 5.6 | fixed | `admin/garantie/actions.ts`, `admin/garantie/[clinicId]/page.tsx`, neu `admin/garantie/fehler-cookie.ts` | Ursache: ein `redirect()` aus einer Server-Aktion lässt Next die Zielseite serverseitig von `__NEXT_PRIVATE_ORIGIN` (http://localhost:3007 unter `next dev`/`next start`) holen, Node-fetch kann den Host-Header nicht setzen (geprüft: auch mit `host`/`x-forwarded-host` 404), die Middleware sieht den Praxis-Host und schreibt `/admin/*` auf /404 um (Next.js #65893); jetzt wirft `fail()` einen `GuaranteeFail`, jede exportierte Aktion fängt ihn, legt die Meldung 10 s in ein httpOnly-Cookie und die Seite rendert neu mit rotem Hinweis; Klick-Test vorher 404 "Seite nicht gefunden", nachher 2 von 2 Mal roter Hinweis (POST 200, kein 404), nach 11 s ohne Hinweis. |
| V2 Neben 1 | fixed | `api/requests/export/csv.ts`, `csv.test.ts` | Telefon-artige Zellen (nur Ziffern, Leerzeichen, `+ ( ) / . -`) bekommen kein Apostroph mehr; beginnen sie mit + oder - oder wären sie eine Zahl, gehen sie als konstante Textformel `="+491701234567"` raus (Excel de, Semikolon-CSV per COM geöffnet: Text, kein Apostroph, keine Rechnung; LibreOffice zeigt das als Text bei "Formeln auswerten"), alles mit Buchstaben/anderen Zeichen behält das Apostroph, echte Zahlen werden nie geschützt; 3 neue Tests. |
| V7 Neben (BOM) | no_change_needed | `api/requests/export/route.ts` | `buildCsv` liefert U+FEFF und `NextResponse` behält es: Bytes beginnen mit EF BB BF (per Skript geprüft), Excel zeigt Umlaute richtig; der Verifier hat vermutlich `fetch().text()` gelesen, das das BOM beim Dekodieren entfernt. |
| V7 3.9 | fixed | `anfragen/[id]/actions.ts`, `anfragen/[id]/_lead-cockpit.tsx`, neu `anfragen/[id]/_followup-date.ts` (+Test) | Wiedervorlage (Dialog und Anruf-Dialog) lehnt Tage vor heute (Berliner Kalendertag, heute auch frühere Uhrzeit erlaubt) im Dialog und serverseitig mit "Das Datum der Wiedervorlage liegt in der Vergangenheit. ..." ab, leeres Datum zeigt "Bitte wählen Sie Datum und Uhrzeit der Wiedervorlage." statt still zu blockieren (Knopf nicht mehr ausgegraut); Klick-Test Roland Graf: beide Meldungen erscheinen, Dialog bleibt offen, nichts gespeichert; 5 Tests inkl. Mitternacht Berlin vs UTC. |
| V7 3.6 | fixed | `anfragen/[id]/page.tsx`, neu `anfragen/[id]/_status-change.ts` (+Test) | Verlauf zeigt unter "Status-Änderung" die Zeile "Status: Neu → Kontaktiert" (Labels aus `ALL_REQUEST_STATUS_LABELS`, `meta.from/to`, sonst `derivedStatus`; "→" gibt es im Portal schon), gleiche Textklasse wie der Eintragstext; PVS-Umsatzzeilen mit from = to bleiben ohne Zeile; im Browser bei Roland Graf gesehen. |
| V7 3.5 | no_change_needed | - | `STATUS_TRANSITIONS` erlaubt kontaktiert/nicht_erreicht/verloren/spam -> neu, und der Dialog nimmt genau diese Liste: bei Roland Graf (Kontaktiert) bietet "Status ändern" jetzt "Termin vereinbart, Nicht erreicht, Verloren, Neu" an (Browser); V7 hat die Liste vermutlich noch im Zustand "Neu" gesehen. |
| V2 Neben 2 | fixed | `server/queries/requests.ts` (nur SLA-Filter) | Listenfilter "Reaktionszeit überschritten" hat jetzt dieselbe Bedingung wie der Zähler (`status = 'neu'` zusätzlich zu ohne Erstkontakt und `sla_respond_by < now()`); gilt auch für den gleichen Filter im Admin-Tab "Anfragen". |
| V2 Neben 3 | fixed | `dashboard/_components/DashboardDetailBundle.tsx` (Aufrufstelle, `TrendChart` unverändert) | Ursache: die geteilte `TrendChart` setzt bei Maximum 0 die Achse auf 0-1 und beschriftet Viertel mit einer Nachkommastelle ("0,0 %, 0,3 %, 0,5 %, 0,8 %"); an der Aufrufstelle wird die Wertachse jetzt nur gezeigt, wenn ein Tag eine Quote über 0 hat, sonst bleibt nur die Datumsachse (die große Zahl darüber sagt "0 %"). |
| V2 Neben 5 | fixed | `anfragen/[id]/actions.ts`, `anfragen/[id]/page.tsx`, neu `anfragen/[id]/_revoke-ads-consent.tsx` | `revokeAdsConsent` läuft jetzt über `toResult` und gibt `{ ok, message }` zurück (Berechtigung, Eingabe, DB-Fehler als deutsche Meldung, Redirects bei abgelaufener Sitzung laufen weiter durch); der Knopf ist ein kleiner Client-Baustein im Stil der Wiedervorlagen-Zeile (gleicher Button `variant="danger"`, Fehlerzeile `text-tone-bad`); bereits widerrufen bleibt ein Erfolg. |
| V2 UNCLEAR | fixed | `(portal)/_components/OnboardingGateGuard.tsx` | Im Code bestätigt: nach Klick auf /dashboard -> Refresh -> Umleitung auf /onboarding blieb `refreshedFor = "/dashboard"`, ein zweiter Klick auf denselben gesperrten Pfad übersprang `router.refresh()` und zeigte die Seite per Soft-Navigation; jetzt wird die Marke auf jedem erlaubten Pfad (bzw. bei offener Sperre) zurückgesetzt, der Schutz gegen eine Refresh-Schleife auf demselben gesperrten Pfad bleibt. Nicht im Browser geklickt (lokale Praxis ist freigeschaltet). |
| V6 Neben | fixed | `onboarding/fragebogen/actions.ts` | Erstes Speichern ohne Zeile: `INSERT ... ON CONFLICT (clinic_id) DO NOTHING RETURNING id`; verliert ein Tab das Rennen, bekommt er dieselbe Konflikt-Antwort wie ein veralteter Tab ("an anderer Stelle geändert", Eingaben bleiben lokal), kein Unique-Fehler mehr; Meldungstext dafür in eine Konstante gezogen, Wortlaut unverändert. Nicht mit zwei Tabs gleichzeitig geklickt. |
| V7 3.3 | fixed | `(portal)/anfragen/page.tsx` | Zähler baut jetzt "1 Eintrag" / "N Einträge" statt "Eintrag"+"e". |
| V6 REFUTED | fixed | `einstellungen/integrationen/ads-conversion/page.tsx:137`, `einstellungen/integrationen/page.tsx:467` | "EUR-Werte"/"EUR-Wert" -> "Euro-Werte"/"Euro-Wert". |
| V6 Copy (ROAS) | fixed | `lib/search/staticIndex.ts` | Suchtreffer-Titel "Werbeertrag (ROAS)" -> "Werbeertrag"; "roas" bleibt als Suchwort, damit die Suche danach weiter trifft. |
| V6 Copy (CTR) | fixed | `werbebudget/page.tsx` | Spaltenkopf und Kennzahl "CTR" -> "Klickrate". |
| V6 Copy (Conversion-Einstellungen) | fixed | `einstellungen/integrationen/ads-conversion/page.tsx` | Knopf "Conversion-Einstellungen speichern" -> "Einstellungen für Abschluss-Meldungen speichern" (gleiche Wortwahl wie FX-V1 im Toast; der Toast in `einstellungen/actions.ts` ist FX-V1). |
| V5 Copy | fixed | `admin/garantie/[clinicId]/page.tsx` | Einzahl "1 weitere Anfrage anzeigen", sonst "Weitere N Anfragen anzeigen". |
| V7 6 | fixed | `lib/dashboard-range.ts` | Umschalter "Mon" -> "Monat" (V7 gemessen: 250 von 293 px, einzeilig bei 375 px). |
| V3 Neben 4 | fixed | `(portal)/_components/search-storage.ts` | Kommentar korrigiert: kein `Clear-Site-Data` beim Abmelden, gelöscht wird clientseitig im Kontomenü vor dem Abmelde-Formular und bei Start/Ende der Kundenansicht. |

Prüfung: `npx tsc --noEmit -p .` in `apps/portal` ohne Fehler; `vitest run` für csv, `_followup-date`, `_status-change`, `search-storage`, `dashboard-range`: 26/26 grün.

## Braucht andere Datei

- `src/app/admin/clinics/actions.ts`, `src/app/admin/clinics/[id]/actions.ts`, `src/app/admin/clinics/[id]/dsgvo/actions.ts`: gleiches Muster `redirect("/admin/...?fehler=...")` aus Server-Aktionen, damit sehr wahrscheinlich derselbe 404 unter `next dev`/`next start` (nicht geklickt). Entweder dort wie in `admin/garantie` umbauen oder zentral in `src/middleware.ts`: Next holt das Redirect-Ziel von `__NEXT_PRIVATE_ORIGIN` mit `x-forwarded-host: admin.*`, die Middleware prüft nur `host`. `x-forwarded-host` dort zu vertrauen ist eine Sicherheitsentscheidung (auf Vercel setzt die Plattform den Header, lokal ist er fälschbar; Admin-Seiten prüfen trotzdem IP-Liste und Admin-Sitzung).

## Offene Entscheidungen für Karam

- CSV-Telefonnummern als `="+49..."`: in Excel sauber (geprüft); LibreOffice zeigt das nur dann als Text, wenn im Import-Dialog "Formeln auswerten" an ist, sonst sieht man `="+49 170 ..."`. Alternative wäre, Nummern ohne Leerzeichen gar nicht zu schützen (Excel macht dann 4,917E+11 daraus). Ich habe Excel bevorzugt.
- No-Show-Kachel: bei durchgehend 0 % wird nur die Wertachse ausgeblendet. Wer dort lieber feste Marken "0 %, 5 %, 10 %" will, braucht eine Option in der geteilten `TrendChart` (packages/ui), nicht meine Datei.

## Nicht getestet

- V2 UNCLEAR (Onboarding-Sperre) nicht im Browser: lokale Praxis ist freigeschaltet; nur am Code nachvollzogen.
- V6 Neben (Fragebogen, zwei Tabs gleichzeitig) nicht als echtes Rennen ausgelöst.
- V2 Neben 3 (No-Show-Achse) nicht im Browser angesehen (keine No-Show-Daten lokal geprüft).
- V2 Neben 5 (Widerruf-Knopf) nicht geklickt, nur `tsc`.
- V7 3.9: Wiedervorlage für heute nicht gespeichert (keine weiteren Testdaten), nur per Test; die Serverprüfung für vergangene Tage nicht separat am Dialog vorbei aufgerufen.
- V7 5.6 in Produktion (Vercel) nicht geprüft; der Umbau hängt nicht mehr vom Host ab.
- LibreOffice nicht installiert, CSV dort nicht geöffnet.


## Nachtrag Hauptsitzung (22:40)

| ID | Status | Dateien | Was und warum |
|---|---|---|---|
| V7 5.6 (Wurzel, alle Admin-Seiten) | fixed | `src/middleware.ts` | Admin-Host wird aus `x-forwarded-host` (erster Eintrag), sonst `host` erkannt. Next lädt die Zielseite eines Server-Action-Redirects selbst über die Loopback-Adresse (`host` = `localhost:<port>`), `x-forwarded-host` behält den Admin-Host; damit trifft der Fix alle 8 Admin-Dateien mit `redirect()`, nicht nur die Garantie. Gleiche Reihenfolge wie `auth/request-origin.ts`; Vercel setzt den Header selbst. Geprüft per curl: Praxis-Host ohne Header `/admin/garantie` weiter 404, mit Admin-Header 200; `tsc` sauber. Klick-Test einer Admin-Aktion mit Redirect (z. B. Praxis bearbeiten) steht im Abschluss-Verifier. |

| Nachtrag Hauptsitzung (nach VF2) | `middleware.ts`: `x-forwarded-host` gilt nur noch, wenn `host` Loopback ist (Next-Selbstabruf über `__NEXT_PRIVATE_ORIGIN`); vom Praxis-Host mit gefälschtem Header 404. Neu `middleware.test.ts` (5 Fälle). Live: Fälschung 404, Selbstabruf 200 -> requireAdmin. | behoben |
