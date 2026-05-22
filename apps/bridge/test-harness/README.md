# EINS PVS Bridge — Local Test Harness

End-to-end smoke tests for **every** bridge ingestion path, with **no real
PVS license required** and **no real portal DB needed** for the default
flow. The harness boots a stub portal that mimics `/api/pvs/events` so the
bridge's signing + canonical-encoding logic can be exercised in isolation.

## What this proves

| Driver       | What it exercises                                              | Real-world equivalent             |
| ------------ | -------------------------------------------------------------- | --------------------------------- |
| `canonical`  | HMAC signing + Zod envelope round-trips for all 8 event kinds  | Any adapter calling `postEvent()` |
| `tomedo`     | OAuth2 + paginated REST + `normalize{Patient,Appointment,…}`   | Zollsoft Tomedo cloud             |
| `fhir`       | `decodeFhirBundle` against Patient/Appointment/Encounter/Invoice | medatixx HealthHub + RED        |
| `gdt`        | GDT file parse + `gdtToCanonical` for 6301 + 8316 Satzarten    | On-prem agent watching a folder   |
| `csv`        | CSV parse + auto-mapping + `mapCsvRow` for all 5 streams       | Honorar-CSV-Watcher path          |

All five run end-to-end against a stub portal which checks the same Zod
schema and the same HMAC signature the real portal does.

## One-liner: run everything

```bash
pnpm install                                            # first time only
pnpm --filter bridge-test-harness harness:all
```

Expected output ends with a green summary like:

```
── summary ──────────────────────────────────────
  ✓ pass  canonical    posted=24 failed=0 ingested=15 deduped=9
  ✓ pass  tomedo       posted=9  failed=0
  ✓ pass  fhir         posted=10 failed=0 mode=fixture
  ✓ pass  gdt          posted=5  failed=0 folder=…
  ✓ pass  csv          posted=7  failed=0 folder=…
```

## Run drivers individually

Each driver boots its own stub portal automatically. In separate terminals:

```bash
pnpm --filter bridge-test-harness harness:portal        # long-running
pnpm --filter bridge-test-harness harness:canonical
pnpm --filter bridge-test-harness harness:tomedo
pnpm --filter bridge-test-harness harness:fhir
pnpm --filter bridge-test-harness harness:gdt
pnpm --filter bridge-test-harness harness:csv
```

While the stub portal is running you can `curl http://127.0.0.1:7401/__stats`
to see what landed.

## Real HAPI FHIR instead of the fixture

The `fhir` driver auto-detects whether HAPI FHIR is reachable at
`FHIR_BASE_URL` (default `http://127.0.0.1:8090/fhir`). If it isn't, it
falls back to `fixtures/fhir-bundle.json` — same canonical events, just
no real HTTP roundtrip.

To run against a real HAPI FHIR R4 server (in-memory, ephemeral):

```bash
docker compose -f apps/bridge/test-harness/docker-compose.yml up -d
# wait ~30s for HAPI to come up — check http://127.0.0.1:8090/fhir/metadata
pnpm --filter bridge-test-harness fhir:seed             # PUTs the fixture
pnpm --filter bridge-test-harness harness:fhir          # now hits HAPI
```

To use the public HAPI test server (no docker, but slower and shared):

```bash
FHIR_BASE_URL=https://hapi.fhir.org/baseR4 \
  pnpm --filter bridge-test-harness fhir:seed
FHIR_BASE_URL=https://hapi.fhir.org/baseR4 \
  pnpm --filter bridge-test-harness harness:fhir
```

## Run against a **real** local portal instead of the stub

The stub portal is great for proving the *bridge* works, but if you also
want to prove the portal's `/api/pvs/events` route end-to-end (Zod parse +
HMAC verification + DB insert + status-derive worker), point the drivers
at it:

```bash
PORTAL_BASE_URL=http://localhost:3001 \
  pnpm --filter bridge-test-harness harness:all
```

The real portal will reject every event with `link_not_ready` /
`clinic_not_found` unless you first seed:

1. A `clinic` row with id matching `TEST_CLINIC_ID`
   (`00000000-0000-4000-8000-00000000eins`).
2. A `pvs_link` row for that clinic with `status = 'connected'` and
   `pvs_vendor = 'tomedo'` (or 'healthhub' / 'red' / 'n8n_custom' /
   'gdt_agent' — but vendor must match `bridgeSource`).
3. A `platform_credentials` row with `platform = 'pvs'` whose
   `access_token_enc` decrypts to `TEST_CLINIC_SECRET` under the portal's
   `APP_KEY`.

See `src/shared.ts` for the constants. The portal team owns the seed
script — see `apps/portal/scripts/seed-pvs-clinic.ts` if it exists, or
adapt `apps/portal/src/server/clinic-signature.ts` to understand the
encryption layout.

## Wire a *live* agent against the generated GDT folder

The `gdt` driver writes its fixture GDT files into a temp folder and
exits. To exercise the **actual chokidar watcher → outbox → portal**
loop from `apps/bridge/agent`:

```bash
# Terminal 1 — stub portal
pnpm --filter bridge-test-harness harness:portal

# Terminal 2 — agent in dev mode, pointed at the stub
EINS_AGENT_CLINIC_ID=00000000-0000-4000-8000-00000000eins \
EINS_AGENT_PORTAL_BASE_URL=http://127.0.0.1:7401 \
EINS_AGENT_SECRET=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef \
EINS_AGENT_WATCH_FOLDER=/tmp/my-gdt-folder \
  pnpm --filter eins-agent dev

# Terminal 3 — drop files into the watched folder
pnpm --filter bridge-test-harness harness:gdt
# then copy the generated files from the printed folder into
# /tmp/my-gdt-folder one at a time
```

(The agent reads its config from a per-user JSON file in production; the
env-var form above is the dev-mode shortcut. See
`apps/bridge/agent/src/config.ts`.)

## Files

```
test-harness/
├── README.md                ← this file
├── package.json             ← own workspace; deps: fastify, zod, tsx
├── tsconfig.json
├── docker-compose.yml       ← HAPI FHIR R4 in a container
├── fixtures/
│   └── fhir-bundle.json     ← seed bundle for HealthHub/RED
└── src/
    ├── shared.ts            ← clinicId, HMAC secret, ports, signBody
    ├── stub-portal.ts       ← mimics /api/pvs/events + /batch
    ├── tomedo-mock.ts       ← mimics Zollsoft REST + OAuth
    ├── fhir-seeder.ts       ← PUTs fixture into HAPI FHIR
    ├── run-canonical.ts     ← one of each canonical event variant
    ├── run-tomedo.ts        ← OAuth + paginate + normalize
    ├── run-fhir.ts          ← decodeFhirBundle for healthhub + red
    ├── run-gdt.ts           ← generates GDT files + parses + posts
    ├── run-csv.ts           ← generates CSV files + maps + posts
    └── run-all.ts           ← orchestrator
```

## When to upgrade to a real PVS sandbox

This harness covers the **80 %** of bugs that live in the bridge code
itself: encoding, signing, parsing, normalization, dedup. The other 20 %
— vendor-specific quirks in field shapes, pagination, FHIR Subscription
delivery semantics — only show up against a real vendor.

- **Tomedo**: email Zollsoft for a partner / developer sandbox (free).
- **RED**: email RED for sandbox credentials (free).
- **medatixx HealthHub**: requires Akkreditierung (4–8 weeks Vorlauf, free
  but bureaucratic). Until then, this harness proves the FHIR R4 code
  path; that code path is identical for HealthHub and RED.
