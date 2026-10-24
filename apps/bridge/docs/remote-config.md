# Remote Vendor-Config Delivery

**Status:** shipped. Agent 0.3.0, portal migration 0071.
**Problem it solves:** a PVS update renames a column, the agent halts the affected stream, and fixing it used to mean a new agent build reinstalled on every affected Praxis machine. At thirty Praxen on one PVS, a one-line YAML change was thirty site visits.

Now: edit the YAML, sign it offline, upload it, set a rollout. Every agent picks it up on its next heartbeat, clears the halt, and resumes.

---

## The trust model, first

A vendor config is SQL that runs against a Praxis patient database. Whoever can push one has read access to patient data on every machine that accepts it. That single fact decides the whole design:

- **The private signing key never touches the portal, the repo, CI, or any environment variable.** Signing happens on your machine with a key you keep offline.
- **The portal only ever verifies.** It holds the PUBLIC key (`PVS_CONFIG_PUBLIC_KEYS`) and stores the uploaded bundle byte for byte. It cannot mint a config.
- **The agent verifies again** against a trust anchor compiled into its binary (`config-trust.ts`), then validates the YAML with the same loader it uses for bundled configs, then cross-checks the signed header against the parsed YAML.

A fully compromised portal can withhold an update or replay an old one. It cannot author one, and the agent's monotonic-version rule refuses the replay.

---

## One-time setup

### 1. Generate the keypair

```bash
pnpm --filter eins-agent config:keygen -- --key-id eins-pvs-2026a --out "D:/secure/eins-pvs-2026a.pem" --install
```

- Writes the private key (mode 0600) plus a sidecar `.json` holding the key id and public half.
- `--install` rewrites `apps/bridge/agent/src/db-adapters/config-trust.ts` with the public key, keeping any existing entries (rotation needs both trusted at once).
- Prints the `PVS_CONFIG_PUBLIC_KEYS` line for the portal.

**Move the private key somewhere offline.** A password manager entry or an encrypted USB key. Not the repo, not Infisical, not a CI secret.

### 2. Ship the agent build that carries the key

An agent whose trust anchor lacks the key refuses every bundle signed with it. Roll out the new agent BEFORE publishing anything.

### 3. Set the portal env

```
PVS_CONFIG_PUBLIC_KEYS='[{"keyId":"eins-pvs-2026a","publicKey":"<base64>"}]'
```

Public only. Without it the portal refuses every upload, which is the right behaviour for an unprovisioned environment.

### 4. Apply the migration

```bash
pnpm --filter portal db:migrate
```

---

## Publishing a config change

1. **Edit the YAML** in `apps/bridge/agent/src/db-adapters/configs/`. This stays the source of truth and still ships bundled with new agent builds.

2. **Sign it.**

   ```bash
   pnpm --filter eins-agent config:sign -- \
     --vendor tomedo-db --version 4 \
     --key "D:/secure/eins-pvs-2026a.pem" \
     --notes "Tomedo 1.152: termin.status_id heisst jetzt termin.status"
   ```

   The signer **validates before it signs** with the same loader the agent runs, so a typo is caught once here instead of thirty times in the field. It writes `tomedo-db-v4.signed.json`.

3. **Upload** at `/admin/pvs-bridge/konfigurationen`. The portal verifies the signature and stores it with the rollout switched **off**. Publishing is never the same action as deploying.

4. **Roll out.** Set one Praxis as a pilot (`Verteilung: Pilot` plus a pin on that Praxis), watch the "Stand je Praxis" table until it reports the new version running, then switch to `Alle`.

### Versions only ever go up

Agents refuse any version at or below the one they run, which is what makes a replayed bundle useless to an attacker. Consequences:

- A version number is never reused. The portal refuses an upload that is not above the current top and tells you which number to use.
- **A revert is a new, higher version carrying the older YAML.** To go back to v3, sign its YAML as v6.

---

## What happens on the machine

Every 60 seconds the agent's heartbeat response carries a manifest of `(vendor, version, sha256)`. When something differs it calls `/api/pvs/agent/config` for the full bundles and runs them through, in order:

1. Ed25519 signature against the compiled-in trust anchor
2. SHA-256 of the YAML against the signed digest
3. version strictly greater than the local one
4. not quarantined on this machine
5. `minAgentVersion` satisfied
6. full YAML validation
7. signed header vs. parsed YAML (`vendor`, `bridgeSource`, `driver` must agree)

Only then does it write the config and reload the runner, which:

- clears `schema_drift` / `config_invalid` / `error` halts so the fixed stream runs again,
- clears the column snapshot (the new config exists *because* the columns changed; keeping the old snapshot would re-detect drift immediately),
- keeps the cursor, unless `cursorType` changed, in which case that one stream restarts and portal-side dedup absorbs the overlap,
- rebuilds the DB connection only if connection parameters changed.

### Self-rollback

A push that reaches thirty machines can break thirty machines, so every apply is on probation for 15 minutes. The agent snapshots each stream's status just before the swap. If a stream that was **healthy before** is halted afterwards, the machine:

- restores the previous config (or the bundled one, if there is no earlier remote version),
- quarantines the bad version so it is never applied there again, even though the portal keeps advertising it,
- reports the rollback on the next heartbeat, where it shows up under "Selbst zurückgesetzt".

A stream that was **already halted** before the push is not a regression: that is usually the reason the config was published, and treating it as one would revert every legitimate repair before it had a chance to run.

Recovery from a quarantined version is a new signed version, which is what you would publish anyway.

---

## Reading the admin page

`/admin/pvs-bridge/konfigurationen`

- **Läuft** is what the agent last reported. **Soll** is what the portal would deliver right now. A gap that persists past a few minutes means the delivery is stuck, not slow.
- **Abgleich fehlgeschlagen** carries the agent's own reason: an unreachable portal, a bundle it refused, a config that needs a newer agent.
- **Selbst zurückgesetzt** is the machine overruling you. Read the reason before republishing.

---

## Files

| Path | What |
|---|---|
| `agent/src/db-adapters/config-signature.ts` | Bundle format, canonicalisation, Ed25519 verify |
| `agent/src/db-adapters/config-trust.ts` | Compiled-in trust anchor (public keys) |
| `agent/src/db-adapters/remote-config-store.ts` | On-disk cache, `.prev`, quarantine, rollback log |
| `agent/src/db-adapters/config-sync.ts` | Manifest → verify → apply → probation → rollback |
| `agent/scripts/pvs-config-keygen.ts` | Keypair generation (`config:keygen`) |
| `agent/scripts/sign-vendor-config.ts` | Validate + sign (`config:sign`) |
| `portal/src/server/pvs-config-signature.ts` | Verification mirror (public key only) |
| `portal/src/server/pvs-vendor-config.ts` | Rollout resolution, publish, pins |
| `portal/src/app/api/pvs/agent/config/route.ts` | Signed bundle delivery |
| `portal/src/app/admin/pvs-bridge/konfigurationen/` | Admin surface |

The verification code is duplicated between agent and portal on purpose: the agent ships as a single binary with zero monorepo runtime deps. A committed fixture (`portal/src/server/__fixtures__/pvs-signed-config.ts`) is a bundle the agent's signer really produced, verified by the portal's verifier in `pvs-config-signature.test.ts`, so the two cannot drift apart silently.

---

## Not built yet

**Signed agent self-update.** This delivers configs, not the binary. A change that needs new agent code (a new transform, a new driver, a `minAgentVersion` bump) still needs an install. `minAgentVersion` at least makes that failure explicit: the agent refuses the config and says why, instead of applying something it cannot execute.
