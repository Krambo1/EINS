---
name: outreach-leads
description: Launch the EINS Outreach Bot — the multi-agent NRW-Praxen-Recherche pipeline that exhausts cities from Karam's Notion CITY_QUEUE, writes qualified Praxis-Leads into the "EINS · Outreach Leads NRW" database, and returns a Status-Block at the end. Use this skill whenever the user invokes `/outreach-leads`, says "run the outreach bot", "outreach lauf starten", "EINS leads sweep", "lead-recherche starten", "städte abklappern", "praxen rauskratzen", or otherwise asks to kick off a Praxis-Discovery run. Also trigger on bare phrases like "starte den bot" / "neuer outreach lauf" when the EINS Outreach Bot is the obvious referent. Accepts override args appended to the invocation: `STADT=<city>` (run only one city), `DRY_RUN_LIMIT=<n>` (cap successful writes per city), `MODEL=<sonnet|haiku|opus>` (escalate or de-escalate the worker models). Do NOT trigger for portal lead-management tasks, for editing the bot's system prompt, or for one-off Notion lookups about leads — only for actually launching a recherche run.
---

# EINS Outreach Bot · v2.8 Main-Thread Playbook

## Architecture (read first)

The Outreach Bot is a **two-level fan-out** pipeline. You — the Main-Thread executing this skill — are the orchestrator. You spawn two kinds of subagents but do **none** of the recherche yourself:

```
You (Main-Thread, Karam's session)
  ├─ for each city in CITY_QUEUE:
  │    ├─ spawn ONE Agent(subagent_type: "eins-outreach-city-discovery")
  │    │    → returns deduped [{place_id, name, address}, ...]
  │    └─ for each candidate (sequentially):
  │         └─ spawn ONE Agent(subagent_type: "eins-outreach-candidate-worker")
  │              → returns one JSON outcome
  └─ emit final Status-Block to Karam
```

Why two levels and not three: Claude Code subagents **cannot** spawn further subagents (the Agent tool is stripped from subagent toolbelts at the harness level). The Coordinator role therefore has to live in the Main-Thread, not in a subagent. v2.7's three-level design aborted with `tools_unavailable` for exactly this reason on 2026-05-21.

Your two subagent types live in `~/.claude/agents/`:

- **eins-outreach-city-discovery** (Sonnet) · `places_search` only. Runs the §1 query matrix below, returns deduped place_id list.
- **eins-outreach-candidate-worker** (Haiku) · `place_details`, `WebFetch`, `WebSearch`, `notion-search`, `notion-create-pages`. Runs the full per-Praxis pipeline for ONE place_id, writes one row to Notion (or skips), returns one JSON outcome.

Each subagent's profile body contains its detailed system prompt. You do not need to pass them the playbook — just the per-invocation header lines defined in their input contracts.

---

## Your tool surface

You are the Main-Thread, which means you have full tool access. **But** you should call only these tools during a run:

- `notion-fetch` · read the Config-Page once at the start.
- `notion-update-page` · mark each city `done` in `cities_to_cover` after its City-Discovery + all Candidate-Workers complete.
- `Agent` · spawn City-Discovery-Workers and Candidate-Workers.

You **must not** call `places_search`, `place_details`, `WebFetch`, `WebSearch`, `notion-search`, or `notion-create-pages` directly. Those belong to the subagents. If you find yourself about to call one of them, you have a planning bug — spawn the appropriate subagent instead. (This is a discipline rule, not a mechanical one, because the harness can't restrict the Main-Thread's toolbelt the way it does for subagents.)

---

## Constants

```
NOTION_DB_ID              = cdc3cc7c-442e-4f30-9f5b-4db7bb63851c
NOTION_DATA_SOURCE_ID     = 1967c50b-343e-48b7-bcdc-df1fcbb20f8a
NOTION_CONFIG_PAGE_ID     = 365e7fc8-8734-81d3-8c1d-f9554e036201
```

---

## Step 1 · Parse overrides from the invocation

Scan Karam's message for these tokens (keys case-insensitive, values preserved literally):

- `STADT=<name>` · single-city run; ignores queue status. Accept German names with umlauts (Köln, Düsseldorf, Mönchengladbach). Natural-language ("for Essen", "in Köln") → translate to `STADT=Essen` etc.
- `DRY_RUN_LIMIT=<n>` · integer ≥1. Caps **successful writes** per city. Once `tally.wrote == n` for a city, you stop spawning more Candidate-Workers for that city.
- `MODEL=<sonnet|haiku|opus>` · escalates / de-escalates the Candidate-Worker model. Default for Candidate-Worker is `haiku`; for City-Discovery, `sonnet`.

If a token is malformed (e.g. `DRY_RUN_LIMIT=abc`), tell Karam in one line and stop. Do not guess.

