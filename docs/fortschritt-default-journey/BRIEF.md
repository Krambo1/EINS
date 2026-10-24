# BRIEF — Default Fortschritt-Journey

Single source of truth for this project. Re-read before any bucket. Keep skimmable.

## Goal

Every newly onboarded Praxis should open the **Fortschritt** tab and immediately see a **clear, forward-looking plan** of what EINS will do over the coming weeks, so the Inhaber feels **EINS has a plan, a timeline, and that expectations are set**. No more empty tab on day one.

**How we know it worked:** a brand-new clinic owner logs in on day one and sees a populated plan that runs from Auftakt through the 90-Tage-Gespräch, with no manual admin work required.

## Decisions (from kickoff interview, 2026-06-16)

- **Horizon:** full plan to **Tag 90** (Aufbau → Technik & HWG → Launch → Optimierung → 90-Tage-Review).
- **Dates:** **relative phases, no fixed dates.** Steps show phase labels ("Woche 1 bis 2", "Ab Woche 6", "Nach 90 Tagen"), not concrete dates. Admin can later add real dates per clinic if wanted.
- **Trigger:** **auto-seed on clinic creation** + an admin button **"Standard-Journey einsetzen"** to backfill empty existing clinics or re-insert. **Idempotent** (never double-seeds).
- **Tweakability:** **central editable template in admin.** The default step list lives in a DB table the admin can edit/add/delete/reorder; it is **copied** into each clinic on seed. After seeding, each clinic's entries remain editable in the existing Fortschritt admin tab.

## Success criteria

- **New clinic** created in admin → Fortschritt tab is populated with the default journey automatically.
- **Empty existing clinic** → one admin click seeds the same journey; a second click does **not** duplicate.
- The journey **renders correctly with relative phase labels** (no dates), forward-ordered, without breaking clinics that already have real dated entries (e.g. the demo clinic).
- Admin can **edit the central template** and a subsequent seed reflects the change.
- All copy is **Inhaber-facing**: formal Sie, plain language, no Anglizismen ("Anfragen" not "Leads"), no em-dashes, no "Klinik".

## Constraints

