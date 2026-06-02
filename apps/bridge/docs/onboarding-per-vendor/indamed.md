# INDAMED MEDICAL OFFICE: EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand:
ca. 35 Minuten.

## Voraussetzungen

1. MEDICAL OFFICE ist installiert; MariaDB-Dienst laeuft auf dem
   Praxis-Server (Standard-Port 3306). Hinweis: MEDICAL OFFICE
   verwendet zusaetzlich eine Firebird-Datenbank fuer statistische
   Auswertungen; die wird vom EINS-Agent NICHT angefasst, wir lesen
   nur den MariaDB-Core.
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Read-only MariaDB-Konto:

   ```sql
   CREATE USER 'eins_readonly'@'localhost'
     IDENTIFIED BY '<starkes-passwort>';
   GRANT SELECT ON medoff.patient       TO 'eins_readonly'@'localhost';
   GRANT SELECT ON medoff.termin        TO 'eins_readonly'@'localhost';
   GRANT SELECT ON medoff.behandlung    TO 'eins_readonly'@'localhost';
   GRANT SELECT ON medoff.rechnung      TO 'eins_readonly'@'localhost';
   GRANT SELECT ON medoff.wiedervorlage TO 'eins_readonly'@'localhost';
   FLUSH PRIVILEGES;
   ```

## Installation

```powershell
.\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
.\eins-agent-win.exe --enable-db-adapter indamed-db `
  --db-host 127.0.0.1 `
  --db-port 3306 `
  --db-database medoff `
  --db-username eins_readonly
.\eins-agent-win.exe --install-service
```

Passwort interaktiv eingeben; Windows Credential Vault.

## Sanity-Check

Status `verbunden` im Portal. Test-Termin im MEDICAL OFFICE anlegen;
Event `AppointmentCreated` spaetestens nach 60 Sekunden sichtbar.

## Schema-Discovery

Wie bei anderen Vendors: bei Spalten-Abweichungen meldet der Agent
`schema_drift`. YAML in
`apps/bridge/agent/src/db-adapters/configs/indamed.yaml` anpassen.

## Hinweis zur Firebird-Statistik-DB

Wer Statistikdaten (z. B. Quartalsstatistiken) auch ins EINS-Portal
einspeisen moechte, kann zusaetzlich eine zweite Vendor-Konfiguration
fuer die Firebird-Seite betreiben (separater `vendor:` Eintrag).
Aktuell nicht im Standard-Setup enthalten; bei Bedarf bei
support@eins.ag melden.
