# EINS PVS Bridge

Native-adapter service for the EINS PVS Bridge. Reads from PVS systems
(Tomedo via REST polling, HealthHub + RED via FHIR Subscriptions) and
forwards canonical events to the EINS Portal's `/api/pvs/events` endpoint,
signed per-clinic with HMAC-SHA256.

## Architecture

```
   PVS (Tomedo, HealthHub, RED)
              │
              ▼
   apps/bridge (this app)
              │
              ▼
   apps/portal /api/pvs/events
              │
              ▼
   pvs_event_log  →  pvs-status-derive worker  →  requests.status
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
- `src/adapters/{tomedo,healthhub,red}/` — per-vendor implementations.
- `src/adapters/_fhir/normalize-shared.ts` — code shared between
  HealthHub and RED (both FHIR-based).
- `src/inbound/` — Fastify routes for the two push adapters:
  `POST /webhooks/healthhub/:linkId` and `POST /webhooks/red/:linkId`.
- `src/sync/` — initial-sync streamer, incremental-poll, scheduler.
- `src/db/client.ts` — read-only postgres-js connection used to load
  `pvs_link`, `pvs_sync_status`, `platform_credentials` rows.
- `n8n-templates/canonical-emitter.json` — n8n workflow template for
  long-tail PVSs.
- `agent/` — the on-prem GDT-Agent (separate buildable sub-project).

## Production deployment

A single Node container next to the portal (Fly.io / Hetzner). Public URL
`https://bridge.einsvisuals.de` for HealthHub + RED webhooks.

## Acceptance status

- V1.5 Tomedo: adapter ready, awaiting Zollsoft sandbox credentials.
- V1.5 RED:    adapter ready, awaiting RED sandbox.
- V1.5 HealthHub: adapter ready, gated on medatixx Akkreditierung
  (4–8 weeks Vorlauf).

All three implement the same `Adapter` interface and produce identical
canonical events.
