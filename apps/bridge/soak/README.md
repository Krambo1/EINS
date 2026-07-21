# PVS-Bridge Soak-Harness

Praxis-Simulator + Dauertest für den Bridge-Agenten. Spielt tagelang "MFA am
Empfang" gegen eine tomedo-förmige Datenbank und einen GDT/CSV-Export-Ordner,
lässt die **echten Agenten** (gleicher Code wie in Produktion, via tsx aus
`apps/bridge/agent/src`) dagegen laufen, injiziert Chaos und prüft am Ende
**eine** Aussage:

> Summe der Rechnungen in der Quelle == Umsatz-Events im Portal.
> Centgenau. Null Duplikate. Null verloren.

Das ist die Abrechnung, an der die Garantie hängt, und der Test, den keiner
der 1.155 Unit-Tests leisten kann.

## Aufbau

Zwei Praxen, weil das Portal (M-D6) pro Praxis nur EINEN führenden
Rechnungs-Datenpfad erlaubt:

| | Praxis A (DB-Pfad) | Praxis B (Datei-Pfad) |
|---|---|---|
| Quelle | Postgres `soak_tomedo` (Schema exakt wie `tomedo.yaml`) | GDT-Ordner + Honorar-CSV-Ordner |
| Agent | eigener APPDATA-Store, tomedo-db-Adapter, read-only DB-User | eigener APPDATA-Store, GDT-Watcher + CSV-Watcher |
| Last | Churn-Script: Patienten, Termine, Rechnungen, Storni, Edits | Dropper: GDT/BDT/CSV-Dateien inkl. Gemeinheiten |
| Wahrheit | die Datenbank selbst | append-only Ledger (`journal/dropper-ledger.jsonl`) |

Beide Agenten reden mit dem Portal **nur über den Chaos-Proxy**
(`127.0.0.1:18091` → `localhost:3001`), damit "Netz weg" ein Moduswechsel ist.

### Gemeinheiten, die der Dropper absichtlich einstreut

- Torn Writes: GDT/CSV-Datei erscheint ohne letztes CR LF, wird Sekunden
  später fertig geschrieben (muss re-prozessiert werden, ohne Duplikat)
- ISO-8859-1 vs. UTF-8 Umlaute; eine UTF-16-Schrottdatei (muss 0 Events
  ergeben, ohne den Agenten zu töten)
- Multi-Satz-BDT (mehrere Patienten + Rechnungen in einer Datei)
- Beträge mit Tausenderpunkt ("1.234,56"), mehrere 8420-Honorarzeilen pro Satz
- CSV mit doppelter Header-Spalte (muss laut scheitern, 0 Events)
- CSV-Zeilen mit Zahlstatus "offen" (dürfen NIE Umsatz buchen)
- Komplette Re-Drops bereits gelieferter Zeilen (müssen zu 0 dedupen)

### Chaos-Ereignisse

- Agent-Kill (SIGKILL mitten im Betrieb) + Neustart
- Netz refuse (Portal "weg") und blackhole (Portal hängt, testet Timeouts)
- DB-Passwort-Rotation, Recovery wahlweise DB-seitig oder via
  Credential-Update + Agent-Neustart
- Blackout: beide Agenten tot + Netz weg, dann alles wieder hoch

Ein **echter Reboot** der Maschine ist bewusst manuell: mitten im Lauf
neu starten, danach `pnpm --filter eins-bridge-soak soak -- --hours N`
erneut starten (Setup/Cursors/Ledger überleben in `.runtime/`), am Ende
normal reconcilen.

## Voraussetzungen

1. Docker-Postgres läuft, Migrationen angewendet: `pnpm db:up && pnpm db:migrate`
2. Portal-Dev-Server läuft: `pnpm dev:portal` (Port 3001)
3. Optional für Level-2-Zahlen (`lifetime_revenue_eur`): `pnpm dev:worker`
4. Einmalig: `pnpm install` (Workspace kennt `apps/bridge/soak`)

