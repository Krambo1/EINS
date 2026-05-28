# Universal PVS Adapter Build Brief

**Status:** Phases 1 to 4 shipped in-repo (SQL-introspection framework, all five DB drivers, eight vendor YAMLs, Bucket B REST adapters Pabau and Consentz, Tomedo Lua bundle, AVV template, per-vendor onboarding docs, troubleshooting doc, schema-drift detection end-to-end, REST/DB-read failover via `pvs_link.preferred_path`). Phase 5 is the pilot rollout; engineering work outside of vendor-side schema discovery is complete.
**Owner:** Karam (solo engineering).
**Estimated effort:** 14 to 16 weeks of focused engineering total. Phases 1 to 4 done 2026-05-21.
**Created:** 2026-05-20.

This document is the in-repo source of truth for the build. Read it cold and execute. Verify assumptions against the actual codebase before writing code.

## Ship checklist (Phases 1 to 4)

Framework + drivers:
- [x] `apps/bridge/agent/src/db-adapters/` framework + drivers for postgres, firebird, mssql, sqlite, mysql, oracle (oracledb v6+ Thin mode; covers CGM M1 PRO's dominant install base without an Oracle Instant Client bundle).
- [x] `apps/bridge/agent/src/secure-store.ts` extended for named DB credentials.
- [x] CLI flags: `--enable-db-adapter`, `--rotate-db-credential`, `--disable-db-adapter`.
- [x] Runner wired into `apps/bridge/agent/src/index.ts` with graceful shutdown.

Vendor configs (Bucket A, on-prem):
- [x] `tomedo.yaml` (postgres), `medatixx.yaml` (firebird), `cgm-albis.yaml` (postgres, since 2022), `cgm-turbomed.yaml` (firebird), `cgm-m1pro.yaml` (mssql) + `cgm-m1pro-oracle.yaml` (oracle, default-recommended for the dominant M1 PRO install base), `indamed.yaml` (mysql/MariaDB), `quincy.yaml` (firebird), `pixelmedics.yaml` (sqlite, vendor confirmation pending).

REST adapters (Bucket B, cloud):
- [x] `apps/bridge/src/adapters/pabau/` + `consentz/` with normalizers, clients, registry test, scheduler wiring.

Schema-drift detection:
- [x] `framework.ts` snapshots column shape on first poll, halts the stream on drift, records to `db_adapter_drift`.
- [x] `drift-publisher.ts` posts unresolved drift to `/api/pvs/health` with HMAC.
- [x] Portal: migration `0040_pvs_link_health.sql`, `pvs_link_health` Drizzle table, `/api/pvs/health` route, integrations UI warning card at `apps/portal/src/app/(portal)/einstellungen/integrationen/page.tsx`.

REST / DB-read failover:
- [x] `apps/portal/src/db/migrations/0041_pvs_link_preferred_path.sql` adds `pvs_link.preferred_path` with CHECK ('auto', 'rest', 'db_read').
- [x] Cloud scheduler's `loadDueLinks` filters out `preferred_path = 'db_read'` rows so the on-prem agent owns multi-path Tomedo links cleanly.
- [x] Integrations UI surfaces the chosen path for multi-path vendors.

Legal + docs:
- [x] `apps/bridge/legal/AVV-template-DE.md` covering DSGVO Art. 28 inkl. TOM, Sub-Processor-Liste, Praxis-Datenhoheit (Anhänge A bis D).
- [x] `apps/bridge/docs/onboarding-per-vendor/` with one short page per supported PVS (tomedo, medatixx, cgm-albis, cgm-turbomed, cgm-m1pro, indamed, quincy, pixelmedics, pabau, consentz).
- [x] `apps/bridge/docs/troubleshooting.md` covering firewall, credentials, schema drift, vendor updates, and per-engine error tables for Postgres, Firebird, MSSQL, MariaDB, SQLite, and Oracle (the M1 Pro Oracle gap was closed 2026-05-21 by the oracledb-Thin driver; see Abschnitt 8.7).
- [x] `apps/bridge/docs/section-11-verification.md`: Open-question deltas vs the brief (Albis is postgres since 2022, M1 Pro is Oracle-dominant, Indamed is MariaDB).

Test state:
- [x] Tests: all 234 agent vitest cases pass on the dev machine (Node 24). The earlier "26 failing on Node 24" report was a misdiagnosis: the cause was NOT a missing C++ toolchain. pnpm 10 disables dependency build scripts unless the package is in the root `pnpm.onlyBuiltDependencies` allowlist, and `better-sqlite3-multiple-ciphers` (the encrypted-outbox driver) was not listed, so its `install` script (`prebuild-install`) never ran and no native binding was fetched. A Node-24 prebuild exists upstream (node-v137 win32-x64), so no compiler is needed. Fix: added `better-sqlite3-multiple-ciphers` to `onlyBuiltDependencies`; a fresh `pnpm install` now fetches the prebuilt binding and all cases pass.

Owner-side TODOs (no engineering work left):
- [ ] Counsel review of the AVV template (Karam to schedule with the practice's Datenschutzbeauftragte and ideally a Fachanwalt:in IT-Medizinrecht).
- [ ] Schema-discovery probe against a real Tomedo install (Karam to schedule with the first Tomedo pilot Praxis).
- [ ] Pixelmedics engine confirmation with Borealys GmbH (Karam owns the conversation).
- [ ] Phase 5 pilot rollout: one paying Praxis per vendor engine (Karam-led commercial work).

---

## 1. Purpose

Ship a **universal PVS integration layer** so the EINS Portal works fully (auto-status, Forecast, Werbebudget ROI, Ads conversion uploads, practitioner attribution, recalls, the differentiated surface) on **any aesthetic Praxis in DACH** regardless of which PVS they use, with **zero dependency on any PVS vendor's partner program**.

This replaces the current strategy of waiting on Zollsoft and RED sandbox credentials and pretending GDT-Agent alone is sufficient.

## 2. Strategic context (why this matters)

The EINS PVS Bridge is the **category-defining moat** for EINS, not a feature. No DACH marketing-agency competitor (ScaleBeauty, ESTIQ, ÄSTHETIK ADS, Docleads, Ganssimpel, KLINIKA, Hello Beauty) reads PVS-level data. Horizontal reporting platforms (AgencyAnalytics, Whatagraph, DashThis, Funnel.io, Triple Whale) have zero PVS integrations.

Today the bridge has three production-quality paths (Tomedo REST, RED FHIR, GDT-Agent), but two are blocked on vendor sandbox access and one (GDT-Agent) cannot emit `AppointmentCreated`, `AppointmentStatusChanged`, `AppointmentCancelled`, `RecallScheduled` events at all, which breaks the portal's differentiated surface (Auswertung, Forecast, Werbebudget ROI, Ads conversion outbox).

This build closes that gap by reading directly from each PVS's local database via the existing on-prem agent. **Direct DB access is legally defensible** under DSGVO Art. 20 (Data Portability) and BGH rulings on Praxis-Datenhoheit, as long as the read is authorized by the Praxis (the data owner) via AVV. PVS vendor EULAs cannot override that.

Full strategic frame: Notion "Wettbewerb & Markt (April 2026)" Section 8. Memory: `project_pvs_bridge_moat.md`.

## 3. Current state of the bridge (read first)

Before writing any code, read these files to understand the existing architecture:

- `apps/bridge/README.md`: production architecture overview.
- `apps/bridge/src/canonical/types.ts`: canonical event schema. **Do not change this.** All new adapters emit events of these exact shapes.
- `apps/bridge/src/adapters/Adapter.ts`: the bridge-side adapter interface (REST/FHIR adapters).
- `apps/bridge/src/adapters/tomedo/index.ts` and `normalize.ts`: reference REST adapter implementation. Use this as the model for cloud-API adapters (Bucket B).
- `apps/bridge/agent/src/index.ts`: agent entry point.
- `apps/bridge/agent/src/gdt-parser.ts`, `csv-parser.ts`, `watcher.ts`, `csv-watcher.ts`: existing file-based ingestion in the agent. The new DB-read framework lives alongside these.
- `apps/bridge/agent/src/normalize.ts`: how the GDT-Agent translates raw inputs into canonical events. Reference pattern for per-vendor normalizers.
- `apps/bridge/agent/src/outbox.ts`, `portal-client.ts`, `secure-store.ts`: shared agent plumbing. Use as-is. DB adapters submit events to the outbox the same way GDT does.
- `apps/portal/src/worker/processors/pvs-status-derive.ts`: the portal-side worker that folds events into `requests.status` and revenue. **The events you emit must match this worker's expectations exactly.** Re-read its `deriveStatusForBucket` and `foldEvents` to understand which fields are non-optional.
- `apps/portal/src/server/pvs-events.ts`: portal-side Zod validation for incoming events.

## 4. The problem (what GDT-Agent cannot do)

`pvs-status-derive.ts` requires events with linked `pvsAppointmentId` to advance `requests.status` past `qualifiziert`. GDT cannot emit:

- `AppointmentCreated` (no concept of "appointment booked" in GDT)
- `AppointmentStatusChanged` (no concept of `checked_in`, `no_show`, `cancelled`)
- `AppointmentCancelled`
- `RecallScheduled`

GDT-emitted `EncounterCompleted` events carry no `pvsAppointmentId`, so the worker silently skips them (see `pvs-status-derive.ts` around line 233). GDT-emitted `InvoicePaid` events fire only if the PVS is configured to ship Honorar-FKs in GDT (rare default; medatixx requires support activation), and even then carry no `pvsAppointmentId`.

Net effect on a GDT-only Praxis: auto-status progression is dead, Forecast engine has zero `won` samples, Werbebudget ROI cannot attribute revenue to leads, Meta CAPI and Google OCI conversion uploads never fire. The portal looks half-empty.

Manual confirmation in the Anfragen UI is **rejected as a solution**. Reason: MFA discipline is unreliable and EINS has a hard rule against code workarounds for MFA discipline gaps (memory: `feedback_no_code_for_mfa_discipline.md`).

## 5. What to build (seven deliverables)

### 5.1 Generic SQL-introspection adapter framework in the agent

Add a new module `apps/bridge/agent/src/db-adapters/` that contains:

- `framework.ts`: generic driver-pluggable DB reader.
- `drivers/`: thin wrappers per DB engine: `postgres.ts`, `firebird.ts`, `mssql.ts`, `sqlite.ts`. Each implements a common `DbDriver` interface: `connect`, `query(sql, params)`, `close`.
- `vendor-config.ts`: YAML/JSON schema definition + loader for per-vendor configs.
- `runner.ts`: scheduler that loads enabled vendor configs, polls each stream on its configured interval, normalizes rows into `CanonicalEvent`, hands off to the existing `outbox.ts`.
- `normalizer.ts`: shared row-to-event transformer driven by the `map:` block in vendor configs.

**Config schema (proposed):**

```yaml
vendor: tomedo-db
driver: postgres
connection:
  # Resolved at runtime from agent secure-store; never inline credentials.
  credentialId: tomedo-db-default
  port: 5432
  database: tomedo
streams:
  - kind: PatientUpserted
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, vorname, nachname, email, telefon, geburtsdatum, geschlecht, kommentar, modified_at
      FROM patienten
      WHERE modified_at > :cursor
      ORDER BY modified_at ASC
      LIMIT 500
    map:
      pvsPatientId: id
      fullName: "{vorname} {nachname}"
      email: email
      phone: telefon
      dob: geburtsdatum
      gender: { from: geschlecht, transform: gender }
      bemerkung: kommentar
      occurredAt: modified_at
  - kind: AppointmentCreated
    cursorColumn: modified_at
    query: |
      SELECT id, patient_id, termin_zeit, behandlung_code, behandlung_name, raum_id, raum_name, kommentar, modified_at
      FROM termine
      WHERE modified_at > :cursor
      ORDER BY modified_at ASC
      LIMIT 500
    map:
      pvsAppointmentId: id
      pvsPatientId: patient_id
      scheduledAt: termin_zeit
      treatmentCode: behandlung_code
      treatmentLabel: behandlung_name
      locationCode: raum_id
      locationLabel: raum_name
      bemerkung: kommentar
      occurredAt: modified_at
  # ... and so on for AppointmentStatusChanged, EncounterCompleted, InvoicePaid, RecallScheduled
```

**Cursor persistence:** reuse the agent's existing SQLite outbox state store. One cursor per `(vendorId, streamKind)` tuple, persisted after every successful batch ack from the portal.

**Backpressure and error handling:** mirror the existing scheduler logic from `apps/bridge/src/sync/`. Fail-threshold per stream, exponential backoff, `pvs_link.status='error'` after FAIL_THRESHOLD consecutive failures.

**Idempotency:** every event needs a stable `pvsExternalEventId` derived from vendor primary key + cursor value, so a re-poll of the same row produces the same event id and the portal dedups it.

### 5.2 Per-vendor DB-read configs (Bucket A)

Ship config files upfront for every on-prem PVS in the addressable set, **not demand-driven**. Order them by aesthetic-Praxen density (see `MEMORY.md` entry for `project_pvs_adapter_priorities.md`):

| Priority | Vendor | DB engine | Estimated effort | Notes |
|---|---|---|---|---|
| 1 | Tomedo | PostgreSQL (local on Mac) | 1 to 2 weeks (first config, sets the pattern) | Highest aesthetic density. Mac-anchored. |
| 2 | medatixx (x.isynet / x.concept / x.comfort) | Firebird (local on Windows server) | 2 to 3 weeks | Firebird schema undocumented. Reverse-engineer carefully. |
| 3 | CGM Albis | Firebird (Windows) | 1 to 2 weeks once medatixx Firebird driver exists | Schema undocumented. |
| 4 | CGM Turbomed | Firebird (Windows) | 1 week (similar engine to Albis) | |
| 5 | CGM M1 Pro | MS SQL Server (newer installs) | 1 week | Better-tooled engine. |
| 6 | Indamed Medical Office | PostgreSQL or proprietary (verify) | 1 to 2 weeks | |
| 7 | Quincy (Frey ADV) | TBD (verify locally) | 2 weeks | |
| 8 | Pixelmedics | likely SQLite or Postgres (verify with vendor) | 1 to 2 weeks | 100% in-segment, small vendor, direct deal possible. |
| 9 | DURIA / DURIA² | proprietary engine | Defer | Hardest case; rely on GDT-Agent fallback unless a customer demands. |

**For each:** schema-discovery phase first (2 to 5 days on a real install, with explicit Praxis authorization), then config writing (3 to 5 days), then end-to-end test against the same install (2 days).

Skip the following entirely:
- CGM Medistar (proprietary, low aesthetic density, very high effort)
- Doc Cirrus inSuite (cloud-only, no local DB)

### 5.3 Cloud REST adapters (Bucket B)

These do **not** use the on-prem agent. They live in the existing `apps/bridge/src/adapters/` directory next to `tomedo/` and `red/`.

| Vendor | API | Effort | Reference |
|---|---|---|---|
| Pabau | REST, publicly documented | 1 week | https://pabau.com/api |
| Consentz | REST | 1 week | https://www.consentz.com (contact for docs) |

Pattern: copy `apps/bridge/src/adapters/tomedo/` as scaffold, swap client for the vendor's REST, write normalizers that emit the same `CanonicalEvent` shapes.

### 5.4 Schema-drift detection

When a PVS vendor pushes an update that renames a column or restructures a table, the agent must fail loudly, not silently emit empty events.

Add to `framework.ts`:

- On first successful poll per stream, snapshot the result-set column names into the cursor state.
- On every subsequent poll, compare current column names to the snapshot. Mismatch → mark stream as `schema_drift`, stop polling that stream only, post a `pvs_link_health` event to the portal with the diff, do not crash other streams.
- Surface drift in the portal at `Einstellungen → Integrationen → PVS` so the Praxis IT person can be alerted to update the config.

### 5.5 Defense-in-depth for Tomedo: Lua script plugin variant

Tomedo supports Lua scripting inside the client that fires on workflow events (appointment status change, invoice booking, encounter completed). Build a `.lua` script set that POSTs canonical events directly to `bridge.einsvisuals.de` with HMAC-SHA256 signing.

Ship as a downloadable bundle at `apps/portal/public/pvs-bridge/tomedo-lua/` alongside the existing `n8n-templates/`. Praxis IT drops the scripts in the Tomedo `Lua/` folder during enrollment.

**Why both DB-read and Lua for Tomedo:** redundancy. A Tomedo software update could break either path independently. If the Postgres schema changes and DB-read goes to `schema_drift`, Lua keeps emitting. If a Lua API changes, DB-read keeps polling. Customers never see an outage.

### 5.6 AVV + onboarding pack

Document, do not just code. Create:

- `apps/bridge/legal/AVV-template-DE.md`: Auftragsverarbeitungsvertrag template explicitly authorizing the agent to read the named DB tables on the Praxis's behalf. Cite DSGVO Art. 20, Art. 28, and BGH ruling references.
- `apps/bridge/docs/onboarding-per-vendor/`: one short markdown per supported PVS, written for the Praxis IT person. Steps: install agent, configure read-only DB credentials, enable monitoring, verify first event arrives in the portal.
- `apps/bridge/docs/troubleshooting.md`: common failures (firewall blocks, wrong credentials, schema drift, vendor update broke a column rename), recovery playbook for each.

**Positioning constraint (hard):** never frame this as "bypassing Tomedo" or "hacking medatixx." Frame it as **"the EINS Agent reads the Praxis's own data, on the Praxis's own hardware, with the Praxis's explicit written authorization."** This is legally and culturally critical. The AVV is the contract. The vendor EULA is not relevant because the Praxis (data owner) is the one granting access to their own data.

### 5.7 Keep vendor sandbox channels open in parallel

Do not abandon Zollsoft and RED partner-program outreach. If they unblock, flip new customers on those PVS to REST and keep DB-read as fallback. Best of both: REST when available, DB-read when not, automatic failover via `pvs_link.preferred_path` config.

Karam handles the outreach side (see Tomedo escalation email drafted in conversation 2026-05-20). Engineering side: ensure the framework treats DB-read and REST as interchangeable paths for the same vendor, selected by `pvs_link.preferred_path`.

## 6. Architecture

```
apps/bridge/
├── src/
│   ├── adapters/
│   │   ├── tomedo/             (existing, REST)
│   │   ├── red/                (existing, FHIR)
│   │   ├── healthhub/          (existing, shelved, do not touch)
│   │   ├── pabau/              (NEW, REST)
│   │   └── consentz/           (NEW, REST)
│   ├── canonical/              (existing, do not change types)
│   └── sync/                   (existing scheduler patterns to mirror in the agent framework)
├── agent/
│   └── src/
│       ├── gdt-parser.ts       (existing)
│       ├── csv-parser.ts       (existing)
│       ├── csv-watcher.ts      (existing)
│       ├── watcher.ts          (existing)
│       ├── outbox.ts           (existing, reuse)
│       ├── portal-client.ts    (existing, reuse)
│       ├── secure-store.ts     (existing, reuse for DB credentials)
│       └── db-adapters/        (NEW)
│           ├── framework.ts
│           ├── runner.ts
│           ├── normalizer.ts
│           ├── vendor-config.ts
│           ├── drivers/
│           │   ├── postgres.ts
│           │   ├── firebird.ts
│           │   ├── mssql.ts
│           │   └── sqlite.ts
│           └── configs/        (YAML per vendor)
│               ├── tomedo.yaml
│               ├── medatixx.yaml
│               ├── cgm-albis.yaml
│               ├── cgm-turbomed.yaml
│               ├── cgm-m1pro.yaml
│               ├── indamed.yaml
│               ├── quincy.yaml
│               └── pixelmedics.yaml
├── legal/
│   └── AVV-template-DE.md      (NEW)
├── docs/
│   ├── onboarding-per-vendor/  (NEW, one file per vendor)
│   └── troubleshooting.md      (NEW)
└── UNIVERSAL_ADAPTER_BUILD.md  (this file)

apps/portal/
└── public/
    └── pvs-bridge/
        ├── n8n-templates/      (existing)
        └── tomedo-lua/         (NEW, Lua script bundle)
```

## 7. Canonical event contract (do not change)

Every adapter (REST, FHIR, GDT-Agent, DB-read, Lua) emits the same `CanonicalEvent` shapes defined in `apps/bridge/src/canonical/types.ts`. The portal's `pvs-status-derive.ts` worker requires:

- `AppointmentCreated.pvsAppointmentId` populated, plus `scheduledAt`, plus `pvsPatientId`.
- `AppointmentStatusChanged.newStatus` ∈ `scheduled | checked_in | completed | no_show | cancelled`, plus `pvsAppointmentId`.
- `EncounterCompleted.pvsAppointmentId` populated (critical, otherwise the worker skips the event entirely).
- `InvoicePaid.pvsAppointmentId` populated, plus `amountCents` (integer cents), plus `paidAt`.
- `RecallScheduled.recallAt`, `pvsRecallId`, `pvsPatientId`.

Re-read `pvs-status-derive.ts:foldEvents` and `deriveStatusForBucket` to verify. Any event missing the linkage field is silently dropped by the portal worker, which is the failure mode the GDT-Agent has today and which this build exists to eliminate.

## 8. Build order and rationale

**Phase 1 (weeks 1 to 3): Framework + first vendor.**
- Build `framework.ts` + `postgres` driver + Tomedo config end-to-end against a real Tomedo install.
- Get one `AppointmentCreated` event flowing from Postgres → outbox → portal → `requests.status='termin_vereinbart'`.
- This proves the architecture before you build five more configs on top of it.
- Bonus: ship the Lua script variant for Tomedo this phase too (defense in depth).

**Phase 2 (weeks 4 to 9): Bucket A coverage.**
- Add `firebird` driver, then medatixx → CGM Albis → CGM Turbomed configs in sequence. Most of the work after the driver exists is schema discovery per vendor.
- Add `mssql` driver, then CGM M1 Pro.
- Add Indamed, Quincy, Pixelmedics in any order based on which customer signs first.

**Phase 3 (weeks 10 to 11): Bucket B cloud APIs.**
- Pabau adapter in `apps/bridge/src/adapters/pabau/`.
- Consentz adapter in `apps/bridge/src/adapters/consentz/`.
- Both copy the Tomedo REST scaffold.

**Phase 4 (weeks 12 to 14): Schema-drift detection + AVV + onboarding docs.**
- Implement drift detection in `framework.ts`.
- Write the AVV template and one onboarding doc per supported vendor.
- Write troubleshooting doc.

**Phase 5 (weeks 15 to 16): End-to-end customer pilot.**
- Onboard one paying Praxis per supported PVS engine (at minimum: one Tomedo, one medatixx, one CGM, one Pabau-or-Consentz).
- Verify each `requests.status` flow end-to-end against real PVS data.
- Verify Werbebudget ROI, Forecast, and Ads conversion outbox all fire correctly.

## 9. Definition of done

The build is shippable when:

1. The agent can be configured with a YAML vendor file, given DB credentials, and produces a steady stream of `CanonicalEvent` rows reaching `apps/portal/src/app/api/pvs/events/route.ts`.
2. For at least one Praxis on each of: Tomedo, medatixx, CGM Albis, Indamed, Pabau, the `requests.status` field on a real lead progresses through `termin_vereinbart → beratung_erschienen → behandelt → gewonnen` driven entirely by PVS events.
3. `forecast/engine.ts` produces non-stub p10/p50/p90 buckets for that Praxis after enough wins are recorded.
4. Meta CAPI and Google OCI conversion outbox rows fire for `InvoicePaid` events.
5. Schema-drift detection has been tested: rename a column in a test DB, agent posts a `pvs_link_health` event, no crash.
6. AVV template is reviewed by counsel before any production customer is onboarded with DB-read.
7. Onboarding doc per vendor is short enough (< 1 page) that a non-technical Praxis IT person can follow it.

## 10. Hard constraints (do not violate)

- **No manual-confirm UI in Anfragen.** EINS rejects MFA-discipline-dependent solutions. See memory `feedback_no_code_for_mfa_discipline.md`.
- **No em-dashes anywhere** in code comments, copy, docs, or German strings. Use colons, semicolons, periods. En-dashes for numeric ranges are fine. See memory `feedback_no_em_dashes.md`.
- **Praxis not Klinik** in any German user-visible string. Code identifiers like `clinicId` can stay as-is. See memory `feedback_praxis_not_klinik.md` and the project CLAUDE.md.
- **Do not retry the medatixx HealthHub Software-Partner-Antrag.** The Bridge README is explicit: "do not retry". medatixx Praxen go through the GDT-Agent path AND the new Firebird DB-read path. Never the FHIR HealthHub path.
- **Do not change the canonical event schema** in `apps/bridge/src/canonical/types.ts`. The portal contract is fixed. New event kinds require a coordinated portal-side migration.
- **Never frame the build as bypassing or hacking any vendor.** The frame is always "reading the Praxis's own data with the Praxis's authorization." This is legally and culturally critical.
- **No worktrees.** Karam's dev server runs against the main repo; worktree edits are invisible. See memory `feedback_no_worktrees.md`.
- **No code workarounds for vendor sandbox delays.** The DB-read path is the solution, not retries against a sandbox that may never grant access.

## 11. Open questions for the implementer to verify before coding

- Confirm Tomedo's local Postgres port and credential-issuance flow on a real Mac install. The README and adapter code suggest a "tenant-specific endpoint" model; verify whether the Praxis IT person can issue read-only DB credentials via the Tomedo admin UI, or whether direct Postgres `pg_hba.conf` editing is required.
- Verify medatixx's local Firebird file location and access model. Some installs run Firebird embedded (file-based), some run as a service. The agent install steps differ.
- Verify CGM Albis vs Turbomed Firebird schema overlap. If the schemas are similar enough, one driver + two configs is fine; if they diverge a lot, two separate drivers may be cleaner.
- Confirm Pixelmedics' DB engine by direct contact with Borealys GmbH. The vendor is small enough for a direct conversation; verify before assuming SQLite or Postgres.
- Confirm Pabau API rate limits and whether their per-clinic API key model allows the bridge to act on behalf of multiple Praxen with one developer account, or whether each Praxis needs to grant access independently.

## 12. References

- Project CLAUDE.md: `D:\Desktop\EINSWebsite\CLAUDE.md`
- Bridge README: `apps/bridge/README.md`
- Canonical types: `apps/bridge/src/canonical/types.ts`
- Status-derive worker: `apps/portal/src/worker/processors/pvs-status-derive.ts`
- Portal event API: `apps/portal/src/app/api/pvs/events/route.ts`
- Notion strategic context: "Wettbewerb & Markt (April 2026)" Section 8 (https://www.notion.so/34be7fc887348148a71fc7c216db04d8)
- Memory files (in `C:\Users\karam\.claude\projects\D--Desktop-EINSWebsite\memory\`):
  - `project_pvs_bridge_moat.md`
  - `project_pvs_adapter_priorities.md`
  - `feedback_no_code_for_mfa_discipline.md`
  - `feedback_no_em_dashes.md`
  - `feedback_praxis_not_klinik.md`
  - `feedback_no_worktrees.md`
