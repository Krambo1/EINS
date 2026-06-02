# medatixx mit EINS verbinden (GDT-Agent)

Diese Anleitung richtet sich an Praxisinhaber:innen und Praxis-IT, die eine
medatixx-Installation (auch psyx oder x.isynet) mit dem EINS-Portal
verbinden wollen.

Die native medatixx-HealthHub-Schnittstelle ist für EINS nicht verfügbar
(Partner-Antrag abgelehnt). Stattdessen nutzen wir den medatixx-internen
**GDT-Export** und den **EINS-Agent**, einen kleinen Hintergrund-Dienst,
der auf dem Praxis-PC läuft.

Geschätzte Dauer: rund 20 Minuten.

---

## Voraussetzungen

- Eine laufende medatixx-Installation (lokale Praxisversion oder
  medatixx.cloud)
- Ein Praxis-PC, der **dauerhaft** läuft (sonst keine kontinuierliche
  Daten-Übertragung). Server, Empfangs-Rechner oder dedizierter Mini-PC
  sind typisch
- Admin-Rechte auf diesem PC (für die Installation des Agents als
  Windows-Dienst beziehungsweise macOS-LaunchAgent)
- Ein Inhaber-Login im EINS-Portal (für das Generieren des
  Einrichtungs-Codes)

---

## Schritt 1: GDT-Ordner anlegen

Auf dem Praxis-PC einen Ordner anlegen, in den medatixx die GDT-Dateien
schreibt und aus dem der Agent sie liest.

