# PVS Bridge: Operator Runbook

**Audience**: an on-call engineer (or Karam) responding to a PVS Bridge
incident in production. Assumes you have:

- Portal admin access at `admin.localhost` (dev) or `https://admin.eins.ag` (prod).
- SSH/RDP access to the Praxis Windows workstation OR ability to ask the
  Praxis admin to run a PowerShell command via screen-share.
- `pnpm` and Node 20 locally so you can run `pnpm --filter portal pvs:reconcile …`.
- Read access to `pvs_event_log`, `pvs_agent_status`, `pvs_link`, and
  `pvs_link_audit` via the operator DB user.

If you don't have any of those, escalate to Karam first; don't try to
diagnose blind.

The first three sections are the "page in the middle of the night"
playbooks. The last section ("Reconciliation primitives") is the toolbox.

---

## Quick map

| Symptom                                                | Section                            |
|--------------------------------------------------------|------------------------------------|
| Agent's dashboard tile shows 401 / red banner          | [1. Agent shows 401](#1-agent-shows-401-in-dashboard) |
| Praxis installed the agent but no events appear        | [2. No events after install](#2-praxis-sees-no-events-after-install) |
| A patient's revenue is on the wrong row                | [3. Maria Müller mis-linked](#3-maria-mller-mis-linked) |
| Admin dashboard shows a spike in 4xx from one IP       | [4. Mass 4xx spike](#4-mass-4xx-spike) |
| Anything else                                          | Escalate. Don't guess.            |

---

## 1. Agent shows 401 in dashboard

The admin clinic-detail page's PVS-Bridge tile reads "Letzter Fehler:
http 401 invalid_request" and the failed-events count is climbing. The
agent itself is still alive (heartbeat is current within the last
60 seconds) but every event POST is rejected.

### Diagnosis tree

```
Does pvs_agent_status.last_heartbeat_at < 2 min ago?
├── NO  → agent is dead-or-offline; jump to "agent down" branch below.
└── YES → secret-related; continue.

Does the secret in platform_credentials (clinic, 'pvs') match what the
agent has stored?
├── Check pvs_link_audit for kind='secret_rotated' or 'enrollment_redeemed'
│   in the last 7 days.
├── If YES → the secret was rotated; the agent is signing with stale data.
│   ─→ Re-issue install command and have the Praxis re-enroll.
└── If NO → not a rotation; continue.

Does the admin clinic-detail page show the cert expiry on the linked
domain (portal.eins.ag)?
├── If expired or expiring < 7 days → cert/TLS issue masking as 401.
│   ─→ Renew the cert; on Vercel the auto-renewal usually catches this.
└── If not → likely IP ban; continue.

Has rate_limit_log shown >300 req/min from the Praxis IP in the last hour?
├── If YES → the agent is in a retry storm; check why outbox is hot.
│   pvs_event_log entries from this clinic in the last hour? If yes,
│   ingest is OK and 401s are something else (skip back to top).
│   If no, it's a backlog catching up; let it run.
└── If NO → escalate. Karam needs to look.
```

### Fix recipes

**Secret was rotated**: confirm via `pvs_link_audit` then re-issue.

```pwsh
# From the portal repo on your laptop.
pnpm --filter portal tsx scripts/show-recent-link-audit.ts --clinic-id <UUID> --days 7
# If you see kind='enrollment_redeemed' in the last 7 days, that's the rotation.
```

Issue a new install command from the admin clinic-detail page UI
(`/admin/clinics/<id>` → Integrationen tab → "Reissue install command").
Send the resulting one-line `eins-agent --enroll <token> --clinic <UUID>
--portal https://portal.eins.ag` to the Praxis admin and have them
run it on the workstation (`Win+R cmd`, paste, enter). The agent's
config + secret are overwritten on the next start; restart the
`EINS Agent` Windows Service (or close-and-reopen the console for
non-service installs).

Verify within 90 seconds: the heartbeat tile flips to green, the
failed-events count stays where it was (the old rows stay 'failed'
permanently; new events ingest cleanly), and the agent log shows a
fresh `[agent] enrollment successful` line.

Replay the failed rows so the Praxis doesn't lose data: see
[Reconciliation primitives → replay-events](#replay-events).

**Cert/TLS issue**: Vercel auto-renews `portal.eins.ag`. If it
fails, the dashboard at `https://vercel.com/eins/portal/settings/domains`
shows the expiry. Trigger a manual renewal via Vercel UI; the agent's
next flush succeeds within minutes.

**IP ban (rate-limit)**: the IP-level limit is 300 req/min
(`apps/portal/src/app/api/pvs/events/route.ts:62`). If a legitimate
agent is hitting this, the underlying problem is usually an outbox
backlog catching up after a long offline period; just wait. If the IP
is hostile (not a known Praxis IP), the ban is doing its job.

**Agent down**: the workstation is off, the agent service crashed, or
the watch folder is unreachable (network share dropped). Ask the
Praxis admin to confirm the agent is running:

```pwsh
Get-Service -Name "EINS Agent" | Format-Table -AutoSize
# or, for non-service installs:
Get-Process -Name "eins-agent" -ErrorAction SilentlyContinue
```

If neither exists, the install was undone. Re-run the install command.

---

## 2. Praxis sees no events after install

The Praxis admin called/messaged: "I installed the agent yesterday, the
dashboard says it's connected, but my numbers haven't moved." 5-step
diagnosis:

### Step 1: Token redeemed?

```sql
SELECT id, created_at, consumed_at, consumed_fingerprint, expires_at
  FROM pvs_agent_enrollment_tokens
 WHERE clinic_id = '<UUID>'
 ORDER BY created_at DESC
 LIMIT 5;
```

- If the most-recent row has `consumed_at IS NULL`: the agent never
  finished enrollment. Ask the Praxis admin to re-run the install
  command and watch for the `enrollment successful` log line.
- If `consumed_at IS NOT NULL` but `consumed_fingerprint` looks
  suspicious (e.g. `unknown-host`), the agent ran but on the wrong
  machine. Investigate.
- Otherwise continue.

### Step 2: pvs_link is `connected`?

```sql
SELECT id, pvs_vendor, status, last_event_at, updated_at
  FROM pvs_link
 WHERE clinic_id = '<UUID>';
```

- `status = 'pending'`: the link is quarantining events (P1-2). The
  Praxis admin needs to confirm in the portal UI: go to
  `/einstellungen/integrationen`, see the "PVS-Verbindung wartet auf
  Bestätigung (N Events in Warteschlange)" banner, click "Verbindung
  bestätigen". This flips status → `connected` AND replays all
  quarantined events through the linker + derive. Expected: within 30
  seconds the dashboard numbers update.
- `status = 'connected'` but `last_event_at` is hours stale: the agent
  is connected but not emitting. Continue to step 3.
- `status = 'error'`: the adapter is wedged. Check
  `pvs_link_audit WHERE kind='status_change' ORDER BY created_at DESC
  LIMIT 5` for the reason.

### Step 3: Vendor matches the install?

```sql
SELECT pvs_vendor FROM pvs_link WHERE clinic_id = '<UUID>';
-- expected for a GDT-Agent install: 'gdt_agent'
```

If the vendor is anything else (e.g. `tomedo` from a previous adapter),
the GDT-Agent's events are being rejected at
`apps/portal/src/server/pvs-events.ts:267-274` with `vendor_mismatch`.
Two fixes:

- If the Praxis is genuinely migrating from the previous PVS adapter:
  re-issue the install command with the "Allow vendor switch"
  checkbox ticked (issues a token with `allow_vendor_switch = true`).
  Re-run the install command on the Praxis workstation.
- If the previous vendor was set in error: SQL-fix the link
  (`UPDATE pvs_link SET pvs_vendor = 'gdt_agent' WHERE clinic_id = '<UUID>'`)
  and write a manual audit row:

```sql
INSERT INTO pvs_link_audit (clinic_id, kind, from_value, to_value, context)
VALUES ('<UUID>', 'manual_override', '<prev>', 'gdt_agent',
        '{"reason":"runbook 2 step 3 SQL fix","operator":"<you>"}'::jsonb);
```

### Step 4: Signature verifies?

The agent logs show `[agent] heartbeat failed: http 400` or every
`postEvent` returning the same 400. Probable causes:

- Secret was rotated and the agent has stale data. See
  [Section 1 → "Secret was rotated"](#fix-recipes).
- Body is being modified in transit (proxy, WAF). Check
  `pvs_event_reject` audit rows for `reason: bad_signature` and the
  request's `requestMeta.ua` field. If it's anything other than the
  agent's user-agent, there's a middlebox rewriting bodies.

### Step 5: Rate limit?

```sql
-- Recent rate-limit hits for this clinic.
SELECT COUNT(*) FROM audit_log
 WHERE clinic_id = '<UUID>'
   AND action IN ('pvs_event_reject', 'pvs_event_batch_reject')
   AND created_at > now() - interval '10 minutes';
```

If this returns > 100, the clinic is hitting the per-clinic 600/10min
limit. Check whether they're in initial-sync (the `batch` endpoint has
a higher 60/10min ceiling that's usually enough for backfill); if so,
they should be using `/api/pvs/events/batch` not `/api/pvs/events`.
Confirm the agent version is >= 0.2.0 (older versions only used the
single-event path).

### Step 5b (last resort)

If steps 1-5 all check green and there are still no events: the agent
is alive, signing correctly, and emitting, but the events are landing
elsewhere. SSH/RDP into the workstation and tail the agent log:

```pwsh
Get-Content -Path "$env:APPDATA\EINS-Agent\agent.log" -Tail 100 -Wait
```

Look for `[watcher] failed for <path>: …` lines. If the watch folder
itself is unreachable (a mapped drive dropped), the agent has nothing
to emit. Confirm with the Praxis admin that GDT files are actually
being written.

---

## 3. Maria Müller mis-linked

A Praxis admin reports that revenue is on the wrong patient. Two
related-but-distinct failure modes:

- **3a**: events for the WRONG `pvsPatientId` are mapped to a portal
  patient. Common when the legacy fuzzy linker silently merged before
  P1-1 hardening.
- **3b**: events for the right `pvsPatientId` are mapped to the wrong
  portal patient (e.g. they were merged into a duplicate of the same
  person).

Both fix with `pvs-reconcile unlink + replay`.

### Procedure

1. Identify the mis-linked pair. Ask the Praxis admin for the patient's
   PVS-internal id (`pvsPatientId`) and the portal patient id you see
   the revenue under (`portalPatientId`).

2. Inspect what events are tied to the pair (dry-run):

   ```pwsh
   pnpm --filter portal pvs:reconcile unlink `
     --clinic-id <UUID> `
     --pvs-patient-id <PVS-ID> `
     --portal-patient-id <PORTAL-UUID> `
     --reason "wrong-fuzzy-match: <one-line cause>"
   ```

   This is a dry-run by default. Read the printed event-log count and
   window. If the window covers months and thousands of events, page
   Karam before applying. If it's a recent mis-link (days, < 100
   events), proceed.

3. Apply:

   ```pwsh
   pnpm --filter portal pvs:reconcile unlink `
     --clinic-id <UUID> `
     --pvs-patient-id <PVS-ID> `
     --portal-patient-id <PORTAL-UUID> `
     --reason "wrong-fuzzy-match: <one-line cause>" `
     --apply
   ```

   This deletes the `pvs_patient_map` row, flags every affected
   `pvs_event_log` row `needs_rederive = true`, and enqueues
   `pvsStatusDerive(clinic, portalPatient)` + a KPI rebuild for the
   affected date window. Audit row written to `pvs_reconcile_audit`.

4. Wait 30-60 seconds for the worker to drain. Verify:

   ```sql
   SELECT lifetime_revenue_eur FROM patients WHERE id = '<PORTAL-UUID>';
   -- should now exclude the mis-attributed revenue.
   ```

5. Tell the Praxis admin the linking-failures inbox (`/admin/clinics/
   <id>` → Linker tab) now has a card for the pvs patient. They (or
   you) click "Mit existierendem Patienten zusammenführen" and pick the
   correct portal patient. This re-creates `pvs_patient_map` with the
   right mapping; subsequent events for that pvs id route correctly.

6. If the original mis-linked invoices already fired ads-conversion
   events (Meta, Google), those are NOT recalled by the reconciliation.
   Document in the Praxis ticket; if it materially affects ROAS
   reporting, open a follow-up to manually exclude via Meta's
   Conversions API offline-undo path. (Out of runbook scope; this is
   marketing-ops territory.)

### Common pitfall

If you run `unlink` for a pair where the link was set via
`bemerkung_token` (Stage 2), the linker WILL re-link it on the next
PatientUpserted event because the token is still in the PVS
`bemerkung` field. To prevent the relink, ask the Praxis admin to
clear the token from the PVS-side bemerkung field BEFORE running the
unlink. Otherwise the next nightly run re-establishes the mapping.

---

## 4. Mass 4xx spike

The admin dashboard's "Recent rate-limit hits" widget shows a
sustained spike from one or more IPs. Two sub-cases:

- **4a**: the spike is from a known Praxis IP. Their agent is in a
  retry storm. Diagnose at the agent, not the portal.
- **4b**: the spike is from an unknown IP. Likely a token-spray attack
  or vulnerability scanner.

### 4a: Praxis retry storm

`pvs_agent_status.failed_events > 100` for that clinic is the giveaway.
The agent's outbox has a backlog and the flush loop is hot. Causes:

- Praxis was offline for hours; outbox accumulated; now flushing fast.
  This is benign; let it run. The per-IP 300/min limit slows them but
  doesn't break them.
- Signature is bad on every row (rotation mismatch). See Section 1
  → "Secret was rotated".
- The agent version is older than 0.2.0 and lacks the single-flight
  guard from P0-2; multiple in-flight POSTs are stacking and timing
  out. Verify with `Get-Process eins-agent` on the workstation -
  resident memory > 500 MB suggests this. Upgrade the agent (re-run
  install command, the bundled binary is overwritten).

### 4b: Hostile IP

Read `audit_log WHERE action IN ('pvs_event_reject', 'pvs_agent_enroll_reject')
  AND request_meta->>'ip' = '<IP>'` for the recent activity. Two reactions:

- **Less than 50 hits over 10 minutes**: do nothing. The IP rate
  limiter is doing its job; the attacker is hitting the wall.
- **Sustained spray > 500/10min from one IP**: add the IP to the
  block-list at the edge.

  **Block-list location**:

  - Production: Cloudflare WAF, rule "Block PVS Bridge Hostiles",
    edit at the Cloudflare dashboard (`security/waf/custom-rules`).
    The rule is `(ip.src eq <IP>) and (http.request.uri.path matches "^/api/pvs/")`.
  - Staging: Vercel firewall (`vercel firewall add deny <IP>`).
  - Local dev: not applicable; rate limit alone is enough.

  After blocking, file a Notion incident note in the "Security · PVS"
  page with the IP, the trigger, and the time of block. Review weekly:
  scanner IPs cycle, so a permanent block is rarely needed.

**Clearing a false-positive block**: if the IP turns out to be a
legitimate Praxis on a new VPN egress address, remove the
Cloudflare/Vercel rule (same UI), tell the Praxis admin to re-test, and
note the removal in the incident note.

---

## Reconciliation primitives

The `pvs-reconcile` CLI is the operator-grade toolbox. All subcommands
are dry-run by default; pass `--apply` to commit. Every invocation
(dry-run + apply) writes an audit row to `pvs_reconcile_audit` keyed
by `actor = $env:USERNAME` (Windows) or `$USER` (POSIX).

Run from the repo root.

### unlink

```pwsh
pnpm --filter portal pvs:reconcile unlink `
  --clinic-id <UUID> `
  --pvs-patient-id <PVS-ID> `
  --portal-patient-id <PORTAL-UUID> `
  --reason "<one-line cause>" `
  [--apply]
```

Deletes a `pvs_patient_map` row, flags affected `pvs_event_log` rows
`needs_rederive = true`, enqueues derive + kpi-rebuild. See
[Section 3](#3-maria-mller-mis-linked) for the full workflow.

### recompute-lifetime

```pwsh
pnpm --filter portal pvs:reconcile recompute-lifetime `
  --clinic-id <UUID> [--apply]
```

Enqueues `pvsStatusDerive` for every patient in the clinic with at
least one PVS mapping. Use after a bulk linker change to refresh
`lifetime_revenue_eur` against the canonical event log. Idempotent.

### replay-events

```pwsh
pnpm --filter portal pvs:reconcile replay-events `
  --clinic-id <UUID> `
  --from YYYY-MM-DD --to YYYY-MM-DD `
  [--include-applied] [--apply]
```

Re-enqueues derive for every patient with at least one event in
`[from, to)` whose `needs_rederive = true` (or, with
`--include-applied`, every event in the window regardless). Clears the
flag on enqueue.

Use cases:
- After running `unlink`, to push the affected window through derive.
- After confirming a pending link (Section 2 step 2), if the automated
  replay only got the first 10,000 events (the default cap) and the
  Praxis has a long backlog.
- After a worker outage that left events with `applied_at = NULL` past
  the link-state machine's quarantine.

### show-link-failures

```pwsh
pnpm --filter portal pvs:reconcile show-link-failures `
  --clinic-id <UUID> [--limit 50]
```

Read-only. Lists open `linking_failures` rows so you can decide whether
to triage in the portal UI (`/admin/clinics/<id>` → Linker tab) or
script a mass-unlink-and-replay.

### Rotate secret (planned)

Not yet implemented as a `pvs-reconcile` subcommand. Today, secret
rotation = re-issue install command from the UI + Praxis re-enrolls.
A future `pvs-reconcile rotate-secret` would automate the SQL side
(mint new secret, invalidate cache, mark old secret rotated) and emit
a new install command JSON for the operator to forward. Tracked under
issue [TBD] when scaling past 20 Praxen.

---

## Escalation contacts

- **Karam** (primary): always page first for anything outside the
  four sections above, or anything affecting > 1 clinic at a time.
- **Vercel infra issues** (cert, DNS, deploy): Vercel status page +
  Karam.
- **Praxis-side cooperation problems**: never block on a Praxis admin
  for more than 30 minutes; if they're unreachable, document what you
  tried in the Praxis's Notion page and move on. The bridge is
  designed to survive offline indefinitely.

---

## Why this runbook exists

P3-3 of the [PVS Bridge Hardening Plan](../security/pvs-redteam.md).
A bridge incident at 2 a.m. that needs an SQL surgeon is a bridge
incident we will lose. The four sections above cover 90% of expected
production incidents based on the staging soak; the rest go to Karam
because the cost of mishandling a wrong-link in DB surgery is worse
than the cost of a 30-minute paging delay.

If you used this runbook and it didn't work, edit the section. If you
used a primitive that wasn't here, add it.
