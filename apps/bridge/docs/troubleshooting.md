# EINS PVS Bridge: Troubleshooting

Praxis-IT-orientierte Checkliste fuer die haeufigsten Fehlerbilder.
Stand: 2026-05.

## 1. Der Agent startet nicht

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no config found. Run --enroll first.`                           | Enrollment wurde nicht durchgefuehrt. Token im Portal generieren und `./eins-agent --enroll <token> --clinic <praxis-uuid>` ausfuehren.                                                                                                                                            |
| `enrollment failed: portal 401 ...`                              | Der Enrollment-Token ist abgelaufen (24 h Gueltigkeit) oder die `clinic-uuid` passt nicht zum Token. Im Portal einen neuen Token generieren.                                                                                                                                       |
| LaunchDaemon laeuft nicht, kein `eins-agent`-Prozess auf macOS   | `sudo launchctl list \| grep eins`. Falls leer: `sudo launchctl load -w /Library/LaunchDaemons/com.eins.agent.plist`. Bei `Bootstrap failed: 5: Input/output error`: `.plist` liegt nicht unter `/Library/LaunchDaemons` oder Owner ist nicht root. Mit `sudo chown root:wheel`. |

## 2. Der DB-Adapter laeuft, aber keine Events kommen an

| Symptom im Agent-Log                                             | Ursache + Behebung                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect to tomedo failed: connection refused`                   | Postgres laeuft nicht oder lauscht nicht auf dem konfigurierten Port. Pruefen mit `sudo lsof -i :5432`. Falls leer: Tomedo-Server starten. Falls anderes Programm den Port nutzt: `--db-port` beim `--enable-db-adapter` ueberschreiben.                                          |
| `connect ... password authentication failed for user "<...>"`    | Das Read-Only-Konto wurde nicht oder mit anderem Namen angelegt. Zollsoft 3rd-Level-Support kontaktieren und Username + Passwort verifizieren. Danach mit `./eins-agent --rotate-db-credential <id>` aktualisieren.                                                              |
| `connect ... database "tomedo" does not exist`                   | Der Datenbankname unterscheidet sich. Auf einem Tomedo-Server-Mac als `postgres`-User: `psql -l` listet die DBs. Per `--db-database <name>` neu enrollen.                                                                                                                          |
| `no credential found for 'tomedo-db-default'`                    | Das Passwort wurde nicht im Apple Keychain hinterlegt. `./eins-agent --rotate-db-credential tomedo-db-default` ausfuehren und das DB-Passwort eingeben.                                                                                                                            |
| `SCHEMA DRIFT; stream halted until config update`               | Tomedo-Update hat eine Spalte umbenannt. Die Drift-Meldung im Portal zeigt fehlende und neue Spaltennamen. In `apps/bridge/agent/src/db-adapters/configs/tomedo.yaml` die Spalte umbenennen, Agent neu starten.                                                                  |
| `pollOnce threw ... permission denied for relation "termin"`    | Das Read-Only-Konto hat keine SELECT-Berechtigung auf alle benoetigten Tabellen. Im Zollsoft-Ticket explizit auflisten: `patient`, `termin`, `behandlung`, `rechnung`, `recall`.                                                                                                  |

## 3. Events kommen an, aber Anfragen-Status bleibt auf `qualifiziert`

| Symptom im Portal-Log                                            | Ursache + Behebung                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `linking_failure` mit `Stage 1/2/3 lookup` Nachricht              | Patient ist im PVS angelegt, aber das Portal kann ihn nicht eindeutig einer offenen Anfrage zuordnen. Loesungen: a) Im PVS-Patient die `Bemerkung` um `EINS-Lead-<8hex>` ergaenzen (Token im Portal pro Anfrage einsehbar). b) Im Portal manuell verknuepfen via "Patient zuweisen".  |
| Event-Typ `EncounterCompleted` kommt an, aber `gewonnen` triggert nicht  | `EncounterCompleted` ohne `pvsAppointmentId` wird vom Portal-Worker verworfen (gesehen in `pvs-status-derive.ts`). Pruefen, ob die Behandlung in Tomedo wirklich an einen Termin geknueft ist. Sonst manuell im PVS verknuepfen.                                                  |
| `InvoicePaid` kommt an, aber `werbebudget ROI` rechnet 0 EUR     | Die Rechnung ist nicht an einen Termin gekoppelt. Im Tomedo Rechnungsdialog: "Mit Termin verknuepfen". Alternativ: ist die Honorar-Position als IGE/Privatleistung markiert? Kasenleistungen werden absichtlich nicht ROI-attribuiert.                                              |