---

## Step 2 · Read the Config-Page

Single `notion-fetch` call on `NOTION_CONFIG_PAGE_ID`. Extract:

- **CITY_QUEUE** · all rows from the `cities_to_cover` database with Status `offen`, in DB order.
  - If `STADT=...` override is set: `CITY_QUEUE = [STADT]` regardless of status.
- **SKIP_CHAINS** · the `skip_chains` property value (comma-separated list of chain names).
- **DISTRICT overrides** (optional) · if a row in `cities_to_cover` has a `districts` text property, use it instead of the default district list (see Reference §B below).

Failure modes:

- Config-Page unreadable → emit Status-Block `aborted: config_unreadable`, stop.
- `CITY_QUEUE` empty AND no `STADT=` override → emit Status-Block `aborted: no_open_city`, stop.

---

## Step 3 · Initialize run-level state

In your head (no Notion writes for this):

```
run_state = {
  start_time: now,
  run_tally: { wrote: 0, skipped: 0, errors: 0 },
  run_skip_reasons: { R1: 0, R2: 0, R3: 0, R4: 0, R5: 0, R6: 0, R7: 0 },
  run_places_calls: 0,        // sum of Discovery queries_run across cities
  run_candidate_spawns: 0,    // count of Candidate-Worker spawns across cities
  cities_done: []             // per-city report rows for the Status-Block
}
```

---

## Step 4 · Per-city loop

For each city in `CITY_QUEUE`, in order:

### 4a. Run-level budget check (before spawning anything)

If **any** of the following are exceeded, stop the run, emit Status-Block with the matching top-level status:

- Wall-clock > **12 h** since `run_state.start_time` → `stopped: run_time_budget`
- `run_places_calls` ≥ **10,000** → `stopped: run_places_budget`
- `run_candidate_spawns` ≥ **2,000** → `stopped: run_candidate_spawns`

Current city stays `offen` in `cities_to_cover` (do not mark it done).

### 4b. Determine districts for this city

If the city has a `districts` property in `cities_to_cover` → use that.
Else if the city is in the §B default district map → use that.
Else → empty (no Stadtbezirks-Sweep).

### 4c. Spawn City-Discovery-Worker

```
Agent(
  subagent_type: "eins-outreach-city-discovery",
  model: "sonnet",   // or MODEL override if Karam passed one
  description: "City-Discovery · " + STADT,
  prompt: "STADT=" + STADT
        + "\nDISTRICTS=" + (districts.join(",") || "")
        + "\nDRY_RUN_LIMIT=" + (DRY_RUN_LIMIT || "")
)
```

Wait for return. The subagent's final message is a single JSON object matching its output contract:

```json
{
  "city": "Köln",
  "districts_used": [...],
  "queries_run": 102,
  "candidates": [{"place_id": "...", "name": "...", "formatted_address": "..."}, ...],
  "truncated": false
}
```

Add `queries_run` to `run_state.run_places_calls`. Set up per-city state:

```
city_state = {
  city: STADT,
  start_time: now,
  candidates: <result.candidates>,
  candidates_truncated: <result.truncated>,
  city_tally: { wrote: 0, skipped: 0, errors: 0, place_details_failed: 0,
                linkedin_owner_found: 0, linkedin_company_found: 0 },
  city_skip_reasons: { R1:0, R2:0, R3:0, R4:0, R5:0, R6:0, R7:0 },
  consecutive_skips: 0,
  per_city_status: null,        // set when loop exits
  candidate_spawns: 0
}
```

If Discovery returns an empty `candidates` array: per_city_status = `done: exhausted`, skip the Candidate-Worker loop, go to 4e.

### 4d. Per-candidate spawn loop (sequential)

For each `candidate` in `city_state.candidates`, in order:

**Stop checks before spawning:**

- `city_tally.wrote >= DRY_RUN_LIMIT` (if set) → `per_city_status = "done: dry_run_limit"`, break out of loop.
- `city_state.candidate_spawns >= 400` (per-city safety cap) → `per_city_status = "partial: budget_candidate_spawns_per_city"`, break.
- Wall-clock > 240 min since `city_state.start_time` → `per_city_status = "partial: budget_time_per_city"`, break.
- `consecutive_skips >= 25` AND `candidate_spawns >= 100` AND `candidates` queue is being drained → `per_city_status = "done: exhausted"`, break.
- Run-level budgets (see 4a) → set `per_city_status = "partial: budget_*"` matching the run-level reason, break out of run entirely after this city.

**Spawn:**

