# Auftragsverarbeitungsvertrag (AVV)

**Zwischen**

[Praxisname]
[Straße Hausnummer]
[PLZ Ort]

vertreten durch [Name Praxisinhaber:in]

nachstehend "Auftraggeber" oder "Praxis" genannt,

**und**

EINS Visuals GmbH
[Anschrift EINS Visuals GmbH]
[PLZ Ort]
HRB [Nummer], Amtsgericht [Ort]

vertreten durch [Geschäftsführer:in]

nachstehend "Auftragsverarbeiter" oder "EINS" genannt,

zusammen "die Parteien".

---

## Präambel

Die Parteien haben einen Hauptvertrag über die Nutzung der "EINS Portal" Plattform geschlossen ("Hauptvertrag"). Im Rahmen des Hauptvertrags installiert die Praxis auf ihrer eigenen Hardware den "EINS Agent": eine lokale Software, die ausschließlich auf den eigenen Praxisverwaltungssystem (PVS) Datenbestand der Praxis lesend zugreift und definierte Ereignisse an das EINS Portal überträgt.

Dieser Auftragsverarbeitungsvertrag ("AVV") regelt die Verarbeitung personenbezogener Daten durch den Auftragsverarbeiter nach Art. 28 DSGVO.

**Grundlegende Klarstellung zur Dateninhaberschaft:**

Die in der PVS-Datenbank gespeicherten Daten sind Daten der Praxis. Die Praxis ist im Sinne der DSGVO die Verantwortliche; sie ist nach § 630f BGB zur Dokumentation und nach DSGVO Art. 20 zur Datenportabilität berechtigt. Die Praxis hat das gesetzliche und vertragliche Recht, einen Auftragsverarbeiter mit der Verarbeitung ihrer eigenen Patientendaten zu beauftragen. Dies gilt unabhängig von etwaigen EULA-Klauseln des PVS-Herstellers; der Bundesgerichtshof hat in mehreren Entscheidungen die Datenhoheit der Praxis gegenüber Drittherstellern bestätigt (vgl. BGH, Urteile zur Datenträgerherausgabe bei Praxisveräußerung).

EINS handelt im Rahmen dieses AVV nicht als eigenständige Verantwortliche, sondern weisungsgebunden für die Praxis.

---

## 1. Gegenstand und Dauer der Auftragsverarbeitung

### 1.1 Gegenstand

Der Auftragsverarbeiter erbringt für den Auftraggeber Datenverarbeitungsleistungen zum Zweck:

a) der Übermittlung definierter Ereignisse aus dem PVS der Praxis an das EINS Portal (Auto-Status, Honorar-Tracking, Recall-Verwaltung, Werbebudget-ROI Zuordnung);

b) der Bereitstellung von Auswertungen, Forecasts und Aktivitätsberichten an die berechtigten Nutzer:innen der Praxis innerhalb des EINS Portals;

c) der Anonymisierten Übergabe von Konversionssignalen an die vom Auftraggeber konfigurierten Werbeplattformen (Meta CAPI, Google OCI) zur Optimierung der eigenen Anzeigenkampagnen der Praxis.

### 1.2 Art der Verarbeitung

Lesender Zugriff auf eine definierte Liste von Tabellen und Spalten des praxiseigenen PVS, Normalisierung in das kanonische Ereignisschema, Übertragung an das EINS Portal über eine signierte HTTPS-Verbindung, Speicherung im EINS Portal, Bereitstellung in der Benutzeroberfläche des Portals an die berechtigten Nutzer:innen der Praxis.

### 1.3 Dauer

Die Auftragsverarbeitung beginnt mit Inbetriebnahme der EINS PVS Bridge und endet mit Beendigung des Hauptvertrags. Datenlöschung und Datenrückgabe sind in Ziffer 9 geregelt.

---

## 2. Art der Daten und Kreis der betroffenen Personen

### 2.1 Datenkategorien

a) **Stammdaten der Patient:innen:** Vor- und Nachname, Geburtsdatum, Geschlecht, Kontaktdaten (E-Mail, Telefon), PVS-interne Patienten-ID.

