# medatixx mit EINS verbinden (GDT-Agent)

Für Praxis-IT und EINS-Installer. Dauer: rund 30 Minuten. Nur Windows.

Der EINS-Agent läuft als Hintergrund-Dienst auf einem Praxis-PC. Er liest
**Patienten-Stammdaten** aus einem GDT-Ordner und meldet sie an das
EINS-Portal.

**Wichtig:** GDT enthält keine Rechnungs- oder Honorardaten. Aus GDT liest
der Agent nur Name, Vorname, Geburtsdatum, Geschlecht und, falls
vorhanden, Telefon und E-Mail. Umsatz kommt aus dem Honorar-Export
(Schritt 6) oder aus dem Datenbank-Weg (`docs/onboarding-per-vendor/medatixx.md`).

---

## Voraussetzungen

- Ein Praxis-PC, der dauerhaft läuft (Server, Empfang oder Mini-PC).
- Administrator-Rechte auf diesem PC.
- Node.js 20 (am besten als `node.exe` im Agent-Ordner) und der Agent-Ordner
  mit `eins-agent.cmd`. EINS stellt ihn bereit. Es gibt keinen Installer.
- Ein Inhaber-Login im EINS-Portal für den Einrichtungs-Code.

---

## Schritt 1: GDT-Ordner anlegen

