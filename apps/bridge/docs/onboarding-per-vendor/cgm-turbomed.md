# CGM TURBOMED: EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand auf
einem laufenden TURBOMED-Server: ca. 40 Minuten.

## Voraussetzungen

1. TURBOMED ist installiert; der Firebird-Dienst laeuft als
   Windows-Service (`Firebird Server - DefaultInstance` und
   `Firebird Guardian - DefaultInstance`).
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Read-only Firebird-Konto:

   ```sql
   CREATE USER eins_readonly PASSWORD '<starkes-passwort>';
   GRANT SELECT ON PATIENT       TO eins_readonly;
   GRANT SELECT ON TERMIN        TO eins_readonly;
   GRANT SELECT ON BEHANDLUNG    TO eins_readonly;
   GRANT SELECT ON RECHNUNG      TO eins_readonly;
   GRANT SELECT ON WIEDERVORLAGE TO eins_readonly;
   COMMIT;
   ```

## Installation

1. EINS-Agent herunterladen (Windows-Binary):
   `https://portal.eins.ag/pvs-bridge/agent/eins-agent-win.exe`

2. EINS-Portal, Token holen.

3. Admin-PowerShell auf dem Praxis-Server:

   ```powershell
   .\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
   .\eins-agent-win.exe --enable-db-adapter cgm-turbomed-db `
     --db-host 127.0.0.1 `
     --db-port 3050 `
     --db-database "C:\Program Files (x86)\CGM\TURBOMED\Datenbank\TURBOMED.FDB" `
     --db-username eins_readonly
   .\eins-agent-win.exe --install-service
   ```

   Passwort interaktiv eingeben; Windows Credential Vault.

## Sanity-Check

Status `verbunden` im Portal. Test-Termin im TURBOMED anlegen; Event
`AppointmentCreated` spaetestens nach 90 Sekunden im PVS-Live-Log.

## Schema-Discovery

Wie bei medatixx: falls die Installation abweichende Spaltennamen hat,
meldet der Agent automatisch `schema_drift`. YAML anpassen in
`apps/bridge/agent/src/db-adapters/configs/cgm-turbomed.yaml`.

## Hinweis zu Legacy-Stores

Aeltere TURBOMED-Installationen haben noch eine FastObjects-Datenbank
fuer historische Daten. Die wird vom Agent NICHT angefasst; der Agent
liest ausschliesslich aus dem Firebird-Hauptstore. Der CGM-Praxisarchiv
(SQL Express) liegt ebenfalls ausserhalb des Scopes; binaere Anhaenge
gehen nicht in das EINS-Portal.
