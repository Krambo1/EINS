# EINS GDT-Agent

On-prem Bridge agent for Praxen whose PVS exports GDT/BDT files or Honorar
CSV files, or has a database the agent can read (see
`docs/onboarding-per-vendor/`). The agent watches the configured folders,
parses the files, normalizes them to canonical EINS events, and POSTs them
to the portal, signed with the per-clinic HMAC secret.

## What GDT carries (and what it does not)

GDT 2.1 is the PVS-to-device interface. EINS acts as a GDT device. The
agent reads **patient master data only**: Satzart 6301 (Stammdaten
übermitteln), 6302 (neue Untersuchung anfordern), 6311 (Daten einer
Untersuchung zeigen) and, for BDT exports, 6100. Fields: 3000 patient number
(mandatory), 3101/3102/3100 name, 3103 birth date, 3110 sex, and from GDT
3.x 3618 mobile, 3619 e-mail, 3626 phone.

GDT carries no billing data. Revenue comes only from the Honorar CSV export
(`csv-watcher.ts`) or a DB adapter (`db-adapters/`), never from GDT. The
EINS lead token `EINS-Lead-xxxxxxxx` is picked up
only when the PVS sends a free-text field that contains it; GDT has no
Bemerkung field.

PVS-side setup: a GDT device whose GDT-ID (receiver id) is `EINS`. The
export file name must start with that id (`EINSMDX.GDT` fixed, or
`EINSMDX.001`, `.002` counting), or the Satz carries FK 8315 = `EINS`.
Change the id at enrollment with `--gdt-receiver-id <id>` (1-8 characters
`[A-Za-z0-9_]`).

How `watcher.ts` consumes files:

- Only files addressed to EINS are touched. Files for other devices in the
  same folder are never moved, deleted or translated.
- A file is claimed by renaming it into `<folder>\.eins\processing`, its
  events are written to the outbox in one transaction, then the claimed
  file is deleted (spec behaviour: the receiver deletes). The agent account
  needs read, write and delete rights on the GDT folder.
- Unreadable or non-GDT files addressed to EINS go to
  `<folder>\.eins\failed` (kept 30 days), so the export channel never
  blocks.
- Files are named `*.GDT` or `*.NNN` (three digits). BDT exports (`*.bdt`)
  are read but never deleted.
- Character set is detected automatically (CP437 default, FK 9206 1/2/3
  honoured, DIN 66003, ISO-8859-1/CP1252, UTF-8).
- A rescan runs every 30 s as a backup for chokidar (SMB shares poll).

Honorar CSV: `*.csv` in the configured folder, columns auto-detected from
the header row (or a mapping JSON), rescan every 5 minutes, files are not
deleted.

## Topology

```
   Praxis-PC                              EINS Portal
   ---------                              -----------
   PVS  ->  GDT folder  ->  eins-agent  --------->  /api/pvs/events
            Honorar CSV     (chokidar)   HMAC-signed
            PVS database        |
                                v
                          outbox.sqlite (SQLCipher, retries)
```

The agent does NOT connect to the Bridge service. It POSTs directly to the
portal so a Bridge outage doesn't block on-prem sync (the portal endpoint
is the durability boundary).

## Install (Windows)

There is no MSI. `pnpm --filter eins-agent build:bundle` produces
`bundle/` (see "Build & package"); that folder is what gets copied to the
Praxis PC. Put it somewhere only administrators can write, for example
`C:\Program Files\EINS-Agent`, with a Node 20 `node.exe` next to
`eins-agent.cmd` (otherwise the launcher uses `node` from PATH).
`--install-service` refuses locations in a user profile or writable by
ordinary users unless `--allow-writable-install` is passed.

All commands below run in an elevated prompt.

1. The inhaber creates a one-time enrollment token (24h TTL) in the portal
   (**Einstellungen, Integrationen**).
2. Enroll. Pipe the token on stdin so it never lands in the OS process
   listing (`Get-CimInstance Win32_Process`) or in shell history:

   ```
   echo <token> | eins-agent --enroll --token-stdin --clinic <clinicId> --folder <GDT-Ordner> [--honorar-folder <path>] [--gdt-receiver-id <id>]
   ```

   Other flags: `--portal <url>` (default `https://portal.eins.ag`),
   `--honorar-mapping <json-path>`. The positional form
   `eins-agent --enroll <token> --clinic <clinicId>` still works. Without
   `--folder` the default is `C:\GDT-Out`. Enrollment refuses to run while a
   live agent holds the instance lock, and it is crash-safe: if the process
   dies after the portal redeems the token but before secret and config are
   written, a plain restart completes it from a recovery journal.
