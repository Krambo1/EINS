# PVS Bridge: Staging Soak Runbook

P3-2 of the [PVS Bridge Hardening Plan](../security/pvs-redteam.md). The
goal of the 30-day soak is to catch regressions the unit tests can't see:
partition rotation under real time, derive-worker behaviour under burst
load, anomaly-alarm calibration on realistic event distributions, and the
linker's false-positive rate on adversarial fixtures.

If the soak passes without surprises, we ship to pilots.

---

## Day 0: provision the staging Praxis

### 0.1 Portal side

The staging cluster at `staging.einsvisuals.de` is already up. Create
the seed clinic if missing:

```sql
-- Run via the staging psql shell.
INSERT INTO clinics (id, name)
  VALUES ('00000000-0000-4000-8000-000000000001', 'STAGING Soak Praxis');

INSERT INTO clinic_users (clinic_id, email, role)
  VALUES ('00000000-0000-4000-8000-000000000001',
          'staging-soak@einsvisuals.de', 'inhaber');

INSERT INTO pvs_link (clinic_id, pvs_vendor, status, connection_config)
  VALUES ('00000000-0000-4000-8000-000000000001', 'gdt_agent', 'connected', '{}'::jsonb);
```

The `clinic_users.email LIKE 'staging-%'` row is what the seed script
checks to confirm it's not pointed at a real clinic. Don't skip it.

### 0.2 Windows VM with GDT-Agent

Provision a Windows 11 VM (Hyper-V, EC2, whatever). Install the
agent build:

```pwsh
# 1) Issue an install command from the staging portal admin UI:
#    /admin/clinics/<staging-clinic-id> → Integrationen tab → "Install command"
#    Copy the resulting one-liner.

# 2) On the VM:
.\eins-agent.exe --enroll <TOKEN> `
  --clinic 00000000-0000-4000-8000-000000000001 `
  --portal https://staging.einsvisuals.de `
  --folder C:\GDT-Out

# 3) Register as a Windows Service (so it survives reboots):
sc create "EINS Agent" binPath= "C:\eins\eins-agent.exe" start= auto
sc start "EINS Agent"
```

Verify the dashboard at `/admin/clinics/<staging-clinic-id>` shows
`pvs_agent_status.last_heartbeat_at` advancing every 60 seconds.

---

## Day 0: seed the cohort

The seed script generates a realistic patient population + 60 days of
events directly via `applyPvsEvent`. Bullmq derive jobs are enqueued
inline; the worker drains them naturally.

```pwsh
# Dry-run first to confirm the safety rails pass.
$env:DATABASE_URL = "postgres://...staging..."
pnpm --filter portal pvs:seed-staging `
  --clinic-id 00000000-0000-4000-8000-000000000001 `
  --patients 10000 --days 60

# If the dry-run prints the expected totals, apply.
pnpm --filter portal pvs:seed-staging `
  --clinic-id 00000000-0000-4000-8000-000000000001 `
  --patients 10000 --days 60 `
  --out C:\soak-2026-05-24-manifest.json `
  --apply
```

The manifest at `C:\soak-2026-05-24-manifest.json` records the
adversarial fixtures' expected outcomes; the weekly review compares
observed outcomes against this.

### Expected ingest tally (10000 patients × 60 days)

| Event kind          | Approx count |
|---------------------|--------------|
| PatientUpserted     | ~10,010      |
| AppointmentCreated  | ~36,000      |
| AppointmentStatusChanged | ~34,000 |
| EncounterCompleted  | ~25,000      |
| InvoicePaid         | ~25,000      |
| RecallScheduled     | ~7,500       |
| Adversarial upserts | 10           |

Real numbers depend on the RNG seed (default `--seed 1` is stable).
The seed script prints the actual totals before applying.

---

## Weekly review (every Monday)

The soak runs for 30 days. Each Monday, run the four queries below and
file a one-page note in Notion ("PVS Soak Week N") with the answers.

### Q1: link health

```sql
SELECT clinic_id, agent_version,
       extract(epoch from now() - last_heartbeat_at) AS seconds_since_heartbeat,
       failed_events, last_failure_reason
  FROM pvs_agent_status
 WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
```

**Expected**: `seconds_since_heartbeat < 120`, `failed_events` reasonably
flat (single-digit drift week-over-week is fine; a climbing count is a
finding).

### Q2: linking-failures inbox

```sql
SELECT count(*) AS open_failures,
       count(*) FILTER (WHERE candidates IS NULL OR jsonb_array_length(candidates) = 0) AS no_candidates,
       count(*) FILTER (WHERE jsonb_array_length(candidates) >= 1) AS with_candidates
  FROM linking_failures
 WHERE clinic_id = '00000000-0000-4000-8000-000000000001'
   AND status = 'open';
