# EINS GDT-Agent

On-prem Bridge agent for clinics running legacy/local PVS software
(CGM Albis, x.concept, pixelmedic, DURIA, etc.) that exports GDT/BDT
files. The agent watches a configured folder for new GDT records,
parses them, normalizes to canonical EINS events, and POSTs to the
portal — signed with the per-clinic HMAC secret.

## Topology

```
   Praxis-PC                              EINS Portal
   ─────────                              ────────────
   PVS  →  GDT folder  →  eins-agent  ─────────────►  /api/pvs/events
                          (chokidar)   HMAC-signed
                            │
                            ▼
                          outbox.sqlite (retries)
```

The agent runs as a Windows service / macOS LaunchAgent. It does NOT
connect to the Bridge service — it POSTs directly to the portal so a
Bridge outage doesn't block on-prem sync (the portal endpoint is the
durability boundary).

## Install

1. The inhaber clicks **Einstellungen → PVS → GDT-Agent installieren**
   in the portal. The page issues a one-time enrollment token (24h TTL).
2. Download the installer (Windows: `.msi`, macOS: `.dmg`) signed with
   the EINS EV / Apple Developer certificate.
3. Run installer; it prompts for the enrollment token + the path to the
   PVS's GDT-out folder.
4. Agent calls `POST /api/pvs/agent-enroll` with the token + a machine
   fingerprint. On success, the portal returns the per-clinic HMAC
   secret which the agent stores encrypted via DPAPI (Windows) /
   Keychain (macOS).

## Layout

- `src/index.ts` — entry point. Boots watcher + outbox flush loop.
- `src/config.ts` — local config (JSON) + secure-store delegation.
- `src/enrollment.ts` — one-shot enrollment + secret persistence.
- `src/watcher.ts` — chokidar folder watch with debouncing.
- `src/gdt-parser.ts` — GDT field-record parser (Satzart 6301, 8316,
  8000, 6200 etc.).
- `src/normalize.ts` — GDT record → canonical event.
- `src/outbox.ts` — SQLite-backed retry queue (per-file send state).
- `src/secure-store.ts` — DPAPI / Keychain wrappers.
- `src/portal-client.ts` — HMAC-signed POST helper (duplicates apps/bridge
  to keep the agent zero-dep on the bridge package).

## Tests

`vitest run` exercises the GDT parser against captured fixtures from
several PVS exports (anonymised).
