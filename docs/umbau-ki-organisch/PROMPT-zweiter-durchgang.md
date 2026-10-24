> OBSOLETE (08.10.2026): Notion is a frozen archive. Do not run this prompt. Current source of truth is the Obsidian vault `D:\Desktop\Claude\Obsidian\Karam`.

Second pass over the ENTIRE EINS Notion workspace. Notion is the base of the whole business and must be consistent from top to bottom. The first pass (30.09 to 01.10.2026) only covered the pages it knew about. This pass looks at every page.

## Read first, in full
1. `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\KANON.md`: the only source of truth for offer, guarantee, deadlines and wording.
2. `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\STAND.md`: what the first pass changed and what is "Offen für Karam". Do not re-decide those open points.
3. `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\AGENT-REGELN.md`: copy rules, Notion technique, self-check regex. Every subagent reads it first.
4. Notion "Lessons & Decisions" (`3e7e7fc8-8734-8196-b8f1-d4ec098e0627`) and the handoff https://app.notion.com/p/3ece7fc8873481778326f24cff8271b9

## Phase 1: Inventory (no edits)
- **Enumerate every page.** Walk the tree from the roots; search alone misses pages. Roots:
  - EINS (`2bee7fc88734802788a6d75cdfc4dc8e`)
  - Unternehmens-Basis database (`2dde7fc88734805190d8c32bc5955b12`)
  - Ai-database
  - Verträge
  - Handoffs
  - Archiv
  - any other top-level page you find
- **Databases:** read the schema and the page list, but never the rows of the Leads DB. It holds thousands of leads; the Notion query quota is limited (only data source `1967c50b-…`).
- **Classify each page:**
  - **LIVE:** must match KANON.
  - **HISTORY:** Archiv, Handoffs, Lessons history entries, change logs, pages marked "ersetzt".
  - **THIRD-PARTY:** teardown/audit pages about other Praxen.
- **Save the inventory** to `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\notion-inventar.md`: title, URL, path, class, last edited. Update the file as you go, because we hit session limits.

## Phase 2: Audit (read-only)
- **Agents:** `verifier` subagents with `model: "sonnet"`, at most 8 per wave. Each owns a disjoint set of LIVE pages.
- **Output:** findings go to `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\notion-befunde.md`, one line each: page URL | quote | rule broken | proposed fix.
- **Check each LIVE page for:**
  - **Facts that differ from KANON:**
    - 1.900 € netto (price for the first client; after the first client 2.900 € netto for all further clients, decision Karam 19.10.2026), no setup fee, no minimum ad budget (but ad budget stays the goal).
    - Guarantee "Keine Anfrage, keine Rechnung", 90 days from signing:
      - § 187 counting;
      - a delay extends only if EINS told the Praxis by email;
      - the three EINS-Messwege, with Meta instant forms and self-reports excluded.
    - Approval within 2 Werktage; clone, consent and access within 3.
    - Clone deleted 30 days after contract end.
    - HWG costs follow the sphere model, never a flat 50/50.
    - No onboarding cap, no scarcity.
    - Current contract versions: HV v1.3, AGB v1.2, Anlage 1 v1.2, Garantie-Anhang v2.0, Zahlungsplan v1.2, AVV v1.3, NDA v1.2, Einwilligung v1.0.
  - **Old-model leftovers:** Drehtag, Produktionstag, Lernphase, Tag 22, sicherer Start, 360 Tage, 3,5 pro 1.000 €, Rückerstattung, Hauptvideo, 20 Fotos, Vorher-Nachher as something EINS makes.
  - **Contradictions between two LIVE pages,** even where both differ from KANON in different ways.
  - **Numbers without a source,** including industry benchmarks and KPI targets.
  - **SEO or AI-search** offered as an EINS service. The avatar's own thoughts about SEO are fine.
  - **Dental wording** (Zahnarzt, Prophylaxe, Vorsorge): Zahnärzte are not targeted.
  - **Old identity:** "EINS Visuals" or einsvisuals.de. The company is EINS, domain eins.ag.
  - **Copy rules:** em-dash U+2014; Klinik instead of Praxis (proper names and court rulings excepted); Pilot/Probe/Test for the offer; anglicisms in client-facing text; € not EUR.
  - **Broken mentions or links, stale "Stand" lines, leftover `[OFFEN: …]` markers.**
- **HISTORY pages:** only check that anything describing the old model is clearly marked as replaced.
- **THIRD-PARTY pages:** skip.

## Phase 3: Report, then stop
- **Send me a ranked summary:**
  - critical: wrong facts a client or a sales call could repeat;
  - then contradictions;
  - then copy rules.
- Give counts per category, and list judgment calls separately.
- **Wait for my go before any edit.**

## Phase 4: Fix (after my go)
- **Agents:** `mech-executor` (Sonnet), one owner per page, never two agents on the same page.
- **Edit technique:**
  - Targeted edits only. Never replace a page that has subpages or databases, and never delete pages.
  - Re-fetch after every edit.
  - Pages must read as if written for the new model, with no "(früher …)" patches.
- **Local mirrors:** if a fixed page has a mirror, update it too:
  - `C:\Users\karam\Documents\Claude\Projects\EINS\context\01` to `06`;
  - `D:\Desktop\Claude\cos-context\eins` plus `MANIFEST.json`.
- **Durable rules:** add any new one to Lessons & Decisions as one line.
- **Verification:** a fresh `verifier` (Sonnet) re-checks the fixed pages against the findings list.

## Rules
- No deploy, commit, email or contact.
- Never read `.env`.
- No Opus subagents except for contract wording.
- Keep a progress file current so a new session can resume.
- **Known non-issues (do not flag):**
  - "Karams Stunden pro Kunde" as internal capacity;
  - 50/50 as the borderline-case split inside the sphere model;
  - Klinik in proper names;
  - history entries marked "ersetzt".
