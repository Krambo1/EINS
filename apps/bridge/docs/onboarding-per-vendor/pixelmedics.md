# Pixelmedics (Borealys GmbH): EINS-Agent Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 5 Minuten. Setup-Aufwand:
ca. 25 Minuten.

## Wichtiger Hinweis: Engine noch nicht vendor-bestaetigt

Die EINS-Bridge geht aktuell davon aus, dass Pixelmedics einen lokalen
SQLite-Store nutzt (typisch fuer Spezial-Vendors in der Aesthetik).
Vor dem produktiven Einsatz bitte bei Borealys GmbH bestaetigen lassen,
ob:

* die Daten lokal in einer SQLite-Datei liegen (Pfad notwendig), oder
* die Daten in einem anderen Engine (Postgres, MariaDB) liegen
  (dann YAML `driver:` anpassen), oder
* der Vendor cloud-only arbeitet (dann nutzen wir den REST-Adapter-
  Pfad statt des On-Prem-Agents).

Karam (EINS) hat den direkten Vendor-Kanal; Anfrage-Vorlage
unter `apps/bridge/docs/onboarding-per-vendor/pixelmedics-vendor-inquiry.md`.
Erste Antwort genuegt, um die richtige Spur (SQLite vs. anderer Engine
vs. Cloud-REST) festzulegen.

## Voraussetzungen (SQLite-Variante)

1. Pixelmedics ist installiert; die SQLite-Datei ist auf dem
   Praxis-Server erreichbar (Standard-Pfad nach Borealys-Bestaetigung).
2. AVV unterschrieben (`apps/bridge/legal/AVV-template-DE.md`).
3. Lese-Zugriff auf die SQLite-Datei fuer den Windows-Dienst-User des
   EINS-Agents. SQLite hat kein eigenes User-System; der Schutz laeuft
   ueber Dateisystem-ACLs. Der Agent oeffnet die Datei strikt
   read-only (`fileMustExist=true`, `readonly=true`), so dass auch im
   Fehlerfall keine Schreib-Operation moeglich ist.

## Installation

```powershell
.\eins-agent-win.exe --enroll <token> --clinic <praxis-uuid>
.\eins-agent-win.exe --enable-db-adapter pixelmedics-db `
  --db-database "C:\ProgramData\Pixelmedics\store.sqlite"
.\eins-agent-win.exe --install-service
```

Bei SQLite werden Port, Username und Passwort nicht abgefragt (Datei
basiert).

## Sanity-Check

Status `verbunden` im Portal. Test-Termin in Pixelmedics anlegen; Event
`AppointmentCreated` spaetestens nach 90 Sekunden sichtbar.

## Schema-Discovery

Pixelmedics-Schema ist nicht oeffentlich; die Spaltennamen in der
ausgelieferten YAML sind Hypothesen. Schema-Drift-Erkennung greift wie
bei den anderen Vendors. Loesung: in
`apps/bridge/agent/src/db-adapters/configs/pixelmedics.yaml`
korrigieren und Agent neu starten.

## Falls cloud-only

Wenn Borealys bestaetigt, dass Pixelmedics ausschliesslich cloud-basiert
ist, wandert die Integration nach `apps/bridge/src/adapters/pixelmedics/`
(REST-Pfad analog Tomedo / Pabau). Die On-Prem-Konfiguration in
`configs/pixelmedics.yaml` wird dann gelöscht.
