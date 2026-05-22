# Phase 2: Section 11 verification findings

Open questions from `UNIVERSAL_ADAPTER_BUILD.md` Section 11 verified
2026-05-20 before any Bucket A code shipped. Findings deviate from the
brief in three places; deltas captured here so future implementers see
the corrected ground truth.

## Tomedo (already in Phase 1)

Not a Phase 2 question; covered by `apps/bridge/docs/onboarding-per-vendor/tomedo.md`.
Read-only Postgres credentials are issued by Zollsoft 3rd-Level Support
per AVV. Port 5432, default db name `tomedo`.

## medatixx (x.isynet / x.concept / x.comfort)

* Engine: **Firebird** on a Windows server (some installs additionally
  have a SQL Server component for satellite features, but the core PVS
  data lives in Firebird).
* Embedded vs. service: medatixx production installs run Firebird as a
  Windows service, not embedded. The agent connects via TCP on port
  3050 to the Praxis server hostname; no file-locking issues.
* DB file location: typically `C:\Program Files (x86)\medatixx\` or a
  customer-defined `D:\medatixx\daten\` directory; the IT contact must
  confirm at enrollment. The exact `.fdb` path is supplied as
  `--db-database` to the agent.
* Schema discovery: vendor does not publish schema. Reverse-engineered
  via the medatixx ODBC export tool on a demo install + community
  field knowledge. Column hypotheses live in
  `apps/bridge/agent/src/db-adapters/configs/medatixx.yaml`; the
  schema-drift detector halts streams whose first poll returns
  unexpected columns, so a wrong guess fails loudly at first run.
* Credential model: Firebird `SYSDBA` is full-access. We require the IT
  contact to provision a separate read-only user via:
  ```
  CREATE USER eins_readonly PASSWORD '<strong>';
  GRANT SELECT ON pat TO eins_readonly;
  GRANT SELECT ON ter TO eins_readonly;
  ... (one GRANT per table referenced by the YAML)
  ```
  Documented in `apps/bridge/docs/onboarding-per-vendor/medatixx.md`.

## CGM Albis

* **Engine: PostgreSQL since early 2022** (Albis 21.10 / Update 26 in
  2022 introduced the Postgres migration; pre-2022 installs were on a
  proprietary store + Firebird side-tables, but those are EOL).
* Source: CGM communication "Erhöhte Datensicherheit: Upgrade für Ihre
  CGM ALBIS-Software" (cgm.com magazine, 2021).
* Implication: Albis runs against the existing Postgres driver, not the
  new Firebird one. The brief assumed Firebird; corrected.
* Config: `apps/bridge/agent/src/db-adapters/configs/cgm-albis.yaml`
  declares `driver: postgres`.
* For the small minority of legacy Albis installs still on the
  pre-2022 store, GDT-Agent remains the fallback path; we don't
  invest in the dead engine.

## CGM Turbomed

* Engine: **Firebird** (primary practice data). The `Firebird Guardian -
  DefaultInstance` and `Firebird Server - DefaultInstance` Windows
  services run on the Praxis server.
* Side-stores: CGM Turbomed historically used FastObjects (Versant/Poet,
  object-oriented) and ships an Apache Derby (`CGMApacheDerby`) for
  some satellite features. Modern installs have migrated practice data
  to Firebird; we read only Firebird.
* Praxisarchiv: a separate SQL Express instance may exist for
  attachments. Out of scope (the portal does not ingest binary
  attachments).
* Config: `apps/bridge/agent/src/db-adapters/configs/cgm-turbomed.yaml`
  declares `driver: firebird`.

## CGM M1 Pro

* **Engine: Oracle** for the dominant install base (per CGM SystemHaus
  product docs, the "Oracle SQL database" is the M1 Pro standard).
* The brief said "MS SQL Server (newer installs)"; this is a partial
  truth. Some newer M1 Pro deployments do run on SQL Server, but the
  bulk of the fleet is Oracle.
* Phase 2 originally shipped the MSSQL config only; the Oracle gap
  was closed 2026-05-21 by adding a node-oracledb v6+ Thin-mode
  driver. Thin mode speaks the Oracle Net protocol in pure JS, so
  the agent still ships as a single self-contained binary with no
  Oracle Instant Client distribution. Both engines now live in the
  same standard build; the Praxis IT person picks the variant at
  `--enable-db-adapter` time. Thin mode supports Oracle 12.1+
  (12c/18c/19c/21c/23ai). Legacy 11g installs would still need a
  Thick-mode build with Instant Client as a sidecar; documented in
  `apps/bridge/docs/troubleshooting.md` Abschnitt 8.7.
* Configs:
  * `apps/bridge/agent/src/db-adapters/configs/cgm-m1pro.yaml` —
    `driver: mssql` (SQL-Server-Variante).
  * `apps/bridge/agent/src/db-adapters/configs/cgm-m1pro-oracle.yaml`
    — `driver: oracle` (Oracle-Variante, Default-Recommendation).

## Indamed Medical Office

* **Engine: MariaDB** for core practice data (patients, appointments,
  invoices) + **Firebird** for statistical reporting tables.
* The brief said "PostgreSQL or proprietary (verify)"; this was wrong.
  Source: Indamed forum and SEC-Consult advisory both reference the
  MariaDB/Firebird split.
* Implication: we ship a new **mysql driver** (mysql2 npm package,
  wire-compatible with MariaDB) to read the core tables; the
  statistical Firebird side is not needed for status derivation.
* Config: `apps/bridge/agent/src/db-adapters/configs/indamed.yaml`
  declares `driver: mysql`.

## Quincy (Frey ADV)

* Engine: **Firebird** (confirmed by FREY's own backup documentation,
  which references `gbak` and the Firebird-bin folder).
* Schema: undocumented publicly; FREY ADV does not provide a schema
  reference. Hypothesis schema in the YAML config based on common
  German PVS naming (`PATIENT`, `TERMIN`, `BEHANDLUNG`, `RECHNUNG`).
  Verified at first-customer onboarding via the schema-drift detector.
* Config: `apps/bridge/agent/src/db-adapters/configs/quincy.yaml`
  declares `driver: firebird`.

## Pixelmedics (Borealys GmbH)

* Engine: **unconfirmed**. Publicly available product pages do not
  disclose the storage layer. Borealys is a small vendor; direct
  contact is the right path (Karam owns this conversation).
* Phase 2 decision: ship a **SQLite config** as the most-likely guess
  (small in-segment vendor, small data volumes, browser-style stack
  often defaults to SQLite). Header comment in the YAML calls out
  the assumption explicitly. The schema-drift detector and the
  config-validator will both fail loudly on a wrong-engine guess,
  so a SQLite default does no harm before vendor confirmation.
* If vendor confirms cloud-only architecture (no on-prem DB), the
  config moves out of the agent and into `apps/bridge/src/adapters/`
  as a REST adapter (Bucket B pattern).
* Config: `apps/bridge/agent/src/db-adapters/configs/pixelmedics.yaml`
  declares `driver: sqlite`.

## Bucket B (Phase 3, verified 2026-05-21)

### Pabau

* **Per-Praxis api_token, not a shared developer account.** Each Praxis
  generates their own token in Pabau Setup → Developer & Other →
  Private Apps → Edit. There is no partner-program gate; every Pabau
  plan ships with API access. EINS does not need to apply for or
  maintain a "Pabau developer" relationship to onboard customers; we
  hold one token per Praxis, encrypted in `platform_credentials`.
* **Rate limits (company-wide on Pabau side):**
  * Standard accounts: 110 req/min, 25,000 req/day
  * Enterprise / Group / Bespoke: 190 req/min, 50,000 req/day
  * Daily POST/PUT fair-usage cap: 10,000 per user per 24 h. Bridge
    is read-only, so non-binding for our flow.
* **Overage signal:** HTTP 429 with a `Retry-After` header in seconds.
  The Pabau client honors it (`apps/bridge/src/adapters/pabau/client.ts`,
  function `parseRetryAfter`).
* **Base URL model:** `https://api.oauth.pabau.com/{api}/`, where
  `{api}` segment identifies the Pabau app the token authorizes.
  Stored per-Praxis as `connection_config.pabauEndpoint` plus
  optional `pabauApiPath`.