## 4. Lua-Hooks senden keine Events

| Symptom in Tomedo Skript-Log                                     | Ursache + Behebung                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HMAC computation failed (openssl missing?)`                     | `/usr/bin/openssl` fehlt oder ist nicht ausfuehrbar. Mit `which openssl` pruefen; auf moderne macOS-Version (Tomedo unterstuetzt 10.13+) updaten oder `brew install openssl` und in der Lua-Datei den Pfad anpassen.                                                                |
| `POST failed for AppointmentCreated: curl: (6) ...`              | DNS-/Firewall-Problem. Pruefen, ob `portal.eins.ag` ausgehend auf 443 erreichbar ist. Bei Praxis-VLAN: Firewall-Regel ergaenzen.                                                                                                                                            |
| `POST failed ... invalid_bridge_source` oder `vendor_mismatch`   | `pvs_link.vendor` auf Portal-Seite passt nicht zur `bridgeSource = "tomedo"`-Signatur. Im Portal die Praxis-Integration auf `Tomedo` setzen.                                                                                                                                       |
| `missing required fields` Warnung                                | Tomedo hat das Row-Schema des Hooks veraendert. Die `pick(row, ...)`-Liste in der betroffenen Hook-Datei um den neuen Feldnamen erweitern.                                                                                                                                         |

## 5. Outbox staut sich

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Im EINS-Portal (Einstellungen, Integrationen, PVS): "Outbox > 10000 ausstehend" | Netzwerkverbindung war laenger offline. Solange `next_attempt_at` in der Vergangenheit liegt, flutscht der Agent automatisch durch (Exponential Backoff, max 1 h). Stoppt das nicht nach 24 h: Logs pruefen, ggf. den Outbox-Pfad (`outbox.sqlite`) sichern und an EINS uebergeben. |
| `[outbox] vacuum: deleted N old sent rows` jeden Tag             | Normal. Die Tabelle wird nach 7 Tagen "sent" automatisch geleert.                                                                                                                                                                                                                  |

## 6. Schema-Drift erkennen und beheben

### 6.1 Symptom im Portal

Sobald der EINS-Agent eine Spalten-Abweichung beim ersten oder einem
fortlaufenden Poll erkennt, hält er den betroffenen Stream automatisch
an (Status `schema_drift`) und postet einen `pvs_link_health`-Eintrag
an das Portal. Die Praxis sieht im Portal unter

**Einstellungen → Integrationen → PVS**

eine Warnkarte mit der Überschrift "PVS-Verbindung benötigt
Aufmerksamkeit". Pro Stream stehen dort:

- Vendor- und Stream-Bezeichner (z. B. `tomedo-db / AppointmentCreated`);
- die im Snapshot erwartete Spaltenliste vs. die jetzt im Result-Set
  gefundene Spaltenliste, aufgeschlüsselt nach „fehlend" und „neu";
- ein Zeitstempel der Erkennung.

### 6.2 Behebung in vier Schritten

1. **Spalte identifizieren.** Im Portal-Warnhinweis steht z. B.
   `Fehlende Spalten: termin_zeit` und `Neue Spalten: appointment_time`.
   Das bedeutet: das PVS-Update hat `termin_zeit` zu `appointment_time`
   umbenannt.

2. **YAML anpassen.** In
   `apps/bridge/agent/src/db-adapters/configs/<vendor>.yaml` den Stream
   suchen und die SQL-Query plus den `map:`-Block aktualisieren:

   ```diff
   - query: SELECT id, patient_id, termin_zeit, modified_at FROM termin
   + query: SELECT id, patient_id, appointment_time AS termin_zeit, modified_at FROM termin
   ```

   Die Aliasform `<neuer_name> AS <alter_name>` ist die schnellste
   Korrektur und vermeidet Folgeänderungen im `map:`-Block. Alternativ:
   auch den Map-Eintrag von `termin_zeit` auf `appointment_time`
   umbenennen.

3. **Agent neu starten.** Damit der Stream den persistierten
   `schema_drift`-Status verliert:

   ```bash
   # macOS
   sudo launchctl unload /Library/LaunchDaemons/com.eins.agent.plist
   sqlite3 ~/Library/Application\ Support/EINS-Agent/outbox.sqlite \
     "UPDATE db_adapter_state SET status='idle', column_snapshot=NULL
      WHERE vendor_id='<vendor>' AND stream_kind='<StreamKind>';"
   sudo launchctl load -w /Library/LaunchDaemons/com.eins.agent.plist
   ```

   Auf Windows:

   ```powershell
   sc stop EINSAgent
   sqlite3 "$env:APPDATA\EINS-Agent\outbox.sqlite" `
     "UPDATE db_adapter_state SET status='idle', column_snapshot=NULL
      WHERE vendor_id='<vendor>' AND stream_kind='<StreamKind>';"
   sc start EINSAgent
   ```

