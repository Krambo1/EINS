# Portal-Review: Ergebnis

Stand 2026-10-08. Alles ist lokal geändert und nicht committet, nichts ist deployt. Seit 07.10. dazu: Design-Kritik umgesetzt, Ihre Entscheidungen vom 08.10. gebaut.

## In einem Satz

Das Portal ist nach dieser Runde bereit für die erste echte Praxis, sobald die Pflichtpunkte vor dem Deploy erledigt sind (Abschnitt "Vor dem Deploy"). Kein Prüfer hat einen Weg gefunden, wie eine Praxis Daten einer anderen sehen oder ändern kann.

## Was gemacht wurde

1. **Prüfung in 13 Blickwinkeln** (Infrastruktur, Anmeldung, Anfragen, Tempo, Hintergrund-Jobs, Kaputtmachen Praxis- und Admin-Seite, fehlende Funktionen, Ballast, Mandantentrennung, Garantie gegen KANON, Patientendaten, große Datenmengen): rund 290 Rohbefunde.
2. **Behebung** in 20 Arbeitspaketen auf getrennten Dateien, jeder Befund vorher im Code bestätigt: rund 330 Log-Zeilen "behoben".
3. **Gegenprüfung** durch frische Prüfer, die nur die Behauptungen bekamen: 7 Bereiche plus Klick-Test im Browser, danach ein zweiter Fix-Durchgang und eine Abschlussprüfung.
4. **Design umgesetzt und Ihre Entscheidungen gebaut** (08.10.), danach drei Sichtprüfungen im Browser und die Schlussprüfung erneut.

## Was sich für die Praxis ändert

- **Neue Anfrage kommt sicher an:** Mail an Inhaber und Empfang sofort nach Eingang, ohne Patientendaten im Text, auch ohne Hintergrund-Worker. Bricht der Server mitten im Versand ab, holt der Morgenlauf die Mail nach.
- **Dashboard schnell, auch mit vielen Anfragen:** bei 20.000 Anfragen "Jahr" und "Max" in etwa 1 s statt 12-16 s. Anruf-Liste 4x schneller.
- **Zeiten stimmen:** alle Datums- und Tagesgrenzen in Berliner Zeit, auch am Tag der Zeitumstellung (25.10.2026).
- **Anfragen-Arbeit robuster:** Fehler werden als deutscher Hinweis gezeigt statt als Fehlerseite, Eingaben bleiben erhalten; Wiedervorlage nicht mehr in der Vergangenheit; Verlauf zeigt "Neu → Kontaktiert"; CSV-Export öffnet in Excel sauber (Umlaute, Telefonnummern).
- **Garantie rechnet nach KANON:** 90 Berliner Tage ab Unterschrift, Verlängerung nur mit Verzugs-Mail, erste Rechnung nur über das Formular als Messweg, der KI-Score entscheidet nie. Anfragen vor der Unterschrift zählen nicht.
- **Patientendaten:** automatische Löschung wie von Ihnen entschieden (Spam nach 90 Tagen, Klick-Kennungen nach 90 Tagen, archivierte Praxis nach 90 Tagen mit Export vorher, Anonymisierung nach 24 Monaten). Keine Patientendaten in Logs, Mails, Betreffzeilen.
- **Sicherheit:** Anmeldegrenzen halten auch bei vielen gleichzeitigen Versuchen (Praxis- und Admin-Login, Passwortwechsel); Anmelde-Link wird nicht von Mail-Scannern verbraucht; Kundenansicht protokolliert jede Aktion mit Ihrer Admin-Id.
- **Copy:** keine Gedankenstriche und kaum noch Anglizismen in sichtbaren Texten (CPL, ROAS, Lead, Funnel ersetzt).

## Vor dem Deploy (Pflicht)