b) **Behandlungsdaten:** Termindatum und -uhrzeit, Behandlungscode und -bezeichnung, behandelnde Person, Behandlungsort innerhalb der Praxis, Terminstatus (geplant, eingecheckt, abgeschlossen, nicht erschienen, storniert).

c) **Abrechnungsdaten:** Rechnungsbetrag, Zahlungsstatus, Zahlungseingangsdatum, Verknüpfung zum zugrundeliegenden Termin.

d) **Recall-Daten:** Geplanter Recall-Zeitpunkt, Recall-Anlass, Verknüpfung zur Patient:in.

e) **Operative Telemetriedaten der Bridge:** Schema-Versionen, Polling-Zeitstempel, Fehlermeldungen ohne Personenbezug.

### 2.2 Nicht erhobene Daten

EINS erhebt im Rahmen dieses AVV keine medizinischen Diagnosen, keine Anamnesedaten, keine Befunde, keine Arzt-Patient-Korrespondenz, keine Behandlungsnotizen, keine Bilddateien und keine Daten besonderer Kategorien gemäß Art. 9 DSGVO über den in 2.1 abschließend aufgezählten Umfang hinaus. Insbesondere werden Gesundheitsdaten ausschließlich in dem Umfang verarbeitet, der zur Erbringung der in 1.1 genannten Leistungen erforderlich ist.

### 2.3 Betroffene Personen

Patient:innen, Interessent:innen und Behandelte der Praxis sowie Mitarbeiter:innen der Praxis, soweit diese als behandelnde Personen in den Behandlungsdaten geführt werden.

---

## 3. Liste der gelesenen Tabellen und Spalten ("Lese-Whitelist")

EINS liest ausschließlich die im jeweiligen Anhang A für das konkrete PVS-Produkt aufgeführten Tabellen und Spalten. Anhang A ist Bestandteil dieses AVV und wird je PVS-Produkt mit der Praxis vor Inbetriebnahme abgestimmt. Beispiele:

* **Tomedo:** Tabellen `patienten`, `termine`, `kontakte`, `rechnungen`, `recalls`.
* **medatixx (x.isynet, x.concept, x.comfort):** Tabellen `PAT`, `TER`, `BEHAND`, `RECHNUNG`, `RECALL`.
* **CGM Albis, CGM Turbomed, CGM M1 Pro:** Tabellen `PATIENT`, `TERMIN`, `BEHANDLUNG`, `RECHNUNG`, `RECALL`.
* **Indamed Medical Office:** Tabellen `patient`, `termin`, `behandlung`, `rechnung`, `recall`.
* **Quincy:** Tabellen `PATIENT`, `TERMIN`, `BEHANDLUNG`, `RECHNUNG`.
* **Pixelmedics:** Tabellen `patients`, `appointments`, `treatments`, `invoices`, `recalls`.

Schreibzugriff ist ausgeschlossen. Der Zugang erfolgt mit einem dedizierten, auf SELECT beschränkten Datenbankbenutzer; die Praxis ist für die Provisionierung dieses Benutzers verantwortlich (siehe Ziffer 6.2).

---

## 4. Weisungsrecht des Auftraggebers

### 4.1 Weisungsbefugnis

Der Auftragsverarbeiter verarbeitet personenbezogene Daten ausschließlich auf dokumentierte Weisung des Auftraggebers. Die im Hauptvertrag und in diesem AVV niedergelegten Festlegungen gelten als Weisung. Mündliche Weisungen sind unverzüglich schriftlich oder in Textform zu bestätigen.

### 4.2 Weisungsempfänger:innen bei EINS

Weisungen sind zu richten an: privacy@einsvisuals.de oder schriftlich an die in der Präambel genannte Anschrift.

### 4.3 Hinweispflicht des Auftragsverarbeiters

EINS hat den Auftraggeber unverzüglich zu informieren, wenn eine Weisung nach Auffassung von EINS gegen Datenschutzvorschriften verstößt (Art. 28 Abs. 3 Satz 3 DSGVO).

---

## 5. Pflichten des Auftragsverarbeiters

### 5.1 Vertraulichkeit

EINS verpflichtet alle Personen, die auftragsgemäß Zugang zu personenbezogenen Daten erhalten, zur Vertraulichkeit (Art. 28 Abs. 3 lit. b, Art. 29 DSGVO) und unterrichtet sie über die einschlägigen datenschutzrechtlichen Pflichten.

