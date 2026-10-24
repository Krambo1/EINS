# REST: kleine Reste nach der Design-Umsetzung (Hauptsitzung, 2026-10-08)

| Punkt | Dateien | Änderung | Status |
|---|---|---|---|
| Fortschritt-Wortlaut | `(portal)/fortschritt/_components/timeline-labels.ts` (+Test) | Geplanter Schritt mit vergangenem Datum: "Geplant seit <Datum>" (Karam 2026-10-08) statt "Geplant für <Datum>". | behoben, Test grün |
| Demo-Praxis in "Heute wichtig" | `server/queries/admin.ts` (`adminAttentionCountsImpl`), `admin/page.tsx` | Die Abfrage selbst lässt die Demo-Praxis (`_template`) bei Garantie und Rückruf weg. Damit stimmen Seitenleisten-Plaketten, "Heute wichtig" und die Karten überein. Die Nachzählung auf der Startseite ist entfernt. | behoben |
| Demo-Praxis auf den Listen (VD2 Nebenbefund) | `server/queries/admin.ts` (neu `demoClinicIds`), `admin/garantie/page.tsx`, `admin/rueckruf/page.tsx` | Garantie-Uhr und Rückruf-Lage zeigen die Demo-Praxis weiter (zum Ausprobieren), aber als letzte Zeile mit Plakette "Demo, zählt nicht mit", auch auf der Rückruf-Karte. Vorher stand sie mitten in der Liste, während die Zähler sie nicht mitzählten. | behoben |
| Deckkraft-Klassen in `@eins/ui` | `packages/ui/src/components/{Badge,MetricTile,EmptyState,Sparkline,TrendChart}.tsx` | `border-accent/30`, `bg-bg-secondary/40`, `bg-fg-tertiary/45`, `bg-fg-tertiary/50`, `border-border/60` haben nichts gerendert (Farben sind nackte `var(--x)`). Jetzt `border-[var(--accent-glow)]` bzw. `color-mix(...)`. Sichtbar: Mint-Rand an Akzent-Plaketten, Hintergrund im Leerzustand, Fadenkreuz im Diagramm. | behoben |
| Textfarbe in `Badge`/`StatusPill` | `anfragen/_lib/badge-classes.ts` (DN1) | `StatusPill` wird nur in den Anfragen genutzt, dort am Aufrufort dunkel. `Badge` hat 160 Aufrufe außerhalb der Anfragen; Farbtext auf zarter Farbfläche bleibt dort (Regel "am Aufrufort umhüllen", keine Massenänderung). | bewusst offen |
| Meta "Trennen" | `(portal)/einstellungen/actions.ts`, `server/meta-pages.ts` (+Test) | Trennen löscht die Meta-Zeile und meldet danach (per `after()`) die Seite vom Leadgen-Abo ab, wenn keine andere Praxis sie hält. Fehler werden protokolliert, nie angezeigt. Neue Funktion `releaseDisconnectedMetaPage`, 3 Tests. | behoben |
| Seiten-Token in der URL | `api/webhooks/meta/leadgen/route.ts` | Abruf der Anfrage bei Meta schickt den Seiten-Token im Kopf `Authorization: Bearer`, nicht mehr als `?access_token=` (URLs landen in Protokollen). Im Portal steht kein Token mehr in einer URL. | behoben |
| Englische Etiketten pvs-bridge | `HANDOFF-ANDERE-SITZUNG.md` | Als Vorschlag an die andere Sitzung übergeben ("Event-Trace" usw.). | übergeben |
| Leitfaden-Titel | `server/reports/leitfaden-pdf.tsx`, `lib/search/staticIndex.ts` | An die Seite angeglichen: "Zielwerte für jeden Anruf", "Bedarf klären", "Termin festmachen und DSGVO-Datenaufnahme", "No-Show-Prävention: Erinnerungsplan und Vorlagen". | behoben |

## Nach VD3 (Sichtprüfung, `verify/VD3.md`)

| Punkt | Dateien | Änderung | Status |
|---|---|---|---|
| VD3 REFUTED: Archivieren-Knöpfe 375 px | `(portal)/einstellungen/page.tsx` | Zeilen Behandlungen und Standorte: Text `min-w-0 flex-1 break-words`, Knopf-Formular `shrink-0`. Live 375 px: Knöpfe 212 bis 334, nichts läuft über. | behoben |
| VD3 REFUTED: Dashboard-Tabellen 375 px | `dashboard/_components/BreakdownStackChart.tsx`, `DashboardDetailBundle.tsx` | Quellen: "Termine" erst ab md (Hover-Karte nennt sie weiter), die vier Kennzahlen am Handy als 2x2-Raster unter der Zeile statt als Spalten, weiche Trennstellen in den Köpfen. Behandlungen: "Ø Fall" erst ab md, engere Abstände am Handy. Standorte: `fitPhone`, "Termine" erst ab md. Live 375 px, Zeitraum "Max": alle drei Tabellen 293 px in 293 px Karte, Seite 375. | behoben |
| VD3 Nebenbefund: Protokoll mit rohen Kennungen | neu `(portal)/einstellungen/_audit-label.ts` (+Test), `einstellungen/page.tsx`, `lib/search/staticIndex.ts`, `leitfaden/pruefung/page.tsx` | Jede Zeile ist ein deutscher Satz ("Anfrage angesehen", "EINS hat Ihre Ansicht geschlossen"), nie eine Kennung; Unbekanntes wird "Sonstige Aktion". Titel "Protokoll" statt "Audit-Log". | behoben |
| VD3 Nebenbefund: Kampagne "–" | `server/queries/campaigns.ts` | Ausgaben ohne Kampagnen-Id und -Name heißen "Ohne Kampagnenangabe". | behoben |
| VD3 Nebenbefund: nur Seiten-ID nach der Meta-Auswahl | - | Der Seitenname wird nicht gespeichert (keine Spalte). Auswahlseite und Erfolgshinweis nennen ihn. | bewusst offen |
| VD3 Nebenbefund: "Wunsch-Patientinnen" | Plan-Text aus Migration 0063 | Daten, kein Code; in `/admin/journey` änderbar. Bei ästhetischer Medizin vermutlich gewollt. | nicht geändert |

Prüfung: `npx tsc --noEmit -p .` in `apps/portal`, `packages/ui`, `apps/clinic-landing` ohne Fehler; ganze vitest-Suite 1319 grün; 11 DB-Testdateien (20 Tests) grün; Routen-Durchlauf 144 ok, 0 Fehler; `next build` Portal (93 Seiten) und Zielseiten grün. Meta-Testverbindung danach mit `--entfernen` zurückgesetzt, `META_PAGES_FIXTURE` aus `.env.local` entfernt.