Vollständig in `DECISIONS.md` Abschnitt A. Kurz:
1. Migrationen 0077 bis 0095 auf Neon, in der Reihenfolge aus A1 (vor 0088 die Prüfabfrage). 0095 (CSV-Import) muss vor dem Code laufen, sonst scheitert jeder CSV-Import.
2. Vercel-Umgebung: `CRON_SECRET` (mindestens 32 Zeichen), E-Mail-Versand, `REVIEW_RELAY_SECRET` (Portal und Zielseiten gleich), `CLINIC_LANDING_ORIGINS`, `OPS_ALERT_EMAIL`. Prüfen, dass `ADMIN_IP_ALLOWLIST` gesetzt ist (sonst scheitert jede Admin-Anmeldung; bestand schon vorher).
3. `DATABASE_URL_APP` zeigt auf die Rolle `eins_app`, nie auf `neondb_owner` (sonst verweigert das Portal jede Praxis-Seite; Prüfabfrage in A 4a).
4. R2: 30-Tage-Regel für Sicherungen, keine öffentliche Domain auf diesem Bucket.
5. Echte Meta-Business-ID in der Checkliste; Wortlaut der Verzugs-Mitteilung lesen.
5a. Meta: Die App fragt jetzt zusätzlich `pages_manage_metadata` an. Meta muss das in der App-Prüfung freigeben, vorher kommen über Meta keine Anfragen an. Eine schon verbundene Praxis muss Meta einmal neu verbinden.
6. Neon-Passwörter vor der ersten echten Praxis wechseln.

## Ihre Entscheidungen vom 08.10. (gebaut)

1. **Messwege (D1):** Start nur mit dem Formular. Anruf (Tracking-Nummer) und Buchungslink müssen gebaut sein, bevor eine Praxis sie bekommt; das steht als Erinnerung vor dem nächsten Onboarding.
2. **"Test" auch als Spam (D6):** Lehnen Sie im Admin eine Anfrage als "Test der EINS-Seite" ab, wird sie zusätzlich Spam und zählt bei der Praxis nicht mehr als unbeantwortet.
3. **Meta-Seitenauswahl (E6):** Verwaltet ein Facebook-Konto mehrere Seiten, wählt die Praxis unter Einstellungen die richtige. Eine Seite, die an einer anderen Praxis hängt, lässt sich nicht wählen. Dazu neu: nach dem Wählen meldet das Portal die Seite bei Meta für Anfragen an, beim Wechsel und beim Trennen wieder ab.
4. **Praxis ohne Unterschriftsdatum (D5):** bleibt wie es ist.
5. **CSV-Import aus der PVS (C8):** läuft jetzt ohne Hintergrunddienst, direkt nach dem Hochladen; was dabei liegen bleibt, holt der Morgenlauf nach.
6. **Datensicherung (C9):** Neon-Wiederherstellung (PITR) reicht.

Eine Entscheidung habe ich selbst getroffen, weil die Prüfung ein Leck gezeigt hat: Der Betreff der Neue-Anfrage-Mail nennt eine Behandlung nur noch, wenn sie genau im Katalog der Praxis steht (H2). Vorher konnte ein Patientenname im Betreff landen.

## Bekannte Grenzen (bewusst so, kein Fehler)

- Ohne Worker kommt die Glocke "Reaktionszeit überschritten" einmal am Morgen, nicht stündlich. In der Anfragenliste ist der Stand immer aktuell.
- Bewertungsmails an Patienten: Bricht der Server genau zwischen Markieren und Versand ab, fällt diese eine Mail aus (anders als die Neue-Anfrage-Mail, die nachgeholt wird).
- Seltener Doppelversand: Stürzt der Server nach der Annahme durch Resend und vor dem Vermerk ab und liegt der Nachholer über 24 h später, kann eine Neue-Anfrage-Mail doppelt kommen. Lieber doppelt als verloren.
- Geht die Neue-Anfrage-Mail an den Inhaber durch und an den Empfang nicht (oder umgekehrt), gilt sie als zugestellt; der fehlgeschlagene Empfänger wird nicht nachgeholt, nur geloggt. Das war schon vorher so.
- Telefonnummern im CSV erscheinen in LibreOffice nur als Text, wenn beim Import "Formeln auswerten" an ist; in Excel immer.
- Fortschritt zählt die Wochen ("Sie sind in Woche N") ab dem Anlegen des Plans, nicht ab der Unterschrift: Das Unterschriftsdatum ist für die Praxis-Rolle aus Datenschutzgründen nicht lesbar. Bei normalem Onboarding liegen beide Tage nah beieinander.
- Knöpfe mit Rückfrage (Löschen, Trennen, Zurückziehen) sind ausgegraut, bis die Seite fertig geladen ist. Vorher hätte ein schneller Klick ohne Rückfrage ausgelöst.
- Plaketten außerhalb der Anfragen behalten farbige Schrift auf zarter Farbfläche (rund 160 Stellen). In den Anfragen ist die Schrift dunkel.
- "No-Show-Quote" bleibt als Wort, weil der Vertriebsleitfaden denselben Begriff nutzt.
- Die Demo-Praxis steht auf Garantie-Uhr und Rückruf-Lage weiter in der Liste (zum Ausprobieren), ganz unten und als "Demo, zählt nicht mit" markiert. In keinem Zähler.
- Meta: Fehlt nach Metas aktueller Doku außer `pages_manage_metadata` noch `pages_read_engagement` oder `pages_manage_ads`, scheitert erst das Lesen der Anfrage. Vor der App-Prüfung in Metas Doku gegenprüfen (`fixes/FX-DECISIONS.md` E6b).
- Alle Zeiten sind auf dem lokalen Entwicklungsserver gemessen. Auf Neon kommt Netzlaufzeit dazu; die Admin-Seiten sind noch nicht auf einem Produktions-Build gemessen.