* **Sources:** Pabau Support Center (support.pabau.com/en/api/api-reference,
  support.pabau.com/testing/en/api/rate-limits) + Pabau Setup → Private
  Apps developer hub walkthrough.

### Consentz

* **No public developer portal as of 2026-05-21.** API credentials are
  issued per-Praxis by Consentz Support on email request. The Praxis
  IT person sends a templated request to `support@consentz.com` (see
  `apps/bridge/docs/onboarding-per-vendor/consentz.md`) and receives
  back: base URL, API token, optional tenant identifier.
* **Endpoint shape (defensive scaffold):** Bearer token + optional
  `X-Tenant-Id` header, with REST resource paths mirroring the public
  product taxonomy: `/clients`, `/appointments`, `/treatment-notes`,
  `/payments`, `/recalls`. Field paths in the normalizer reflect the
  same product surface; the portal dedup index protects replays
  during the first-Praxis calibration window. Karam owns the
  calibration ping path; same pattern as Phase 2's Pixelmedics
  scaffold.
* **Rate limits / overage:** Consentz does not publish numeric limits.
  HTTP 429 + `Retry-After` is honored on the assumption Consentz
  follows standard practice. First-Praxis onboarding will confirm
  exact ceilings.
* **Onboarding cadence:** ~2 working days from Praxis email to token
  delivery, per the support-reply pattern Consentz documents on
  their CQC compliance pages.

### Scheduler + DB whitelist