### 5.2 Berufsgeheimnis

Sofern die verarbeiteten Daten unter ein Berufsgeheimnis nach § 203 StGB fallen, verpflichtet EINS alle relevant beteiligten Personen zusätzlich nach § 203 Abs. 4 StGB.

### 5.3 Technische und organisatorische Maßnahmen

EINS trifft die in Anhang B beschriebenen technischen und organisatorischen Maßnahmen (TOM) nach Art. 32 DSGVO. EINS überprüft die TOM regelmäßig und passt sie an den Stand der Technik an.

### 5.4 Unterstützungspflichten

EINS unterstützt den Auftraggeber bei der Erfüllung seiner Pflichten nach Art. 32 bis 36 DSGVO, insbesondere bei der Beantwortung von Anträgen Betroffener auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch.

### 5.5 Datenschutzverletzungen

EINS informiert den Auftraggeber unverzüglich, spätestens jedoch innerhalb von 24 Stunden nach Kenntnisnahme, über Verletzungen des Schutzes personenbezogener Daten gemäß Art. 33 DSGVO. Die Meldung enthält die in Art. 33 Abs. 3 DSGVO genannten Angaben.

### 5.6 Datenschutzbeauftragte:r

EINS hat eine:n Datenschutzbeauftragte:n bestellt, erreichbar unter datenschutz@einsvisuals.de.

---

## 6. Pflichten des Auftraggebers

### 6.1 Rechtmäßigkeit der Verarbeitung

Der Auftraggeber ist für die Rechtmäßigkeit der Datenverarbeitung verantwortlich. Er stellt sicher, dass er über eine zulässige Rechtsgrundlage für die Verarbeitung der in Ziffer 2.1 aufgeführten Daten verfügt (insbesondere § 203 StGB Schweigepflichtentbindung, Behandlungsvertrag, berechtigtes Interesse oder Einwilligung der Patient:innen).

### 6.2 Provisionierung des Lesezugangs

Der Auftraggeber stellt EINS einen dedizierten, auf SELECT beschränkten Datenbankbenutzer mit Zugriff ausschließlich auf die in Ziffer 3 und Anhang A genannten Tabellen und Spalten zur Verfügung. Die Zugangsdaten werden ausschließlich im verschlüsselten lokalen Schlüsselspeicher des EINS Agent auf der Hardware der Praxis abgelegt und nicht an EINS übermittelt.

### 6.3 Auskunftsersuchen

Wendet sich eine betroffene Person mit einem Anliegen nach Art. 12 ff. DSGVO an EINS, leitet EINS dieses Anliegen unverzüglich an den Auftraggeber weiter. Die unmittelbare Bearbeitung erfolgt durch den Auftraggeber.

### 6.4 Kontrollrecht

Der Auftraggeber hat das Recht, sich von der Einhaltung dieses AVV durch EINS zu überzeugen. Form und Häufigkeit sind in Ziffer 11 geregelt.

---

## 7. Unterauftragsverhältnisse

### 7.1 Genehmigte Unterauftragsverarbeiter

Der Auftraggeber stimmt der Einbindung der in Anhang C aufgeführten Unterauftragsverarbeiter zu. Anhang C listet typischerweise:

a) Hosting-Dienstleister des EINS Portals (z. B. Vercel Inc., Frankfurt-Region "fra1", AVV vorhanden);
b) Datenbank-Dienstleister (Neon, Frankfurt-Region, AVV vorhanden);
c) Versanddienstleister für transaktionale E-Mails (z. B. Resend, AVV vorhanden);
d) Werbeplattformen, soweit der Auftraggeber Konversionsuploads aktiv konfiguriert hat (Meta CAPI, Google OCI). Hierbei handelt es sich um eigenständige Verantwortlichkeiten der jeweiligen Plattform; EINS stellt lediglich die Übermittlung im Auftrag der Praxis sicher.

### 7.2 Hinzuziehung weiterer Unterauftragsverarbeiter

