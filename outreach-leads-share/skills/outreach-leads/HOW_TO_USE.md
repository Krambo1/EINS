# `/outreach-leads` · How to use

Three override tokens, all appended to the slash-command on the same line. Keys case-insensitive, values literal. Combine freely.

## Controls

| Token | Type | Default | What it does |
|---|---|---|---|
| `STADT=<name>` | string | (queue) | Run **one city only**, ignores the Notion queue and its `offen`/`done` status. Umlauts OK (`Köln`, `Düsseldorf`, `Mönchengladbach`). |
| `DRY_RUN_LIMIT=<n>` | int ≥1 | unlimited | Caps **successful Notion writes per city**. Skips and errors don't count. Once `n` rows land, that city stops. |
| `MODEL=<sonnet\|haiku\|opus>` | enum | `haiku` | Overrides the **Candidate-Worker model**. City-Discovery stays on Sonnet. Use `sonnet` for tricky cities (lots of LinkedIn digging), `opus` for debugging, `haiku` for cheap mass runs. |

Malformed tokens (`DRY_RUN_LIMIT=abc`) abort immediately with a one-line error. No silent guessing.

## Recipes

```text
/outreach-leads                                  → drain the whole Notion queue (CITY_QUEUE, Status=offen)
/outreach-leads STADT=Essen                      → just Essen, ignore queue status
/outreach-leads STADT=Köln DRY_RUN_LIMIT=10      → trial run: 10 Köln leads, stop
/outreach-leads DRY_RUN_LIMIT=5                  → 5 per city across the whole queue (smoke test)
/outreach-leads STADT=Düsseldorf MODEL=sonnet    → escalate worker model for one city
```

Natural language also works for `STADT`: "for Essen" / "in Köln" → translated automatically. The other two tokens must be in `KEY=VALUE` form.

## What you can't control from the slash-command

These are configured in **Notion**, not via flags:

- **City queue** → the `cities_to_cover` DB on the Config-Page. Add a row with Status `offen` to enqueue; rows flip to `done` automatically when their run finishes (or stay `offen` if a run-level budget killed the run mid-city).
- **Stadtbezirke per city** → optional `districts` text property on the city row. Comma-separated. Overrides the default district list for the big-five (Köln / Düsseldorf / Essen / Dortmund / Duisburg). All other cities have no district sweep unless you add this.
- **Skip-chains** → `skip_chains` property on the Config-Page. Comma-separated chain names that get R4-skipped automatically (M1 Med Beauty, S-thetic, etc.).
- **Hard budgets** (12h wall-clock, 10k Places calls, 2k candidate spawns per run; 240 min and 400 spawns per city) → baked into the skill body. Change them by editing `~/.claude/skills/outreach-leads/SKILL.md`.

## What the run looks like

1. You invoke the skill. No preamble: first thing you see is a `notion-fetch` reading the Config-Page.
2. For each city: one **City-Discovery-Worker** (Sonnet, ~1-3 min) returns a deduped place_id list.
3. Then **Candidate-Workers** spawn sequentially (Haiku, ~30-90s each). One per Praxis: pulls Place Details, enriches via WebFetch + LinkedIn, runs the R1-R7 quality gate, writes one Notion row or skips.
4. After every city, the city's queue row flips to `done`.
5. At the very end, one **Status-Block** drops as the final message. That's your deliverable: cities, write counts, skip-reason breakdown, LinkedIn coverage, errors.

No mid-run chatter, no per-candidate updates streamed to you. If you want to watch progress, open the Leads-DB in Notion; rows appear there in real-time.

## When to use which model

- **Default (`haiku`)** → cheap, fast, good enough for ~85% of Praxen where the website + LinkedIn search are clean.
- **`sonnet`** → if Haiku is producing too many R6 (low_confidence) skips on a city you know is dense. Costs ~5-8x more per candidate.
- **`opus`** → only when you're debugging a Candidate-Worker prompt issue. Don't use for production runs.

## Stopping a run

Hit interrupt. The skill itself has no graceful-shutdown control: you abort the Main-Thread session and any city that was mid-loop stays `offen` in Notion so you can resume by re-invoking `/outreach-leads` (or `/outreach-leads STADT=<that city>` to redo just that one).

## Prereqs (for other people running this)

- Notion MCP connected with write access to the **EINS · Outreach Leads NRW** DB and the Config-Page.
- Google Places MCP connected (`places_search` + `place_details`).
- Both subagent profiles installed at `~/.claude/agents/eins-outreach-city-discovery.md` and `~/.claude/agents/eins-outreach-candidate-worker.md`.
- WebFetch + WebSearch tools enabled (default in Claude Code).

If any of those are missing the bot aborts with `aborted: tools_unavailable` before doing any work: no half-runs.