## Design (umgesetzt am 08.10.)

Details in `DESIGN-CRITIQUE.md` (Kritik) und `DESIGN-UMSETZUNG.md` (Plan). Umgesetzt in fünf Paketen und einer Nachbesserung:
1. Etiketten in normaler Schreibweise, dunkel und lesbar statt klein, grau und in Großbuchstaben.
2. KI-Bewertung mit Skala ("32 von 100, geringe Passung") und Erklärung; sie entscheidet nie, ob eine Anfrage zählt.
3. Kürzere Seitenleiste, Frist zur Kontaktaufnahme in jeder Anfrage sichtbar, Anrufen am Handy mit einem Tipp.
4. Admin-Startseite zeigt die Garantie-Lage ("Tag X von 90") auch beim organischen Start; gefährliche Knöpfe sind rot und fragen vorher.
5. Tabellen am Handy ohne seitliches Scrollen der Seite, Leerzustände erklären, wann sich eine Seite füllt.
6. Fortschritt: ein geplanter Schritt mit vergangenem Datum heißt "Geplant seit <Datum>".

## Für die andere Sitzung (PVS, Wiederbehandlungen)

Liste in `HANDOFF-ANDERE-SITZUNG.md`: unter anderem PVS-CSV-Dateien nach Verarbeitung löschen, Fehler-Logs ohne Patientendaten, Wiederbehandlungs-Erinnerung ohne Worker.

## Schlussprüfung

Zuletzt am 08.10. nach Design-Umsetzung und Ihren Entscheidungen auf dem lokalen Stand gelaufen:

| Prüfung | Ergebnis |
|---|---|
| Typprüfung Portal, Bausteine (`packages/ui`) und Zielseiten | fehlerfrei |
| Ganze Testsuite Portal | 1.319 Tests grün |
| Datenbank-Tests gegen die lokale Datenbank | 11 Dateien, 20 Tests grün (neu: Test als Spam, CSV-Import ohne Worker, Meta-Seitenauswahl) |
| Produktions-Build Portal | grün, 93 Seiten |
| Produktions-Build Zielseiten | grün |
| Durchlauf aller Routen mit 4 Nutzern | 144 ok, 0 Fehler; die Anfrage einer fremden Praxis bleibt gesperrt |
| Sichtprüfung Design (VD1, VD2, VD3) | Praxis-Seiten bestätigt, die zwei letzten Handy-Fehler (Archivieren-Knöpfe, Dashboard-Tabellen) danach behoben und live nachgemessen |
| Abschluss-Gegenprüfung vom 07.10. (VF1 Sicherheit, VF2 Oberfläche) | je 20 bestätigt, 0 widerlegt |

Nicht im Bild geprüft: die Admin-Seiten nach der Design-Umsetzung am Handy (Startseite, Garantie-Uhr, Rückruf-Lage). Der Prüfer war dort nicht angemeldet und rät keine Passwörter. Der Code ist geprüft und gebaut; ein Blick von Ihnen am Handy auf `/admin` reicht.

Lokaler Produktions-Build: Das Portal bricht ohne `DATABASE_URL_APP` ab (gewollt). In `.env.local` fehlt die Variable; der Build lief mit einem nur für diesen Prozess gesetzten Wert. Auf Vercel muss sie gesetzt sein (A 4a).

## Wo was liegt

`README.md` (Ablauf, Wiederaufnahme), `LEDGER.md` (Stand je Paket), `findings/` (Rohbefunde), `fixes/` (was je Paket geändert wurde), `verify/` (Gegenprüfung, VD1-VD3 Sichtprüfung Design), `DECISIONS.md` (Ihre Entscheidungen, Pflicht vor Deploy), `DESIGN-CRITIQUE.md`, `HANDOFF-ANDERE-SITZUNG.md`.