4. **Im Portal verschwindet die Warnung.** Nach dem ersten
   erfolgreichen Poll mit dem korrigierten Schema sendet der Agent das
   `schema_recovered`-Health-Event, das die Drift-Zeile im
   `pvs_link_health` auf `resolved_at` setzt. Die Warnkarte
   verschwindet beim nächsten Reload der Integrationen-Seite.

### 6.3 Lokale Inspektion (Praxis-IT, ohne Portal-Zugriff)

```bash
# Pending drift reports im Agent-State (vor dem nächsten Publish-Tick)
sqlite3 ~/Library/Application\ Support/EINS-Agent/outbox.sqlite \
  "SELECT vendor_id, stream_kind, missing, added, datetime(detected_at/1000, 'unixepoch')
   FROM db_adapter_drift WHERE reported_to_portal = 0 ORDER BY detected_at DESC LIMIT 20;"

# Bereits ans Portal übertragene Drift-Hinweise (forensisch)
sqlite3 ~/Library/Application\ Support/EINS-Agent/outbox.sqlite \
  "SELECT vendor_id, stream_kind, missing, added, datetime(detected_at/1000, 'unixepoch')
   FROM db_adapter_drift WHERE reported_to_portal = 1 ORDER BY detected_at DESC LIMIT 20;"

# Aktueller Stream-Status pro Vendor
sqlite3 ~/Library/Application\ Support/EINS-Agent/outbox.sqlite \
  "SELECT vendor_id, stream_kind, status, consecutive_failures, last_error,
          datetime(last_run_at/1000, 'unixepoch')
   FROM db_adapter_state ORDER BY vendor_id, stream_kind;"
```

### 6.4 Was die Drift-Erkennung ausdrücklich nicht tut

- Sie korrigiert das Schema nicht selbständig. Die Heuristik
  „Spalten-Umbenennung" könnte technisch automatisch raten, würde aber
  bei einer echten Schema-Umstellung (z. B. medatixx ändert die
  Bedeutung einer Spalte) zu stillen Falschauswertungen führen. Die
  Stream-Pause ist deshalb absichtlich hart.
- Sie validiert nicht die Spalten-Typen, nur die Namen-Reihenfolge. Ein
  PVS-Update, das `termin_zeit` von `TIMESTAMP` auf `VARCHAR` ändert,
  ohne den Namen anzufassen, schlägt erst beim Parsen einzelner Rows
  fehl. Dort greift die Failure-Backoff-Strecke (Abschnitt 5).