EINS informiert den Auftraggeber mindestens 30 Tage vor Einbindung neuer Unterauftragsverarbeiter in Textform. Der Auftraggeber kann der Einbindung innerhalb dieser Frist aus wichtigem Grund widersprechen. Erfolgt kein Widerspruch, gilt die Zustimmung als erteilt.

### 7.3 Vertragliche Bindung der Unterauftragsverarbeiter

EINS legt jedem Unterauftragsverarbeiter die Pflichten dieses AVV durch schriftlichen Vertrag auf (Art. 28 Abs. 4 DSGVO).

### 7.4 Drittlandübermittlung

Erfolgt eine Übermittlung in ein Drittland ohne Angemessenheitsbeschluss, schließt EINS mit dem Empfänger die Standardvertragsklauseln 2021/914 ab und führt eine Transfer Impact Assessment durch.

---

## 8. Ort der Datenverarbeitung

Die Verarbeitung erfolgt:

a) auf der Hardware des Auftraggebers (EINS Agent, lokal in der Praxis);
b) im EINS Portal in der EU (Frankfurt-Region);
c) nach Konfiguration durch den Auftraggeber gegebenenfalls bei den in Anhang C genannten Werbeplattformen.

---

## 9. Löschung und Rückgabe von Daten

### 9.1 Nach Beendigung

Nach Beendigung des Hauptvertrags löscht EINS sämtliche personenbezogenen Daten des Auftraggebers nach Wahl des Auftraggebers (Löschung oder Rückgabe), spätestens jedoch nach 90 Tagen.

### 9.2 Gesetzliche Aufbewahrungspflichten

Soweit gesetzliche Aufbewahrungspflichten einer Löschung entgegenstehen (insbesondere § 257 HGB, § 147 AO), beschränkt EINS die Verarbeitung der betroffenen Daten auf das gesetzlich vorgeschriebene Maß und löscht nach Ablauf der Frist.

### 9.3 Nachweis

Auf Anforderung des Auftraggebers bestätigt EINS die Löschung schriftlich.

---

## 10. Haftung

Die Haftung der Parteien für Schäden, die im Zusammenhang mit der Auftragsverarbeitung entstehen, richtet sich nach Art. 82 DSGVO sowie den allgemeinen Regelungen des Hauptvertrags.

---

## 11. Nachweis- und Kontrollrechte

### 11.1 Nachweise

EINS weist die Einhaltung der in diesem AVV festgelegten Pflichten durch:

a) jährlich aktualisierte schriftliche Selbstauskunft zu den TOM;
b) Vorlage aktueller Zertifizierungen, soweit vorhanden (z. B. ISO 27001 der Unterauftragsverarbeiter);
c) Bereitstellung der jährlich aktualisierten Liste der Unterauftragsverarbeiter.

### 11.2 Vor-Ort-Prüfungen

Der Auftraggeber ist berechtigt, sich nach vorheriger Ankündigung mit einer Frist von 14 Tagen während der üblichen Geschäftszeiten von der Einhaltung dieses AVV zu überzeugen. Vor-Ort-Prüfungen werden auf das erforderliche Maß beschränkt; EINS kann die Prüfung von der Unterzeichnung einer Verschwiegenheitsvereinbarung abhängig machen.

### 11.3 Kosten

Eine Vor-Ort-Prüfung pro Kalenderjahr ist für den Auftraggeber kostenfrei. Weitere Prüfungen oder anlassbezogene Sonderprüfungen werden nach Aufwand abgerechnet, sofern nicht ein Verstoß von EINS festgestellt wird.

---

## 12. Schlussbestimmungen

### 12.1 Schriftform

Änderungen und Ergänzungen dieses AVV bedürfen der Textform.

### 12.2 Salvatorische Klausel

Sollten einzelne Bestimmungen dieses AVV ganz oder teilweise unwirksam sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.

### 12.3 Anwendbares Recht und Gerichtsstand

Es gilt deutsches Recht. Gerichtsstand ist [Sitz EINS Visuals GmbH].

### 12.4 Vorrangregelung

Im Falle von Widersprüchen zwischen diesem AVV und dem Hauptvertrag gehen die Regelungen dieses AVV vor.

---

## Unterschriften

**Auftraggeber:**

Ort, Datum: __________________________________

Unterschrift: __________________________________

Name in Druckbuchstaben: __________________________________