```

**Expected**: `open_failures` is mostly the 5 adversarial fixtures (some
of which are EXPECTED to land here). If real synthetic patients are
landing in here, the linker is too strict; check `with_candidates`
distribution and tune downstream of the fixture set.

### Q3: anomaly alerts fired

```sql
SELECT kind, count(*) AS n,
       max(created_at) AS most_recent
  FROM anomaly_alerts
 WHERE clinic_id = '00000000-0000-4000-8000-000000000001'
   AND created_at > now() - interval '7 days'
 GROUP BY kind
 ORDER BY n DESC;
```

**Expected**: lifetime-revenue swings and ad-id-stale alerts should fire
zero times in steady-state (the seed events don't create reverse-
attribution scenarios). One-off "first event in window" alerts at the
start of the soak are fine.

### Q4: derive lag

```sql
SELECT date_trunc('hour', enqueued_at) AS hour,
       count(*)            AS jobs,
       avg(extract(epoch from finished_at - enqueued_at)) AS avg_lag_sec,
       max(extract(epoch from finished_at - enqueued_at)) AS p_max_lag_sec
  FROM job_log
 WHERE clinic_id = '00000000-0000-4000-8000-000000000001'
   AND kind = 'pvs_status_derive'
   AND enqueued_at > now() - interval '7 days'
 GROUP BY 1 ORDER BY 1 DESC;
```

**Expected**: `avg_lag_sec < 5`, `p_max_lag_sec < 60`. Sustained lag >
60 seconds is a BullMQ backpressure finding; check redis memory and
worker concurrency.

### Q5: adversarial-fixture outcomes (one-shot, after week 1)

For each of the 5 fixtures in the manifest, find the second patient
(the one whose linker outcome we're testing):

```sql
-- Example for ADV-1.
SELECT lf.id, lf.status, lf.candidates
  FROM linking_failures lf
 WHERE lf.clinic_id = '00000000-0000-4000-8000-000000000001'
   AND lf.pvs_patient_id = 'soak-...-adv-ADV-1-namesake-dob-1'
 ORDER BY lf.created_at DESC LIMIT 1;
```

Compare to the manifest's `expected` field:
- `expected: "auto-merge"` → no linking_failures row; `pvs_patient_map`
  should resolve to the SAME `portal_patient_id` as the first patient.
- `expected: "review-queue"` → exactly one open linking_failures row.
- `expected: "new-patient"` → no linking_failures row; `pvs_patient_map`
  resolves to a DIFFERENT `portal_patient_id` from the first patient.

A mismatch is the most important finding the soak can produce. File a
ticket with the fixture marker and the observed candidate scores.

---

## Day 30: ship/no-ship gate

The soak passes if all of these are true at the end of the 30 days:

- [ ] Linker false-positive rate on the 5 adversarial fixtures: 0.
      Every `expected: "review-queue"` case landed in the queue;
      every `expected: "auto-merge"` collapsed correctly.
- [ ] `pvs_agent_status.failed_events` for the soak clinic is < 0.1%
      of total ingested events (rough number: 100 of 100,000).
- [ ] No `anomaly_alerts` fired for reasons other than the
      week-1 startup volatility (`first_window`, `cold_start`).
- [ ] Derive p95 lag stayed under 30 seconds across all weekly
      samples.
- [ ] No agent crashes / restarts logged in the EINS Agent Windows
      Service journal.
- [ ] The legacy outbox migration (P3-4) ran exactly once on the VM
      at first encrypted-agent boot, copied N rows, and left a
      timestamped `.legacy-` backup (verify by `Get-ChildItem
      $env:APPDATA\EINS-Agent\*.legacy-*` on the VM).

A single failure on any line above means the soak failed; revisit the
underlying defence and re-run the affected portion.

---

## Tear-down

After the soak:

```sql
-- Delete events first (FK to clinic).
DELETE FROM pvs_event_log  WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM pvs_patient_map WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM linking_failures WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM pvs_link        WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM patients        WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM clinic_users    WHERE clinic_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM clinics         WHERE id        = '00000000-0000-4000-8000-000000000001';
```

Decommission the Windows VM. Archive the manifest + weekly notes
under the Notion "Soak runs" database. Future soak runs use a fresh
UUID; we never reuse the staging clinic id across runs because the
adversarial fixtures' `pvsExternalEventId`s are namespaced by the
`seed_run_id` but the patient pool itself isn't.