- Sie deduziert nicht aus dem `column_snapshot`, ob das Praxis-PVS
  upgegradet wurde. Diese Information liegt nur in den Release-Notes
  des Herstellers; die Praxis-IT ist verantwortlich, das Update mit
  EINS abzustimmen.

## 7. Daten-Reset (Notfall)

Sollten Cursors korrupt sein und ein Full-Reset noetig:

```bash
# Stoppt den Agent
sudo launchctl unload /Library/LaunchDaemons/com.eins.agent.plist

# Loescht die DB-Adapter-Cursors (NICHT die Outbox; ungesendete Events bleiben).
sqlite3 ~/Library/Application\ Support/EINS-Agent/outbox.sqlite \
  "DELETE FROM db_adapter_state;"

# Startet neu, alle Streams beginnen wieder bei Epoch
sudo launchctl load -w /Library/LaunchDaemons/com.eins.agent.plist
```

Vorsicht: Der erste Poll nach Reset wiederholt alle Events seit 1970-
Epoch. Das Portal dedupliziert ueber das UNIQUE-Index auf
`(clinicId, bridge_source, pvs_external_event_id, occurred_at)`, also
sind das No-Ops auf Portalseite; die Bandbreitenbelastung kann aber
kurz erheblich sein (mehrere 10k POST/Min). Im Zweifel ausserhalb der
Praxis-Sprechzeiten ausfuehren.

## 8. Engine-spezifische Fehler (Phase 2)

### 8.1 Firebird (medatixx, CGM Turbomed, Quincy)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error: I/O error during "open" operation for file ...`          | Pfad zur `.fdb`-Datei stimmt nicht oder Windows-Dienst-User hat keine Leseberechtigung. Pfad pruefen; ACL fuer Dienstkonto setzen: `icacls "C:\...\PRAXIS.FDB" /grant "<DienstUser>:R"`. |
| `Error: connection rejected by remote interface`                  | Firebird-Wire-Encryption-Verhandlung. Bei Firebird 2.5: `wireEncryption: false` im YAML setzen. Bei 3.x/4.x: SYSDBA-Konto pruefen; manche Installationen verbieten den Login von Nicht-Loopback-Hosts. |
| `Error: no permission for read access to TABLE <X>`              | Die GRANTS aus dem Onboarding-Doc nicht ausgefuehrt. `isql -user SYSDBA` und die `GRANT SELECT ...`-Statements nachholen. |
| `Error: Token unknown - line N, column M: FIRST`                 | Sehr alte Firebird-Version (<2.0) ohne `FIRST N`-Support. In der YAML alle `SELECT FIRST :limit` durch `SELECT` ersetzen und `WHERE ROWNUM <= :limit` ergaenzen, oder Firebird auf 3.x updaten. |

### 8.2 MS SQL Server (CGM M1 PRO neuer Installationen)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectionError: Failed to connect to ... - self signed certificate` | Der SQL-Server praesentiert ein selbstsigniertes Zertifikat und `trustServerCertificate` ist false. Im YAML auf `true` setzen (Default in `cgm-m1pro.yaml`). |
| `RequestError: Login failed for user 'eins_readonly'`            | Login existiert auf Server-Ebene, aber kein DB-Mapping. `USE M1PRO; CREATE USER eins_readonly FOR LOGIN eins_readonly;` nachholen. |
| `RequestError: The SELECT permission was denied on the object 'Termin'` | GRANTS fehlen; siehe Onboarding-Doc. |
| `ConnectionError: Could not connect (sequence)` (TLS-Handshake)   | TLS-Version-Mismatch zwischen Node und SQL Server. SQL Server-Update einspielen, oder im YAML `options.encrypt: false` setzen (LAN only). |