**Auftragsverarbeiter:**

Ort, Datum: __________________________________

Unterschrift: __________________________________

Name in Druckbuchstaben: __________________________________

---

# Anhang A: Lese-Whitelist je PVS-Produkt

*Dieser Anhang wird bei Vertragsschluss mit dem konkret eingesetzten PVS-Produkt befüllt. Die jeweils gelesenen Tabellen und Spalten werden auf das Mindestmaß beschränkt, das zur Erbringung der in Ziffer 1.1 genannten Leistungen erforderlich ist.*

Die konkreten Abfragen je PVS-Produkt sind dokumentiert in:
`apps/bridge/agent/src/db-adapters/configs/<vendor>.yaml`

Eine Beispiel-Belegung (Tomedo):

| Tabelle    | Gelesene Spalten                                                                                       | Zweck                            |
|------------|--------------------------------------------------------------------------------------------------------|----------------------------------|
| patienten  | id, vorname, nachname, email, telefon, geburtsdatum, geschlecht, kommentar, modified_at                | Stammdaten und Matching          |
| termine    | id, patient_id, termin_zeit, behandlung_code, behandlung_name, raum_id, raum_name, kommentar, status, modified_at | Termin-Lifecycle und Auto-Status |
| rechnungen | id, patient_id, termin_id, betrag_cent, status, paid_at, modified_at                                   | Honorar-Tracking und ROI         |
| recalls    | id, patient_id, recall_zeit, anlass, modified_at                                                       | Recall-Verwaltung                |

Schreibzugriff: ausgeschlossen.

---

# Anhang B: Technische und organisatorische Maßnahmen (TOM)

## B.1 Vertraulichkeit (Art. 32 Abs. 1 lit. b DSGVO)

* **Zutrittskontrolle:** Büroflächen mit Zutrittsbeschränkung, Schlüsselregelung, Besucherprotokoll.
* **Zugangskontrolle:** Mehrfaktor-Authentifizierung für alle EINS-Mitarbeitendenzugriffe auf Produktionssysteme.
* **Zugriffskontrolle:** Rollen- und Rechtekonzept im EINS Portal; principle of least privilege; Audit-Log über alle privilegierten Zugriffe.
* **Trennungskontrolle:** Mandantentrennung über Row-Level Security in der Datenbank; Tests gegen Vermischung dokumentiert.
* **Pseudonymisierung:** Patientendaten werden im EINS Portal mit zufälligen UUIDs anstelle natürlicher Schlüssel referenziert.

## B.2 Integrität (Art. 32 Abs. 1 lit. b DSGVO)

* **Weitergabekontrolle:** Verbindungen zwischen EINS Agent und EINS Portal über TLS 1.2 oder höher mit HMAC-SHA256 signierten Anfragen.
* **Eingabekontrolle:** Append-only Event-Log (`pvs_event_log`) im EINS Portal; alle Veränderungen sind versioniert.

## B.3 Verfügbarkeit und Belastbarkeit (Art. 32 Abs. 1 lit. b DSGVO)

* **Verfügbarkeitskontrolle:** Tägliche Backups der Portal-Datenbank, Speicherung in der EU, Vorhaltedauer 30 Tage.
* **Wiederherstellbarkeit:** Recovery-Time-Objective 4 Stunden, Recovery-Point-Objective 24 Stunden.
* **Belastbarkeit:** Lasttests vor jedem produktiven Release; Auto-Scaling im Hosting.

## B.4 Verfahren zur regelmäßigen Überprüfung (Art. 32 Abs. 1 lit. d DSGVO)

* **Datenschutz-Management:** Jährliche Überprüfung dieses TOM-Anhangs durch die Geschäftsführung und die:den Datenschutzbeauftragte:n von EINS.
* **Incident-Response:** Dokumentierte Eskalationskette; 24-Stunden Meldepflicht an den Auftraggeber.
* **Auftragsverarbeitung:** Vertragliche Verpflichtung aller Unterauftragsverarbeiter; jährliche Überprüfung.

## B.5 Spezifische Maßnahmen der EINS PVS Bridge

