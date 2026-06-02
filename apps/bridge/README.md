# EINS PVS Bridge

Multi-path PVS integration layer for EINS. Reads from PVS systems
across four paths and forwards canonical events to the EINS Portal's
`/api/pvs/events` endpoint, signed per-clinic with HMAC-SHA256.

The five paths in production (May 2026):

1. **Cloud REST adapters** (`src/adapters/tomedo/`, `src/adapters/red/`,
   `src/adapters/pabau/`, `src/adapters/consentz/`).
   Scheduler-driven, polling. Tomedo + RED awaiting vendor sandbox creds;
   Pabau + Consentz shipped 2026-05-21 per Phase 3 of
   UNIVERSAL_ADAPTER_BUILD.md.
2. **Cloud FHIR push** (`src/adapters/healthhub/`). Shelved; do not retry.
3. **On-prem GDT-Agent** (`agent/`). chokidar folder watcher for GDT files,
   plus Honorar-CSV watcher. Production today.
4. **On-prem SQL-introspection** (`agent/src/db-adapters/`). Direct DB read
   via vendor YAML config; ships AppointmentCreated, AppointmentStatusChanged,
   EncounterCompleted, InvoicePaid, RecallScheduled events that GDT cannot
   produce. Six drivers (postgres, firebird, mssql, sqlite, mysql, oracle)
   and nine Bucket A configs: tomedo (postgres), medatixx + cgm-turbomed +
   quincy (firebird), cgm-albis (postgres, post-2022 migration),
   cgm-m1pro (mssql, newer installs) + cgm-m1pro-oracle (oracle,
   dominant install base; oracledb v6+ Thin mode, no Instant Client
   needed), indamed (mysql/MariaDB), pixelmedics (sqlite, vendor-engine
   TBD). Per-vendor onboarding docs under `docs/onboarding-per-vendor/`;
   verified open questions from the build brief Section 11 recorded in
   `docs/section-11-verification.md`.
5. **Tomedo Lua hooks** (`apps/portal/public/pvs-bridge/tomedo-lua/`).
   Defense-in-depth POSTer that runs inside Tomedo's Skript-Engine and
   covers the same event types as path 4. NOT idempotent against path 4:
   Lua emits a distinct `tomedo-lua:` id prefix on purpose (see the dedup
   note below), so run exactly one of {Lua, DB-read} per Praxis.

## Architecture

```
   PVS sources                          adapter / path
   ─────────────────────────────────────────────────────────────────
   Tomedo / RED / Pabau /     → apps/bridge/src/adapters (REST/FHIR)
   Consentz cloud
   HealthHub                  → (shelved)
   GDT files                  → apps/bridge/agent (chokidar)
   Honorar CSVs               → apps/bridge/agent (chokidar)
   PVS local Postgres/        → apps/bridge/agent/db-adapters
   Firebird/MSSQL/SQLite        (vendor YAML + driver)
   Tomedo Lua workflow hooks  → apps/portal/public/pvs-bridge/tomedo-lua
                                     │
                                     ▼
                       apps/portal /api/pvs/events
                                     │
                                     ▼
                       pvs_event_log → pvs-status-derive worker
                                     → requests.status, revenue,
                                       Forecast, Ads conversions
```

## Layout

- `src/index.ts` — entry point. Boots Fastify on port 7300 + the
  BullMQ scheduler that polls due `pvs_link` rows every 30s.
- `src/config.ts` — env vars (`BRIDGE_DATABASE_URL`, `REDIS_URL`,
  `PORTAL_BASE_URL`, `BRIDGE_PUBLIC_URL`, `APP_KEY` for shared
  encrypted-secret decryption).
- `src/portal-client.ts` — `postEvent(event)` and `postBatch(events)`
  helpers that sign the body with the clinic's PVS secret and POST.
- `src/canonical/types.ts` — TypeScript mirror of the portal's
  `PvsEventSchema`. Adapters return values of these types.
- `src/canonical/sign.ts` — HMAC-SHA256 helper used both by the Bridge
  and by the GDT-Agent (shared via workspace symlink).
- `src/adapters/Adapter.ts` — interface that each PVS vendor implements.
- `src/adapters/{tomedo,healthhub,red,pabau,consentz}/` — per-vendor implementations.
- `src/adapters/_fhir/normalize-shared.ts` — code shared between
  HealthHub and RED (both FHIR-based).