- **Reuse the existing feature.** `clinic_timeline_entries` table, `/fortschritt` page, `FortschrittTab.tsx` admin CRUD, and `src/server/queries/timeline.ts` already exist. Extend them; do not rebuild.
- **Migration required.** `event_date` is currently `NOT NULL`; relative phases need it nullable + new `phase_label` and `sort_order` columns. Next migration number: **0063**.
- **RLS + caching** patterns of the existing timeline feature must be preserved (cache tag `timeline:${clinicId}`, `withClinicContext`, revalidate `/fortschritt`).
- Copy rules from `CLAUDE.md` apply to every string. Contact is `team@eins.ag` (the offer doc's `einsvisuals.com` is stale).
- **No worktrees** — edit the main repo directly.

## Explicit non-goals

- **Not** auto-computing concrete dates from a start date (we chose relative phases instead).
- **Not** touching the demo clinic's existing rich dated showcase history in `seed.ts` — it stays as a "mid-journey" demo. A separate fresh-clinic demo shows the relative-phase default.
- **Not** building per-step file attachments, notifications, or progress percentages. Just the step list.
- **Not** a client-editable journey — admin-only tweaks, owner sees read-only (unchanged from today).
- **Not** reworking the three-section (läuft/geplant/abgeschlossen) layout beyond what relative-phase rendering needs.

## Proposed default journey content (10 steps, tweakable)

Source: `docs/umbau-ki-organisch/KANON.md` section 9 (KI-Klon, organisch zuerst, "Keine Anfrage, keine Rechnung"), rewritten Inhaber-facing. Step 1 starts as **läuft**, the rest **geplant**. Full wording: migration `0074_journey_ki_organisch.sql` (repairs template and already-seeded clinic rows; 0063 still seeds the original rows on a fresh DB, 0074 then rewrites them).

| # | Phase (`phase_label`) | Title | Gist |
|---|---|---|---|
| 1 | Woche 1 | Onboarding-Gespräch und Zugänge | Unterschrift startet die 90 Tage; Onboarding per Video, Fragebogen, Einwilligung KI-Klon, Zugänge (Instagram, Facebook, Meta Business, Domain) |
| 2 | Woche 1 | Ihre Klon-Aufnahme | Wenige Minuten Video und Stimme am Handy, daraus entsteht der KI-Klon |
| 3 | Woche 1 bis 2 | Ihr Klon und Ihre Zielseite entstehen | KI-Klon plus Zielseite für die profitabelste Behandlung, Ziel des Profil-Links und später der Anzeigen |
| 4 | Woche 1 bis 2 | Anfrage-System und Auswertung | Vorqualifizierung, Weiterleitung, Erinnerungen; jede Anfrage mit Herkunft im Portal |
| 5 | Woche 1 bis 2 | Erste Beiträge zu Ihrer Freigabe | KI-Videos, Erklär-Animationen, Bildmaterial; HWG-geprüft, als KI-generiert gekennzeichnet, kein Beitrag ohne Freigabe |
| 6 | Ab Woche 2 | Ihre ersten Beiträge gehen live | Organisch auf den Kanälen der Praxis, wöchentliche Sammel-Freigabe |
| 7 | Erste qualifizierte Anfrage | Erste Anfrage, erste Rechnung | Garantie-Wortlaut (erste qualifizierte Anfrage über EINS, 90 Tage); Vorschlag Werbebudget |
| 8 | Laufend | Anzeigen hinter den Beiträgen, die wirken | Anzeigen auf Meta und Google hinter Beiträgen mit Anfragen, Budget direkt an die Plattformen |
| 9 | Monatlich | Ihre Auswertung und Strategie-Gespräch | Beiträge und Anzeigen, gestoppte, Anfragen, Behandlungen im Portal; kurzes Gespräch |
| 10 | Nach 90 Tagen | Großes 90-Tage-Gespräch | Rückblick: welche Beiträge und Anzeigen Anfragen brachten, Werbebudget-Empfehlung; Sie entscheiden |

## Buckets (risk-first)

1. **Content + schema (the spine).** Migration 0063: make `event_date` nullable, add `phase_label` + `sort_order` to `clinic_timeline_entries`; create `timeline_default_steps` template table and seed it with the 10 finalized steps. Also seed a fresh-clinic demo so the next bucket is reviewable. *First because it fixes the actual reassurance copy and the novel relative-phase data shape — the most decision-shaping parts.*
2. **Render the relative-phase journey** on `/fortschritt`: query ordering for null dates, `TimelineList` shows `phase_label` instead of a relative date, dated entries still work. *Proves the owner-facing reassurance actually looks right.*
3. **Auto-seed + admin button + idempotency.** Copy template → clinic on creation; "Standard-Journey einsetzen" button in `FortschrittTab`; guard against double-seed. *The mechanism, lower design risk once content + render are proven.*
4. **Central template editor in admin.** UI to edit/add/delete/reorder `timeline_default_steps`. *Pure admin convenience, highest effort, lowest risk to the goal — last.*

## Key open assumptions

- Step 1 defaults to **läuft** so the tab never looks entirely future; admin can flip it. (Confidence: medium — easy to change.)
- The central template is a **single global default** (not per-segment / per-treatment). (Confidence: high — nothing suggested multiple templates.)
- Keeping the demo clinic's existing dated showcase is desirable for demos. (Confidence: medium.)
- 10 steps is the right granularity — detailed enough to reassure, not a wall. (Confidence: medium.)

## Decision log

- 2026-06-16 — Horizon = full plan to Tag 90. (interview)
- 2026-06-16 — Dates = relative phases, no fixed dates (requires nullable `event_date` + `phase_label`/`sort_order`). (interview)
- 2026-06-16 — Trigger = auto-seed on creation + idempotent admin backfill button. (interview)
- 2026-06-16 — Tweakability = central editable template table in admin, copied per clinic on seed. (interview)
- 2026-06-16 — **Bucket 1 built.** Migration 0063 (nullable `event_date`, `phase_label`, `sort_order`, `timeline_default_steps` + 10-step seed) + Drizzle schema. Typecheck green; migration NOT yet applied to a DB (done in Bucket 2).
- 2026-06-16 — Security: `timeline_default_steps` is admin-only (superuser `db`), **no RLS, no `eins_app` grant** — clinics never read the template, only seeded copies. Mirrors `geocode_cache` global-table pattern but tighter (no app grant).
- 2026-06-16 — Scope ripple (disclosed): nullable `event_date` forced minimal null-guards in `TimelineList.tsx`, `FortschrittTab.tsx`, `actions.ts`, `timeline.ts` to keep the build green. Behavior unchanged for dated entries; proper relative-phase rendering/ordering is Bucket 2.
- 2026-06-16 — **Bucket 2 built + verified.** `TimelineList` now orders each status section via `makeComparator` (dated → by date, date-less → by `sortOrder` = plan order); date-less cards show `phase_label`. Migration applied to dev DB; added a second demo clinic "Praxis Dr. Neu" (Tag 1) in `seed.ts` seeded from the template (10 date-less steps). Verified against the running server: `/fortschritt` returns 200 with sections "Wir arbeiten gerade daran" (step 1, läuft) then "Als Nächstes" (steps 2-10 in exact sortOrder), no empty state. Pixel screenshot blocked by a preview-harness streaming-Suspense quirk (a concurrent session's uninstalled `driver.js` had broken client hydration); server HTML order-verified instead.
- 2026-06-16 — **Finding: no admin "create clinic" UI exists.** Clinics are created only by `seed.ts` and the `scripts/setup-intake.ts` CLI. So "auto-seed on creation" = a reusable helper wired into every creation path, and the admin button is the primary live mechanism for both new and empty-existing clinics. A future admin create-clinic action must call `applyDefaultJourney`.
- 2026-06-16 — **Bucket 4 built + verified.** Central template editor at admin route `/admin/journey` (nav: Wachstum → "Standard-Journey", `Route` icon). New `listDefaultJourneySteps()` in `timeline-journey.ts`; `journey/actions.ts` create/update/delete on superuser `db` (requireAdmin + audit `timeline_default_step`); `JourneyTemplateEditor.tsx` mirrors the FortschrittTab form idiom (per-step Titel/Phase/Sortierung/Start-Status/Sichtbar/Beschreibung, add + edit + delete). Reorder is via the editable `sortOrder` number (the 10er gaps allow inserting between); no drag-and-drop, matching the existing admin idiom. Template edits deliberately do NOT revalidate clinic `/fortschritt` (only future seedings are affected; existing clinics keep their copies). Verified on dev DB: read returns the 10 steps in sort order; full create→update→delete round-trip leaves the template at 10 rows. Typecheck green. Admin page not pixel-rendered (admin IP-gate + the preview hydration quirk); follows the exact working onboarding/clinics page idiom.
- 2026-06-16 — **Bucket 3 built + verified.** New `src/server/timeline-journey.ts` → `applyDefaultJourney(clinicId)`: atomic `INSERT … SELECT … WHERE NOT EXISTS` on superuser `db`, in a tx guarded by a per-clinic `pg_advisory_xact_lock` so concurrent calls can't double-seed; returns `{ seeded }` (0 when skipped). Admin action `seedDefaultJourneyAction` (requireAdmin → helper → audit → revalidate). `FortschrittTab` shows a "Standard-Journey einsetzen" CTA only when the clinic has 0 entries, so it self-hides after seeding (visual idempotency on top of the server guard). `setup-intake.ts` inlines the same guarded copy (tsx can't load the server-only helper) so the script creation path auto-seeds. **Idempotency verified on the real dev DB:** throwaway empty clinic → first seed 10 rows, second seed 0, total 10, all `event_date` NULL, correct sort order + statuses. Typecheck green. CTA not pixel-verified (no empty clinic in dev + the known preview-hydration quirk); it is a trivial `entries.length === 0` conditional, and the action runs the SQL-verified helper.
- 2026-09-30: **Steps rewritten for the KI + organic model** (Kanon section 9): no Produktionstag, no Tag 22; signing starts the 90 days, Klon-Aufnahme in week 1, first posts live from week 2, first qualified inquiry = first invoice. Migration 0074 updates template rows (match sort_order + seeded title) and seeded clinic rows (match seeded title + phase_label), status untouched, admin re-titled steps kept.