3. Register the service: `eins-agent --install-service`. This creates the
   scheduled task `EINS-Agent` (SYSTEM, no logon needed). The task starts at
   boot and again every 5 minutes; a tick while the agent runs does nothing
   (one instance only, and the instance lock is the second guard), so an agent
   or supervisor that exited after a good launch is back within 5 minutes.
   `--supervise` itself restarts a failing agent forever with 2 s to 60 s
   backoff and logs every restart with the exit code. The command first
   migrates legacy per-user data from `%APPDATA%\EINS-Agent`, so run it as
   the Windows user who did the setup. It refuses (exit 2) while the old agent
   still runs, and when legacy data exists in more than one user profile it
   copies nothing and lists the folders found. After starting the task it waits
   up to 60 s for the agent (live instance lock or a new log line) and exits 1
   with a pointer to `agent.log` if nothing shows up.

Other commands: `--service-status`, `--stop-service`, `--start-service`,
`--uninstall-service`, `--requeue-failed [--reason <code>]`,
`--configure-honorar <folder> [--honorar-mapping <json>]`,
`--enable-db-adapter <vendor> ...`, `--rotate-db-credential <id>`,
`--disable-db-adapter <vendor>`, `--probe-db-adapter <vendor> [--json]`
(full list: header comment of `src/index.ts`).

**DB adapters:** `--probe-db-adapter <vendor>` checks every table and column
the vendor YAML uses against the real database, read-only (exit 0 = all
found, 1 = differences, 2 = probe failed). Run it on the first real Praxis PC
before trusting a stream: the bundled vendor YAMLs are guessed schemas.

**Upgrade (Windows).** In an elevated prompt:

1. `eins-agent --stop-service`: disables the task (otherwise the 5 minute tick
   would restart it), ends the running instance and waits until the instance
   locks are released (exit 1 after 45 s if the agent still runs).
2. Replace the files in the install folder (the whole `bundle/` content,
   including `node_modules` and `build-info.json`).
3. `eins-agent --install-service` (re-registers the task and starts it), or
   `eins-agent --start-service` if the task definition did not change. Both
   wait for the agent to come up and check `--service-status` afterwards.

**Requeue dead-lettered events:** `eins-agent --requeue-failed [--reason <code>]`
moves outbox rows that gave up (status `failed`) back to `pending` so the agent
uploads them again. Use it after the cause is fixed (bad deploy, wrong portal
URL, version skew). `--reason <code>` only touches rows whose last error
contains that text, for example `--reason invalid_envelope`. It prints how many
rows were moved and is safe while the agent runs.

**Data and logs:** data dir `%ProgramData%\EINS-Agent` (config, DPAPI
machine-scope secrets, outbox; ACL restricted to SYSTEM and
Administrators). Log: `%ProgramData%\EINS-Agent\logs\agent.log` (10 MB x 5
rotation). `EINS_AGENT_DATA_DIR` overrides the data dir (development only;
the agent then does not manage its ACL).

**Single instance:** a second agent on the same data dir exits with code 75.

**Mapped drives:** the service runs as SYSTEM and cannot see mapped drive
letters. Use UNC paths (`\\server\share\GDT`) for the GDT and Honorar
folders; the share must grant the computer account access (`folder-check.ts`
logs the reason and a hint at boot and hourly).