- `src/inbound/` — Fastify routes for the two push adapters:
  `POST /webhooks/healthhub/:linkId` and `POST /webhooks/red/:linkId`.
- `src/sync/` — initial-sync streamer, incremental-poll, scheduler.
- `src/db/client.ts` — read-only postgres-js connection used to load
  `pvs_link`, `pvs_sync_status`, `platform_credentials` rows.
- `n8n-templates/canonical-emitter.json` — reference copy of the n8n
  workflow template. The file actually served to Praxis admins lives at
  `apps/portal/public/pvs-bridge/n8n-templates/canonical-emitter.json`
  (served as a static asset under `/pvs-bridge/n8n-templates/…`). Keep
  these two in lockstep when changing the template — the portal copy is
  what ships to Vercel.
- `agent/` — the on-prem GDT-Agent (separate buildable sub-project).

## Production deployment

A single Node container next to the portal (Fly.io / Hetzner). Public URL
`https://bridge.eins.ag` for HealthHub + RED webhooks.

## Acceptance status

- **Tomedo (REST)**: adapter ready, awaiting Zollsoft sandbox credentials.
  Karam's escalation channel open as of 2026-05-20. Customers on Tomedo
  are routed to the DB-read path below in the meantime.
- **Tomedo (DB-read)**: shipped 2026-05-20. Postgres adapter framework +
  YAML config + Lua defense-in-depth bundle. Zollsoft 3rd-Level-Support
  officially provisions the read-only DB account per AVV (see forum
  thread #86195). End-to-end pilot with first Tomedo Praxis scheduled.
  Onboarding: `docs/onboarding-per-vendor/tomedo.md`.
- **RED**: adapter ready, awaiting RED sandbox.
- **HealthHub**: code retained, **shelved**. The medatixx
  Software-Partner-Antrag was rejected in 2026-05; do not retry. medatixx
  Praxen use GDT-Agent + (Phase 2) Firebird DB-read.
- **medatixx, CGM Albis/Turbomed/M1Pro, Indamed, Quincy, Pixelmedics
  (DB-read)**: Phase 2 shipped 2026-05-20. Drivers + configs +
  onboarding docs in place; awaiting first-customer schema validation.
  See `UNIVERSAL_ADAPTER_BUILD.md`, `docs/section-11-verification.md`.
- **Pabau, Consentz (REST)**: Phase 3 shipped 2026-05-21. Per-Praxis
  api_token / Bearer-token model, no vendor partner program required.
  Pabau API verified against
  support.pabau.com/en/api/api-reference (rate limits, auth header,
  pagination). Consentz API scaffolded; first-Praxis onboarding
  calibrates against vendor-issued tenant docs (Section 11 doc).
  Adapters at `src/adapters/pabau/` and `src/adapters/consentz/`.
  Onboarding docs at `docs/onboarding-per-vendor/{pabau,consentz}.md`.
  Section 11 verification appended to
  `docs/section-11-verification.md`. Schema migration
  `apps/portal/src/db/migrations/0039_pvs_bucket_b.sql` extends the
  pvs_link.pvs_vendor and pvs_event_log.bridge_source CHECK
  constraints to admit `pabau` and `consentz`.

All paths produce canonical events from `src/canonical/types.ts`. The portal
dedups REPLAYS **within a single path** via the
`(clinicId, bridge_source, pvs_external_event_id, occurred_at)` UNIQUE index.

The Tomedo **REST** (path 1) and **DB-read** (path 4) paths ALSO dedup against
each other (Phase 11): both derive the id and `occurred_at` from the single
identity contract in `src/adapters/tomedo/event-identity.ts`, so the same Tomedo
row yields one byte-identical key on either path. `normalize.test.ts` (REST) and
`agent/src/db-adapters/cross-path-dedup.test.ts` (DB-read) pin both sides to the
same fixture, so the convergence can't drift unnoticed.

The **Lua** path stays a separate provenance: it emits a `tomedo-lua:`
`pvs_external_event_id` prefix, because a Lua hook only knows the hook-fire time
(not the row's `modified_at`) for a status change and so cannot reproduce
`occurred_at` for every kind. Aligning only the prefix would dedup invoices but
double-count status changes. So do **not** co-run Lua with DB-read: Lua is the
fallback for sites without DB access, or the path you switch to if a Tomedo
update breaks the Postgres schema. `cross-path-dedup.test.ts` locks that
divergence so it can't be erased by accident.
