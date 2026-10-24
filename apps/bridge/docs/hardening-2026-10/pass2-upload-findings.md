# Pass 2: agent upload findings (source reviews, 2026-10-07)

Two read-only reviews of the agent upload path. Work package WP-C fixes them; see HANDOFF.md Pass 2 for status.

## Review A (Sonnet breadth review)


## Findings, most damaging first

**1. P0, config wiped on re-enrollment** (confidence: high, proven by probe4)
- **Where:** `AGENT/enrollment.ts:284-296` (`finalizeEnrollment`), with the `--enroll` call in `AGENT/index.ts:399-512`.
- **Defect:** `finalizeEnrollment` builds a fresh config containing only clinicId, portalBaseUrl, watchFolder, machineFingerprint and the honorar CSV fields. It reads `existing` only for the fingerprint, so `dbAdapters` and `gdtReceiverId` are dropped. The honorar fields survive only if repeated on the CLI, and `watchFolder` resets to the default.
- **Failure scenario:** The 401 log in `flush.ts` says "re-enrollment may be required". The portal also rotates the secret on every enrollment. An admin re-enrolls to fix the auth pause. The DB-adapter streams, the GDT receiver and the CSV watcher then never start. The heartbeat just reports fewer sources and nothing alerts, so for that clinic the PVS data stops until someone notices.
- **Fix:** Merge into the existing config: `{...existing, clinicId, portalBaseUrl, machineFingerprint, ...cliOverrides}`. Overwrite `watchFolder`, `honorarCsvFolder` and `honorarCsvMapping` only when passed explicitly.
- **Test:** Save a full config with `dbAdapters`, `gdtReceiverId` and honorar fields. Call `enroll()` with minimal args. Assert all of them survive and `watchFolder` is unchanged.

