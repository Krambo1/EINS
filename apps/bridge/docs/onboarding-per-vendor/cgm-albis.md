# CGM ALBIS: EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand auf
einem laufenden ALBIS-Server (Postgres-basiert, ab Update 26 / 2022):
ca. 30 Minuten.

## Voraussetzungen

1. ALBIS-Server ist installiert und in der Postgres-Variante (Update 26
   oder neuer; vor 2022 lief ALBIS auf einem anderen Store, der
   inzwischen EOL ist). Im ALBIS-Hauptmenue Hilfe, Info: die
   Datenbank-Version sollte `PostgreSQL` zeigen.
2. AVV (Auftragsverarbeitungsvertrag) zwischen Praxis und EINS
   GmbH unterschrieben. Vorlage: `apps/bridge/legal/AVV-template-DE.md`.
3. Read-only Postgres-Konto. Praxis-IT (oder CGM-Support) legt das
   einmalig an:

   ```sql
   CREATE USER eins_readonly WITH PASSWORD '<starkes-passwort>';
   GRANT CONNECT ON DATABASE albis TO eins_readonly;
   GRANT USAGE ON SCHEMA public TO eins_readonly;
   GRANT SELECT ON patient,
                   termin_praxistimer,
                   karteieintrag,
                   rechnung,
                   wiedervorlage
                TO eins_readonly;
   ```

## Installation

1. EINS-Agent herunterladen (Windows-Binary, ca. 14 MB):
   `https://portal.eins.ag/pvs-bridge/agent/eins-agent-win.exe`

2. Im EINS-Portal: Einstellungen, Integrationen, PVS, "Neuen Agent
   verbinden". Token notieren; 24 h gueltig.

3. In einer Admin-PowerShell auf dem Praxis-Server:

   ```powershell
   .\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
   ```

4. ALBIS-Adapter aktivieren:

   ```powershell
   .\eins-agent-win.exe --enable-db-adapter cgm-albis-db `
     --db-host 127.0.0.1 `
     --db-port 5432 `
     --db-database albis `
     --db-username eins_readonly
   ```

   Passwort interaktiv eingeben; sofort in Windows Credential Vault
   verschluesselt, nie in einer Datei.

5. Agent als Windows-Dienst:

   ```powershell
   .\eins-agent-win.exe --install-service
   ```

## Sanity-Check

Im EINS-Portal: Status `verbunden` innerhalb weniger Minuten. Einen
Test-Termin im ALBIS-Praxistimer anlegen; das Event `AppointmentCreated`
ist spaetestens nach 60 Sekunden im PVS-Live-Log sichtbar.

## Schema-Discovery (einmalig)

ALBIS-Installationen koennen je nach Migrationszeitpunkt leicht
abweichende Spaltennamen haben (z. B. `notiz` vs. `bemerkung`). Der
Agent erkennt das automatisch und meldet `schema_drift` im EINS-Portal
unter **Einstellungen, Integrationen, PVS** (Warnkarte
"PVS-Verbindung benoetigt Aufmerksamkeit"). Loesung: in
`apps/bridge/agent/src/db-adapters/configs/cgm-albis.yaml` die
betroffene Spalte umbenennen und Agent neu starten. Vollstaendige
Schritt-fuer-Schritt-Anleitung: `apps/bridge/docs/troubleshooting.md`
Abschnitt 6.

## Hinweis fuer Pre-2022-Installationen

ALBIS-Installationen, die noch nicht auf Postgres migriert wurden,
muessen den GDT-Agent-Pfad verwenden (siehe `apps/bridge/README.md`).
Wir empfehlen vorab das CGM-Update auf >= Update 26 einzuspielen; das
verbessert auch die ALBIS-eigene Datensicherheit.
