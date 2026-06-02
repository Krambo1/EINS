# PVS Bridge: Red-Team Test Plan

**Status**: living document. Last updated 2026-05-24 with Phase 3 of the hardening plan.
**Owner**: `@karam`.
**Audience**: anyone shipping changes to `/api/pvs/*`, `apps/bridge/*`, `apps/portal/src/server/pvs-*`.

This document enumerates the attacks we have decided to defend against, the
defence each one lands on, the expected outcome when the attack runs, and the
CI test that locks the defence in place. Every scenario follows the same
shape so a reviewer can read down the rows quickly:

| Field        | Meaning                                                                |
|--------------|------------------------------------------------------------------------|
| Threat       | What the attacker is trying to accomplish.                             |
| Capability   | What they need to already possess (network position, partial secrets). |
| Defence      | The code path that stops them, with file:line refs.                    |
| Expected     | The exact response a working defence produces.                         |
| CI test      | The automated check that proves the defence is wired.                  |
| Manual gate  | What a human still has to verify (e.g. Windows-only smoke).            |

Scenarios are grouped by where the attacker lives: at the portal edge, at
the agent on the Praxis workstation, or on the disk after a host
compromise. The grouping matters because the defences differ: edge attacks
are defended by code we own at runtime; on-host attacks shift toward
secure-store invariants and SQLCipher.

If you add a scenario, add the CI test in the same PR. The point of this
file is that "we considered X" never lives only in a designer's head.

---

## Index

