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

## Build & package

`pnpm --filter eins-agent build:bundle` produces `bundle/` — a
self-contained, runnable agent: the compiled `dist/`, a FLAT, real-file
production `node_modules` (native bindings included), and per-platform
launchers (`eins-agent.cmd`, `eins-agent`). The signed `.msi` (Windows) /
`.dmg` (macOS) installer wraps this folder plus a pinned Node runtime and
drops it under Program Files / Applications.

Native bindings the bundle must carry: `better-sqlite3-multiple-ciphers`
(the SQLCipher outbox), `better-sqlite3` (the read-only SQLite vendor
adapter, e.g. Pixelmedics), and `oracledb` (CGM M1 PRO). The build asserts
the SQLCipher binding is present and aborts if it is not, so a bundle that
cannot open the outbox can never ship silently.

> **ABI invariant:** `better-sqlite3(-multiple-ciphers)` is a V8-ABI (NAN)
> addon — its prebuilt binary is Node-MAJOR-version specific (the filename
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
the encrypted outbox, secure-store, and the watcher mtime cursor. All
state stores (outbox queue, `watcher_state`, `db_adapter_state`) share the
single SQLCipher-keyed connection from `outbox.ts:outboxConnection()`;
none of them open the outbox file with a second, plaintext driver.