- **Windows:** `C:\EINS\gdt\`
- **macOS:** `~/EINS/gdt/`

Berechtigungen:

- Der medatixx-Benutzer (meist der eingeloggte Windows-User) muss in den
  Ordner schreiben dürfen
- Der Agent-Dienst (läuft unter LocalSystem beziehungsweise dem
  angemeldeten macOS-User) muss aus dem Ordner lesen dürfen

In den meisten Praxis-Setups reicht die Standard-NTFS-Berechtigung.
Wenn medatixx auf einem anderen Rechner läuft als der EINS-Agent, den
Ordner als Netzwerk-Share freigeben und beide Pfade gleich verwenden.

---

## Schritt 2: GDT-Export in medatixx konfigurieren

Pfad in medatixx:

```
Administration → Praxisorganisation → Schnittstellen → GDT-Geräteanbindung
```

> Der exakte Menü-Pfad kann je nach medatixx-Version leicht variieren.
> Screenshots ergänzen wir nach Abnahme einer Test-Praxis. Bei Unsicherheit
> hilft die medatixx-Support-Suche nach "GDT-Geräteanbindung einrichten".

Neue Geräteanbindung anlegen:

| Feld | Wert |
| --- | --- |
| Gerätename | `EINS-Portal` |
| GDT-Importpfad | leer lassen (wir importieren nichts nach medatixx) |
| GDT-Exportpfad | der Ordner aus Schritt 1 (z.B. `C:\EINS\gdt\`) |
| Zeichensatz | `ISO-8859-15` (medatixx-Standard); der Agent erkennt UTF-8 ebenfalls automatisch |
| Dateiname-Schema | medatixx-Standard belassen |

Satzarten aktivieren, die gesendet werden sollen:

- **6301:** Patientendaten an PVS senden (für Stammdaten-Sync)
- **8316:** Behandlungsdaten inkl. Patienten (für Termin- und
  Behandlungsverlauf)
- **6200:** Befund / Behandlungsdaten (optional, wenn medatixx getrennte
  Befund-Exporte schreibt)

Speichern und in medatixx einmal einen Test-Patienten exportieren. Im
Ordner aus Schritt 1 sollte eine `.gdt`-Datei erscheinen.

---

## Schritt 3: Lead-Token-Verknüpfung einrichten

Damit das Portal automatisch erkennt, welcher medatixx-Patient zu welcher
EINS-Anfrage gehört, wird beim Anlegen des Patienten in medatixx ein Token
ins **Bemerkungsfeld** des Patienten geschrieben.

So funktioniert es:

1. Eine Anfrage kommt ins Portal. In der Anfrage-Detail-Ansicht zeigt das
   Portal den Lead-Token im Format `EINS-Lead-{8 Hex-Zeichen}`, zum
   Beispiel `EINS-Lead-a3f7b2c1`.
2. Beim Anlegen des Patienten in medatixx wird dieser Token (genau so wie
   angezeigt) in das **Bemerkungsfeld** des Patienten kopiert.
3. Sobald medatixx den Patienten via GDT exportiert, liest der Agent das
   Bemerkungsfeld mit und schickt es ans Portal. Das Portal verknüpft
   Patient und Anfrage automatisch.

Hinweise:

- Der Token funktioniert **case-insensitive**: `eins-lead-a3f7b2c1` ist
  derselbe Token
- Tolerante Trennzeichen: `EINS Lead: a3f7b2c1`, `EINSLeada3f7b2c1`,
  `EINS_Lead_a3f7b2c1` werden alle erkannt
- Der Token muss nicht alleinstehen; auch `Patientin via
  EINS-Lead-a3f7b2c1 gemeldet, Erstgespräch am 14.6.` wird sauber
  geparst
- Ohne Token funktioniert weiterhin das Fuzzy-Matching über E-Mail,
  Telefon und Name. Der Token verbessert nur die Trefferquote auf nahe
  100 Prozent

---

## Schritt 4: EINS-Agent installieren

Im Portal:

1. Einloggen als Inhaber:in
2. **Einstellungen → Integrationen → medatixx → Installation starten**
3. Einen **Einrichtungs-Code** generieren (24 Stunden gültig). Den Code
   kopieren

Auf dem Praxis-PC:

1. Den Installer herunterladen (Link auf der Setup-Seite)
   - Windows: `eins-agent-x.y.z-windows-x64.msi`
   - macOS: `eins-agent-x.y.z-macos-universal.pkg`
2. Installer ausführen
3. Im Installer-Dialog die zwei Felder ausfüllen:
   - **Einrichtungs-Code:** der Code aus dem Portal
   - **GDT-Ordner:** der Pfad aus Schritt 1 (z.B. `C:\EINS\gdt\`)
4. Installation abschließen

Der Agent läuft danach als Hintergrund-Dienst und startet bei jedem
PC-Neustart automatisch mit. Keine weitere Konfiguration nötig.

---

## Schritt 5: Verifikation

Direkt nach der Installation sollte der Agent den medatixx-Test-Export
aus Schritt 2 verarbeiten und ans Portal senden.

Im Portal prüfen:

1. **Einstellungen → Integrationen → medatixx** zeigt jetzt Status
   `Verbunden` und ein erstes `Letzter Event vor wenigen Sekunden`
2. Unter **Anfragen → einer Test-Anfrage**: wenn der Test-Patient mit
   Token-Bemerkung exportiert wurde, ist die Anfrage jetzt mit einem
   Patienten verknüpft
3. (Nur für EINS-intern) Im Admin-Dashboard `/admin/pvs-bridge` steigt
   `total_events_last_24h` für die Praxis um eins

---

## Umsatz und Rechnungen

GDT von medatixx liefert keine Rechnungs- und Honorardaten. Für die
Umsatz-Auswertung im Portal (ROAS, Umsatz pro Anfrage) gibt es einen
zweiten Weg.

**Empfohlener Weg: monatlicher CSV-Upload**

1. In medatixx unter **Statistik → Abrechnung → Export** den
   Abrechnungs-Export für den jeweiligen Monat erstellen
2. Im EINS-Portal: **Einstellungen → Integrationen → CSV-Upload**
3. Die exportierte CSV in den 3-Schritt-Wizard ziehen. Mapping geschieht
   geführt

Damit hat das Portal die kompletten Behandlungs-Umsätze und kann ROAS
und Umsatz-pro-Lead sauber pro Anfrage berechnen.

Eine Aktivierung der medatixx-Honorar-FK-Schnittstelle ist technisch
möglich, in der Praxis aber häufig support-pflichtig und für die meisten
Praxen unverhältnismäßig aufwändig. CSV ist der pragmatische Weg.

---

## Troubleshooting

### Umlaute werden falsch dargestellt (z.B. "Müller" statt "Müller")

Der Agent versucht automatisch UTF-8 zuerst, fällt auf ISO-8859-15 zurück.
Wenn medatixx einen anderen Zeichensatz schreibt:

1. In medatixx unter der GDT-Geräteanbindung den Zeichensatz auf
   `ISO-8859-15` zurücksetzen
2. Der Agent muss nicht neugestartet werden, neue Dateien werden direkt
   korrekt geparst

### Keine Events im Portal nach Installation

Agent-Log prüfen:

- Windows: `%APPDATA%\EINS-Agent\agent.log`
- macOS: `~/Library/Logs/EINS-Agent/agent.log`

Häufige Ursachen:

- Watch-Ordner-Pfad im Installer-Dialog hat sich getippt unterschieden
  vom GDT-Exportpfad in medatixx. Beide vergleichen, exakt gleich machen
- Praxis-PC oder Agent-Dienst ist gestoppt. Dienste-Manager prüfen
  (Windows: `services.msc`, Dienst-Name `EINS-Agent`)
- Internet-Zugriff vom Praxis-PC zum Portal blockiert. Firewall-Regel
  setzen: ausgehend HTTPS auf `*.eins.ag`

### Lead-Token wird nicht erkannt

- Format kontrollieren: `EINS-Lead-` plus genau **acht Hex-Zeichen**
  (0-9, a-f). Nicht weniger, nicht mehr
- Sichergehen, dass der Token wirklich im **Bemerkungs-Feld** des
  Patienten steht, nicht im Behandlungs-Bemerkungsfeld oder einer
  Karteinotiz
- Im Portal in der Anfrage-Detail-Ansicht den Token erneut kopieren
  (Kopier-Button) und in medatixx neu einsetzen. Tippfehler sind die
  häufigste Ursache

### medatixx-Update: bleibt die Konfiguration?

Ja. GDT-Geräteanbindungen sind Bestandteil der medatixx-Datenbank und
überleben Updates. Der Agent ist davon unabhängig und läuft weiter.

---

## FAQ

**medatixx hat den GDT-Export schon eingerichtet für eine andere Software.
Kann ich beides parallel laufen lassen?**

Ja. In medatixx einen zweiten GDT-Geräte-Eintrag anlegen mit einem
eigenen Exportpfad (z.B. `C:\EINS\gdt\` zusätzlich zum bestehenden
`C:\Labor\gdt\`). Beide Empfänger erhalten dann eigene Dateien.

**Brauche ich für die GDT-Aktivierung ein Support-Ticket bei medatixx?**

Nein. GDT-Geräteanbindungen sind in jeder medatixx-Lizenz Standard und
lassen sich von der Praxis selbst einrichten.

**Was passiert mit den GDT-Dateien nach dem Senden ans Portal?**

Der Agent behält sie standardmäßig 30 Tage im Ordner und löscht sie
dann. Bei Bedarf kann das per Agent-Config angepasst werden.

**Werden die Daten verschlüsselt übertragen?**

Ja. Der Agent signiert jeden POST mit einem praxis-spezifischen
HMAC-Secret und sendet ausschließlich über HTTPS ans Portal.

**Wie sieht es mit DSGVO aus?**

Der Agent verarbeitet nur Daten, die medatixx exportiert (Schritt 2 ist
die Stellschraube). Das EINS-Portal ist Auftragsverarbeiter; der
AV-Vertrag liegt im Portal unter **Einstellungen → Verträge** zur
Unterzeichnung bereit.