Ordner anlegen, z.B. `C:\EINS\gdt\`.

Rechte:

- medatixx muss in den Ordner schreiben dürfen.
- Der Agent läuft als SYSTEM. SYSTEM braucht **Lesen, Schreiben und
  Löschen** im Ordner. Der Agent löscht jede Datei, die an EINS adressiert
  ist, nach dem Lesen. Das schreibt die GDT-Spezifikation so vor.
- Der Agent legt den Unterordner `.eins` an. Dateien für andere Geräte
  (EKG usw.) im selben Ordner fasst er nie an.

Liegt der Ordner auf einem anderen Rechner: Netzlaufwerk-Buchstaben
(`Z:\`) sieht SYSTEM nicht. Den UNC-Pfad verwenden
(`\\server\freigabe\gdt`). Die Freigabe muss dem Computerkonto
(`DOMÄNE\PCNAME$`) Lesen, Schreiben und Löschen erlauben.

---

## Schritt 2: EINS in medatixx als GDT-Gerät anlegen

In medatixx die GDT-Geräteanbindung öffnen (Menü-Pfad je nach Version
verschieden, meist unter Administration, Schnittstellen).

Neues Gerät anlegen:

| Feld | Wert |
| --- | --- |
| Gerätename | `EINS` |
| GDT-ID (Empfänger-ID) | `EINS` |
| Exportpfad | der Ordner aus Schritt 1 |
| Dateiname | `EINSMDX.GDT` (fester Name) oder `EINSMDX.001`, `.002` ... (zählend) |

Der Dateiname **muss mit der GDT-ID beginnen**. Statt über den Dateinamen
kann die Datei auch das Feld 8315 = `EINS` enthalten.

Satzart einstellen: medatixx soll **6301** (Stammdaten übermitteln) oder
**6302** (neue Untersuchung anfordern) senden, wenn Praxis-Mitarbeitende
bei einer Patientin oder einem Patienten das Gerät EINS auslösen. Mitzusenden:

- Patientennummer (Feld 3000). **Pflicht.** Ohne sie verwirft der Agent
  den Satz.
- Name, Vorname, Geburtsdatum, Geschlecht.
- Wenn medatixx GDT 3.x kann: 3618 Mobil, 3619 E-Mail, 3626 Telefon.

Der Zeichensatz wird automatisch erkannt. Hier ist nichts einzustellen.

Test: einen Test-Patienten an EINS senden. Es erscheint eine Datei wie
`EINSMDX.GDT` im Ordner. Der Agent nimmt sie in den nächsten Sekunden und
löscht sie. Ohne laufenden Agent bleibt sie liegen.

---

## Schritt 3: Lead-Token (optional)

GDT hat kein Bemerkungsfeld. Der Agent erkennt den Token
`EINS-Lead-xxxxxxxx` (acht Hex-Zeichen) nur, wenn medatixx ein Freitextfeld
mit dem Token im GDT-Satz mitsendet (zum Beispiel Befund oder Kommentar).
Der Token wird dann in jedem Feld des Satzes gefunden. Groß-/Kleinschreibung
und die Trennzeichen (`EINS Lead: a3f7b2c1`, `EINS_Lead_a3f7b2c1`) sind egal.
Es wird nur der Token weitergegeben, nie der Text drumherum.

Sendet medatixx kein solches Feld, bleibt es bei Name, Telefon und E-Mail.

---

## Schritt 4: Agent einrichten

Im Portal: **Einstellungen → Integrationen → medatixx**, einen
Einrichtungs-Code erzeugen (24 Stunden gültig) und die Praxis-ID notieren.

Agent-Ordner in einen Ordner nur für Administratoren legen, z.B.
`C:\Program Files\EINS-Agent`. Nicht in ein Benutzerprofil: der Dienst läuft
als SYSTEM und lehnt Orte ab, die normale Benutzer ändern können.

Eingabeaufforderung **als Administrator** öffnen:

```
cd "C:\Program Files\EINS-Agent"
echo <Einrichtungs-Code> | eins-agent --enroll --token-stdin --clinic <Praxis-ID> --folder "\\server\freigabe\gdt"
```

Optionen:

- `--folder <Pfad>`: GDT-Ordner aus Schritt 1. Ohne Angabe gilt `C:\GDT-Out`.
- `--honorar-folder <Pfad>`: Ordner für den Honorar-Export (Schritt 6).
- `--gdt-receiver-id <ID>`: nur wenn die GDT-ID nicht `EINS` sein kann.
  1 bis 8 Zeichen aus `A-Z a-z 0-9 _`. Dann muss der Dateiname in medatixx
  mit dieser ID beginnen.

---

## Schritt 5: Dienst installieren

In derselben Administrator-Eingabeaufforderung:

```
eins-agent --install-service
```

Das legt die geplante Aufgabe `EINS-Agent` an. Sie läuft als SYSTEM und
startet beim Hochfahren, ohne dass sich jemand anmelden muss. Zusätzlich
prüft Windows alle 5 Minuten, ob der Agent noch läuft, und startet ihn bei
Bedarf neu. Der Befehl wartet bis zu 60 Sekunden, ob der Agent wirklich
läuft. Meldet er danach einen Fehler, steht der Grund in
`%ProgramData%\EINS-Agent\logs\agent.log`.

Den Befehl als der Windows-Benutzer ausführen, der die Einrichtung gemacht
hat: er übernimmt dabei Daten einer älteren Einrichtung aus
`%APPDATA%\EINS-Agent`.

Läuft auf dem PC noch ein alter Agent als normales Programm, bricht der
Befehl ab und nennt den Prozess. Den alten Agent beenden und den Befehl
wiederholen. Liegen alte Daten in mehreren Benutzerprofilen, übernimmt der
Befehl nichts und listet die gefundenen Ordner auf. Dann nur den Ordner der
richtigen Praxis behalten und den Befehl als dieser Benutzer wiederholen.

Weitere Befehle: `eins-agent --service-status` (zeigt Dienst, Agent,
Datenordner und letzte Logzeilen), `eins-agent --stop-service`,
`eins-agent --start-service`, `eins-agent --uninstall-service`.

### Agent aktualisieren

Eingabeaufforderung **als Administrator**:

1. `eins-agent --stop-service`. Das deaktiviert die Aufgabe (sonst startet
   Windows sie nach 5 Minuten wieder), beendet den Agenten und wartet, bis er
   wirklich weg ist. Meldet der Befehl nach 45 Sekunden, dass der Agent noch
   läuft, im Task-Manager den Prozess `node.exe` des Agenten beenden.
2. Die Dateien im Agent-Ordner ersetzen (kompletter neuer Ordnerinhalt,
   auch `node_modules`).
3. `eins-agent --install-service` (oder `eins-agent --start-service`, wenn
   sich die Aufgabe nicht geändert hat). Beide warten, bis der Agent läuft.
4. `eins-agent --service-status` prüfen.

Konfiguration, Schlüssel und Warteschlange bleiben im Datenordner erhalten.

### Nicht gesendete Meldungen erneut versuchen

Gibt der Agent eine Meldung nach mehreren Versuchen auf, bleibt sie als
fehlgeschlagen in der Warteschlange. Nach Behebung der Ursache:
`eins-agent --requeue-failed` (optional `--reason <Code>`, zum Beispiel
`invalid_envelope`). Der Befehl nennt die Zahl der Meldungen, die wieder auf
"wartend" stehen. Er darf auch bei laufendem Agenten ausgeführt werden.

Danach den Test aus Schritt 2 wiederholen.

---

## Schritt 6: Umsatz (Honorar-Export)

GDT liefert keinen Umsatz. Für Umsatz und Werbeertrag im Portal:

1. In medatixx den Honorar-Export als **CSV-Datei** in einen eigenen
   Ordner schreiben lassen (nicht in den GDT-Ordner), z.B.
   `\\server\freigabe\honorar`.
2. Ordner beim Einrichten mit `--honorar-folder` angeben. Nachträglich:
   `eins-agent --configure-honorar "<Ordner>"`, danach den Dienst neu
   starten (`eins-agent --stop-service`, dann `eins-agent --start-service`).

Der Agent liest alle `*.csv` im Ordner, erkennt die Spalten über die
Kopfzeile und prüft den Ordner alle 5 Minuten. Er löscht die Dateien nicht.

Alternative ohne CSV: der Datenbank-Weg, siehe
`docs/onboarding-per-vendor/medatixx.md`.

---

## Prüfen

1. `eins-agent --service-status`: Dienst installiert, Agent läuft,
   Einrichtung vorhanden.
2. Im Portal unter **Einstellungen → Integrationen → medatixx**: Status
   `Verbunden`.
3. Testpatient senden: die Datei im GDT-Ordner verschwindet, der Patient
   erscheint im Portal.

---

## Fehlersuche

**Log:** `%ProgramData%\EINS-Agent\logs\agent.log` (10 MB, 5 Dateien
rotierend). Der Ordner `%ProgramData%\EINS-Agent` ist nur für SYSTEM und
Administratoren lesbar. Ohne Administrator-Rechte kein Zugriff.

**Ordner nicht gefunden oder kein Zugriff:** Der Agent schreibt beim Start
und danach stündlich den genauen Pfad und den Grund ins Log. Häufigste
Ursache: Netzlaufwerk-Buchstabe statt UNC-Pfad, oder die Freigabe erlaubt
dem Computerkonto den Zugriff nicht.

**Im Portal steht ein gestoppter Stream `gdt_agent/gdt_inbox`:** Der
GDT-Ordner ist nicht lesbar, oder eine Datei für EINS kann nicht übernommen
werden. Meist fehlt dem Konto SYSTEM das Schreib-/Löschrecht im Ordner.
Rechte setzen, der Agent versucht es selbst erneut.

**Im Portal steht ein gestoppter Stream `honorar_csv/csv_folder`:** Der
Honorar-Export ist nicht auswertbar (Spalten nicht erkannt) oder zu groß.
Das Portal zeigt die gefundenen Spaltennamen. Export in kleinere Zeiträume
teilen oder die Spaltennamen an EINS melden.

**Dateien in `<GDT-Ordner>\.eins\failed`:** Der Agent konnte die Datei nicht
lesen (kein GDT, zu groß, kein Satz). Er verschiebt sie dorthin, damit
medatixx nicht blockiert, und löscht sie nach 30 Tagen. Der Stream steht im
Portal dann auf `degraded`.

**Datei bleibt im Ordner liegen:** Sie ist nicht an EINS adressiert (Name
beginnt nicht mit der GDT-ID und kein Feld 8315 = `EINS`), oder der Agent
läuft nicht. Bei einer Datei für EINS ohne Patientennummer (3000) wird die
Datei gelöscht, aber kein Patient gemeldet. Das Log nennt es.

**Der Agent startet nicht, Exit-Code 75:** Es läuft schon ein Agent
(eine Instanz pro PC). `eins-agent --service-status` zeigt ihn.

**Anderer Datenpfad (nur Entwicklung):** `EINS_AGENT_DATA_DIR`.

**BDT-Export (`*.bdt`):** Der Agent liest ihn, löscht ihn aber nie.

---

## FAQ

**Kann ein bestehender GDT-Export für ein anderes Gerät im selben Ordner
liegen?** Ja. Der Agent fasst nur Dateien an, die an EINS adressiert sind.

**Wie werden die Daten übertragen?** Jede Meldung ist mit einem
praxis-spezifischen Schlüssel signiert und geht per HTTPS an das Portal.
Nicht gesendete Meldungen liegen verschlüsselt im Datenordner und gehen bei
der nächsten Verbindung raus.

**Welche Daten verlassen die Praxis?** Nur Patientennummer, Name,
Geburtsdatum, Geschlecht, Telefon, E-Mail und ein erkannter Lead-Token.
Adresse, Versichertennummer, Größe, Gewicht und alle Befundtexte werden
nicht übernommen.
