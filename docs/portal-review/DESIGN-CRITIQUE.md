# Design-Kritik Portal

Seit 2026-10-08 umgesetzt (Freigabe Karam), Stand in `DESIGN-UMSETZUNG.md` und `fixes/DS*.md`.

Stand 2026-10-07. Quelle: Abschnitte "Design-Kritik" der neun Reviews plus eigene Live-Prüfung. Reine Copy-Regelverstöße (Gedankenstriche, Anglizismen) sind keine Design-Frage und werden im Copy-Durchgang (WS10) behoben.

## 1. Lesbarkeit für Inhaber:innen 40-65

- **Versal-Etiketten:** 55 `uppercase`-Klassen in 31 Dateien (Tabellenköpfe, Kartenetiketten, Admin-Set-Password-Label, Review-Mail-Besuchskarte). Kollidiert mit der Projektregel "kein Versal, Satzanfang groß". Meist 12 px in `fg-secondary`/`fg-tertiary`: grau, klein, schwer lesbar.
- **Kleine graue Zeitangaben:** Dashboard-Datumszeile und Fristzeiten in `text-sm` + `fg-secondary`. Die Frist ist eine Entscheidungsgröße und verdient mehr Gewicht.
- **Score ohne Skala:** "74" in der Bewertungsspalte sagt der Praxis nichts. Dazu dreimal dasselbe Funkeln-Symbol (Badge, Spalte, Kopf).

## 2. Hierarchie und Hauptweg

- **Seitenleiste:** 20 Menüpunkte am ersten Tag. Am Handy zählen "Anfragen" und (künftig) "Freigaben".
- **Anfrage-Detail:** viele kleine Karten untereinander; "Anrufen" steht doppelt (Kontaktzeile und Cockpit) und am Handy weit unten.
- **Admin-Startseite:** für bezahlte Anzeigen gebaut (Budget, CPL, ROAS), zeigt beim organischen Start nur Striche. Was Karam täglich braucht (Tag X von 90, offene Kandidaten, Rückruf), ist zwei Klicks entfernt.
- **Login:** Passwort, E-Mail-Link und Google konkurrieren. Der E-Mail-Link wirkt als Nebensache, ist aber der Weg für alle ohne Passwort.

## 3. Leerzustände

- Wiederbehandlungen und Werbebudget sind im ersten Monat leer, ohne Hinweis, wann sie sich füllen.
- Wiedervorlagen-Karte erscheint erst nach der ersten Wiedervorlage; vorher weiß niemand, dass es sie gibt.
- Dashboard "Heute" auf einer neuen Praxis: fast immer leere Diagramme.
- Fortschritt: relative Phasen zeigen nur "Woche 1 bis 2", keinen Stand.

## 4. Handy (375 px)

- Werbebudget-Kopfzeile: `grid-cols-3` mit `text-3xl`-Zahlen; ab "12.345 €" brechen oder überlappen die Spalten. Kampagnentabelle mit 8 Spalten scrollt seitlich.
- Admin-Tabellen mit `min-w-[820px]`/`[860px]` (Garantie, Rückruf, Videos): die Resttage-Spalte ist verdeckt.
- Dateien: Papierkorb 16 px, Tippziel unter 44 px, direkt neben "Von EINS gesehen".
- Fragebogen: 40+ Felder auf einer Seite ohne Abschnittsnavigation.
- Admin-Untertitel (Rückruf-Lage, Garantie-Uhr) drücken die Tabelle nach unten.

## 5. Gefahr und Rückmeldung

- Gefährliche Admin-Knöpfe (Löschen, Pause vermerken, Bestätigung aufheben, Verzug entfernen) sehen aus wie normale `outline`-Knöpfe und zeigen keinen Zustand nach dem Klick.
- Rote Markierungen ("Überfällig", "Von der Praxis nicht beantwortet") ohne Erklärung, was daraus folgt.
- Impersonation: Banner ohne Restzeit; nicht sichtbar, dass der Admin gerade als Inhaber handelt.

## 6. Begriffe und Ton

- Zeitraum-Kürzel "Mon" liest sich wie Montag.
- "Kürzel (slug)" in den Einstellungen ist für die Zielgruppe unverständlich.
- Reset-Seite "Kein Drama" passt nicht zur formellen Sie-Ansprache.
- Seitenleiste: Die grüne Anfragen-Plakette zeigt jetzt "4 neu · 1 fällig" in einem Feld (INT-B, B12). Eine eigene Plakette für fällige Wiedervorlagen wäre deutlicher, ist aber eine Design-Änderung.
- Vier getrennte Zeitraumschalter pro Karte: unklar, welche Zahlen zusammengehören.

## Empfehlung (Reihenfolge nach Wirkung)

1. Versal-Etiketten auf Satzanfang + `fg-primary` umstellen (größter Lesbarkeitsgewinn, rein CSS).
2. Leerzustände mit einem Satz "füllt sich, sobald ..." für Werbebudget, Wiederbehandlungen, Wiedervorlagen, Dashboard "Heute".
3. Admin-Startseite auf Garantie-Lage (Tag X von 90, Kandidaten, Rückruf) umbauen.
4. Handy-Raster Werbebudget + Admin-Tabellen (Spalten am Handy ausblenden statt seitlich scrollen).
5. Gefährliche Knöpfe mit `variant="danger"` + Bestätigung.