```
Agent(
  subagent_type: "eins-outreach-candidate-worker",
  model: MODEL_OVERRIDE || "haiku",
  description: "Candidate · " + candidate.place_id.slice(0, 12),
  prompt: "STADT=" + STADT
        + "\nSKIP_CHAINS=" + SKIP_CHAINS.join(",")
        + "\nCANDIDATE=" + JSON.stringify({
            place_id: candidate.place_id,
            name: candidate.name,
            formatted_address: candidate.formatted_address
          })
)
```

Wait for return. Parse the final JSON:

```json
{
  "place_id": "...",
  "outcome": "wrote" | "skipped" | "error",
  "skip_reason": "R1" | ... | "R7" | null,
  "row_id": "..." | null,
  "error": "..." | null,
  "place_details_fetched": true | false,
  "linkedin_owner_found": true | false,
  "linkedin_company_found": true | false
}
```

**Update state:**

- `city_state.candidate_spawns += 1`
- `run_state.run_candidate_spawns += 1`
- If `outcome == "wrote"`:
  - `city_tally.wrote += 1`, `run_tally.wrote += 1`
  - `consecutive_skips = 0`
  - If `linkedin_owner_found`: `city_tally.linkedin_owner_found += 1`
  - If `linkedin_company_found`: `city_tally.linkedin_company_found += 1`
- If `outcome == "skipped"`:
  - `city_tally.skipped += 1`, `run_tally.skipped += 1`
  - `city_skip_reasons[skip_reason] += 1`, `run_skip_reasons[skip_reason] += 1`
  - `consecutive_skips += 1`
- If `outcome == "error"`:
  - `city_tally.errors += 1`, `run_tally.errors += 1`
  - Do not increment consecutive_skips.
- If `place_details_fetched == false`:
  - `city_tally.place_details_failed += 1`

**Discard the parsed JSON** after updating state. Do not keep per-candidate results in your context.

### 4e. Per-city wrap-up

If `per_city_status` is still null (loop drained `candidates` naturally), set it to `done: exhausted`.

Append to `run_state.cities_done`:

```
{
  city: STADT,
  per_city_status: city_state.per_city_status,
  wrote: city_state.city_tally.wrote,
  skipped: city_state.city_tally.skipped,
  duration_min: minutes(now - city_state.start_time),
  skip_reasons: city_state.city_skip_reasons,
  linkedin_owner_found: city_state.city_tally.linkedin_owner_found,
  linkedin_company_found: city_state.city_tally.linkedin_company_found,
  place_details_failed: city_state.city_tally.place_details_failed,
  errors: city_state.city_tally.errors
}
```

**Mark city done in Notion** if `per_city_status` ∈ {`done: exhausted`, `done: dry_run_limit`, `partial: budget_*`}: one `notion-update-page` call to set Status = `done` on the city's row in `cities_to_cover`. If `per_city_status` starts with `partial:` due to a run-level budget hit, the city stays `offen` (so Karam can resume from there next run); only the per-city budgets / exhaustion lead to `done`.

**Discard `city_state`** before moving to the next city. Your context must not accumulate per-city detail across cities — only `run_state.cities_done` (one row per city) and the running counters.

---

## Step 5 · Emit final Status-Block

After the city loop terminates (queue complete, run-level budget hit, or single-city override done), emit **exactly one** Status-Block as your final message to Karam:

```
EINS Outreach Bot v2.8 · {top_level_status}
Cities:
  {city 1}: {per_city_status}, {n} written, {n} skipped, {n} min
  {city 2}: {per_city_status}, {n} written, {n} skipped, {n} min
  ...
Total: {n} written · {n} skipped · {n} min
Skip-Reasons (total): R1:{n} (dedupe) R2:{n} (web_unreachable) R3:{n} (no_owner) R4:{n} (chain) R5:{n} (non_aesthetic) R6:{n} (low_confidence) R7:{n} (no_contact)
LinkedIn coverage (Owner / Company): {n}/{total_written} / {n}/{total_written}
place_details failures: {n}
Errors (intern): {n}
```

**Per-city status values:**

- `done: exhausted` · Discovery drained and §4d exhaustion criterion hit.
- `done: dry_run_limit` · `DRY_RUN_LIMIT=N` reached.
- `partial: budget_time_per_city` · 240 min per-city wall-clock hit.
- `partial: budget_candidate_spawns_per_city` · 400 spawn safety cap hit.
- `partial: run_time_budget` / `partial: run_places_budget` / `partial: run_candidate_spawns` · run-level budget interrupted this city.

**Top-level status values:**

- `done: queue_complete` · all cities processed.
- `done: single_city` · `STADT=` override completed.
- `stopped: run_time_budget` · 12-h cap hit.
- `stopped: run_places_budget` · 10,000 Places-API calls hit.
- `stopped: run_candidate_spawns` · 2,000 Candidate-spawns hit.
- `aborted: config_unreadable` · Config-Page read failed.
- `aborted: no_open_city` · `CITY_QUEUE` empty, no override.
- `aborted: tools_unavailable` · `Agent`, `notion-fetch`, or a required MCP tool not callable; halt before any work.

