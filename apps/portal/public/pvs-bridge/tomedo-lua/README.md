# EINS PVS Bridge: Tomedo Lua-Skripte

Defense-in-depth POSTer fuer Tomedo Praxen. Laeuft direkt im Tomedo-
Skript-Engine und sendet kanonische Events an die EINS-Portal-API, sobald
ein Termin, eine Behandlung oder eine Rechnung im Tomedo-Workflow
durchlaeuft.

Diese Lua-Bundle ergaenzt den Datenbank-Lese-Pfad des EINS-Agents (siehe
`apps/bridge/agent/src/db-adapters/configs/tomedo.yaml`). Beide Pfade
emittieren identische Events; das Portal dedupliziert ueber
`(clinicId, bridgeSource, pvsExternalEventId, occurredAt)`. Wenn der DB-
Lese-Pfad ausfaellt, weil Tomedo das Schema veraendert hat, laufen die
Lua-Hooks weiter, und umgekehrt.

## Voraussetzungen

* Tomedo-Server installiert (macOS).
* `/usr/bin/curl` und `/usr/bin/openssl` vorhanden (default auf macOS).
* Praxis ist beim EINS-Portal enrolled; ein gueltiger PVS-HMAC-Secret
  liegt vor (Einstellungen → Integrationen → PVS).

## Installation

1. Pfad zum Tomedo-Skript-Verzeichnis ermitteln. Standard:
   `/Library/Application Support/tomedo/Skripte/EINS/`. Anlegen, falls
   nicht vorhanden.

2. Diese Dateien hineinkopieren:

   ```
   EINS/
     eins-canonical-emitter.lua
     config.lua               (eigene Kopie von config.example.lua)
     hooks/
       appointment_created.lua
       appointment_status_changed.lua
       encounter_completed.lua
       invoice_paid.lua
       recall_scheduled.lua
   ```

3. `config.example.lua` nach `config.lua` kopieren und die drei
   Pflichtfelder ausfuellen:
   * `clinicId`: aus dem EINS-Portal kopieren.
   * `pvsSecret`: aus dem EINS-Portal kopieren (wird beim Agent-Enrollment
     vergeben).
   * `portalBaseUrl`: bleibt bei Standard `https://portal.eins.ag`
     unveraendert. Self-Hosted Setups passen die URL hier an.

4. In Tomedo Einstellungen → Skripte → Workflow-Trigger jeden Hook an
   den passenden Event binden:

   | Workflow-Trigger              | Lua-Datei                              |
   | ----------------------------- | -------------------------------------- |
   | Termin erstellt               | `hooks/appointment_created.lua`        |
   | Termin-Status geaendert       | `hooks/appointment_status_changed.lua` |
   | Behandlung abgeschlossen      | `hooks/encounter_completed.lua`        |
   | Rechnung bezahlt              | `hooks/invoice_paid.lua`               |
   | Recall erstellt               | `hooks/recall_scheduled.lua`           |

   Falls die Trigger-Namen in der eigenen Tomedo-Version anders heissen,
   sind sie in Tomedo Einstellungen ueber das gleiche Menue auffindbar.

## Funktionstest

Im Tomedo Skript-Log eines Demo-Termins sollte folgender Eintrag
erscheinen (oder eine Fehlermeldung, die das Problem benennt):

```
[eins-emitter] POST ok (kind=AppointmentCreated)
```

Auf der Portal-Seite unter Einstellungen → Integrationen → PVS-Live-Log
muss das Event innerhalb von einigen Sekunden auftauchen.

## Fehlerbilder

| Symptom in Tomedo Skript-Log                                                | Ursache + Loesung                                                                                                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HMAC computation failed (openssl missing?)`                                | macOS-Update hat `/usr/bin/openssl` veraendert. Pfad in `eins-canonical-emitter.lua` (Suchmuster `openssl`) anpassen oder openssl ueber brew nachinstallieren. |
| `POST failed for AppointmentCreated: curl: (6) Could not resolve host`     | Netzwerk-/DNS-Problem. Pruefe Firewall, ob `portal.eins.ag` ausgehend auf Port 443 erreichbar ist.                                              |
| `POST failed ... invalid_bridge_source` oder `vendor_mismatch`              | `pvs_link.vendor` auf Portal-Seite passt nicht zu `bridgeSource = "tomedo"`. Im Portal die Praxis-Integration auf `Tomedo` setzen.                      |
| `missing required fields` Warnung                                           | Tomedo hat das Row-Schema fuer den Hook-Trigger veraendert. Hook-Datei oeffnen, `pick(row, ...)` Liste um den neuen Feldnamen erweitern.               |

## Sicherheitsmodell

* Der `pvsSecret` ist Praxis-individuell. Verlust => sofort ueber das
  EINS-Portal rotieren (Einstellungen → Integrationen → PVS → Rotieren).
  Beide Pfade (DB-read Agent + Lua) verwenden denselben Secret und
  schalten gemeinsam um.
* Die Lua-Hooks senden ausschliesslich kanonische Event-Felder. Keine
  Klartext-Anamnese, kein Befund, keine clinical notes.
* HMAC-SHA256 ueber den Request-Body verhindert Replay durch nicht
  autorisierte Skripte. Das Portal validiert den Signature-Header
  `x-eins-signature: sha256=<hex>`.

## Updates

Wenn EINS neue Event-Felder oder Trigger-Hooks freischaltet, wird in der
Portal-Oberflaeche der Download-Link zur naechsten Bundle-Version
sichtbar. Hooks koennen ohne Tomedo-Restart neu geladen werden.