`apps/bridge/src/sync/scheduler.ts` registers `pabauAdapter` and
`consentzAdapter` in the `ADAPTERS` map; `apps/bridge/src/db/client.ts`
extends the `loadDueLinks` vendor whitelist to include `pabau` and
`consentz`. Migration `apps/portal/src/db/migrations/0039_pvs_bucket_b.sql`
extends `pvs_link.pvs_vendor` and `pvs_event_log.bridge_source` CHECK
constraints accordingly. Drizzle schema (`apps/portal/src/db/schema-pvs.ts`)
and the portal Zod surface (`apps/portal/src/server/pvs-events.ts`)
mirror the new values. The bridge `BridgeSource` union
(`apps/bridge/src/canonical/types.ts`) is in lock-step.

## Net-new corrections recorded in code

| Vendor       | Brief said           | Reality verified           | Action                |
|--------------|----------------------|----------------------------|-----------------------|
| CGM Albis    | Firebird             | PostgreSQL (since 2022)    | Use postgres driver   |
| CGM M1 Pro   | MSSQL (newer)        | Oracle (dominant) + MSSQL  | Oracle driver shipped 2026-05-21 (Thin); MSSQL retained |
| Indamed      | Postgres / proprietary | MariaDB + Firebird       | New mysql driver      |
| Quincy       | TBD                  | Firebird                   | Use firebird driver   |
| Pixelmedics  | SQLite / Postgres    | Unconfirmed                | SQLite default; vendor follow-up |

## Phase 5 pilot: per-vendor schema-validation checklist

Seven of the eight Bucket A YAMLs ship with **hypothesis schemas** (column
names derived from vendor docs, community knowledge, or naming conventions
rather than a published schema reference). Tomedo's schema lands via
Zollsoft's read-only account at first pilot; the others are uncertain in
exact column names but certain in engine and event-kind coverage.

The schema-drift detector in `framework.ts` halts a stream the moment its
first poll returns columns that don't match the YAML snapshot, so a wrong
guess fails loud at first contact rather than silently emitting empty
events at 2 a.m. This is the safety net, not the primary check. The
primary check is a per-vendor first-Praxis validation pass before billing
the customer's PVS integration as "ready":

| Vendor (config)                                     | First-Praxis sign-off owner    | Verification step                                                                                                                            | Status            |
| --------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `tomedo.yaml` (postgres)                            | Karam + Praxis-IT              | Run the discovery probe from `docs/onboarding-per-vendor/tomedo.md`; pin any deviating column names; record AppointmentCreated → InvoicePaid roundtrip in `pvs_event_log` for one test patient. | Pending pilot     |
| `medatixx.yaml` (firebird)                          | Karam + Praxis-IT              | medatixx ODBC export tool against a demo install OR direct first-Praxis read; verify `pat`, `ter`, `behandlung`, `rechnung` table + column names.                                                | Pending pilot     |
| `cgm-albis.yaml` (postgres, since-2022 migration)   | Karam + Praxis-IT              | Confirm Albis 21.10+ (Postgres-flavour, not pre-2022 store); pin schema namespace; one-patient roundtrip.                                                                                          | Pending pilot     |
| `cgm-turbomed.yaml` (firebird)                      | Karam + Praxis-IT              | Confirm Firebird is the **primary** practice DB (not Apache Derby satellite); pin schema; one-patient roundtrip.                                                                                   | Pending pilot     |
| `cgm-m1pro.yaml` (mssql) **or** `cgm-m1pro-oracle.yaml` (oracle) | Karam + Praxis-IT | Engine variant from M1 PRO → Hilfe → Info; matching YAML; if Oracle, confirm the schema-owner trigger from the onboarding doc is installed; one-patient roundtrip.                                | Pending pilot     |
| `indamed.yaml` (mysql/MariaDB)                      | Karam + Praxis-IT              | Confirm MariaDB primary DB (not Firebird side-store); pin schema name (`medoff` is the typical default); one-patient roundtrip.                                                                    | Pending pilot     |
| `quincy.yaml` (firebird)                            | Karam + Praxis-IT              | FREY ADV does not publish schema → drift detector is the only signal; **expect schema_drift on first poll** and pin column names via the onboarding-doc probe.                                     | Pending pilot     |
| `pixelmedics.yaml` (sqlite, hypothesis)             | Karam (with Borealys)          | Out-of-band vendor reply first (see `pixelmedics-vendor-inquiry.md`), THEN first-Praxis schema confirmation.                                                                                       | Pending vendor    |

**Rule:** the first paying Praxis per vendor stays in "pilot" status —
not "ready" — until the row above is signed off (commit message
`feat(bridge): pin <vendor> schema after first-Praxis verification`
moves the row to "verified <date>"). The drift detector + the
`pvs_link_health` integrations card surface mismatches in the portal
UI in real time; the checklist row is the operational handshake that
turns "we built it, looks fine" into "a real Praxis has been emitting
events through it for ≥7 days with zero schema_drift events."

