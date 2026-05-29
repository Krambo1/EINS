# Pixelmedics / Borealys GmbH — Vendor Inquiry Template

Pixelmedics ist der einzige in Phase 2 verbliebene Bucket-A-Vendor, dessen
Datenbank-Engine die EINS-Bridge nicht aus oeffentlichen Quellen verifizieren
konnte (siehe `docs/section-11-verification.md`). Die `pixelmedics.yaml`
trifft eine SQLite-Annahme; der Schema-Drift-Detektor wuerde eine
abweichende Engine an der ersten Praxis lautstark detektieren, aber wir
wollen die Engine **vor** dem ersten Onboarding klaeren.

Nachfolgend eine kurze, sachliche Mail an Borealys, die alle drei
Antwortmoeglichkeiten in einem Round-Trip abdeckt. Karam fuehrt den
Kanal; nach Eingang der Antwort: yaml/driver entsprechend anpassen,
diesen Eintrag aus dem ueberbrueckenden Pixelmedics-Onboarding entfernen
und in `docs/section-11-verification.md` von "unconfirmed" auf
"verified <date>" umstellen.

## Empfaenger

* Primaer: `info@borealys.de` (Borealys GmbH allgemeine Geschaeftsadresse;
  ueber https://www.borealys.de/kontakt zu finden)
* CC, falls bekannt: technischer Ansprechpartner des Pixelmedics-Vertriebs

## Betreff

```
EINS: Integrations-Architektur Pixelmedics (Engine + Datenzugriff)
```

## Body (Deutsch)

```
Sehr geehrte Damen und Herren,

ich melde mich im Namen der EINS (Aesthetik-Marketing-Agentur,
Anfragen-/Conversions-Reporting fuer Praxen in DACH). Wir bauen einen
sogenannten EINS PVS Bridge, der den Status von Patienten-Anfragen
("Anfrage -> Termin -> Behandlung -> Rechnung") aus dem jeweils
eingesetzten Praxis-Software-System ableitet und damit den Marketing-ROI
fuer Aesthetik-Praxen exakt messbar macht. Vergleichbare Adapter haben
wir bereits fuer Tomedo (Zollsoft), medatixx, CGM Albis/Turbomed/M1 PRO,
Indamed und Quincy in Produktion bzw. in Pilot-Vorbereitung.

Eine erste Praxis, die mit Pixelmedics arbeitet, hat ihr Interesse
signalisiert. Bevor wir den finalen Adapter-Branch ausliefern, wollen
wir die Architektur sauber aufsetzen. Drei kurze Fragen:

  1. Auf welcher Datenbank-Engine speichert Pixelmedics seine
     Praxis-Daten (Patienten, Termine, Behandlungen, Rechnungen)?
     -> SQLite, PostgreSQL, MariaDB/MySQL, Firebird, MS SQL Server,
        Oracle, oder cloud-only ohne lokale DB?

  2. Falls on-prem: gibt es einen offiziellen Weg, ein read-only
     Datenbankkonto fuer einen externen, vertraglich
     auftragsverarbeitenden Dienstleister anzulegen?
     Wir arbeiten ausschliesslich mit einem schriftlich
     unterzeichneten AVV nach DSGVO Art. 28 (Vorlage liegt vor).
     Vergleichsweise hat Zollsoft fuer Tomedo dies offiziell ueber
     den 3rd-Level-Support eingerichtet (Forum-Thread #86195).

  3. Falls cloud-only / API-only: existiert eine REST-API mit
     Bearer-Token-Authentifizierung, vergleichbar mit Pabau
     (per-Praxis api_token)? Falls ja, wo finden wir die
     Schnittstellen-Dokumentation und wie wird ein Token
     ausgegeben?

Wir suchen ausdruecklich nur lesenden Zugriff auf strukturierte
Daten zur Status-Ableitung; wir schreiben nichts in das System
zurueck. Patientendaten verlassen die Praxis-Umgebung nicht (der
EINS-Agent laeuft on-prem und uebermittelt ausschliesslich
kanonisierte Status-Events, keine Volltext-Patientendaten).

Wir freuen uns auf eine kurze Rueckmeldung. Bei Bedarf gerne ein
30-Minuten-Call zur technischen Klaerung.

Mit freundlichen Gruessen,
Karam Issa
Geschaeftsfuehrer EINS
karam@einsvisuals.de
```

## Antwort-Mapping

Nach Erhalt der Antwort verzweigt sich die Bridge wie folgt:

| Borealys-Antwort                          | Code-Aenderung                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SQLite                                    | Keine Aenderung; `pixelmedics.yaml` (`driver: sqlite`) bleibt; Header-Kommentar von "Annahme" auf "bestaetigt am <Datum>" updaten. |
| PostgreSQL                                | `pixelmedics.yaml` → `driver: postgres`; `connection.port: 5432`; SQL-Statements bleiben strukturell gleich, ggf. `LIMIT` statt SQLite-spezifischer Form. |
| MariaDB / MySQL                           | `driver: mysql`; `connection.port: 3306`; `LIMIT`-Syntax beibehalten.                                       |
| Firebird                                  | `driver: firebird`; `connection.port: 3050`; `SELECT FIRST :limit` statt `LIMIT :limit`.                    |
| MS SQL Server                             | `driver: mssql`; `connection.port: 1433`; `SELECT TOP (:limit)`-Form analog `cgm-m1pro.yaml`.               |
| Oracle                                    | `driver: oracle`; `connection.port: 1521`; `ROWNUM <= :limit` analog `cgm-m1pro-oracle.yaml`.               |
| Cloud-only mit REST-API                   | YAML aus `agent/src/db-adapters/configs/` entfernen; neuer REST-Adapter unter `apps/bridge/src/adapters/pixelmedics/` analog Pabau/Consentz; Migration `pvs_link.pvs_vendor` und `pvs_event_log.bridge_source` CHECK-Constraints um `pixelmedics` erweitern. |
| Cloud-only ohne API                       | Pixelmedics-Praxen erhalten den GDT-Agent-Pfad (file-based fallback); `pixelmedics.yaml` als Adapter loeschen; Vendor in `docs/troubleshooting.md` als GDT-only fuehren. |

Bei Aenderungen jeweils:

1. `apps/bridge/docs/section-11-verification.md` -> Pixelmedics-Abschnitt von "unconfirmed" auf "verified <Datum>" umstellen.
2. `apps/bridge/UNIVERSAL_ADAPTER_BUILD.md` -> Owner-side TODO "Pixelmedics engine confirmation" als erledigt markieren.
3. `apps/bridge/docs/onboarding-per-vendor/pixelmedics.md` -> "Engine noch nicht vendor-bestaetigt"-Block ersetzen durch die Praxis-IT-Anleitung fuer die bestaetigte Variante.