### 8.3 MariaDB (Indamed Medical Office)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Error: ER_ACCESS_DENIED_ERROR: Access denied for user 'eins_readonly'@'127.0.0.1'` | Host-Pattern beim GRANT war `'localhost'` statt `'127.0.0.1'` (in MariaDB unterscheidet sich das). `GRANT SELECT ... TO 'eins_readonly'@'%'` als breitester Workaround, oder beide Eintraege explizit. |
| `Error: ER_BAD_DB_ERROR: Unknown database 'medoff'`              | Datenbankname stimmt nicht; mit `SHOW DATABASES` pruefen, ggf. `--db-database` korrigieren. |
| `Error: ER_NO_SUCH_TABLE: Table 'medoff.behandlung' doesn't exist` | MEDICAL OFFICE-Version hat das Schema umbenannt. Schema-Drift-Detector wird auch greifen; YAML-Tabellen-/Spaltennamen anpassen. |

### 8.4 SQLite (Pixelmedics)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SqliteError: unable to open database file`                      | Pfad zur SQLite-Datei stimmt nicht oder Windows-Dienst-User hat keine Leseberechtigung. ACLs setzen wie unter 8.1. |
| `SqliteError: attempt to write a readonly database`              | Eine YAML-Konfiguration enthaelt versehentlich ein `INSERT`/`UPDATE`/`DELETE`-Statement. Der Agent oeffnet die DB strikt read-only; das ist Absicht. SQL korrigieren. |
| `SqliteError: no such table: patients`                           | Pixelmedics-Schema ist anders als die Hypothese in der YAML. Mit `sqlite3 <pfad> ".tables"` die echten Tabellen listen und YAML anpassen. |

### 8.5 Pabau / Cloud REST (Phase 3)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pabau health 401` beim "Verbindung pruefen"                     | API-Token in Pabau wurde rotiert oder die Praxis hat eine andere App aktiviert. Im Pabau-Setup → Private Apps → Edit den aktuellen Token kopieren und im EINS-Portal eintragen. |
| `pabau health 403`                                                | Der Token hat nicht die noetigen Scopes (clients, bookings, treatment_notes, invoices, recalls). In Pabau die App-Berechtigungen pruefen und ggf. neu generieren. |
| `pabau GET /bookings page=N 429`                                  | Rate-Limit ueberschritten. Die Bridge backed off automatisch via Retry-After. Bei haeufigem Auftreten: Pabau-Plan-Limits pruefen (Standard 110/min, Enterprise/Group/Bespoke 190/min); ggf. ein Plan-Upgrade auf Pabau-Seite. |
| `pabau GET /treatment_notes 404`                                 | Das Pabau-Konto verwendet `medical_forms` statt `treatment_notes`. Im EINS-Portal `connection_config.pabauEncounterPath` auf `/medical_forms` setzen (oder Karam pingen). |
| Initial-Sync laeuft sehr langsam                                  | Pabau-API hat ein hartes 100-rows-per-page-Limit; bei sehr grossen Praxen mit >50k Bookings dauert es 30 bis 45 min. Live-Updates beginnen parallel und sind nicht blockiert. |
| `vendor_mismatch` Fehler im Bridge-Log                            | `pvs_link.pvs_vendor` ist nicht auf `pabau` gesetzt. Im Portal die Praxis-Integration neu auswaehlen. |

### 8.6 Consentz / Cloud REST (Phase 3)

