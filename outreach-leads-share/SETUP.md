# `/outreach-leads` · Setup Guide

This bundle ships Karam's EINS Outreach Bot v2.8: a multi-agent Claude Code pipeline that sweeps a queue of cities, finds aesthetic-medicine Praxen via Google Places, enriches each one (website + LinkedIn + treatments + story), runs a 7-rule quality gate, and writes qualified leads into a Notion DB. Invoked with `/outreach-leads` in Claude Code.

The bot is split across three pieces, all of which you'll install in this guide:

1. A **skill** at `~/.claude/skills/outreach-leads/` — the Main-Thread orchestration prompt.
2. Two **subagents** at `~/.claude/agents/` — the City-Discovery worker (Sonnet) and the Candidate-Worker (Haiku).
3. Two **MCP servers** in your Claude Code config — Notion (official) and a Google Places wrapper you'll deploy yourself.

Plan on ~45 min for the first install. Most of it is Notion DB setup and Google Cloud key provisioning.

---

## Prerequisites

- **Claude Code** installed and working (`claude` on your PATH). Tested on macOS, Linux, and Windows (PowerShell).
- A **Notion workspace** you can write to, with admin rights to create databases and connect integrations.
- A **Google Cloud** account with billing enabled (Places API needs billing on, even at free-tier usage).
- A **Vercel** account (free hobby tier is fine) for hosting the Places MCP wrapper.
- **Node 20+** and **git** locally if you want to deploy from CLI; the Vercel web UI works without either.

---

## Step 1 · Deploy the Google Places MCP wrapper

The bot talks to Google Places via a thin MCP server Karam wrote. You'll deploy your own copy of it (the API key inside is yours, not Karam's).

Repo: <https://github.com/Krambo1/eins-places-mcp>

### 1a. Get a Google Places API key

1. Go to <https://console.cloud.google.com/> and create (or reuse) a project.
2. Enable the **Places API (New)** under **APIs & Services → Library**.
3. **APIs & Services → Credentials → Create Credentials → API Key**. Copy the key.
4. Restrict the key (recommended): **Application restrictions → None** for now (Vercel-side); **API restrictions → Restrict key → select Places API (New)**.
5. Confirm billing is enabled on the project (Billing tab). Without billing the key returns `PERMISSION_DENIED` on every call.

### 1b. Fork & deploy on Vercel

