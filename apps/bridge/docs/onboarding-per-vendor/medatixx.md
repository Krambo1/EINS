# medatixx (x.isynet / x.concept / x.comfort): EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand auf
einem laufenden medatixx-Server: ca. 45 Minuten.

## Voraussetzungen

1. medatixx ist installiert (egal welche der drei Varianten); der
   Firebird-Dienst laeuft als Windows-Service (`Firebird Server -
   DefaultInstance`).
2. AVV (Auftragsverarbeitungsvertrag) zwischen Praxis und EINS
   GmbH unterschrieben. Vorlage: `apps/bridge/legal/AVV-template-DE.md`.
3. Read-only Firebird-Konto bereitgestellt. Praxis-IT legt den Nutzer
   einmalig per `isql -user SYSDBA` an:

   ```sql
   CREATE USER eins_readonly PASSWORD '<starkes-passwort>';
   GRANT SELECT ON PAT  TO eins_readonly;
   GRANT SELECT ON TER  TO eins_readonly;
   GRANT SELECT ON BEH  TO eins_readonly;
   GRANT SELECT ON RECH TO eins_readonly;
   GRANT SELECT ON WV   TO eins_readonly;
   COMMIT;
   ```

   Falls die Tabellennamen in der vorliegenden Installation abweichen
   (z. B. `PATIENT` statt `PAT`), wird die Schema-Drift-Erkennung beim
   ersten Polling den Hinweis liefern; dann die YAML-Konfiguration
   anpassen und Agent neu starten.

## Installation

1. EINS-Agent herunterladen (Windows-Binary, ca. 14 MB):
   `https://portal.eins.ag/pvs-bridge/agent/eins-agent-win.exe`

2. Im EINS-Portal: Einstellungen, Integrationen, PVS, "Neuen Agent
   verbinden". Token notieren; 24 h gueltig.

3. In einer Admin-PowerShell auf dem Praxis-Server:

   ```powershell
   .\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
   ```

4. medatixx-Adapter aktivieren. Den absoluten Pfad zur Firebird-Datei
   bereithalten (Standard: `C:\Program Files (x86)\medatixx\daten\PRAXIS.FDB`).

   ```powershell
   .\eins-agent-win.exe --enable-db-adapter medatixx-db `
     --db-host 127.0.0.1 `
     --db-port 3050 `
     --db-database "C:\Program Files (x86)\medatixx\daten\PRAXIS.FDB" `
     --db-username eins_readonly
   ```

   Das Passwort wird interaktiv abgefragt und sofort in der Windows
   Credential Vault verschluesselt; nie in einer Datei.

5. Agent als Windows-Dienst einrichten (laeuft im Hintergrund, startet
   beim System-Boot):

   ```powershell
   .\eins-agent-win.exe --install-service
   ```

## Sanity-Check

Im EINS-Portal unter Einstellungen, Integrationen, PVS sollte innerhalb
weniger Minuten der Status `verbunden` und die ersten Events
auftauchen. Einen Test-Termin in medatixx anlegen; das Event
`AppointmentCreated` muss spaetestens nach 90 Sekunden im PVS-Live-Log
sichtbar sein.

## Schema-Discovery (einmalig empfohlen)

medatixx-Installationen koennen leicht abweichende Spaltennamen haben,
besonders bei aelteren x.isynet-Versionen. Der Agent vergleicht die
beim ersten Poll zurueckgegebenen Spalten mit der YAML-Deklaration und
meldet `schema_drift` im EINS-Portal unter
**Einstellungen, Integrationen, PVS** (Warnkarte "PVS-Verbindung
benoetigt Aufmerksamkeit"), falls etwas nicht passt. Loesung: in
`apps/bridge/agent/src/db-adapters/configs/medatixx.yaml` die
betroffene Spalte umbenennen und Agent neu starten. Vollstaendige
Schritt-fuer-Schritt-Anleitung: `apps/bridge/docs/troubleshooting.md`
Abschnitt 6.

## Datenbank-Lasthinweis

Der Agent liest mit Batch-Groesse 500 und einem Standardintervall von
90 Sekunden. Auf einer aktiven medatixx-Installation entspricht das
weniger als 0,1% der normalen Praxis-Last. Falls die IT trotzdem
Bedenken hat, kann die Frequenz pro Stream im YAML mit `intervalSeconds`
erhoeht werden (z. B. 300 Sekunden fuer alle Streams).
