# Tomedo: EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand auf
einem laufenden Tomedo-Server: ca. 30 Minuten.

## Voraussetzungen

1. Tomedo-Server ist installiert und laeuft.
2. Praxis hat einen AVV (Auftragsverarbeitungsvertrag) mit EINS
   GmbH unterschrieben. Vorlage: `apps/bridge/legal/AVV-template-DE.md`.
3. Read-only Postgres-Konto bei Zollsoft beantragt. So geht das:
   * Support-Ticket an `support@zollsoft.de` mit Betreff:
     "Read-only DB-Konto fuer EINS-Bridge: AVV vorhanden".
   * Bezug: Toni Ringling (Zollsoft 3rd-Level-Support) bestaetigte am
     2026-05-XX im offiziellen Tomedo-Forum: "Die Moeglichkeit, ein
     read-only-Konto fuer die Datenbank einzurichten, bieten wir
     grundsaetzlich an."
   * Zollsoft liefert per Antwort: Host (in der Regel `localhost`),
     Port (Standard 5432), Datenbankname, Username, Passwort.

## Installation

1. EINS-Agent herunterladen (macOS-Binary, ca. 12 MB):
   `https://portal.eins.ag/pvs-bridge/agent/eins-agent-macos`

2. Im EINS-Portal: Einstellungen → Integrationen → PVS → "Neuen Agent
   verbinden". Token notieren; ist 24 h gueltig.

3. Im Terminal auf dem Mac, der den Tomedo-Server haellt:

   ```bash
   chmod +x eins-agent-macos
   ./eins-agent-macos --enroll <token> --clinic <praxis-uuid>
   ```

4. Den Tomedo-Datenbank-Adapter aktivieren:

   ```bash
   ./eins-agent-macos --enable-db-adapter tomedo-db \
     --db-host 127.0.0.1 \
     --db-port 5432 \
     --db-database tomedo \
     --db-username eins_readonly
   ```

   Das Passwort wird interaktiv abgefragt und sofort in Apple Keychain
   verschluesselt; es landet nie in einer Datei.

5. Den Agent als macOS LaunchDaemon einrichten (laufender Hintergrund-
   prozess, startet beim System-Boot). Vorlage liegt unter
   `/usr/local/etc/eins-agent/com.eins.agent.plist`. Aktivierung:

   ```bash
   sudo launchctl load -w /Library/LaunchDaemons/com.eins.agent.plist
   ```

## Sanity-Check

Im EINS-Portal sollte unter Einstellungen → Integrationen → PVS innerhalb
weniger Minuten der Status `verbunden` und die ersten ein-zwei Events
auftauchen. Einen Test-Termin im Tomedo anlegen; das Event
`AppointmentCreated` muss spaetestens nach 60 Sekunden im PVS-Live-Log
sichtbar sein.

## Schema-Discovery (optional, einmalig)

Manche Tomedo-Installationen verwenden leicht andere Spaltennamen
(`telefon_mobil` vs. `mobil`, `recall` vs. `wiedervorlage`). Der Agent
erkennt das automatisch beim ersten Poll und meldet einen
`schema_drift`-Hinweis im EINS-Portal unter
**Einstellungen, Integrationen, PVS** (Warnkarte "PVS-Verbindung
benoetigt Aufmerksamkeit"). Loesung: in
`apps/bridge/agent/src/db-adapters/configs/tomedo.yaml` die betroffene
Spalte umbenennen und den Agent neu starten. Die Drift-Erkennung
schuetzt davor, dass ein vermeintliches Schema-Match leise leere Events
sendet. Schritt-fuer-Schritt-Anleitung: `apps/bridge/docs/troubleshooting.md`
Abschnitt 6.

## Lua-Skripte (defense in depth)

Optional, dringend empfohlen: zusaetzlich die Tomedo-Lua-Hooks
installieren. Dann gibt es zwei unabhaengige Pfade, die jeweils Events
emittieren; faellt einer aus, bleibt der andere lebendig. Bundle und
Anleitung:
`/pvs-bridge/tomedo-lua/` im EINS-Portal-Download-Bereich (im Repo:
`apps/portal/public/pvs-bridge/tomedo-lua/`).
