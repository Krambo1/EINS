# CGM M1 PRO: EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand auf
einem M1 PRO-Server: ca. 30 Minuten.

## Vor dem Start: Datenbank-Variante pruefen

M1 PRO laeuft entweder auf Oracle (historisch die Mehrheit der
Installationen, weiterhin die Standard-Variante laut CGM SystemHaus)
oder auf Microsoft SQL Server (neuere Deployments). Beide werden vom
Standard-Agent-Build unterstuetzt; gewaehlt wird ueber den
`--enable-db-adapter`-Parameter.

Variante pruefen: In M1 PRO oben rechts auf Hilfe, Info; in der
Datenbank-Zeile steht entweder "Oracle" oder "SQL Server".

* **Oracle-Variante:** weiter mit Abschnitt "Voraussetzungen (Oracle-
  Variante)" unten.
* **SQL-Server-Variante:** Abschnitt "Voraussetzungen (SQL-Server-
  Variante)" verwenden.

## Voraussetzungen (Oracle-Variante)

1. CGM M1 PRO ist installiert; Oracle-Listener laeuft auf dem
   Praxis-Server (Standard-Port 1521).
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Read-only Oracle-Konto:

   ```sql
   -- als SYS oder ein Schema-Owner ausfuehren
   CREATE USER eins_readonly IDENTIFIED BY "<starkes-passwort>";
   GRANT CREATE SESSION TO eins_readonly;
   GRANT SELECT ON m1pro_owner.patient        TO eins_readonly;
   GRANT SELECT ON m1pro_owner.termin         TO eins_readonly;
   GRANT SELECT ON m1pro_owner.behandlung     TO eins_readonly;
   GRANT SELECT ON m1pro_owner.rechnung       TO eins_readonly;
   GRANT SELECT ON m1pro_owner.wiedervorlage  TO eins_readonly;

   -- damit unqualifizierte Tabellennamen im YAML aufgeloest werden:
   CREATE OR REPLACE TRIGGER set_default_schema
     AFTER LOGON ON eins_readonly.SCHEMA
   BEGIN
     EXECUTE IMMEDIATE 'ALTER SESSION SET CURRENT_SCHEMA = m1pro_owner';
   END;
   /
   ```

   Den tatsaechlichen Schema-Owner-Namen erfaehrt man ueber
   `SELECT owner FROM all_tables WHERE table_name = 'PATIENT';` als
   System-Account.

## Installation (Oracle-Variante)

```powershell
.\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
.\eins-agent-win.exe --enable-db-adapter cgm-m1pro-oracle-db `
  --db-host 127.0.0.1 `
  --db-port 1521 `
  --db-database M1PRO `
  --db-username eins_readonly
.\eins-agent-win.exe --install-service
```

`--db-database` ist der Oracle-**Service-Name** (per Easy Connect). Bei
Bedarf `lsnrctl status` am Praxis-Server ausfuehren, um den realen
Namen zu lesen. Bei bespoken TNS-Aliasen die volle Connect-Descriptor-
Form in `connection.options.connectString` der YAML pflegen.

Wire-Library: `oracledb` v6+ im Thin Mode (Default, kein Oracle Instant
Client noetig). Unterstuetzt Oracle 12.1 und neuer (12c, 18c, 19c,
21c, 23ai). Bei alten 11g-Installationen: Karam pingen, wir bauen eine
Thick-Mode-Variante mit Instant Client als Sidecar.

## Voraussetzungen (SQL-Server-Variante)

1. CGM M1 PRO ist installiert; SQL Server Dienst laeuft auf dem
   Praxis-Server (Standard-Instanz auf Port 1433).
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Read-only SQL-Server-Konto:

   ```sql
   USE M1PRO;
   CREATE LOGIN eins_readonly WITH PASSWORD = '<starkes-passwort>';
   CREATE USER eins_readonly FOR LOGIN eins_readonly;
   GRANT SELECT ON dbo.Patient        TO eins_readonly;
   GRANT SELECT ON dbo.Termin         TO eins_readonly;
   GRANT SELECT ON dbo.Behandlung     TO eins_readonly;
   GRANT SELECT ON dbo.Rechnung       TO eins_readonly;
   GRANT SELECT ON dbo.Wiedervorlage  TO eins_readonly;
   ```

## Installation

```powershell
.\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
.\eins-agent-win.exe --enable-db-adapter cgm-m1pro-db `
  --db-host 127.0.0.1 `
  --db-port 1433 `
  --db-database M1PRO `
  --db-username eins_readonly
.\eins-agent-win.exe --install-service
```

Passwort interaktiv eingeben; Windows Credential Vault.

## Sanity-Check

Status `verbunden` im Portal. Test-Termin im M1 PRO anlegen; Event
`AppointmentCreated` spaetestens nach 60 Sekunden sichtbar.

## Schema-Discovery

Wie bei den anderen Vendors. Bei abweichenden Spaltennamen meldet der
Agent `schema_drift`; je nach Variante die passende YAML anpassen:

* Oracle: `apps/bridge/agent/src/db-adapters/configs/cgm-m1pro-oracle.yaml`
* SQL Server: `apps/bridge/agent/src/db-adapters/configs/cgm-m1pro.yaml`

## TLS / Zertifikate

SQL Server in Praxis-LANs hat selten ein offizielles Zertifikat. Der
Agent akzeptiert standardmaessig das Server-Zertifikat (Option
`trustServerCertificate: true` in der YAML). Da der Datenverkehr das
LAN nicht verlaesst, ist das Risiko vernachlaessigbar.
