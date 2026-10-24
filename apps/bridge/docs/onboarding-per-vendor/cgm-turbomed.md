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

Befehle in einer PowerShell als Administrator, im Agent-Ordner (mit `eins-agent.cmd`; es gibt keinen Installer, siehe `medatixx.md`, Abschnitt Installation). Token besser per `echo <token> | .\eins-agent.cmd --enroll --token-stdin --clinic <praxis-uuid>` uebergeben. Nach `--enable-db-adapter` mit `.\eins-agent.cmd --probe-db-adapter <vendor>` das Schema pruefen (Exit 0 = alles gefunden). `--install-service` legt die geplante Aufgabe `EINS-Agent` an (SYSTEM, startet beim Hochfahren); als der Windows-Benutzer ausfuehren, der die Einrichtung gemacht hat.

1. Agent-Ordner vom EINS-Team erhalten (siehe Hinweis oben).

2. EINS-Portal, Token holen.

3. PowerShell als Administrator auf dem Praxis-Server:

   ```powershell
   .\eins-agent.cmd --enroll <token> --clinic <praxis-uuid>
   .\eins-agent.cmd --enable-db-adapter cgm-turbomed-db `
     --db-host 127.0.0.1 `
     --db-port 3050 `
     --db-database "C:\Program Files (x86)\CGM\TURBOMED\Datenbank\TURBOMED.FDB" `
     --db-username eins_readonly
   .\eins-agent.cmd --install-service
   ```

   Passwort interaktiv eingeben; Windows DPAPI (Datenordner `%ProgramData%\EINS-Agent`).

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
