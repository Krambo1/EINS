# QUINCY (FREY ADV): EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand:
ca. 40 Minuten.

## Voraussetzungen

1. QUINCY win ist installiert; der Firebird-Dienst laeuft auf dem
   Praxis-Server (Standard-Port 3050). Hinweis: vor der Datensicherung
   muessen alle QUINCY-Arbeitsplaetze QUINCY verlassen haben (FREY-
   Hausregel); der EINS-Agent ist davon NICHT betroffen, weil er
   ausschliesslich liest.
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Read-only Firebird-Konto. FREY-Support kann das einrichten, oder
   die Praxis-IT macht es selbst per `isql -user SYSDBA`:

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

```powershell
.\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
.\eins-agent-win.exe --enable-db-adapter quincy-db `
  --db-host 127.0.0.1 `
  --db-port 3050 `
  --db-database "C:\Frey\QUINCY\Daten\QUINCY.FDB" `
  --db-username eins_readonly
.\eins-agent-win.exe --install-service
```

Passwort interaktiv eingeben; Windows Credential Vault.

## Sanity-Check

Status `verbunden` im Portal. Test-Termin im QUINCY anlegen; Event
`AppointmentCreated` spaetestens nach 90 Sekunden im PVS-Live-Log.

## Schema-Discovery

QUINCY-Schema ist nicht oeffentlich dokumentiert; die Spaltennamen in
der ausgelieferten YAML sind Hypothesen. Beim ersten Poll wird der
Agent `schema_drift` melden, falls die tatsaechlichen Spaltennamen
abweichen. Loesung: in
`apps/bridge/agent/src/db-adapters/configs/quincy.yaml` Spalten
umbenennen und Agent neu starten. Die Schema-Drift-Erkennung
verhindert, dass falsche Annahmen leise leere Events erzeugen.

## Hinweis zu QScan pro (Archiv)

QScan pro speichert Bilder und Dokumente getrennt vom Hauptstore. Der
EINS-Agent liest nur den Hauptstore; binaere Anhaenge gehen nicht ins
EINS-Portal.