**2. P1, the agent accepts emails the portal rejects, and the portal dead-letters the whole event** (confidence: high on the mismatch, medium on how often it hits)
- **Where:** `AGENT/csv-mapper.ts:~1458`, `AGENT/normalize.ts:~206` and `AGENT/db-adapters/normalizer.ts:~488` (`lowerEmail`), against the `PvsEventSchema` email rule (`.email().max(200)`) in `apps/portal/src/server/pvs-events.ts`.
- **Defect:** All three agent producers use the loose regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`. Zod's `.email()` is stricter. Probe6 shows `anna@web.de.`, `a..b@x.de`, umlaut local parts, `a@b.c` and addresses with a trailing `;` or `>` pass the agent and fail the portal.
- **Failure scenario:** The portal answers 400 `invalid_envelope`, which is in `PERMANENT_EVENT_REASONS`, so `markFailedPermanent` runs. The whole `PatientUpserted` is lost, not just the email. The patient's appointments and invoices then have nothing to link to, which loses revenue attribution. Real PVS data has dirty emails at an estimated ~1% (a guess, not measured).
- **Not confirmed as a defect:** Numeric ids reaching the wire as numbers do not occur in the shipped configs. All nine cast ids to text (`CAST(.. AS VARCHAR(40))` or `::text`). It is only a footgun for a custom config. `fullName` and labels are not clamped to 200 characters, and I did not test whether a real row can exceed that.
- **Fix:** Validate optional fields in the normalizers with the portal's exact rules (a shared schema or the same `.email()` check) and drop an invalid optional field instead of emitting it. Alternatively, make the portal's optional fields degrade to absent with `.catch(undefined)`, as the heartbeat schema already does. Clamp strings to 200 characters.
- **Test:** Feed each producer (CSV, GDT, DB adapter) dirty emails, a 300-character name and a numeric id. Assert `PvsEventSchema.safeParse(payload).success` is true for every emitted event.

**3. P1, any non-retryable, non-auth HTTP status dead-letters on first sight, even a non-JSON body** (confidence: high, probe2)
- **Where:** `AGENT/portal-client.ts:~531-546` (single path) and `~660-679` (batch, which falls back to single); `AGENT/flush.ts:~197-201`.
- **Defect:** A 404, 400, 406, 410, 414 or 431 becomes a permanent failure whatever the body, including an HTML page from a proxy, CDN or captive portal, or a Vercel DEPLOYMENT_* page.
- **Failure scenario:** During a bad deploy or a middlebox hiccup, probe2 dead-lettered 100 of 120 rows in 2 cycles. A dead-lettered row cannot be re-queued, because `UNIQUE(content_hash)` makes `INSERT OR IGNORE` swallow the re-enqueue. For GDT files the duplicate-looking rows get deleted, so the data is gone. Agent/portal version skew producing `invalid_envelope` loses events the same way.
- **Fix:** Treat a status as permanent only when the body is JSON with a known portal `error.code`. Otherwise retry with long backoff (up to 1 h). Add a requeue path, or hold `invalid_envelope` rows for N days before dead-lettering.
- **Test:** Stub a 404 `text/html` response and assert the rows stay `pending` with `attempt_count` incremented. Then dead-letter a row, call the requeue API, and assert it flows.

**4. P1, a second enrollment silently kills the first PC and masks it** (confidence: medium, design-level)
- **Where:** `apps/portal/src/server/pvs-agent-enroll.ts` (a new secret is minted on every enrollment) and the one-row-per-clinic `pvs_agent_status`.
- **Defect:** The first PC is auth-paused for good after a second enrollment, and the second PC's healthy heartbeat overwrites the status row.
- **Failure scenario:** The first PC holds its rows indefinitely. The clinic dashboard shows healthy and no alert fires, because the heartbeat route's own auth-failure handling never reaches the shared row.
- **Fix:** Track status per machine fingerprint, or let a second enrollment reuse the current secret. Alert when any known machine has been auth-paused for more than 1 h.
- **Test:** Enroll twice for the same clinic. Assert the first machine's status is not masked and an `agent_auth_paused` signal exists.

**5. P1, per-row autocommit enqueue in the DB-adapter poll loop** (confidence: high, measured)
- **Where:** `AGENT/db-adapters/framework.ts:~1128`, which calls `enqueue()` per event. `outbox.ts:~493` is autocommit per row, and `enqueueMany` (`outbox.ts:~519`) is a single transaction.
- **Defect:** The GDT and CSV paths were moved to `enqueueMany`, but this one was not. It measured 2.8 ms per row against 0.013 ms per row for `enqueueMany` (215x) on an SSD.
- **Failure scenario:** A poll of 500 to 5000 rows (the batchSize range) blocks the event loop for 1.4 to 14 s on an SSD, and several times longer on an HDD. Heartbeats and flushes stall during the first backfill.
- **Fix:** Collect the payloads for one poll and call `enqueueMany` once. Advance the cursor only after the transaction commits.
- **Test:** Poll 2000 rows and assert one transaction and a bounded duration. Inject an enqueue failure and assert the cursor does not advance.

**6. P1, portal rate limit is spent before signature verification** (confidence: high, from code and the limits)
- **Where:** `apps/portal/src/app/api/pvs/events/route.ts:155` vs `:173`; `apps/portal/src/app/api/pvs/events/batch/route.ts:132` vs `:149`.
- **Defect:** The per-clinic `rateLimit` runs before `verifyClinicSignature`. The heartbeat route does it the other way round, on purpose.
- **Failure scenario:** Anyone who knows a clinic UUID (the per-IP limit is only 30 per minute) can keep the clinic's 60 per 10 min batch budget saturated. The real agent then sees only 429, rows pile up, and nothing is lost but nothing arrives.
- **Fix:** Apply the per-clinic limiter after signature verification. Keep only the per-IP limiter before it.
- **Test:** Send 100 unsigned requests for a clinic. Assert a following signed request is not 429.

**7. P2, vacuum and prune never run on PCs that are shut down nightly** (confidence: high)
- **Where:** `AGENT/index.ts:~851-867`.
- **Defect:** `vacuumTimer = setInterval(..., 24h)` has no initial run, so `vacuumOld`, `pruneFailedOlderThan` and the failure-summary post only fire after 24 h of continuous uptime.
- **Failure scenario:** A practice PC that is switched off every night never prunes sent rows (7-day retention) or old failed rows (30 days). It also never posts failure summaries, so dead letters stay invisible.
- **Fix:** Run once about 60 s after startup, then every 24 h.
- **Test:** With fake timers, assert vacuum runs within 2 minutes of `start()`.

**8. P2, `getFailureSummary` full-scans pending rows every 60 s** (confidence: high, measured)
- **Where:** `AGENT/outbox.ts:~714-770`, called from `emitHeartbeat` (`AGENT/index.ts:~1001-1083`).
- **Defect:** The query blocks the event loop for 1.77 s at 500k rows on an SSD, once per heartbeat.
- **Failure scenario:** During a long portal outage with a deep queue, the agent freezes for about 2 s every minute. That is worse on an HDD, and flushes slow down while they are most needed.
- **Fix:** Use a bounded or cached query, or maintain counters.
- **Test:** Seed 500k rows and assert `getFailureSummary()` finishes under 100 ms.

**9. P2, wall-clock persisted and compared state** (confidence: medium)
- **Where:** `AGENT/outbox.ts:~540-561` (`dueRows`: `next_attempt_at` vs `Date.now()`), `AGENT/index.ts:~833-839` (`nextFlushAllowedAt`), `AGENT/flush.ts:~135` (`lastAuthProbeAt`).
- **Defect:** A clock set too far ahead and then corrected leaves `next_attempt_at` in the future, so rows go invisible. `stalePending` cannot see them either, because it uses `created_at`.
- **Failure scenario:** A PC with a wrong date, corrected an hour later, holds up to 1 h of backoff. A larger jump holds rows until the old date catches up. A large forward jump also skips backoff.
- **Fix:** In `dueRows`, also treat `next_attempt_at > now + 2h` as due. Use `performance.now()` or `process.hrtime` for in-memory timers.
- **Test:** Set `next_attempt_at` to `now + 1 day` and assert `dueRows` returns the row.

**10. P2, the single-event path treats any 2xx as stored** (confidence: high)
- **Where:** `AGENT/portal-client.ts:~548-549`.
- **Defect:** `postEvent` returns `{ok:true}` for any 2xx, and `res.json().catch(() => ({}))` swallows a non-JSON body. The batch path is strict, so this contradicts "never mark sent on an unaligned response".
- **Failure scenario:** A captive portal or redirected GET returning an HTML 200 marks the row sent without it ever being stored. It is reachable only via batch fallback or isolation, so the exposure is narrow.
- **Fix:** Require `ok:true` JSON with a known `status`. Treat anything else as ambiguous and retryable.
- **Test:** Stub a 200 `text/html` response and assert the row stays `pending`.

**11. P2, folder check can delay flush start for minutes** (confidence: medium)
- **Where:** `AGENT/index.ts:~798` (`await refreshFolderStatus()`) and `AGENT/folder-check.ts` (`stat` has no timeout).
- **Defect:** The await runs before the flush and heartbeat timers are created (~831-888).
- **Failure scenario:** An offline UNC share can make `stat` hang for the OS network timeout. Nothing is uploaded, and no heartbeat is sent, until it returns.
- **Fix:** Bound it with `Promise.race([..., 10s])`, or start the timers first.
- **Test:** Mock `stat` to never resolve and assert the flush timer still starts within 15 s.

**12. P2, an all-retryable 201 batch has no cycle-level backoff** (confidence: medium for the hammering, low for the poison-event wedge)
- **Where:** `AGENT/flush.ts:~225-256` (`runBatchCycle`); isolation is triggered only for `httpStatus >= 500`.
- **Defect:** When the batch returns 201 and every per-event result is retryable (for example `internal_error`), only per-row `recordRetry` runs. `retryAfterMs` and `consecutiveTransientFailures` are set only on batch-level failures.
- **Failure scenario:** The agent keeps posting every 5 s and burns the 60 per 10 min batch limit, so 429s follow. `attempt_count` climbs on the rows the portal is rejecting. Separately, a poison event that makes the portal slow ends in timeouts, which never trigger single-event isolation, so the head of the queue could wedge (low confidence, not reproduced).
- **Fix:** Count a batch whose results are all retryable as a transient batch failure. Let timeouts and ambiguous responses also trigger the isolation cycle after N repeats.
- **Test:** Stub a 201 whose 50 results are all `internal_error`. Assert `nextFlushAllowedAt` moves out and the post rate stays below the limit.

## Checked and fine

- **Two flushes at once:** impossible. `flushInFlight` guards it, and `index.ts:837` is the only caller of `runFlushCycle`.
- **Marked sent without being stored:**
  - Batch results are matched by index. A length mismatch or a non-JSON 2xx is retryable and never marked sent.
  - 413 on a batch falls back to single.
  - The stored payload is written once and the same bytes are sent on retry.
- **Event id stability:** `content_hash` equals `pvsExternalEventId`. GDT and CSV ids are content-derived, so they are stable across retries and restarts.
- **Pruning:** only touches `failed` rows older than 30 days and `sent` rows older than 7 days. It never deletes `pending`.
- **401 after token rotation:** 401, 403 and 400 `invalid_request` pause flushing and hold the rows. Probing continues every 10 min and recovers on its own. HMAC has no timestamp, so clock skew does not affect auth.
- **Re-enroll vs stale secret cache:** enrollment refuses while the agent holds the instance lock.
- **Key or DPAPI failure after upgrade:**
  - It is a visible supervised restart loop (2 s doubling to 60 s), covered by the heartbeat-stale alert. The outbox is never re-minted.
  - The DPAPI round trip works for non-ASCII DB passwords.
- **Legacy plaintext to SQLCipher migration:** crash-safe, and the outbox schema is unchanged across git history (only the additive `sent_at` column).
- **Durability:** `journal_mode=delete` with `synchronous=FULL` survives power loss.
- **500k-row outbox:** `dueRows` is O(limit) at about 1 ms. The only slow point is `getFailureSummary` (finding 8).
- **Retry and backoff:**
  - Backoff is capped at 5 min for batches and 1 h per row.
  - Retry-After is clamped to 5 min.
  - A Retry-After of 0 does not hot-loop, because the 5 s tick is the floor.
  - Rate limiting is a fixed window, so there is no Retry-After death spiral.
- **Hangs:** timeouts are 30 s on headers and undici's 300 s on bodies, so nothing hangs forever.
- **Two PCs for one clinic:** the second enrollment rotates the secret by portal design. The first PC is held, not dropped (the alerting gap is finding 4).


## Review B (Opus second pass)


**1. P1: The outbox silently swallows corrected DB-adapter invoices**
- **Where:** `agent/src/outbox.ts:93` (`UNIQUE(content_hash)`), `outbox.ts:493-506` and `519-538`, `db-adapters/framework.ts:1129-1133` (`enqueue(payload, event.pvsExternalEventId)`), `db-adapters/configs/*.yaml` (for example `medatixx.yaml:226`, `"medatixx:invoice:{id}"`, the same in all 9 YAMLs).
- **Defect:** The outbox dedups on the event id alone, but the portal dedups on id plus occurredAt. The 9 invoice templates carry no revision (the refund templates do have `{modified_at}`), so every corrected invoice row has the same id as the original.
- **Scenario:** A medatixx invoice is paid at 100 € on Monday and sent. On Tuesday staff correct it to 150 € or fix `BEZAHLT_AM`. `DAT_MOD` changes, the adapter re-reads the row, and the enqueue is swallowed. Probe result: `{inserted:0, duplicates:1}`, and only the 100 € row exists. Nothing logs it, because `emitted++` still counts it. The block lasts 7 days after the first send, or forever on PCs where the vacuum never runs (known #7). For an amount-only correction the portal would dedup it too, because paidAt is unchanged.
- **Fix:**
  - Set `content_hash = sha256(pvsExternalEventId|occurredAt|payload)`. Existing rows keep their old hashes.
  - Change the invoice templates to `…:invoice:{id}:{modified_at}`.
  - Resolve the resulting equal-paidAt ties with a source revision (see #3).
- **Failing test:** enqueue v1 (`medatixx:invoice:4711`, 10000), `markSent`, then enqueue v2 (same id, 15000, new paidAt). Expect 2 rows and v2 pending.
- **Confidence:** high.

**2. P1: Dead-lettered events raise no alert anywhere and can be pruned with no recovery window**
- **Where:**
  - Portal: `server/pvs-agent-health.ts:305ff`, `api/pvs/agent/heartbeat/route.ts:413-423`, `api/pvs/agent/failure-summary/route.ts`.
  - Agent: `outbox.ts:794-816`, `flush.ts:153-202` and `265`.
- **Defect:**
  - `failedCount` is not part of the health conditions. The failure-summary route only writes an audit row and a table row. Nothing goes to `notifyOps`; there is only the admin badge and an audit row above 100.
  - The prune keys on `created_at`, so a row that sat pending for over 30 days and is dead-lettered today is deleted at the next vacuum.
- **Scenario:** Known #2 (email regex) or #3 (HTML 404) permanently drops revenue events, and nobody is notified. This is worse than #3 as described: in batch mode, a batch-level 404/405/410 hits `fallbackToSingle` every cycle. That dead-letters about 50 rows every 5–15 s with no circuit breaker, so a 15-minute misroute kills thousands of events. Fetch also follows a 301/302 by turning the POST into a GET, which returns 405 and triggers the same cascade.
- **Fix:**
  - Portal: add a `dead_letter` condition (high) that fires when `failedCount` rises past the stored value, and include the top reasons.
  - Agent: add a `failed_at` column and prune on `COALESCE(failed_at, created_at)`. Add an `--requeue-failed [--reason]` CLI. Stop the fallback after N consecutive per-row permanent failures that share one status. Pass `redirect:"error"` on agent POSTs.
- **Failing tests:**
  - A heartbeat with failedCount 0→5 expects a `pvs_agent_health:dead_letter` alert.
  - A row created 40 days ago and failed now must survive `pruneFailedOlderThan(30)`.
- **Confidence:** high.

**3. P1: The agent re-orders events for the same invoice or patient, and the portal resolves ties by arrival order**
- **Where:** `outbox.ts:546` (`ORDER BY next_attempt_at`), `flush.ts:181,247` (independent ±20 % jitter per row), `flush.ts:268-273` (single-mode reshuffle). Portal side: `pvs-status-derive.ts:627-638` (ties broken by `ingestedAt`), `:189` (ORDER BY occurredAt only), `pvs-linking.ts:613-644` (PatientUpserted: last arrival wins).
- **Defect:** A retried row is pushed behind newer rows and its original order is lost. The portal relies on "later INSERT wins" when occurredAt is equal, which is exactly the case for CSV corrections: the id contains the total and `at` is the same.
- **Scenario A (probe):** v1 = 100 € and v2 = 150 € are both in one batch. The portal returns `internal_error` for v1 once. The portal then receives `15000 -> 10000`, so the stale 100 € is counted permanently.
- **Scenario B (probe):** a `link_not_ready` period, or 3× 5xx followed by single mode, leaves 40 queued rows in random order (370 of 780 pairs inverted).
- **Patient data:** an older PatientUpserted overwrites a newer email or phone, which hurts lead linking and review emails. A retry of a half-applied older event via `finishDuplicate` does the same.
- **Fix:**
  - Primary: add a producer `sourceRevision` (DB `modified_at`+tiebreak; CSV file mtime+row; GDT file mtime+Satz). Use it before `ingestedAt` in `isLaterEntry`, and as a guard in `mergePvsDataIntoPatient`. Change the derive ORDER BY to `(occurredAt, ingestedAt, id)`.
  - Agent defense: add an `order_key` column. `dueRows` orders by id and skips a row while an older pending row with the same key exists. Single-mode 5xx should use a cycle-level backoff instead of per-row jitter.
- **Failing test:** the probe scenario A. Assert that the portal receives v1 before v2.
- **Confidence:** high on the mechanism, medium on frequency.

**4. P2: A slow or hanging event wedges the whole outbox**
- **Where:** `flush.ts:267-277`, `portal-client.ts:21` (30 s timeout), `events/batch/route.ts:31,174-208` (maxDuration 60, applied one by one).
- **Defect:** Only a batch-level 5xx can trigger poison isolation. A batch timeout counts as a network failure and the rows are left untouched; the existing test "network failures grow the backoff" locks this in.
- **Scenario:** One event in the oldest 50 takes more than 60 s, for example partition-heal DDL waiting on a lock or a pathological linker query. Every attempt aborts at 30 s, and the same 50 rows come back forever. The `backlog_stuck` alert then says "check the firewall".
- **Fix:** Treat 3 consecutive batch timeouts while the heartbeat is OK like 5xx (single mode). Single mode's network-failure handling already moves the poison row back. Also give the portal batch route a time budget: stop at about 20 s and return a retryable `deferred` result for the rest.
- **Failing test:** `postBatch` always times out; after 3 cycles expect `singleModeNext === true`.
- **Confidence:** high on the mechanism, medium on the trigger.

**5. P2: The heartbeat never says why uploads are stuck, and the alert points the wrong way**
- **Where:** `flush.ts:267-290` (batch-level failures write no `last_error`), `outbox.ts:714-737` (only failed rows' reasons are reported), `index.ts:1029-1057`, `pvs-agent-health.ts:386-405`.
- **Defect:** Batch-level failures leave no trace in the outbox, the heartbeat reports no reasons for pending rows, and it sends no flush state (`authPaused`, last batch error).
- **Scenario:** `link_not_ready`, `vendor_mismatch`, `ambiguous batch response` or batch timeouts cause `backlog_stuck`. The ops email says to check internet, firewall and proxy, although the arriving heartbeat proves connectivity. The real reason exists only in a log line on the Praxis PC that is written at most every 10 min.
- **Fix:** Add `uploadState{authPaused,lastBatchError,lastBatchErrorAt,consecutiveTransientFailures,lastSuccessAt}` and `pendingReasons` (top `last_error` among rows with `attempt_count > 0`) to the heartbeat, and branch the alert text on them.
- **Failing test:** after per-event `link_not_ready`, the heartbeat payload contains `pendingReasons:[{reason:"link_not_ready"}]`.
- **Confidence:** high.

**Also worse than described:**
- **#9:** the in-memory gates (`nextFlushAllowedAt`, `lastAuthProbeAt`) also use the wall clock, and any batch transient failure sets `nextFlushAllowedAt`. A backward clock step freezes the whole flush loop until the next restart.
- **Out of scope, for the CSV owner:** per-period Honorar exports where Teilzahlungen span two files. The later file's partial total has a later `at` and wins, so revenue is understated.

## Checked and fine
- **No "sending" state:** rows stay pending during a POST. A crash leads to a resend of the identical stored payload, and the portal dedups it.
- **HMAC:** the batch body is built by string concatenation, and that exact string is both signed and sent. The portal verifies over `request.text()`. `JSON.stringify` escapes lone surrogates, so the UTF-8 round trip is lossless.
- **SQLite durability:**
  - The probe showed `journal_mode=delete`, `synchronous=2` (FULL) and `busy_timeout` 5000, which is durable on power loss.
  - The actual cipher is chacha20, not SQLCipher as the comments say; this is harmless.
  - All modules share one connection, there is no manual `BEGIN`, and all transactions are synchronous. So there is no cross-subsystem rollback and no in-process `SQLITE_BUSY`.
  - 50 autocommit `markSent` calls took 116 ms here (perf only).
- **Outbox mechanics:** `INSERT OR IGNORE` semantics and non-empty ids are correct. Backoff overflow clamps to 1 h with no NaN. Batch outcome alignment is correct, and an ambiguous 2xx never marks rows sent.
- **Timeouts:**
  - The abort covers DNS, connect and headers.
  - Body reads are bounded by undici's `bodyTimeout` (300 s).
  - The DPAPI child process is bounded at 30 s, so `flushInFlight` cannot wedge forever.
  - A keep-alive socket that died during sleep gives a reset or abort, which is retried; dedup absorbs any double send.
- **TLS interception:** classified as a retryable network failure, with a local hint. The portal raises `heartbeat_stale` (high during business hours, which emails ops). Node 20 cannot read the Windows cert store, so `NODE_EXTRA_CA_CERTS` must be set as a machine env var. The supervisor passes the environment through.
- **Proxy:** the `EnvHttpProxyAgent` plus undici fetch swap is correct.
- **Re-enroll:** a running agent must be stopped first (`refuseIfAgentRunning`), so the in-memory secret cache is safe.
- **Heartbeat schema:** it truncates or clamps oversized fields instead of rejecting the heartbeat. Liveness uses the portal's receive time.
- **Portal batch apply:** events in a batch are applied one at a time, each with its own `ingested_at`.

Probe scripts are in `C:\Users\karam\AppData\Local\Temp\pass2-opus-upload\`: `probe-order.mts`, `probe-dedupe.mts`, `probe-pragma.mts`.