**Health in the portal** (via the heartbeat's `adapterStatuses`): a GDT file
the agent cannot claim (permissions) or an unreadable GDT folder shows as
a halted stream `gdt_agent/gdt_inbox`; quarantined files in `.eins\failed`
show as `degraded`. An unreadable Honorar export shows as
`honorar_csv/csv_folder` with the column names found.

macOS: there is no service installer (`--install-service` is Windows-only).
Run `eins-agent` or `eins-agent --supervise` yourself.

## Networks behind a proxy or TLS inspection

Praxis workstations sometimes sit behind a corporate proxy or a
TLS-inspecting firewall that is rolled out AFTER the agent is installed.
Node's built-in fetch does not honour proxy env vars on its own and does not
trust the Windows certificate store, so without configuration every upload
fails silently with `network: fetch failed`. Two environment variables fix
this; set them for the service account that runs the agent, then restart it:

- **`HTTPS_PROXY`** (and/or `HTTP_PROXY`, `NO_PROXY`): the agent installs
  undici's `EnvHttpProxyAgent` as the global dispatcher at startup when any of
  these is set, routing enrollment, event, and heartbeat requests through the
  proxy. A startup log line confirms which proxy is active.
- **`NODE_EXTRA_CA_CERTS`**: path to the corporate root CA (`.pem`) used by a
  TLS-inspecting middlebox. Node reads this at process start and adds the CA to
  its trust store. When a request fails certificate verification, the agent
  logs a targeted hint naming this variable (see `src/net-setup.ts`,
  `tlsHint`). Enrollment failures print the same guidance.

## Layout

- `src/index.ts`, entry point. Boots watcher + outbox flush loop.
- `src/config.ts`, local config (JSON) + secure-store delegation.
- `src/enrollment.ts`, one-shot enrollment + secret persistence.
- `src/watcher.ts`, chokidar folder watch with debouncing.
- `src/gdt-parser.ts`, GDT field-record parser (line length, FK 8000
  Satzart, character-set detection).
- `src/normalize.ts`, GDT/BDT patient Satz (6301, 6302, 6311, 6100) →
  PatientUpserted event.
- `src/csv-watcher.ts`, Honorar CSV folder watcher (revenue events).
- `src/service-windows.ts`, `src/supervisor.ts`, `src/data-dir.ts` ,
  scheduled task, restart supervisor + rotating log, locked-down data dir.
- `src/outbox.ts`, SQLite-backed retry queue (per-file send state).
- `src/secure-store.ts`, DPAPI (machine scope) / Keychain wrappers.
- `src/portal-client.ts`, HMAC-signed POST helper (duplicates apps/bridge
  to keep the agent zero-dep on the bridge package).

## Build & package

`pnpm --filter eins-agent build:bundle` produces `bundle/`, a
self-contained, runnable agent: the compiled `dist/`, a FLAT, real-file
production `node_modules` (native bindings included), `build-info.json`,
and per-platform launchers (`eins-agent.cmd`, `eins-agent`). The launcher
uses a `node.exe` / `node` placed next to it and falls back to `node` on
PATH. The build refuses to run unless the build Node major equals
`SHIP_NODE_MAJOR` (20) in `scripts/bundle.mjs`. No MSI or DMG is built; the
folder is copied to the Praxis PC (see "Install").

Native bindings the bundle must carry: `better-sqlite3-multiple-ciphers`
(the SQLCipher outbox), `better-sqlite3` (the read-only SQLite vendor
adapter, e.g. Pixelmedics), and `oracledb` (CGM M1 PRO). The build asserts
the SQLCipher binding is present and aborts if it is not, so a bundle that
cannot open the outbox can never ship silently.

> **ABI invariant:** `better-sqlite3(-multiple-ciphers)` is a V8-ABI (NAN)
> addon, its prebuilt binary is Node-MAJOR-version specific (the filename
> carries the tag: `node-v137` == Node 24, `node-v115` == Node 20). Build
> the bundle under the **same Node major** the installer ships, or the
> agent dies at startup with "Could not locate the bindings file".
> `oracledb` is N-API and ABI-stable across Node majors.

Not `pkg` (the former `build:bin`): pkg snapshots JS into one executable
but does not embed native `.node` addons; its only work-around extracts
them to a temp dir on first run, which a locked-down Praxis workstation
(AV / AppLocker / non-writable `%TEMP%`) can silently block. A folder of
real files has no such failure mode.

Dependency builds run only when allowlisted: pnpm 10 disables dependency
install scripts unless the package is in the root `package.json`'s
`pnpm.onlyBuiltDependencies`. Both SQLite drivers are listed there; without
it, `pnpm install` produces a tree with no SQLCipher binding and the agent
cannot boot.

## Tests

`vitest run` exercises the GDT parser against captured fixtures from
several PVS exports (anonymised), plus the SQL-introspection framework,
the encrypted outbox, secure-store, and the file ledger. All
state stores (outbox queue, `watcher_state`, `db_adapter_state`) share the
single SQLCipher-keyed connection from `outbox.ts:outboxConnection()`;
none of them open the outbox file with a second, plaintext driver.
