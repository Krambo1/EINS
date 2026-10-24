# VD3 Sichtprüfung (localhost:3007 und admin.localhost:3007), 2026-10-08

Prüfer: Sonnet, frischer Kontext, nur lesen. Die Praxis-Seite wurde mit dem lokalen Demo-Zugang geprüft, weil der Browser dort abgemeldet war. Die Admin-Seite war nicht angemeldet. Alle Admin-Punkte, die ein Bild brauchen, sind UNCLEAR, es wurde kein Passwort geraten.

## Tabelle

| Punkt | Ergebnis | Beobachtung |
|---|---|---|
| A VD1-1 /login Fehlerkasten | CONFIRMED | Ausgeliefertes HTML von `/login?error=impersonation_expired` ohne Cookies geholt und ohne Skripte gerendert. Kasten "Der Link für die Kundenansicht ist abgelaufen ..." hat Text rgb(201,53,43), Fläche rgba(201,53,43,0.08), Rand rgba(201,53,43,0.25), also rot und sichtbar. Klassen `border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)]`. |
| A VD1-5 /werbebudget 375 px, Kampagnentabelle | CONFIRMED | `?days=90`: Tabelle 293 px in Container 293 px (scrollWidth 293). Vier Spalten je 73 px. Seite scrollWidth 375. |
| A VD1-7 /anfragen 1024 px | CONFIRMED | Kopf 333 bis 952, Spalten Anfrage 333-604, KI-Bewertung 620-756, Eingang und Frist 772-932. Kein Überlapp, nichts über 1024. |
| A VD1-12 /einstellungen/integrationen 375 px | CONFIRMED | Knopf "Einstellungen für Abschluss-Meldungen öffnen": 41 bis 334 px, 66 px hoch, bricht um. Seite scrollWidth 375. Keine rohe Praxis-ID. |
| A VD1-10 /dateien | UNCLEAR | Lokale DB ohne Datei (Leerzustand). Zeilen, Papierkorb und Rückfrage nicht beobachtbar. |
| A VD1-14 Kundenansicht-Banner | UNCLEAR | Braucht die Admin-Sitzung. |
| A VD1-9 Rundgang-Karte über der Leiste | UNCLEAR | Rundgang war nicht offen. |
| A VD2-1 Admin-Startseite, Tag X von 90 | UNCLEAR | Admin abgemeldet. |
| A VD2-2 Admin 375 px Karten Pipeline und KI-Bewertung | UNCLEAR | Admin abgemeldet. DN3 meldet `min-w-0` an beiden Rasterkindern. |
| A VD2-3 `/admin/garantie` 375 px | UNCLEAR | Admin abgemeldet. |
| A VD2-4c bis 4e (Rückfragen vor Löschen) | UNCLEAR | Admin abgemeldet; Löschen-Knöpfe werden ohnehin nicht geklickt. |
| A VD2-6 Admin-Login ohne Versalien | CONFIRMED | `admin.localhost:3007/admin/login`: Etikett "Admin", 0 Elemente mit `text-transform: uppercase`. |
| A Stichprobe DN1-4 KI-Begründung deutsch | CONFIRMED | "80 von 100, gute Passung: basierend auf Nachrichtenlänge, Terminbereitschaft, Budget-Indikation." Kein HOT/COLD/Score/filler. |
| A Stichprobe DN1-7 Suchfeld 375 px | CONFIRMED | Platzhalter "Suchen: Name, Telefon, E-Mail" vollständig sichtbar (202 px Text in 341 px Feld). |
| A Stichprobe DN1-6 Fortschritt | CONFIRMED | Siehe B1. Wochenkasten nennt "Ihre ersten Beiträge gehen live", nicht die Empfehlung. |
| A Stichprobe DN2-2 Knöpfe 375 px | REFUTED (Teil) | `/ads-conversion`: Speichern-Knopf bricht um, kein `META_CAPI_TOKEN`. Aber `/einstellungen`, Karte "Behandlungs-Kategorien": "Archivieren"-Knöpfe zwischen x=212 und x=409, Zeile Kryolipolyse abgeschnitten. |
| A Stichprobe DN2-3 Interna | CONFIRMED (mit Rest) | Keine UUID, Praxis-ID oder Servervariable auf `/einstellungen`, `/ads-conversion`, `/integrationen`. Rest siehe Nebenbefunde (Aktivitätsprotokoll). |
| A Stichprobe DN2-5 setup/csv Auswahl | CONFIRMED | 375 px: Auswahl zeigt sofort "Termine (geplant, mit Status)", 293 px, kein Überlauf. |
| A Stichprobe DN2-6/7 /medien, /leitfaden, /setup/medatixx | CONFIRMED | `/medien` Etiketten 14 px dunkel; `/leitfaden` ohne KPI, Cadence, Discovery, Close, mit "Zielwerte"; `/setup/medatixx` ohne GitHub-Link. |
| A Stichprobe DN1-5 Dashboard Quellen-Karte 375 px | REFUTED (Teil) | Wörter stimmen. Aber Quellen-Tabelle 438 px in 293 px Container (`overflow-x:auto`), Termine und Gewonnen abgeschnitten. Behandlung (358 px) und Standort (411 px) ebenso breiter. |
| A Stichprobe DN3 (Admin) | UNCLEAR | Admin abgemeldet. |
| B1 Fortschritt "Geplant seit" | CONFIRMED | 1440 px: "Geplant seit 25.07.2026" und "Geplant seit 11.08.2026"; weder "Heute geplant" noch "Geplant für". Test 5/5 grün. |
| B2 Admin "Heute wichtig", Listen, Plaketten | UNCLEAR | Admin abgemeldet. Nur Code gelesen: Startseite und `adminAttentionCountsImpl` filtern `_template`. |
| B3a Badge Ton accent | CONFIRMED | `/anfragen`: border-color rgb(88,186,181), 1 px, Fläche rgba(88,186,181,0.10). |
| B3b EmptyState | CONFIRMED | `/dateien`: Hintergrund `color(srgb 0.96 0.96 0.97 / 0.4)`, nicht transparent. |
| B3c TrendChart-Fadenkreuz | CONFIRMED | `/dashboard` 1440 px, Hover: Linie 1 px, 120 px hoch, `color(srgb 0.416 0.416 0.455 / 0.45)`. |
| C1 Meta in den Einstellungen | CONFIRMED | 375 px: "Facebook & Instagram", "Verbunden", "Noch keine Facebook-Seite gewählt. Ohne Seite kommen keine Anfragen aus Meta-Formularen in Ihr Portal.", Link "Facebook-Seite wählen". |
| C2 `/einstellungen/integrationen/meta-seite` | CONFIRMED | 375 px: drei Testseiten als Radiofelder mit Seiten-ID, Knopf "Diese Seite verbinden" 44 px. scrollWidth 375, 0 Versalien, kein U+2014, Sie-Form. |
| C3 Seite wählen, Erfolg | CONFIRMED (mit Einschränkung) | Weiterleitung auf `/einstellungen`, grüner Hinweis "Facebook-Seite verbunden / Privates Profil-Projekt (Testseite)". Danach "Facebook-Seite: Seiten-ID 0000000000000003" mit "Andere Seite wählen". Einschränkung: dort nur die Seiten-ID, nicht der Name. |