**Skip-reason labels** are locked: `R1 (dedupe)`, `R2 (web_unreachable)`, etc. No German synonyms.

The Status-Block IS your final output. No preface, no commentary after.

---

## Reference §A · City Queue (default, from `cities_to_cover`)

Default order of the 65 NRW cities (Tier 1: 30 core cities by population, Tier 2: 35 affluent suburbs + mid-size markets):

```
Tier 1 (1-30):
Düsseldorf, Köln, Essen, Bonn, Münster, Aachen, Dortmund, Bochum,
Wuppertal, Bielefeld, Krefeld, Mönchengladbach, Leverkusen, Neuss,
Paderborn, Siegen, Bergisch Gladbach, Mülheim an der Ruhr, Solingen,
Oberhausen, Hagen, Hamm, Gelsenkirchen, Recklinghausen, Duisburg,
Remscheid, Moers, Iserlohn, Bottrop, Gütersloh

Tier 2 (31-65):
Ratingen, Meerbusch, Hilden, Langenfeld, Monheim am Rhein, Pulheim,
Hürth, Brühl, Troisdorf, Sankt Augustin, Dormagen, Bergheim, Kerpen,
Düren, Witten, Marl, Lünen, Velbert, Lüdenscheid, Viersen, Minden,
Rheine, Detmold, Lippstadt, Arnsberg, Herford, Castrop-Rauxel,
Dorsten, Gladbeck, Bocholt, Wesel, Hattingen, Unna, Soest, Eschweiler
```

The actual queue is read from Notion (Status `offen` rows in `cities_to_cover`); this list is the seed.

## Reference §B · Default Stadtbezirke (only big cities; Bezirks-Sweep mandatory)

- **Köln** (9): Innenstadt, Lindenthal, Ehrenfeld, Nippes, Mülheim, Kalk, Porz, Chorweiler, Rodenkirchen.
- **Düsseldorf** (10): Altstadt, Carlstadt, Pempelfort, Flingern, Oberkassel, Bilk, Unterbilk, Düsseltal, Stockum, Benrath.
- **Essen** (9): Stadtmitte, Rüttenscheid, Bredeney, Werden, Kettwig, Borbeck, Holsterhausen, Frohnhausen, Steele.
- **Dortmund** (10): Innenstadt-West, Innenstadt-Ost, Hörde, Mengede, Aplerbeck, Hombruch, Brackel, Eving, Lütgendortmund, Huckarde.
- **Duisburg** (7): Mitte, Walsum, Hamborn, Meiderich, Homberg, Rheinhausen, Süd.

All other cities: base matrix only (no district sweep). Karam can override per-city via the `districts` text property in `cities_to_cover`.

## Reference §C · Default SKIP_CHAINS

```
M1 Med Beauty, S-thetic, DermaLogica, Beautyhills, Cleanderma, Klinik am Rhein-Gruppe
```

Actual list is read from the Config-Page (`skip_chains` property) and may have been edited by Karam.

---

## What not to do

- **Do not call places_search, place_details, WebFetch, WebSearch, notion-search, or notion-create-pages directly.** Those are subagent jobs. If a Candidate-Worker fails and you're tempted to "just check the website yourself" — don't. Mark it as `error` in the tally and move on.
- **Do not modify the subagent profiles inline** during the run. If a profile is broken, abort the run with `aborted: tools_unavailable`, fix the profile, restart.
- **Do not parallelize Candidate-Worker spawns.** Sequential is mandatory — two parallel Workers can both R1-dedupe against Notion, both find no match, both write the same Praxis (rare but real). Notion's 3/s rate limit also makes aggressive parallelism unstable.
- **Do not preface the run with chat output.** First user-visible message after `/outreach-leads` is the first tool call (notion-fetch). No "starting now", no "loading config". Karam invoked the skill; that is the confirmation.
- **Do not emit a partial Status-Block mid-run.** One Status-Block at the very end. If you have to abort, that's the Status-Block.
- **Do not summarize the Status-Block.** The block IS the deliverable. Forward it as your last message verbatim.
- **Do not write to any Notion DB other than the Leads-DB (via Candidate-Workers) and `cities_to_cover` (your own update-page calls).**

## Single-context fallback (no Agent tool)

If the `Agent` tool is not available in your toolbelt (rare — would only happen in a stripped Claude Code config), emit `aborted: tools_unavailable [single_context_mode]` and stop. Do **not** attempt to run the full pipeline yourself in a single context — that's the v2.6 design that exhibited context-rot at ~10-15 candidates. Better to abort cleanly and have Karam fix the toolset than to produce partial garbage.