## Benutzung

```powershell
pnpm --filter eins-bridge-soak run setup      # Praxen, Vendor-DB, Enrollment (idempotent)
pnpm --filter eins-bridge-soak run smoke      # 8-Minuten-Beweislauf (hohe Rate, kurzes Chaos)
pnpm --filter eins-bridge-soak run soak --hours 48    # der echte Lauf
pnpm --filter eins-bridge-soak run reconcile  # Abgleich jederzeit manuell
pnpm --filter eins-bridge-soak run reset      # alles abreißen (Portal-Rows, DB, .runtime)
```

Das `run` ist Pflicht: `pnpm --filter ... setup` trifft sonst pnpm's eingebautes
`pnpm setup`, das `PNPM_HOME` setzt und den User-PATH anfasst.

Läuft das Portal nicht auf 3001, muss `SOAK_PORTAL_URL` bei **jedem** Befehl
gesetzt sein (z. B. `$env:SOAK_PORTAL_URL="http://localhost:3007"`).

Flags für `soak`: `--minutes N` / `--hours N`, `--smoke` (kurze
Chaos-Fenster, hohe Op-Rate), `--no-chaos`, `--edge`.

`--edge` hebt die Reconcile-Schutzplanken auf und provoziert die bekannten
semantischen Lücken von State-Polling-Bridges (bezahlt→storniert schneller
als das Poll-Intervall, nachträgliche Betrags-/Datums-Edits an bezahlten
Rechnungen). Ein Edge-Lauf soll rot werden — er ist die Bug-Jagd, nicht der
Abnahmetest.

Ctrl+C bricht sauber ab: Generatoren stoppen, Agenten dürfen nachliefern
(Drain), dann Reconcile + Report.

## Ergebnis

- Konsole: `PASS` / `FAIL` + Exit-Code
- Report: `.runtime/soak-report.md` (Soll/Ist je Praxis, Netto centgenau,
  jede fehlende/doppelte/falsche Rechnung einzeln)
- Journale: `.runtime/journal/` (churn.jsonl, dropper-ledger.jsonl,
  chaos.jsonl), Agent-Logs: `.runtime/logs/agent-a.log`, `agent-b.log`

Findings im Report tragen ggf. `(in-flight?)`: Quelle wurde innerhalb der
Grace-Periode zuletzt geändert, Event kann noch unterwegs sein → ein paar
Minuten später `reconcile` erneut laufen lassen.

## Was PASS bedeutet (und was nicht)

PASS heißt: über die gesamte Laufzeit, durch alle Kills, Netzlöcher und
Passwort-Rotationen hindurch, hat der Agent jede bezahlte Rechnung und jede
Erstattung **genau einmal** und **centgenau** ins Portal gebracht
(`pvs_event_log`, Level 1, worker-unabhängig).

Nicht abgedeckt: die Ableitung in Dashboard-KPIs (`kpi_daily`, nightly) und
`lifetime_revenue_eur` wird nur informativ mitgeprüft (Level 2, braucht den
Worker); macOS-Keychain-Pfad; echte Vendor-Schemata abseits des
tomedo-Discovery-Drafts.

## Troubleshooting

- **Setup: "portal not reachable"** → `pnpm dev:portal` starten (3001).
- **Enrollment schlägt fehl** → `.runtime/logs/agent-a.log` lesen; Token ist
  24h gültig, Setup erzeugt bei jedem Lauf ein frisches.
- **Alles neu aufsetzen** → `reset`, dann `setup`. Reset löscht auch die
  Portal-Zeilen beider Soak-Praxen und die Vendor-DB.
- **Reconcile rot direkt nach Abbruch** → Drain abwarten / `reconcile`
  erneut; nur Findings ohne `(in-flight?)` zählen.
- Der Proxy-Port (18091) ist belegt? Alte Soak-Session killen oder
  `SOAK_PROXY_PORT` setzen (dann `reset` + `setup`, die enrollte
  Portal-URL enthält den Port).