1. [Spoofed-signature replay against `/api/pvs/events`](#1-spoofed-signature-replay)
2. [Batch replay across clinics via `/api/pvs/events/batch`](#2-batch-replay-across-clinics)
3. [Install-token replay (N attempts, different fingerprints)](#3-install-token-replay)
4. [Token reuse after `consumedAt`](#4-token-reuse-after-consumedat)
5. [Malformed GDT (binary, oversized, encoding edge cases)](#5-malformed-gdt)
6. [CSV bombs (100 MB, deep nesting, formula injection)](#6-csv-bombs)
7. [Expired-cert / TLS downgrade attempts](#7-tls-downgrade)
8. [Secret rotation under load](#8-secret-rotation-under-load)
9. [Clock-skew replay window abuse](#9-clock-skew-replay)

Each item below has a stable anchor for cross-linking from PR descriptions
(`docs/security/pvs-redteam.md#3-install-token-replay`).

---

## 1. Spoofed-signature replay

**Threat**: attacker holds a body that was previously POSTed (sniffed from a
proxy log, leaked through a compromised n8n workflow, dumped from a journal)
and replays it against `/api/pvs/events` from a hostile IP. Goal: ingest
forged revenue, conversion, or appointment events; or simply burn the
clinic's rate-limit budget so the legitimate adapter starves.

**Capability**: knows a valid `clinicId` (not secret; appears in every
install-command URL) and one complete signed body. Does NOT know the
per-clinic HMAC secret.

**Defence**:

1. `apps/portal/src/app/api/pvs/events/route.ts:61-78` rate-limits per IP
   at 300 req/min BEFORE any JSON parse or DB read. A spray of replayed
   bodies from one host trips this layer first.
2. `apps/portal/src/app/api/pvs/events/route.ts:173` calls
   `verifyClinicSignature(clinicId, raw, sig, "pvs")`. Without the secret
   the attacker cannot produce a matching signature, even on a body whose
   contents are valid; the request is rejected with `400 invalid_request`
   and an audit row is written.
3. On the off-chance the attacker DOES hold a valid signature (i.e. the
   exact original body + signature pair, replayed verbatim), the body's
   `pvsExternalEventId` collides with the `(clinicId, bridgeSource,
   pvsExternalEventId, occurredAt)` UNIQUE index in `pvs_event_log`.
   `apps/portal/src/server/pvs-events.ts:482-491` returns
   `{status: "deduped"}` and the event is ingested zero times.

**Expected outcomes**:

- Wrong-IP spray: `429 rate_limited`, `X-PVS-RateLimit-Reason: ip`,
  zero DB reads after the first 300 requests in that minute.
- Forged body without valid signature: `400 invalid_request`, audit row
  with `reason: bad_signature`.
- Verbatim replay with valid signature: `201 {status: "deduped"}`, zero
  derive effects.

**CI test**:
[`apps/portal/src/server/pvs-redteam.test.ts`](../../apps/portal/src/server/pvs-redteam.test.ts)
`"signature replay returns deduped, never re-applies derive"`.

**Manual gate**: in staging, run `pvs-redteam-cli replay --body=fixture.json
--count=50` from a foreign IP and check the admin clinic-detail page shows
the rate-limit burn (per IP) but no `pvs_event_log` rows beyond the original.

---

## 2. Batch replay across clinics

**Threat**: attacker holds a valid signed batch for Clinic A and POSTs it
to `/api/pvs/events/batch` claiming it belongs to Clinic B. Goal:
cross-contaminate clinic data, attribute Clinic A's revenue to Clinic B's
pipeline, or sabotage Clinic B by injecting irrelevant events that
trigger the anomaly alarm.

**Capability**: a sniffed signed batch from Clinic A; knowledge of
Clinic B's clinicId.

**Defence**:

1. `apps/portal/src/app/api/pvs/events/batch/route.ts:93-100`:
   "every event in the batch must carry the same clinicId" as the
   envelope. Cross-clinic batches return `400 clinic_mismatch` BEFORE
   the signature check, so the attacker can't even use the rejection
   message to enumerate which clinics they hold valid batches for.
2. The HMAC signature is computed over the entire raw body including
   the envelope `clinicId`. An attacker who edits the envelope to flip
   the clinic invalidates the signature; signature-check at line 120
   rejects with `400 invalid_request`.

**Expected**: `400 clinic_mismatch` (if envelope was edited to match
the inner events) OR `400 invalid_request` (if envelope says Clinic B
but inner events still say Clinic A). Audit row in both cases.

**CI test**:
[`apps/portal/src/server/pvs-redteam.test.ts`](../../apps/portal/src/server/pvs-redteam.test.ts)
`"batch with mixed clinicIds is rejected before signature verify"`.

**Manual gate**: none. Pure schema-level test covers it.

---

## 3. Install-token replay

**Threat**: attacker intercepts the one-time install command (read from
a screen, a chat history, an SMS) and races the legitimate Praxis
admin to redeem it. Goal: enroll a hostile agent and receive the per-
clinic HMAC secret so they can sign arbitrary `/api/pvs/events` POSTs
forever.

Variant 3a: N concurrent redemption attempts with different machine
fingerprints, hoping to win the race.

Variant 3b: legitimate admin redeems first; attacker re-tries the
token, hoping the consumed-flag check is non-atomic.

**Capability**: the plaintext token (24-hour TTL after issue).

**Defence**:

1. `apps/portal/src/server/pvs-agent-enroll.ts:220-245` wraps the
   token-consume + secret-mint + link-upsert in one Drizzle transaction.
   The token claim is a conditional UPDATE:
   `UPDATE pvs_agent_enrollment_tokens SET consumed_at=now() WHERE id=? AND consumed_at IS NULL RETURNING id`.
   PostgreSQL serializes per-row; only one concurrent caller's UPDATE
   returns a row, the others get zero rows and the tx is aborted via
   `EnrollmentAbort("token_consumed")`. No secret is minted on the
   losing side because the mint and the upsert are inside the same tx.
2. The redemption requires the requester to present a
   `machineFingerprint`. When the issuing operator supplied an
   `expectedFingerprint` at token-creation time, the pre-check at
   line 166 returns `fingerprint_mismatch`; without an expectedFingerprint,
   the agent's fingerprint is just recorded for the audit trail (it
   provides no security, but lets you correlate the redeeming host
   with the issue ticket).
3. Cache invalidation runs ONLY after the tx commits
   (`apps/portal/src/server/pvs-agent-enroll.ts:325-330`), so a
   rolled-back redemption never bumps the cache version and never
   strands the previously-deployed secret.

**Expected**:

- 3a (concurrent race): exactly one redemption returns `200 + secret`,
  all others return `401 enrollment_failed` (token_consumed).
- 3b (sequential reuse after consumption): `401 enrollment_failed`
  (token_consumed). The audit table has one `pvs_agent_enroll` row
  for the winner and one `pvs_agent_enroll_reject` row per loser.

**CI test**: [`apps/portal/src/server/pvs-agent-enroll.test.ts`](../../apps/portal/src/server/pvs-agent-enroll.test.ts)
"P0-1 transactional redemption" + "concurrent claim only one winner"
(existing). The new
[`pvs-redteam.test.ts`](../../apps/portal/src/server/pvs-redteam.test.ts)
"token spray N attempts" loop adds a higher-cardinality check.

**Manual gate**: in staging, run
```pwsh
$tok = (issue-enrollment).Token
1..20 | ForEach-Object -Parallel { Invoke-RestMethod -Method Post -Uri "https://staging.eins.ag/api/pvs/agent-enroll" -Body (@{ clinicId="…"; token=$using:tok; machineFingerprint="host-$_" } | ConvertTo-Json) -ContentType "application/json" }
```
Assert: exactly one 200, 19 401s, one row in `pvs_agent_enroll`, 19
in `pvs_agent_enroll_reject`.

---

## 4. Token reuse after consumedAt

**Threat**: the legitimate redemption succeeded, but the attacker
obtains the token afterwards (DM screenshot, log capture) and tries
to use it weeks later. Goal: re-enroll a hostile agent and rotate the
secret out from under the original.

**Capability**: the plaintext token (post-consumption).

**Defence**:

1. `apps/portal/src/server/pvs-agent-enroll.ts:162` pre-check:
   `if (row.consumedAt) return { ok: false, reason: "token_consumed" }`.
2. Even if the pre-check is bypassed (concurrent in-flight redemption
   between pre-check and tx), the conditional UPDATE at line 230 with
   `isNull(consumedAt)` fails, the tx aborts, and the response is
   `401 enrollment_failed`.
3. `purgeExpiredAgentTokens` (`pvs-agent-enroll.ts:337`) deletes
   unconsumed expired tokens; consumed tokens stay for audit and so
   the second-attempt path STILL produces a useful `token_consumed`
   reason instead of a generic `token_invalid`.

**Expected**: `401 enrollment_failed`; audit row with
`reason: token_consumed` containing the requesting fingerprint and IP.
Original agent is unaffected; cache invalidation does not fire.

**CI test**: [`apps/portal/src/server/pvs-agent-enroll.test.ts`](../../apps/portal/src/server/pvs-agent-enroll.test.ts)
`"second redeem after consume returns token_consumed"`.

**Manual gate**: none.

---

## 5. Malformed GDT

**Threat**: attacker drops a hostile file into the GDT watch folder
(requires local access to the Praxis workstation, or compromise of
the PVS export pipeline). Goal: crash the agent (denial-of-service of
the entire bridge), exhaust memory (100 MB GDT file), or smuggle
events via encoding tricks (UTF-7, BOM stripping, length-prefix lying).

Variants:

- 5a: binary garbage (not GDT at all). E.g. an MP4 renamed to `.gdt`.
- 5b: oversized GDT (>50 MB). One file, one allocation.
- 5c: encoding edge cases: UTF-8 BOM, ISO-8859-15 vs CP1252,
  mixed-encoding within one file (`8000` header in latin-1, value
  bytes in CP1252).
- 5d: length-prefix lying: every GDT line is `LLLFFFFvalue\r\n` where
  `LLL` is the total line length. An attacker writes `999` as the
  length on a 20-byte line, expecting the parser to slurp 999 bytes
  past the line break.

**Defence**:

1. `apps/bridge/agent/src/watcher.ts:GDT_MAX_BYTES` (new in Phase 3):
   files larger than 32 MB are skipped with a log line + watcher-state
   cursor advance, never reaching `parseGdtFile`. 32 MB is two orders
   of magnitude above the largest legitimate GDT we've observed at
   pilots (~150 KB for a year of patient data); the watcher logs the
   reject so an operator can investigate but the agent does not crash.
2. `apps/bridge/agent/src/gdt-parser.ts` is buffer-driven, not stream-
   based: it accepts a `Buffer`, decodes per record using the
   encoding-probing in [csv-parser-like fashion], and never trusts the
   length-prefix beyond `bytes.subarray(i, i + claimedLen)` clamping
   at the actual buffer length. A lying length-prefix produces a
   parse error logged at the file level; no events are emitted.
3. Encoding probing: `parseGdtFile` tries UTF-8, falls back to
   ISO-8859-15 and CP1252, scores by the count of decoded diacritics
   (most legitimate German GDT has at least one umlaut per record).
   A pure-ASCII file decodes identically under all candidates and is
   accepted. A binary-garbage file produces extremely low diacritic
   density under every candidate and is rejected at the line-format
   layer (no valid `LLLFFFF` prefix).

**Expected**:

- 5a (binary): `[watcher] failed for <path>: <parser-error>`,
  zero events enqueued, watcher continues.
- 5b (oversized): `[watcher] <path> exceeds GDT_MAX_BYTES (33554432); skipped`,
  zero events enqueued, watcher cursor advances so the file isn't
  re-attempted on restart.
- 5c (encoding): legitimate events emitted with correct umlauts; the
  encoding-probe winner is logged once per file.
- 5d (length-lie): partial parse up to the lying line, then `[watcher]
  failed for <path>: length-prefix exceeds buffer at offset N`.

**CI test**:

- [`apps/bridge/agent/src/gdt-parser.test.ts`](../../apps/bridge/agent/src/gdt-parser.test.ts)
  already covers 5c (the encoding-probe scenarios).
- [`apps/bridge/agent/src/csv-bomb.test.ts`](../../apps/bridge/agent/src/csv-bomb.test.ts)
  (new in Phase 3) covers 5b via the parallel size-limit test on the
  CSV watcher; the GDT size-limit follows the same pattern.
- A new fixture in `gdt-parser.test.ts` "length-lie smuggling
  attempt" covers 5d.

**Manual gate**: drop a 100 MB random-byte file in the watch folder
on a Windows test VM, confirm the agent's resident memory stays flat
(check Task Manager, the agent's Working Set should not jump by
100 MB).

---

## 6. CSV bombs

**Threat**: hostile CSV in the Honorar-CSV watch folder. Goals as 5,
plus formula injection (a cell with `=cmd|'/c calc'!A0` would execute
when the CSV is re-opened in Excel by an operator triaging an
ingestion problem).

Variants:

- 6a: oversized CSV (>32 MB). One file, one allocation explosion.
- 6b: deep row count (10 M rows of 10-byte data). String allocation
  per cell would balloon the JS heap.
- 6c: formula injection (`=…`, `+…`, `-…`, `@…` leading cells).
- 6d: zip bomb (CSV compressed to 1 KB, decompresses to 10 GB).
  Out of scope: the watcher reads raw `.csv` files, never gzipped
  inputs.

**Defence**:

1. `apps/bridge/agent/src/csv-watcher.ts:CSV_MAX_BYTES` (new):
   files larger than 32 MB are skipped with a log line and watcher-
   cursor advance, never reach `parseCsv`. Operator sees the skip in
   the agent log and the file in the folder; they can investigate.
2. `apps/bridge/agent/src/csv-watcher.ts:CSV_MAX_ROWS` (new): after
   `parseCsv` returns, if `parsed.rows.length > 1_000_000` the file
   is logged + skipped. Anomaly threshold: the biggest legitimate
   medatixx Honorar export we've seen is ~25,000 rows (one year for
   a large Praxis).
3. Formula injection: not exploitable in this pipeline. The agent
   parses cells into JS strings, emits canonical JSON events, never
   writes a file back out and never opens cells in Excel. The cell
   value lands as a plain string in `pvs_event_log.payload.amountCents`
   or similar typed numeric field, and any cell whose mapper produces
   a non-numeric `amountCents` is rejected at the mapper layer
   (`mapCsvRow` returns `{ok: false}` and the row is skipped). If an
   operator later opens the CSV in Excel for triage, that is their
   risk; documented in the runbook with "Use a text editor for CSV
   triage, not Excel."
4. Zip bomb: not applicable. The watcher's `isCsvFile` matches
   `\.csv$` only; gzipped files are ignored.

**Expected**:

- 6a: `[csv-watcher] <path> exceeds CSV_MAX_BYTES; skipped`,
  zero events.
- 6b: `[csv-watcher] <path> row count 10000000 exceeds limit
  1000000; skipped`, zero events.
- 6c: events emitted only for rows whose `amountCents` parses as a
  non-negative integer. `=cmd…` in `Bezahldatum` produces a date-parse
  failure, row skipped, summary `skipped: 1` in the agent log.

**CI test**:
- [`apps/bridge/agent/src/csv-bomb.test.ts`](../../apps/bridge/agent/src/csv-bomb.test.ts):
  `"oversized CSV is skipped before parseCsv allocates"`,
  `"row-count bomb is skipped after parse"`,
  `"formula-injection cells do not crash mapper"`.

**Manual gate**: run `pvs-redteam-cli csv-bomb --size=100mb
--target=C:\Honorar` on the staging VM; agent memory stays flat.

---

## 7. TLS downgrade

**Threat**: an MITM (malicious DNS, rogue proxy on the Praxis network,
phished install command containing `--portal http://…`) redirects the
agent to an http endpoint or a TLS endpoint with an expired/self-signed
cert. Goal: read patient data in cleartext, or substitute portal
responses to manipulate the agent.

Variants:

- 7a: install command contains `--portal http://evil.example`.
- 7b: a previously-running agent has its config.json hand-edited to
  swap https for http (malware with user-level write access, or
  social engineering of the Praxis admin).
- 7c: portal hostname resolves to a TLS endpoint with an expired or
  self-signed certificate.

**Defence**:

1. `apps/bridge/agent/src/portal-url.ts:validatePortalUrl` (P0-4):
   anything that is not `https://`, or `http://` against `localhost` /
   `127.0.0.1` / `::1` WITH the explicit `--allow-insecure-dev` flag,
   is rejected. Runs at enrollment time AND at every cold start
   (see `apps/bridge/agent/src/index.ts:189-201`); a hand-edit of
   config.json that swaps the scheme fails the next agent start.
2. `apps/bridge/agent/src/portal-client.ts` uses Node's default `fetch`,
   which uses Node's default TLS validator: expired certs, self-signed
   certs, hostname mismatches, and unknown CAs all reject at the TLS
   handshake. The agent does NOT pass `rejectUnauthorized: false`
   anywhere. The fetch surfaces an `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
   error which lands in the outbox row's `last_error` and the
   heartbeat's `recentReasons` so the operator sees it.
3. No `NODE_TLS_REJECT_UNAUTHORIZED=0` shim. Verified via the static-
   grep test
   [`apps/bridge/agent/src/portal-url.test.ts`](../../apps/bridge/agent/src/portal-url.test.ts).

**Expected**:

- 7a: enrollment exits non-zero with German-language error message
  about `https://`.
- 7b: agent exits non-zero on next start with
  `[agent] refusing to start: http:// portal URL '…' rejected; use https://`.
- 7c: every event POST fails with `network: …UNABLE_TO_VERIFY…`,
  outbox holds rows pending; heartbeat surfaces the reason within
  60 seconds. Operator runbook step "Agent shows 401 in dashboard"
  has the diagnosis tree.

**CI test**:
- [`apps/bridge/agent/src/portal-url.test.ts`](../../apps/bridge/agent/src/portal-url.test.ts)
  covers 7a + 7b (validator unit tests).
- 7c is exercised manually because Node's TLS stack is the system
  under test, not our code; spinning a self-signed CA in CI for
  this single assertion is not worth the maintenance burden.

**Manual gate**:
- 7c: run `eins-agent` against `https://expired.badssl.com/` (replace
  the portal URL with a curated badssl host) and confirm the agent
  fails-loud and does NOT post anything.

---

## 8. Secret rotation under load

**Threat**: a rotation happens (operator clicks "Reissue install
command" → token issued → admin redeems on the same workstation) while
the existing agent is mid-flush. Goal that the attacker doesn't need
to engineer but might benefit from: secret rotation strands events
in the outbox forever, the legitimate agent dies silently, the
attacker who controls a stale install command can re-enroll later
with the OLD secret because cache invalidation never fired.

**Capability**: timing only. The "attack" is really a failure mode we
need to survive cleanly.

**Defence**:

1. `apps/portal/src/server/pvs-agent-enroll.ts:218-322`: the entire
   redemption (token claim + secret mint + link upsert + audit) is
   one Drizzle transaction. `mintAndStorePvsSecret` is passed the
   `tx` handle so the secret insert participates in the same tx; any
   downstream failure rolls back the mint, so the previously-deployed
   secret stays live and the legitimate agent keeps flushing.
2. `invalidateSignatureSecretCache(clinicId, "pvs")` runs ONLY after
   the tx commits (line 328). A rolled-back redemption never bumps
   the cache version; the in-process secret cache continues serving
   the old secret to `/api/pvs/events`. (Whereas the previous
   implementation invalidated mid-redemption, opening a window where
   the cache served the new secret while the DB still held the old.)
3. Outbox retry budget: rows that get a `401 invalid_request` from
   the portal mark `failed` permanently (it's a 4xx, not retryable).
   Rotation that strands legitimate events would surface as a spike
   in `pvs_agent_status.failed_events` within one minute (heartbeat
   cadence). The runbook entry "Agent shows 401 in dashboard" walks
   the operator through verifying the secret rotation, re-pushing the
   install command, and replaying the failed rows via
   `pvs-reconcile`.
4. Token TTL is 24 hours
   (`apps/portal/src/server/pvs-agent-enroll.ts:47`). An attacker who
   grabs a token from a stale install command has at most 24 hours to
   redeem; after that the token rejects at the pre-check.

**Expected**:

- Successful rotation under load: the in-flight POSTs that signed
  with the old secret either land before the cache invalidation
  (signature verifies, ingested) or arrive after invalidation and
  return `400 invalid_request`. The legitimate agent's next flush
  loop reloads the secret from `secure-store` (which was overwritten
  by the redemption response), re-signs the same outbox rows, and
  they ingest cleanly via the dedupe path. Net data loss: zero.
- Failed-mid-tx rotation: previous secret intact, token un-consumed,
  cache un-invalidated, original agent keeps working as if nothing
  happened. Operator sees no audit row for the failed redemption
  except the `pvs_agent_enroll_reject` from the catch path.

**CI test**: [`apps/portal/src/server/pvs-agent-enroll.test.ts`](../../apps/portal/src/server/pvs-agent-enroll.test.ts)
already covers the tx-rollback contract. A new test
[`pvs-redteam.test.ts`](../../apps/portal/src/server/pvs-redteam.test.ts)
`"cache invalidation never fires on rolled-back redeem"` locks the
ordering invariant in.

**Manual gate**: in staging, schedule 200 events/sec for one
minute via the test-harness, click "Reissue install command" at the
30-second mark, run the new install command on a second VM, assert
the original agent's `failed_events` count stays at zero and the
new agent picks up signing within 10 seconds.

---

## 9. Clock-skew replay

**Threat**: the canonical-event protocol has no timestamp-based
replay window. An attacker who holds a valid signed body can replay
it indefinitely. Documented here because reviewers ask "where's the
nonce / timestamp guard?" and the honest answer is "we replaced it
with content-hash dedupe."

**Capability**: a valid signed body (sniffed, leaked, journaled).

**Why no timestamp guard**:

A timestamp-based guard would require either:

1. A nonce-store on the portal that remembers every (clinicId,
   nonce, ts) tuple within the replay window. This is a stateful
   throughput sink (every request now needs a read+write to a
   nonce-store) that buys us nothing the next defence doesn't already
   give us; OR
2. A short, strictly-enforced clock window (e.g. `|now - ts| < 5min`)
   that rejects requests outside the window. The Praxis workstation
   clock can drift by 5+ minutes on isolated Praxis networks without
   NTP, so a strict window would generate spurious failures.

**The actual defence**:

`apps/portal/src/server/pvs-events.ts:482-491` uses a UNIQUE index on
`(clinicId, bridgeSource, pvsExternalEventId, occurredAt)` in
`pvs_event_log`. Every canonical event must carry a
`pvsExternalEventId` that is stable for that event (adapter-defined:
GDT-Agent uses SHA-256 of the file content, HealthHub uses the FHIR
Bundle entry id, CSV uses `{uploadId}:{rowNumber}`). Replays land on
the same row and ON CONFLICT DO NOTHING returns `{status: "deduped"}`
with no derive side-effects.

This is structurally stronger than a timestamp window: a replay 5
minutes after the original AND a replay 5 months later both produce
the same zero-effect outcome.

**Edge case**: an attacker who can forge `pvsExternalEventId` (by
controlling the producing adapter) can produce non-colliding events
that all share the same body otherwise. In that case the attacker
already controls a legitimate adapter and has the per-clinic HMAC
secret; replay is no longer the interesting attack.

**Expected**: replay returns `201 {status: "deduped"}`. No derive
queue enqueue. Audit table is silent (replays are deliberately not
audited; see `pvs-events/route.ts:217-223`) to avoid drowning the
log in noise during legitimate retry storms.

**CI test**: [`apps/portal/src/server/pvs-redteam.test.ts`](../../apps/portal/src/server/pvs-redteam.test.ts)
`"replay of an identical event hits the dedupe path"` (logic-level
via mocked `applyPvsEvent`; the SQL UNIQUE constraint behaviour is
covered by the existing integration test set under
`apps/portal/test/`).

**Manual gate**: none.

---

## Out-of-scope (intentional)

These attack classes are not covered here because the threat model
puts them outside the bridge's defence perimeter. If you think one of
them should move IN, open a ticket and link this anchor.

- **Workstation full compromise (root/admin malware)**: an attacker
  who runs code as the same Windows user as the agent can read DPAPI-
  protected blobs by impersonating the user. SQLCipher (P3-4) makes
  the at-rest outbox unreadable without the key, but the key itself
  is DPAPI-protected for the same user, so this raises the bar for a
  cold-disk theft scenario but not for a live malware scenario. We
  accept this; mitigations belong at the workstation-hardening layer
  (EDR, BitLocker, application allowlisting) which is the Praxis IT
  policy, not the bridge.
- **Portal supply chain compromise**: an attacker who lands code in
  the portal repo can do anything. Defence is code-review + signed
  commits + CI gates, not runtime checks.
- **Voluntary admin action**: an admin who manually issues an
  install command for an attacker has already chosen to onboard
  them. We can't defend against the legitimate operator deciding to
  do the wrong thing.

---

## Adding a scenario

1. Pick a stable header `## N. <slug>` and add it to the index.
2. Fill in the six fields (Threat / Capability / Defence / Expected
   / CI test / Manual gate).
3. Add the CI test in the same PR. If the test is impossible without
   spinning a real Postgres / Windows host, mark it under "Manual
   gate" and link to the staging runbook section.
4. Link from the affected PR description so reviewers know the
   defence is documented.

A scenario without a CI test or a Manual gate is not a scenario; it
is a hope.
