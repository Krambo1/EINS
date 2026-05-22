# Pabau: EINS-Bridge Onboarding

Setup-Anleitung fuer Praxis-IT. Lesezeit: 4 Minuten. Setup-Aufwand: ca. 15
Minuten. Kein lokal installierter Agent erforderlich; Pabau ist Cloud-PVS
und die EINS-Bridge ruft die Pabau-API direkt vom EINS-Server aus auf.

## Voraussetzungen

1. Pabau-Account ist aktiv; die Praxis hat Admin-Zugriff auf
   `Setup → Developer & Other → Private Apps` (alle Pabau-Plans
   verfuegen ueber API-Zugang).
2. Praxis hat einen AVV (Auftragsverarbeitungsvertrag) mit EINS Visuals
   GmbH unterschrieben. Vorlage: `apps/bridge/legal/AVV-template-DE.md`.
   Hinweis: bei Pabau liegt die Datenhoheit ebenfalls bei der Praxis;
   die Pabau-AGB erlauben den Zugriff via API-Token explizit.

## API-Token erzeugen

1. In Pabau einloggen, dann `Setup → Developer & Other → Private Apps
   → Developer Hub`.
2. Auf "Create App" oder "Edit" einer bestehenden App klicken. Pabau
   zeigt drei Werte:
   * `API Key` (auch `api_token` genannt)
   * `Base URL` (z. B. `https://api.oauth.pabau.com/api/v1`)
   * optional einen `Tenant Identifier`
3. Den `API Key` sicher kopieren; Pabau zeigt ihn nur einmal vollstaendig.
4. Den Token NICHT per E-Mail teilen. Ueber das EINS-Portal hochladen:
   `Einstellungen → Integrationen → PVS → "Pabau anbinden"`. Der Token
   landet AES-256-verschluesselt in `platform_credentials`.

## Aktivierung im Portal

1. Praxis-Inhaber:in oeffnet `Einstellungen → Integrationen → PVS`.
2. "PVS-System: Pabau" auswaehlen.
3. Felder ausfuellen:
   * `pabauEndpoint`: Base URL aus dem Pabau Developer Hub.
   * `pabauApiToken`: API Key (einmalig aus Schritt 3 oben).
   * `pabauApiPath` (optional): nur setzen, wenn der Base URL keinen
     `api/vN` Pfad enthaelt.
4. "Verbindung pruefen" klickt einen `/me`-Healthcheck gegen Pabau und
   meldet `OK` oder den HTTP-Fehler.
5. Nach erfolgreichem Healthcheck startet die Bridge automatisch den
   Initial-Sync (12 Monate Rueckblick per Default). Fortschritt im
   selben Panel sichtbar.

## Was die Bridge liest

| Pabau-Endpoint              | Canonical-Event             |
|-----------------------------|-----------------------------|
| `GET /patients`             | `PatientUpserted`           |
| `GET /bookings`             | `AppointmentCreated`, `AppointmentStatusChanged` |
| `GET /treatment_notes`      | `EncounterCompleted`        |
| `GET /invoices`             | `InvoicePaid`               |
| `GET /recalls`              | `RecallScheduled`           |

Nur Lese-Zugriff. Keine Schreiboperationen. Pabau-API erlaubt 110 bis
190 Anfragen pro Minute (je nach Pabau-Plan); die Bridge ist deutlich
darunter.

## Datenschutz

* Daten bleiben in Pabau-EU-Rechenzentren plus EINS-EU-Datenbank.
* AVV deckt die Verarbeitung; Pabau ist als Subauftragsverarbeiter
  bereits in der Pabau-Praxis-Verbindung deklariert.
* Personenbezogene Daten sind verschluesselt: API-Token in der Bridge
  AES-256, Transport TLS 1.3.

## Troubleshooting

* "401 Unauthorized": Token im Pabau Developer Hub gedreht. Im EINS-
  Portal neu eintragen und "Verbindung pruefen" klicken.
* "429 Too Many Requests": Bridge backed off automatisch. Bei
  wiederholtem Auftreten: Pabau-Plan-Limits pruefen
  (Enterprise/Group/Bespoke: 190/min, sonst 110/min).
* Initial-Sync laeuft langsam: bei sehr grossen Praxen (>50k Bookings)
  rechnet die Bridge mit ca. 30 bis 45 Minuten. Live-Updates beginnen
  parallel, sobald die ersten Patienten gesynct sind.
* Konkrete Fehlersymptome: `apps/bridge/docs/troubleshooting.md`
  Abschnitt "Pabau / Cloud REST".