1. Fork <https://github.com/Krambo1/eins-places-mcp> to your own GitHub.
2. <https://vercel.com/new> → import the fork.
3. **Environment Variables** (set these before the first deploy):
   - `GOOGLE_PLACES_API_KEY` = the key from 1a.
   - Any auth secret the repo expects (check the README on the fork — if it asks for `MCP_AUTH_TOKEN` or similar, generate a long random string and save it; you'll need it in step 1c).
4. Deploy. Wait for the build to go green. Copy the production URL — looks like `https://eins-places-mcp-<your-suffix>.vercel.app`.
5. Smoke-test: open `https://<your-url>/` in a browser. You should get a JSON or text response confirming the server is alive (not a 404).

### 1c. Register the MCP server in Claude Code

Edit your Claude Code MCP config. Location depends on OS:

- macOS / Linux: `~/.claude/mcp.json` (or `~/.config/claude/mcp.json` on some setups)
- Windows: `%USERPROFILE%\.claude\mcp.json`

Add an entry under `mcpServers`. **Pick a server key you'll remember** — this becomes part of every tool ID later. Example using `eins-places` as the key:

```jsonc
{
  "mcpServers": {
    "eins-places": {
      "transport": "http",
      "url": "https://eins-places-mcp-<your-suffix>.vercel.app/mcp",
      "headers": {
        "Authorization": "Bearer <your MCP_AUTH_TOKEN if the fork uses one>"
      }
    }
    // ... your other MCP servers
  }
}
```

(If the fork uses a different transport — stdio, SSE — follow its README. The key point is: register it so Claude Code can call it.)

Restart Claude Code. Then in a fresh Claude Code session, type `/mcp` and confirm the server appears with two tools: `places_search` and `place_details`.

### 1d. Find the exact tool IDs

This is the gotcha. In Claude Code, MCP tool IDs are `mcp__<server-key>__<tool-name>`. With the example above, you'll see:

- `mcp__eins-places__places_search`
- `mcp__eins-places__place_details`

**Write these two strings down.** You'll paste them into the agent files in Step 4. If you used a different server key, substitute accordingly.

---

## Step 2 · Set up the Notion MCP and duplicate the DBs

### 2a. Notion MCP

If you don't already have it: add Notion to Claude Code via the connectors UI (<https://claude.com/settings/connectors>) or by following <https://developers.notion.com/docs/mcp>. Grant the integration access to the workspace you'll use.

Confirm in a Claude Code session via `/mcp` that you see Notion tools: `notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`.

Note the Notion server key the same way you noted the Places one. Likely something like `notion`. So the tool IDs become:

- `mcp__notion__notion-search`
- `mcp__notion__notion-create-pages`

**Write the server key down.**

### 2b. Duplicate Karam's Notion structure

Ask Karam to share two pages to your Notion workspace (or duplicate them yourself if he sends links):

1. **EINS · Outreach Leads NRW** — the Leads database. Schema is documented in `skills/outreach-leads/SKILL.md` §2 and `agents/eins-outreach-candidate-worker.md` §2. If you'd rather rebuild from scratch, every property name + type is listed there. Property names matter exactly — `Behandlungen` not `Treatments`, `LinkedIn Inhaber:in` not `Owner LinkedIn`, etc.
2. **Outreach Bot Config-Page** — contains a `cities_to_cover` sub-database (columns: `City` title, `Status` select with options `offen` / `done`, optional `districts` text) and a `skip_chains` property on the page itself (comma-separated chain names to auto-skip).

Once duplicated, get the IDs:

- Open the Leads-DB as a full page. The URL looks like `notion.so/<workspace>/<db-name>-<32-char-id>?v=...`. The 32-char string (with dashes inserted: `8-4-4-4-12`) is `NOTION_DB_ID`.
- Inside the DB, use the Notion MCP from Claude Code (`notion-fetch` on the DB) to retrieve its `data_source_id`. That's `NOTION_DATA_SOURCE_ID`.
- Open the Config-Page. Its URL has the page ID at the end. That's `NOTION_CONFIG_PAGE_ID`.

**Write all three IDs down.**

### 2c. Seed the city queue

Open the `cities_to_cover` DB. Add at least one row with Status `offen` so the bot has something to chew on. The default NRW seed list (65 cities) is in `skills/outreach-leads/SKILL.md` Reference §A — copy-paste any subset you like.

---

## Step 3 · Install the skill and agent files

Copy the contents of this bundle into your Claude Code config dir:

**macOS / Linux:**

```bash
mkdir -p ~/.claude/skills/outreach-leads ~/.claude/agents
cp -r skills/outreach-leads/* ~/.claude/skills/outreach-leads/
cp agents/*.md ~/.claude/agents/
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\outreach-leads", "$env:USERPROFILE\.claude\agents" | Out-Null
Copy-Item -Recurse -Force skills\outreach-leads\* "$env:USERPROFILE\.claude\skills\outreach-leads\"
Copy-Item -Force agents\*.md "$env:USERPROFILE\.claude\agents\"
```

You should now have four files installed:

```
~/.claude/skills/outreach-leads/SKILL.md
~/.claude/skills/outreach-leads/HOW_TO_USE.md
~/.claude/agents/eins-outreach-city-discovery.md
~/.claude/agents/eins-outreach-candidate-worker.md
```

---

## Step 4 · Patch the MCP tool IDs (mandatory)

The agent files ship with Karam's MCP server keys baked in. Yours are different. Open each agent file and replace.

### `~/.claude/agents/eins-outreach-city-discovery.md`

Find the `tools:` line in the frontmatter:

```yaml
tools: mcp__05c10f6a-524c-4870-b2e7-20be8f7f7288__places_search
```

Replace with your Places tool ID from Step 1d:

```yaml
tools: mcp__eins-places__places_search
```

### `~/.claude/agents/eins-outreach-candidate-worker.md`

Find:

```yaml
tools: mcp__05c10f6a-524c-4870-b2e7-20be8f7f7288__place_details, WebFetch, WebSearch, mcp__c25d44d8-5ea5-4794-b8f1-b38e2f9c865f__notion-search, mcp__c25d44d8-5ea5-4794-b8f1-b38e2f9c865f__notion-create-pages
```

Replace with your IDs (from Step 1d for Places, Step 2a for Notion):

```yaml
tools: mcp__eins-places__place_details, WebFetch, WebSearch, mcp__notion__notion-search, mcp__notion__notion-create-pages
```

Save both files.

---

## Step 5 · Patch the Notion IDs

Three IDs are hardcoded. Replace them with the ones you wrote down in Step 2b.

### `~/.claude/skills/outreach-leads/SKILL.md`

Find the **Constants** block near the top:

```
NOTION_DB_ID              = cdc3cc7c-442e-4f30-9f5b-4db7bb63851c
NOTION_DATA_SOURCE_ID     = 1967c50b-343e-48b7-bcdc-df1fcbb20f8a
NOTION_CONFIG_PAGE_ID     = 365e7fc8-8734-81d3-8c1d-f9554e036201
```

Replace all three values with yours.

### `~/.claude/agents/eins-outreach-candidate-worker.md`

This file references `NOTION_DATA_SOURCE_ID` in **four** places:

1. §1 tool surface description (the long sentence under `notion-create-pages`).
2. §1.7 the `notion-create-pages` call example.
3. §1.7 the pre-write self-check (item 1).
4. §1.7 the post-write verification block.
5. §2 Notion Schema → IDs section.

Do a project-wide find-and-replace on `1967c50b-343e-48b7-bcdc-df1fcbb20f8a` → your `NOTION_DATA_SOURCE_ID`. Also replace `cdc3cc7c-442e-4f30-9f5b-4db7bb63851c` → your `NOTION_DB_ID` in §2.

(There's no replace for `NOTION_CONFIG_PAGE_ID` in this file — the Candidate-Worker never reads the Config-Page.)

---

## Step 6 · Smoke test

Restart Claude Code. Open a new session in any directory. Type:

```
/outreach-leads STADT=Düsseldorf DRY_RUN_LIMIT=2
```

What you should see:

1. No preamble. First visible action is a `notion-fetch` reading your Config-Page.
2. One `Agent` spawn for City-Discovery (Sonnet) — runs ~1-3 min, does 12+ `places_search` calls.
3. A handful of `Agent` spawns for Candidate-Workers (Haiku) — sequential, ~30-90s each, each ends in a `notion-create-pages` write or a skip.
4. The run stops after 2 successful writes (your `DRY_RUN_LIMIT=2`).
5. A final Status-Block summarising the run.

Verify in Notion that two new rows landed in the Leads-DB, both with `Place-ID`, `Behandlungen`, and full schema fields populated. If `Behandlungen` is empty or you see treatment lists dumped into `Notizen`, the Haiku worker has the property-name bug — re-check that you copied `eins-outreach-candidate-worker.md` verbatim (the §1.2d block is the discipline).

If the run aborts with `aborted: tools_unavailable`: one of your MCP tool IDs in Step 4 is wrong, or the MCP servers aren't connected. `/mcp` to debug.

If the run aborts with `aborted: config_unreadable`: your Config-Page ID in Step 5 is wrong, or the Notion integration doesn't have access to that page (share the page with your Notion integration in the page's `...` → Connections menu).

---

## Day-to-day usage

Once installed, the full controls are documented in `~/.claude/skills/outreach-leads/HOW_TO_USE.md`. Quick reference:

```text
/outreach-leads                                  → drain the whole queue
/outreach-leads STADT=Köln                       → one city only
/outreach-leads STADT=Essen DRY_RUN_LIMIT=10     → trial run
/outreach-leads DRY_RUN_LIMIT=5                  → 5 per city across queue
/outreach-leads STADT=Bonn MODEL=sonnet          → escalate Candidate-Worker model
```

Cost note: a full sweep of one big city (Köln, with the Stadtbezirke matrix) runs ~80-150 Places API calls (well under the $200/month Google free credit) and ~30-100 Haiku Candidate-Worker spawns. Budget accordingly if you're on a tight Anthropic plan.

---

## Updating later

When Karam ships a new bot version, he'll send you a new bundle. Diff the new `SKILL.md` and agent files against your patched versions before overwriting — your MCP tool IDs and Notion IDs (Steps 4-5) must survive the update.

Worth keeping your installed files under git in a private repo so you can `git stash` the local patches, pull Karam's update, and re-apply.
