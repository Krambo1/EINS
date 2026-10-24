# Gemeinsame Regeln für alle Umbau-Agenten (EINS, 30.09.2026)

## Hintergrund
EINS ist ein Akquise-System für Praxen für ästhetische Medizin (DACH), Solo-Gründer Karam. Am 30.09.2026 hat Karam das Geschäft umgestellt: kein Drehtag mehr, KI-Inhalte mit einem KI-Klon des Inhabers, organisch zuerst und danach bezahlte Anzeigen (Werbebudget bleibt das Ziel, ist aber zu Beginn keine Pflicht), neue Garantie "Keine Anfrage, keine Rechnung" (90 Tage ab Unterschrift), keine Obergrenze "1 Praxis pro Monat" mehr. Der Obsidian-Vault ist die Basis des ganzen Geschäfts und muss danach durchgehend widerspruchsfrei sein.

## Zuerst lesen (vollständig)
1. `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\KANON.md`: die EINZIGE Quelle für Fakten, Zahlen, Fristen und Kernsätze. Wortlaut in Anführungszeichen oder Zitatblöcken wörtlich übernehmen.
2. `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\PLAN.md`: die Zeilen zu Deinem Auftrag (Teil 3 für die Vault-Notizen, Teil 4 für Dateien).

## Umfang
- Ändere NUR die Seiten und Dateien in Deinem Auftrag. Andere Agenten arbeiten gleichzeitig an anderen Seiten. Findest Du außerhalb Deines Auftrags etwas Veraltetes, nenne es im Bericht, ändere es nicht.
- Andere Sitzungen arbeiten am selben ungesicherten Git-Stand: jede Datei direkt vor der Änderung neu lesen, nur gezielte Änderungen, nie ganze Dateien mit altem Stand überschreiben.
- Nicht committen, nicht pushen, nicht deployen, niemanden kontaktieren, keine E-Mail senden.
- Nie `.env`-Dateien oder Schlüssel lesen, ausgeben oder in Berichte schreiben.
- Dateien außerhalb von Git (z. B. unter `D:\Desktop\EINS Dokumente`; Vault-Notizen ausgenommen, der Vault hat eigene Backups): vor der ersten Änderung eine Kopie in einen Unterordner `_backup-2026-09-30` im selben Ordner legen (falls noch nicht vorhanden).

## Was geändert wird
- Alles, was dem Kanon widerspricht, wird auf den Kanon gebracht: Drehtag/Produktionstag, sicherer Start, Rücktritt bis zum Drehtag, 3,5 pro 1.000 €, 360 Tage, Rückerstattung, Lernphase, Tag 22, Mindest-Werbebudget 3.000 €, 1 Praxis pro Monat, "Inhalte ohne Anzeigen werden nicht gesehen", Hauptvideo/20 Fotos/Animationsbibliothek, Freigabe binnen 10 Werktagen usw. Siehe Ersetzungs-Tabelle im Kanon, Abschnitt 2.
- Die Seite soll danach so lesen, als wäre sie von Anfang an für das neue Modell geschrieben. Keine Flicken wie "(früher Drehtag)". Ausnahme: Historien-Teile (Lessons-Einträge, Änderungsprotokolle, Versionshistorien, Archiv, Handoffs) bleiben stehen und werden höchstens mit "Ersetzt am 30.09.2026, siehe …" markiert.
- Begründungs-Abschnitte, die nur das alte Modell rechtfertigen (z. B. "Warum 3,5 statt 4"), werden entfernt oder durch die Begründung des neuen Modells ersetzt, nicht stehen gelassen.
- Fehlt im Kanon etwas, das Du brauchst: nichts erfinden, `[OFFEN: …]` setzen und im Bericht nennen.

## Text-Regeln (alle Texte)
Sie-Form mit großem Sie/Ihr/Ihnen · keine Gedankenstriche (U+2014) und keine Halbgeviertstriche als Satzzeichen, stattdessen Komma, Punkt, Doppelpunkt oder "-" · Praxis statt Klinik (englische Bezeichner wie `clinicId` bleiben) · nie "Probe", "Test" oder "Pilot" für das Angebot · keine Knappheit · deutsche Begriffe statt Anglizismen (Anfrage statt Lead, Zielseite statt Landingpage, Werbebudget statt Adspend, Auswertung statt Reporting, Gespräch statt Call; Eigennamen wie Instagram, Meta, Google bleiben) · € statt EUR · keine erfundenen Zahlen oder Ergebnisse · Garantie immer mit beiden Grenzen im selben Absatz ("erste qualifizierte Anfrage über EINS" und "90 Tage").

## Vault-Technik
- Quelle ist der Obsidian-Vault `D:\Desktop\Claude\Obsidian\Karam`. Kein Notion, keine Notion-Werkzeuge.
- Notiz vollständig lesen, bevor Du änderst. Bei langen Notizen alles lesen, nicht nur die Treffer.
- Gezielt ändern (Abschnitte ersetzen oder nach einer Stelle einfügen). NIE den ganzen Inhalt einer Notiz überschreiben. Notizen nie löschen oder verschieben, Frontmatter (`notion-id`, `lead-id`, `teardown-id`) und Links erhalten.
- Nach jeder Änderung die Notiz neu lesen und prüfen: Änderung angekommen, nichts anderes verloren, Formatierung (Überschriften, Tabellen, Callouts) intakt.
- Gibt es in der Notiz eine Versions- oder Stand-Angabe, hochzählen und "Stand: 30.09.2026" setzen.

## Selbstprüfung vor dem Bericht
Suche in jeder Deiner Seiten und Dateien nach: `Drehtag|Produktionstag|Drehtermin|Videodreh|Fotoshooting|Lernphase|Tag 22|sichere(n)? Start|3,5 (qualif|Anfragen)|pro 1\.000 €|360 Tage|12-Monats|126 qualif|Mindest.?[Ww]erbebudget|3\.000 €|maximal (1|eine?) (neue|Praxis)|Rücktritt bis|Geld zurück|Rückerstattung|Reserve-Konto|Hauptvideo|20 Fotos|Animationsbibliothek|Behind-the-Scenes|Klinik|—`. Erwartet: null Treffer außer markierter Historie. Jeden verbleibenden Treffer im Bericht begründen.

## Bericht (höchstens 350 Wörter)
- Geänderte Seiten/Dateien mit Abschnittsnamen.
- Was ersetzt wurde (knapp).
- Alle `[OFFEN: …]`-Stellen.
- Gefundenes außerhalb Deines Auftrags.
- Ergebnis der Selbstprüfung.