* **Lesezugriff ausschließlich:** Der EINS Agent verwendet einen Datenbankbenutzer mit ausschließlich SELECT-Rechten auf die in Anhang A definierten Tabellen.
* **Lokale Verschlüsselung:** Datenbank-Passwort wird ausschließlich im OS-Schlüsselspeicher (macOS Keychain, Windows Credential Manager) auf der Praxis-Hardware abgelegt und nicht an EINS übermittelt.
* **Schema-Drift-Erkennung:** Erkennt strukturelle Änderungen der PVS-Datenbank automatisch und meldet diese, bevor potenziell falsche Daten interpretiert werden.
* **Minimal-Erhebung:** Es werden ausschließlich die für die in Ziffer 1.1 genannten Zwecke erforderlichen Spalten gelesen; medizinische Behandlungsnotizen, Befunde und Diagnosen sind ausgeschlossen.

---

# Anhang C: Liste der Unterauftragsverarbeiter

*Aktueller Stand: bei Vertragsschluss eingetragen, jährlich aktualisiert.*

| Dienstleister                                | Zweck                                  | Sitz                  | AVV vorhanden |
|----------------------------------------------|----------------------------------------|-----------------------|---------------|
| Vercel Inc. (Region fra1)                    | Hosting EINS Portal                    | USA, EU-Region        | ja            |
| Neon Inc.                                    | Managed Postgres (Region eu-central-1) | USA, EU-Region        | ja            |
| Resend (Resend, Inc.)                        | Transaktionale E-Mails                 | USA, EU-Region        | ja            |
| (optional, kundenseitig konfiguriert) Meta   | Konversionsuploads (CAPI)              | Eigenständig          | Meta-AVV      |
| (optional, kundenseitig konfiguriert) Google | Konversionsuploads (OCI)               | Eigenständig          | Google-AVV    |

Bei Kundenkonfiguration einer Konversionsuploadintegration handelt der Auftraggeber als Werbetreibender direkt mit der jeweiligen Plattform; EINS stellt lediglich die technische Übermittlung im Auftrag der Praxis sicher.

---

# Anhang D: Rechtliche Bezüge und Hinweise

* DSGVO Art. 4 Nr. 8: Begriff Auftragsverarbeitung.
* DSGVO Art. 20: Recht auf Datenübertragbarkeit; Grundlage für die Übertragung praxiseigener Daten an einen vom Auftraggeber gewählten Auftragsverarbeiter.
* DSGVO Art. 28: Inhalt eines Auftragsverarbeitungsvertrags.
* DSGVO Art. 32: Sicherheit der Verarbeitung; siehe Anhang B.
* DSGVO Art. 33, 34: Meldepflichten bei Verletzungen des Schutzes personenbezogener Daten.
* DSGVO Art. 82: Haftung und Schadensersatzansprüche.
* § 203 StGB: Verletzung von Privatgeheimnissen; verpflichtet Berufsgeheimnisträger:innen, ihre Hilfspersonen vertraglich zur Verschwiegenheit zu binden.
* § 630f BGB: Dokumentationspflicht der behandelnden Person; begründet u. a. die Dateninhaberschaft der Praxis am Behandlungsdatenbestand.
* § 257 HGB, § 147 AO: gesetzliche Aufbewahrungspflichten.
* BGH zur Datenhoheit der Praxis: vgl. die einschlägige Rechtsprechung zur Datenträgerherausgabe bei Praxisveräußerung, die die Praxis als Inhaberin der Patientendokumentation gegenüber Drittherstellern bestätigt. Daraus folgt: EULA-Klauseln eines PVS-Herstellers, die einer praxisseitig erteilten Verarbeitungsbefugnis entgegenstehen, sind insoweit unwirksam, als sie der gesetzlichen Stellung der Praxis als Verantwortliche zuwiderlaufen.

---

*Stand: 2026-05-21. Dieses Dokument ist eine Vorlage. Vor produktivem Einsatz bei einer Praxis ist eine Prüfung durch die Rechtsabteilung der Praxis und gegebenenfalls der Berufskammer empfohlen. EINS empfiehlt, die hier gewählten Formulierungen einer Endprüfung durch eine:n Fachanwalt:in für IT- und Medizinrecht zu unterziehen, bevor sie als Vertragsdokument an Praxen ausgegeben werden.*
