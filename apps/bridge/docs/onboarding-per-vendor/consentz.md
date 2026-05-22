# Consentz: EINS-Bridge Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 4 Minuten. Setup-Aufwand: ca.
20 Minuten plus eine Email an den Consentz-Support. Kein lokal
installierter Agent erforderlich; Consentz ist Cloud-PVS und die
EINS-Bridge ruft die Consentz-API direkt vom EINS-Server aus auf.

## Voraussetzungen

1. Consentz-Account ist aktiv (jeder Plan).
2. Praxis hat einen AVV (Auftragsverarbeitungsvertrag) mit EINS
   (Einzelunternehmen von Karam Issa) unterschrieben. Vorlage:
   `apps/bridge/legal/AVV-template-DE.md`.

## API-Zugang bei Consentz beantragen

Consentz hat im Mai 2026 kein Self-Service-Developer-Portal; API-
Credentials werden pro Praxis durch den Consentz-Support ausgestellt.

1. Email an `support@consentz.com` mit folgendem Inhalt:

   > Betreff: API access request: read-only sync to EINS Visuals
   >
   > Hello Consentz team,
   >
   > we are a Praxis using Consentz for [clinic name]. We have signed
   > a data-processing agreement (AVV/DPA) with our marketing-analytics
   > vendor EINS (sole proprietor: Karam Issa, Cologne, Germany) and
   > would like to authorize EINS to read our Consentz data via the
   > Consentz API.
   >
   > Please issue:
   >  - a read-only API token scoped to clients, appointments,
   >    treatment-notes, payments, and recalls;
   >  - our tenant API base URL;
   >  - our tenant identifier if required.
   >
   > Authorized by: [Praxis-Inhaber:in name + role]
   > Sent to EINS via secure channel; not via email.
   >
   > Thank you.

2. Consentz antwortet typischerweise innerhalb von 2 Werktagen mit:
   * `Base URL` (z. B. `https://api.consentz.com/v1`)
   * `API Token`
   * `Tenant Identifier` (optional, je nach Account-Modell)

3. Diese Werte NICHT per E-Mail weiterleiten. Direkt im EINS-Portal
   hochladen: `Einstellungen → Integrationen → PVS → "Consentz
   anbinden"`. AES-256-Verschluesselung in `platform_credentials`.

## Aktivierung im Portal

1. Praxis-Inhaber:in oeffnet `Einstellungen → Integrationen → PVS`.
2. "PVS-System: Consentz" auswaehlen.
3. Felder ausfuellen:
   * `consentzEndpoint`: Base URL von Consentz.
   * `consentzApiToken`: API Token.
   * `consentzTenantId` (optional): nur setzen, wenn Consentz einen
     Tenant Identifier mitgeschickt hat.
4. "Verbindung pruefen" klickt `/health`, dann `/me`, dann
   `/clients?per_page=1` als Healthcheck. Ein OK bei einer der drei
   Stufen zaehlt als erfolgreiche Verbindung.

## Was die Bridge liest

| Consentz-Endpoint             | Canonical-Event             |
|-------------------------------|-----------------------------|
| `GET /clients`                | `PatientUpserted`           |
| `GET /appointments`           | `AppointmentCreated`, `AppointmentStatusChanged` |
| `GET /treatment-notes`        | `EncounterCompleted`        |
| `GET /payments`               | `InvoicePaid`               |
| `GET /recalls`                | `RecallScheduled`           |

Nur Lese-Zugriff. Keine Schreiboperationen.

## Datenschutz

* Daten bleiben in Consentz-EU/UK-Rechenzentren plus EINS-EU-Datenbank.
* Consentz ist ISO 27001:2013 zertifiziert; AWS-256-AES at rest, TLS
  1.3 in transit. AVV deckt die Verarbeitung.

## Troubleshooting

* "401 Unauthorized": Token-Rotation; bei Consentz-Support neuen Token
  anfordern und im EINS-Portal aktualisieren.
* "Endpunkt nicht erreichbar": Consentz nutzt pro Tenant separate Hosts.
  Bei einem Tenant-Umzug aendert sich `consentzEndpoint`; muss im
  Portal nachgezogen werden.
* "Field calibration mismatch": Consentz hat keine oeffentliche
  Schema-Dokumentation; die EINS-Bridge protokolliert nicht-zuordenbare
  Felder im Bridge-Log und meldet sie als `pvs_link_health`. Bei
  Auftreten: Karam pingen (`karam@einsvisuals.de`); 1-Stunden-Fix.
* Konkrete Fehlersymptome: `apps/bridge/docs/troubleshooting.md`
  Abschnitt "Consentz / Cloud REST".