| Symptom                                                          | Ursache + Behebung                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consentz health 401/403/...` (drei Stufen)                       | Token ist abgelaufen oder hat zu wenige Scopes. Consentz-Support kontaktieren (`support@consentz.com`) und einen neuen Token mit Scope `clients,appointments,treatment-notes,payments,recalls` anfordern. |
| `consentz health 404/404/...`                                     | `consentzEndpoint` zeigt auf eine alte Tenant-URL. Consentz hat den Tenant verschoben. Im Support-Ticket nach der neuen Base URL fragen und im Portal aktualisieren. |
| `consentz GET /clients page=N 429`                                | Rate-Limit; Bridge backed off automatisch. Bei wiederholtem Auftreten ist die Consentz-Plan-Quote ausgeschoepft; Support kontaktieren. |
| `Field calibration mismatch` im Bridge-Log                        | Consentz hat keine oeffentliche Schema-Dokumentation; die Bridge protokolliert nicht-zuordenbare Felder als `pvs_link_health`-Event. Karam (`karam@eins.ag`) pingen; 1-Stunden-Fix in `apps/bridge/src/adapters/consentz/normalize.ts`. |
| Keine Events trotz erfolgreichem Healthcheck                       | Consentz schickt Events ueber `updated_since`; manche Tenants nennen den Parameter `modified_since`. Karam pingen; Adapter-Patch in `apps/bridge/src/adapters/consentz/client.ts` Zeile `updated_since=`. |

### 8.7 Oracle (CGM M1 PRO Oracle-Installationen)

Seit 2026-05-21 ist der Oracle-Adapter Teil des Standard-Agent-Builds.
Wire-Library: `oracledb` v6+ im **Thin Mode** (Default seit v6.0); kein
Oracle Instant Client erforderlich, kein separates Installer-Bundle.
Aktivierung pro Praxis:

```
./eins-agent --enable-db-adapter cgm-m1pro-oracle-db \
  --db-host 127.0.0.1 \
  --db-port 1521 \
  --db-database M1PRO \
  --db-username eins_readonly
```

| Symptom                                                              | Ursache + Behebung                                                                                                                                                                                       |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NJS-138: connections to Oracle Database 11g (or earlier) ... thin`  | Sehr alte Oracle 11g-Installation. Thin Mode unterstuetzt erst 12.1+. Praxis-IT um Oracle-Update bitten; im Notfall einen separaten Thick-Mode-Build mit Oracle Instant Client anfordern (Karam pingen). |
| `ORA-12514: TNS:listener does not currently know of service`         | `--db-database` enthaelt einen falschen Service-Namen. Im Praxis-Server: `lsnrctl status` ausfuehren und den exakten Service-Namen kopieren.                                                              |
| `ORA-12504: TNS:listener was not given the SERVICE_NAME`             | Im Easy-Connect-String fehlt der Service-Anteil. `--db-database` zwingend angeben oder `connection.options.connectString` mit voller TNS-Descriptor setzen.                                               |
| `ORA-01017: invalid username/password`                               | DB-Account ist falsch oder gesperrt. `ALTER USER eins_readonly ACCOUNT UNLOCK;` (sysdba) und Passwort via `--rotate-db-credential` neu setzen.                                                            |
| `ORA-00942: table or view does not exist`                            | Schema-Owner stimmt nicht. Im YAML auf vollqualifizierte Form umstellen (`m1pro_owner.patient`) oder ein `SET CURRENT_SCHEMA` per Login-Trigger fuer `eins_readonly` einrichten lassen.                   |
| Initial-Sync sehr langsam (>30 min)                                  | `ROWNUM <= :limit` deckelt die Batch-Groesse, aber Oracle ohne Index auf `modified_at` macht einen Full-Scan. Praxis-IT um einen Index bitten: `CREATE INDEX ix_patient_mod ON patient(modified_at);`.   |
| `NJS-525: invalid connection string`                                 | `options.connectString` ist ein TNS-Alias ohne aufgeloeste TNSNAMES-Datei. Entweder Easy-Connect-Form (`host:port/service`) verwenden oder `TNS_ADMIN`-Umgebung sauber setzen (LaunchDaemon-plist).        |

## 9. Eskalation

Wenn keine der obigen Massnahmen hilft:

* Im Portal: Einstellungen → Integrationen → PVS → "Diagnose-Pack
  herunterladen". Datei enthaelt sanitisierte Logs (PII entfernt) und
  Agent-State-Auszug. An `support@eins.ag` schicken.
* Antwort-SLA: 1 Werktag im Wartungsfenster (Mo-Fr 9-18 Uhr).
