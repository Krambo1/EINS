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

Alle Befehle in einer Eingabeaufforderung **als Administrator**, im
Agent-Ordner (enthaelt `eins-agent.cmd`). Es gibt keinen Installer: EINS
stellt den Ordner bereit, er wird z. B. nach `C:\Program Files\EINS-Agent`
kopiert (nicht in ein Benutzerprofil). Ein Node-20-`node.exe` liegt neben
`eins-agent.cmd`.

1. Im EINS-Portal: Einstellungen, Integrationen, PVS, "Neuen Agent
   verbinden". Token notieren; 24 h gueltig.

2. Einrichten (Token ueber stdin, nicht als Argument):

   ```
   echo <token> | eins-agent --enroll --token-stdin --clinic <praxis-uuid>
   ```

3. medatixx-Adapter aktivieren. Den absoluten Pfad zur Firebird-Datei
   bereithalten (Standard: `C:\Program Files (x86)\medatixx\daten\PRAXIS.FDB`).

   ```
   eins-agent --enable-db-adapter medatixx-db --db-host 127.0.0.1 --db-port 3050 --db-database "C:\Program Files (x86)\medatixx\daten\PRAXIS.FDB" --db-username eins_readonly
   ```

   Das Passwort wird interaktiv abgefragt und verschluesselt (Windows DPAPI)
   im Datenordner `%ProgramData%\EINS-Agent` abgelegt; nie im Klartext.

4. Schema pruefen (nur lesend, Pflicht auf dem ersten echten Praxis-PC):

   ```
   eins-agent --probe-db-adapter medatixx-db
   ```

   Exit-Code 0: alle Tabellen und Spalten gefunden. 1: Abweichungen, der
   Bericht nennt fehlende Tabellen und Spalten mit aehnlichen Namen. 2: die
   Pruefung ist fehlgeschlagen. Die mitgelieferte YAML ist ein geratenes
   Schema und darf erst nach einem sauberen Lauf als verlaesslich gelten.

5. Agent als Dienst einrichten (geplante Aufgabe `EINS-Agent`, laeuft als
   SYSTEM, startet beim Hochfahren, ohne Anmeldung). Als der Windows-Benutzer
   ausfuehren, der die Einrichtung gemacht hat; der Befehl uebernimmt dabei
   Daten aus `%APPDATA%\EINS-Agent`:

   ```
   eins-agent --install-service
   ```

   Pruefen: `eins-agent --service-status`. Entfernen:
   `eins-agent --uninstall-service`. Log:
   `%ProgramData%\EINS-Agent\logsgent.log`.

## Sanity-Check

Im EINS-Portal unter Einstellungen, Integrationen, PVS sollte innerhalb
weniger Minuten der Status `verbunden` und die ersten Events
auftauchen. Einen Test-Termin in medatixx anlegen; das Event
`AppointmentCreated` muss spaetestens nach 90 Sekunden im PVS-Live-Log
sichtbar sein.

## Schema-Abweichungen

medatixx-Installationen koennen leicht abweichende Spaltennamen haben,
besonders bei aelteren x.isynet-Versionen. Der Agent vergleicht die
beim ersten Poll zurueckgegebenen Spalten mit der YAML-Deklaration und
meldet `schema_drift` im EINS-Portal unter
**Einstellungen, Integrationen, PVS** (Warnkarte "PVS-Verbindung
benoetigt Aufmerksamkeit"), falls etwas nicht passt. Loesung: mit
`--probe-db-adapter medatixx-db` die Abweichung ansehen, in
`apps/bridge/agent/src/db-adapters/configs/medatixx.yaml` die
betroffene Spalte umbenennen und Agent neu starten. Vollstaendige
Schritt-fuer-Schritt-Anleitung: `apps/bridge/docs/troubleshooting.md`
Abschnitt 6.

## GDT und Honorar-Export (zusaetzlich oder statt Datenbank)

GDT liefert nur Patienten-Stammdaten, nie Rechnungen. Einrichtung:
`apps/bridge/agent/docs/SETUP-MEDATIXX.md`. Umsatz kommt aus der
Datenbank (`RECH`) oder aus dem Honorar-CSV-Export (`--honorar-folder`).
Ordner auf anderen Rechnern als UNC-Pfad angeben (`\serverreigabe\...`),
nicht als Netzlaufwerk-Buchstabe: der Dienst laeuft als SYSTEM.

## Datenbank-Lasthinweis

Der Agent liest mit Batch-Groesse 500 und einem Standardintervall von
90 Sekunden. Auf einer aktiven medatixx-Installation entspricht das
weniger als 0,1% der normalen Praxis-Last. Falls die IT trotzdem
Bedenken hat, kann die Frequenz pro Stream im YAML mit `intervalSeconds`
erhoeht werden (z. B. 300 Sekunden fuer alle Streams).