## REFUTED

- `/einstellungen` 375 px, Karte "Behandlungs-Kategorien": "Archivieren"-Knöpfe laufen aus der Zeile (bis x=409). `(portal)/einstellungen/page.tsx` Zeile 827 (Behandlungen) und 887 (Standorte, gleiches Muster).
- `/dashboard` 375 px, Karte "Quellen": Tabelle 438 px in 293 px Container, Termine und Gewonnen abgeschnitten. Auch Behandlung (358 px) und Standort (411 px). DataTable ohne `fitPhone`.

## Nebenbefunde

- `/einstellungen` Aktivitätsprotokoll: rohe englische Kennungen (`login`, `view request`, `impersonate_start`, `reopen_discovery_fragebogen discovery_fragebogen`), eine Zeile ragt bei 375 px bis x=381.
- Meta-Seite zeigt nach der Auswahl in den Einstellungen nur die Seiten-ID, nicht den Namen.
- Erfolgshinweis "Facebook-Seite verbunden" unten und schnell weg; nach der Weiterleitung steht die Seite oben, nicht bei den Werbekonten.
- `/werbebudget`: Kampagnenname der ersten Zeile "–".
- `/fortschritt`: "Patientinnen" (nur weiblich) im Text.
- Durch die Prüfung geändert (lokale Fixture-Daten): gewählte Facebook-Seite der Demo-Praxis ist "Privates Profil-Projekt (Testseite)".
