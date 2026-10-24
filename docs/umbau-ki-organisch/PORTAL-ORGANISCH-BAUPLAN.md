# Build plan: portal for organic-first

**Date:** 08.10.2026 · **For:** a separate build session · **Analysis behind it:** `PORTAL-ORGANISCH.md` (same folder; section numbers below refer to it)

## Kickoff prompt (paste into the new session)

> Build the organic-first portal according to `D:\Desktop\EINSCodebase\docs\umbau-ki-organisch\PORTAL-ORGANISCH-BAUPLAN.md`. Read the files under "Read first", then do Step 0 with me before writing any code. Work phase by phase, keep `PORTAL-ORGANISCH-STAND.md` updated after every phase, and stop after each phase with a short report. No commit, no deploy, no migration on Neon without my explicit OK. /check-obsidian

---

## Goal in one sentence

The portal answers "which post brought which inquiry, which treated patient and which revenue?" and keeps every promise the offer makes about posts: Messwege, Herkunft per Beitrag, Freigabe, Klon, monthly view.

**Done means:** phases 1 to 6 built in the local tree, migrations applied to the local DB only, typecheck and tests green, every phase checked by a fresh verifier. Phases 7 and 8 are built as far as Meta's App Review allows (test accounts), and the remaining external steps are listed for Karam.

---

## Read first (in this order)

1. `docs/umbau-ki-organisch/PORTAL-ORGANISCH.md`: the gap analysis this plan implements.
2. `docs/umbau-ki-organisch/KANON.md`: every customer-facing wording comes from here. Read sections 3, 5, 6, 6a, 7, 8 and 9.
3. `docs/umbau-ki-organisch/AGENT-REGELN.md`: rules every sub-agent reads first.
4. The vault note `10 EINS/Kunden/Lead-Tracking & Attribution- Playbook für Praxen für ästhetische Medizin.md`, section "Organische Beiträge: fünf Wege ohne Anzeige" (O1 to O5), "EINS-Messwege" and the UTM convention.
5. The vault, `20 AI and Sotta/Decisions/Lessons & Decisions.md`, sections "EINS: Angebot und Garantie" and "EINS: Portal und Code".
6. Repo `CLAUDE.md` (copy rules, code gotchas) and `apps/portal/RUN.md`.

---

## Working rules for this build

- **Shared, uncommitted tree.** Other sessions edit the same files. Re-read a file right before every edit, make targeted edits only, never reformat a file you are not changing. If a file changed under you, re-read and merge; never overwrite.
- **No commit, no deploy, no Neon.** Migrations run against the local Docker DB only (`pnpm db:up`, then `pnpm --filter portal db:migrate`). Prod migrations and `/ship` only on Karam's explicit OK.
- **Migration numbers:** take the next free number at the moment you create the file (`ls apps/portal/src/db/migrations`). On 08.10.2026 the last one was `0096`, and other sessions add more.
- **RLS:** a practice-readable table copies the pattern in `0066_client_uploads.sql` (RLS on, FORCE, tenant policy, GRANT to `eins_app`). An admin-only table copies `0076` (RLS on, no policy, explicit REVOKE).
- **Typed contracts over prose.** Rules live in code with tests: source vocabulary, post-code format, compliance gate, clone gate, approval deadlines. No new prompt rules or KB edits as a fix.
- **Copy rules** (repo `CLAUDE.md`): Sie, no em-dashes, Praxis not Klinik, German terms (Anfrage, Beitrag, Zielseite, Werbebudget, Auswertung), € via `formatEuro`, no all-caps. Wording about guarantee, Messwege, Freigabe and Klon comes from `KANON.md`, word for word.
- **No invented numbers.** No KPI targets, no thresholds for "Kandidat für Anzeigen", no example results. Where a number is Karam's call, make it a setting.
- **Legal points:** name a risk once with how sure you are, then build the safest version. Never suggest a lawyer.
- **Never truncate data** to fit a tile; show fewer columns at the call site. Never change shared components in place; wrap at the call site.
- **New routes:** repo `CLAUDE.md` says ask before new pages and routes. The route list is approved in Step 0, so don't ask again per phase.
- **Admin login is Karam's real account.** Never type its password. Check admin queries via the generated SQL plus `psql` against the local container `eins-postgres` (user `eins`, DB `eins_portal`). Admin runs on `admin.localhost:3001`, not `localhost:3001/admin`.
- **Preview ports:** if `portal` (3001) is taken, use `portal-b` (3005) or `portal-c` (3006) from `.claude/launch.json`.

### Agents and cost

- The main session plans, owns `schema.ts`, `lib/sources.ts`, `lib/constants.ts` and the intake route, and reviews every diff.
- **`executor`** (Opus, medium) writes code. **`mech-executor`** (Sonnet, low) does copy, FAQ, checklist text and mechanical edits from an exact spec. **`verifier`** with `model: "sonnet"` checks each phase. **`scout`/`Explore`** does lookups.
- **Sequential on shared core files** (`schema.ts`, `sources.ts`, `constants.ts`, intake route, `guarantee-clock`). Parallel only on disjoint files, for example clinic-landing against portal admin UI.
- **One verifier round per phase, at most one fix round.** No second verifier round, no escalation to a bigger model without Karam's cost OK. A green test run is not a reason for another round.
- Give the verifier the **claims** (what should now be true, with commands to check it), not your conclusions.
- If a sub-agent stops on a usage limit (429), resume it with SendMessage; never relaunch it fresh.

### Recovery file

Create `docs/umbau-ki-organisch/PORTAL-ORGANISCH-STAND.md` at the start. After every phase, record: done, touched files, migrations (number, local only), test counts, open points, decisions taken. A fresh session must be able to resume from it without the chat.

---

## Step 0: decisions with Karam (before any code)

Ask these in one go. Phases 1 to 6 do not wait for D1 and D2, because calls and bookings come in through a provider-neutral webhook (Phase 2). Only the adapter depends on the provider.

| ID | Question | Recommendation | Blocks |
|---|---|---|---|
| D1 | Call-tracking provider | Matelso (already in the tracking playbook) | the Phase 2 adapter only |
| D2 | Booking tool for the EINS-Buchungslink: Calendly, Doctolib or samedi | the one that passes UTM to a webhook; check Doctolib first, many ICP practices use it | the Phase 2 adapter only |
| D3 | Who answers Instagram DMs: Praxis or EINS? | the Praxis team; EINS only automates keyword → link | Phase 8 DM automation |
| D4 | Publishing: manual with permalink, or via API | manual now, API later (not in this plan) | none |
| D5 | Post code format | portal-generated, opaque, 5 characters, no vowels (cannot form words) | Phase 3 |
| D6 | Keep the opaque post code (`utm_content`) in the URL so a reload doesn't lose it | yes, it reveals no treatment; this changes the 06.10 strip rule for this one parameter only | Phase 3 landing change |
| D7 | Approvals for the first 3 clients | e-mail with one-click signed links that log into the portal; portal approval afterwards, switchable per Praxis | Phase 4 |
| D8 | Route list (repo rule "ask before new routes") | portal `/beitraege`, public `/freigabe/[token]`, admin `/admin/clinics/[id]` tab "Beiträge", admin `/admin/beitraege`; clinic-landing `[clinicSlug]/page.tsx` (practice start page); webhook `/api/webhooks/messweg/[provider]` | all phases |
| D9 | Holidays for the 2-Werktage approval deadline | `lib/werkstunden.ts` knows NRW plus nationwide holidays; leads are now nationwide, so add the practice's Bundesland | Phase 4 |

Write the answers into `PORTAL-ORGANISCH-STAND.md` before Phase 1.

---

## Phase 1: one source vocabulary and attribution fields

**Why:** two vocabularies exist and disagree. `REQUEST_SOURCES` in `lib/constants.ts:111` (`meta, google, formular, manuell, whatsapp`) is enforced by the intake route (`api/leads/intake/route.ts:124-129`). The entry-point sets in `lib/sources.ts:121-143` know `anruf` and `buchung`, but the intake rejects them. Everything after this phase depends on one contract.

**Build:**
- One typed source contract in `lib/sources.ts`: entry sources (at least `formular`, `anruf`, `buchung`, `meta`, `google`, `manuell`, `whatsapp`, `pvs_import`), labels, the Messweg mapping and aliases. `constants.ts` re-exports from it; intake, UI filters, labels and reports use only it. Existing DB values stay valid, nothing is renamed in the DB.
- Migration: on `requests`, add `attribution_confidence` (`messweg | plattform | selbstauskunft | praxis_eingabe | unbekannt`), `self_reported_source` (nullable, closed list) and `ttclid`. On `patients`, add `first_touch_channel` and `first_touch_content_code` (today `firstTouchSource` is raw text and loses UTMs, `server/request-patient-link.ts:102-121`). Backfill existing rows from `source` and `utm`.
- Derive `attribution_confidence` at intake in one pure function with tests. A Messweg source gives `messweg`; Meta or Google forms give `plattform`; `manuell` gives `praxis_eingabe`.
- clinic-landing `lib/portal-intake.ts:131-147` forwards `ttclid`.

**Tests:** extend `sources.test.ts` (every source, alias, Messweg, confidence) and the intake route tests (`anruf` and `buchung` accepted and classified as Messweg; unknown sources rejected).

**Done when:** one vocabulary, typecheck and tests green, the backfill checked with psql on seed data, and the Garantie-Uhr still classifies existing seed requests exactly as before.

---

## Phase 2: Messwege "Anruf" and "Buchung" (provider-neutral)

**Why:** contract Messwege 2 and 3 have no producer (P0-1, P0-2 in the analysis).

**Build:**
- Migration: `tracking_numbers` (clinic_id, e164 number, channel `profil | zielseite | meta | google | sonstige`, provider, active, created_at) and `booking_links` (clinic_id, provider, url, medium `profil_link | dm | zielseite`, active). Admin-write, practice-read.
- One route `/api/webhooks/messweg/[provider]` with signature check (reuse `server/clinic-signature.ts` or the provider's own scheme). Each provider adapter maps its payload to one typed `MesswegEvent` (`kind: anruf | buchung`, clinicId, occurredAt, contact phone/email/name, tracking number or booking-link id, utm, externalId, durationSec). Idempotent on `provider + externalId`.
- `MesswegEvent` goes through `persistLead` (`server/leads.ts:237-296`) with `source = anruf | buchung`, channel from the number or link, and `attribution_confidence = messweg`.
- **Dedupe:** the same phone or e-mail within 30 days adds an activity to the existing request instead of creating a new one (qualification rule "dieselbe Person ein zweites Mal innerhalb von 30 Tagen"). Check first how `persistLead` dedupes today and extend it; don't build a second path.
- **No call recording by default.** Store only what the provider reports (number, time, duration, caller). Recording needs the consent announcement (tracking playbook, Methode 1).
- Build the D1 and D2 adapters once decided. Until then, one fixture adapter used only by tests.
- Admin: manage numbers and booking links per Praxis (tab in `admin/clinics/[id]`). Onboarding checklist block G shows the real number and link.

**Tests:** adapter mapping, signature failure, idempotency, 30-day dedupe, the Garantie-Uhr counting an `anruf` and a `buchung` as a Messweg.

**Done when:** a signed test webhook creates a correctly classified request that the Garantie-Uhr shows as a qualifying candidate.

---

## Phase 3: posts (Beiträge), link builder, practice start page

**Why:** P0-3 (no post entity, the post is lost on reload) and P0-7 (the profile link has no good destination). Analysis § 3.

**Build in the portal:**
- Migration:
  - `content_items`: clinic_id, code, title, treatment_id, format (`reel | story | karussell | bild | video`), uses_clone, ai_content, asset_id, caption, hwg_check_id, status (`entwurf | zur_freigabe | aenderung | freigegeben | geplant | live | gestoppt`), stop_reason, timestamps.
  - `content_publications`: content_item_id, platform, platform_media_id, permalink, published_at, stopped_at, published_by `manuell | api`.
  - `content_links`: content_item_id, medium (`profil_link | dm | story_link | organisch`), url.
  - `requests.content_item_id` (FK, nullable).
  - Practice reads, admin writes.
- **Post code** (D5): generator plus validator in one module with tests, unique per Praxis, opaque by construction. Anything that doesn't match the pattern is never treated as a post code.
- **Intake:** resolve `utm_content` to `content_item_id` (clinic plus code). Unknown codes keep the raw value and are flagged in admin.
- **Asset write path:** today no app code inserts into `assets`. Add an admin upload (reuse `lib/uploads.ts` and the existing storage driver) that creates the `assets` row and its `content_item` together and emits the existing `asset_ready` notification.
- **Admin "Beiträge" per Praxis:** create and edit, status changes, paste a permalink (creates a publication), stop with reason. The link builder shows profile link, DM link and story-link URL per post, each with a copy button.
- **Practice `/beitraege`:** post list with status, live link, live since, stopped, and inquiries per post (count by Messweg). Keep `/medien` as the file library and link the two.

**Build in clinic-landing** (parallel to the portal work, disjoint files):
- `attribution-script.tsx`: if D6 = yes, keep `utm_content` in the URL only when it matches the post-code pattern; everything else is stripped as today. Check the Datenschutz text (template Ziffer 3 and 4) still describes it correctly and update it if not.
- New practice start page `app/[clinicSlug]/page.tsx`: neutral title, treatment choice, carries `utm_*` and click IDs through to the treatment page. Same consent and pixel rules as the treatment pages (06.10: neutral addresses, no treatment in URL or title, PageView only). `middleware.ts:76-80` already rewrites the bare domain to `/{slug}`.
- `scripts/validate-clinics.ts` and `lint:hwg` cover the new page.

**Tests:** code generator and validator, intake resolution, a reload keeping the code (simulated browser as in the 06.10 session), the start page passing UTM through.

**Done when:** a post created in admin gives tagged links, and a form sent through such a link lands as a request linked to that post, also after a reload. `pnpm --filter clinic-landing validate` and both typechecks are green.

---

## Phase 4: approval, Verzug, clone, compliance gate

**Why:** P0-5, P0-6 and analysis § 7. "Kein Beitrag ohne Ihre Freigabe", 2 Werktage, "Verzug nur nach Mitteilung", and "Widerruf stoppt alle Klon-Beiträge".

**Build:**
- **Compliance gate:** one pure function `canSubmitForApproval(item)` with tests. It blocks status `zur_freigabe` unless:
  - the caption has a linked HWG check (`server/hwg.ts`, table `hwg_checks`) that is clean, or has warnings acknowledged by name;
  - the caption contains "KI-generiert" when `uses_clone` or `ai_content` is set;
  - the confirmation "keine Vorher-Nachher-Darstellung, keine KI-Patientin, kein KI-Behandlungsergebnis" is ticked;
  - for clone posts, the clone record is valid.
- **Approval:** migration `content_approval_batches` (clinic, sent_at, due_at, mode `email | portal`) and `content_approvals` (item, decision `freigegeben | aenderung`, change_text, decided_at, decided_by user or token).
  - `due_at` = 2 Werktage from sending via `lib/werkstunden.ts`, using the practice's Bundesland (D9).
  - The admin builds the weekly batch from gate-passing posts and sends one e-mail, with per-post signed one-click links "Freigeben" and "Ändern" (with a text field). Copy the token pattern of `api/retreatment-tokens` and `api/review-tokens`.
  - Public `/freigabe/[token]` shows the post (video preview, caption, label) and records the decision.
  - Portal mode: the same buttons on `/beitraege`, switchable per Praxis (D7).
  - **Clone posts may only be approved by role `inhaber`** (`lib/roles.ts`). Token links for clone posts go only to the Inhaber's address.
  - No automatic approval, ever.
- **Verzug into the Garantie-Uhr:** a cron job finds batches past `due_at` with undecided posts and creates a `guarantee_delays` row (`kind = verzug`, `from_date` = day after the deadline, `to_date` null, `notified_at` null) linked to the batch (new column, unique, so it never duplicates). `notified_at` null means it doesn't count yet (`lib/guarantee-clock.ts:17-22`). The admin sees it on `/admin/garantie/[clinicId]` and sends the notice with the existing action. A decision sets `to_date`. Same for a missed 3-Werktage start (clone recording, consent, access) if those dates exist; otherwise leave that manual.
- **Clone:** migration `clone_records` (clinic, consent signed at, consent document, tool, training opt-out document, model created at, revoked at, contract end, deletion due, deleted at). Admin-only write.
  - Code gate: `model_created_at` cannot be set without the opt-out document for that tool (Betriebspflicht, confirmed 07.10).
  - Revocation action: every `content_item` with `uses_clone` not yet `gestoppt` is set to "zu stoppen", shown on admin home as an open task, and EINS gets an e-mail. No new clone post can pass the gate.
  - Deletion alarm on admin home from contract end plus 30 days.
  - Checklist A5 and F5 link to the clone record (IDs A5, F5 stay, they are a storage contract).

**Tests:** gate cases, `due_at` across weekends and holidays, the Inhaber-only rule, token expiry and replay, the Verzug job is idempotent, revocation flags exactly the clone posts.

**Done when:** a batch e-mail (MailHog or console in dev) lets a post be approved through the link, an overdue batch shows as an unnotified Verzug in the Garantie-Uhr, and a revocation flags the clone posts.

---

## Phase 5: per-post Auswertung and paid-first screens

**Why:** P0-4 (the monthly view promised in FAQ `faq/content.ts:352` and journey step 90) and analysis § 5.

**Build:**
- **Query:** per post (and per ad once they run), for a date range: live since, stopped, Aufrufe (null until Phase 7), Anfragen by Messweg, Termine, Behandlungen, Umsatz. The join is post → requests → patient → PVS revenue. Respect the per-Praxis limit rule (Lessons: never a global LIMIT across practices).
- **`/beitraege`:** the table above with a period picker.
- **Monthly PDF** (`server/reports/monthly-pdf.tsx`, `worker/processors/monthly-report.ts`):
  - new section "Beiträge und Anzeigen": ran, stopped, Anfragen, Behandlungen;
  - Finanzen only when the Praxis has ad data;
  - keep the Antwortzeit section.
- **Dashboard:**
  - an organic block first while there is no ad data (Beiträge live, Anfragen über Beiträge, best post by Anfragen);
  - the ROAS sparkline pushes `null` instead of `0` (`server/queries/kpis.ts:247-249`);
  - organic sources get their own hue instead of `warn` (`DashboardTopMetricsEnhanced.tsx:500-505`);
  - the "Kosten pro Anfrage" footer and per-treatment ROAS are hidden without ad data (`DashboardDetailBundle.tsx:624, 783-789`).
- **Admin:**
  - `clinics/page.tsx:111` default sort by Garantie-Uhr state (day X of 90, first qualifying inquiry) instead of `roas`;
  - `leistung` and `revenue` gated on ad data like the overview;
  - a "Beiträge" column (live, waiting for approval).
- **Onboarding checklist** (`onboarding/checkliste/content.ts`):
  - B3 (Meta ad account with payment, `required: true`), B4 and B6 become "ab der ersten Anfrage". Keep the IDs.
  - New items: Instagram professional account, Instagram connected (Phase 7), profile link set to the start page, tracking number visible in the profile, booking link.
  - Then run `pnpm --filter portal pdf:checkliste`.
- **Copy** (`mech-executor`, wording from KANON):
  - FAQ `faq/content.ts:12, 166, 171-172, 238, 244, 256`, plus `anfrage-manuell` after Phase 6;
  - `leitfaden/content.ts` (not yet checked for paid-only copy);
  - the tour steps that mention Medien or Freigabe.

**Done when:** a seed Praxis without ad data sees an organic dashboard with no paid widgets and no fake zeros, and a monthly PDF generated locally lists the posts with Anfragen and Behandlungen.

---

## Phase 6: self-reported source and front-desk entry

**Why:** organic patients often call or walk in, which only humans can record. Neither may ever trigger the invoice (Garantie-Anhang § 2).

**Build:**
- **clinic-landing pre-qualifier:** an optional step "Wie sind Sie auf uns aufmerksam geworden?" with a closed list: Instagram, Facebook, TikTok, Google-Suche, Empfehlung, Sonstiges. No free text, so no health data lands there. Stored in `self_reported_source`; it never changes `source` or the Messweg. Update `pre-qualifier/types.ts:18` and the step components. Run `validate` and `lint:hwg`.
- **Portal "Anfrage anlegen":** for the front desk. Fields: name, phone or e-mail, treatment, "Wie kam die Person zu Ihnen?" (same list plus "Anruf in der Praxis"). Source `manuell`, confidence `praxis_eingabe`, the same 30-day dedupe as Phase 2. It counts as a contact attempt only where KANON 6a says so. Replace the FAQ answer "Im Moment nicht" (`faq/content.ts:140-142`).
- **Auswertung:** a confidence breakdown everywhere totals appear (Messweg, Plattform, Selbstauskunft, Praxis-Eingabe, unbekannt). Product copy never claims complete organic attribution.

**Done when:** a manual entry and a form with self-report both show in the Auswertung under their confidence, and the Garantie-Uhr ignores both as triggers.

---

## Phase 7: Instagram insights

**External step for Karam, start on day 1 of the build:** Meta App Review with Advanced Access for the Instagram permissions, because EINS serves accounts it doesn't own. This needs business verification and a screencast, and the lead time is weeks. Until it is approved, build and test with accounts that have a role on the app.

**Build:**
- Add the Instagram permissions to the existing Facebook Login: today `META_OAUTH_SCOPES` (`server/meta-pages.ts:75-81`) is `ads_read, leads_retrieval, business_management, pages_show_list, pages_manage_metadata`. Add `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`. Verify the names against the current docs. Existing connections must reconnect once (the file comment already expects that). Facebook Login also returns the `total_*` metrics that include promoted reach.
- Resolve the Instagram professional account from the connected Page. A personal account gets a clear message in the portal.
- Migrations:
  - `content_metrics_daily` (publication, date, views, reach, likes, comments, saves, shares, follows, profile_visits; **null, never 0**, when the API returns nothing);
  - `instagram_account_daily` (followers, reach);
  - `instagram_baseline` (snapshot at the first connect: followers, views of the last posts).
- **Job `sync-instagram`:** nightly, in the per-clinic dispatcher pattern of `worker/schedules.ts` (pg-boss). Respect the 48-hour data lag. It also lists recent media, matches them to `content_publications` by permalink, and shows unmatched media in admin as "nicht von EINS" or "zuordnen".
- `views` replaced `impressions` and `plays` (deprecated April 2025). Verify every metric name at build time with a test call. Store unknown or empty as null.
- **UI:**
  - Aufrufe on `/beitraege` and in the monthly PDF;
  - an "assisted" timeline on the dashboard: posts and their views next to Anfragen per day, including `direkt` and `unbekannt`, with no causal claim;
  - baseline next to current numbers.

**Done when:** with a test Instagram account, a post gets daily metrics, the timeline renders, and a missing metric shows as "–", not 0.

---

## Phase 8: bridges for VALIDATE and SCALE

**Build:**
- **Ad ↔ post link:** `sync-meta` also reads which Instagram post an ad creative is based on (verify the field name at build time) and stores the ad → `content_item` link. `/beitraege` then shows organic and paid Anfragen per post side by side.
- **"Kandidat für Anzeigen" and the Werbebudget proposal:**
  - admin ranks posts by Anfragen and Behandlungen and sets the flag by hand (no threshold, Lessons 01.10);
  - a proposal object (posts, proposed monthly budget entered by EINS, status `vorgeschlagen | angenommen | abgelehnt`) shows to the Praxis with "Annehmen";
  - wording from KANON § 4 ("EINS schlägt vor, welches Werbebudget hinter welche Beiträge gehört", paid directly to Meta and Google, no guarantee on Werbebudget).
- **DM keyword automation (only after D3 and App Review for comments and messages):**
  - a keyword per post;
  - webhooks for comments and messages;
  - on a match, one private reply within 7 days of the comment, carrying the DM link (`utm_medium=dm`, `utm_content=code`);
  - store **only** event metadata in `dm_link_events` (keyword, post, time, sent yes/no), **never the message text**. DMs carry health data (Art. 9 DSGVO), and keeping them out of the portal is the safest setup; fairly sure;
  - rate-limit handling, and one message per commenter.
- **Founder hours per Praxis (admin):** a small time log by category (Onboarding, Inhalte, Freigabe, Support, Technik), so "Karams Stunden pro Kunde, gemessen an den ersten 3 Kunden" (Lessons 30.09) has data.

**Done when:** an ad linked to a post shows in that post's row, a proposal can be accepted by the Praxis, and the DM flow works end to end on a test account (or is fully built and waiting only on App Review, listed as such).

---

## Not in this plan (later)

Publishing via API (`instagram_content_publish`), Facebook Page insights, TikTok organic, Google Business Profile performance, HWG-checked reply templates for comments and DMs.

---

## Checks per phase

Run all of these, then hand the claims to the `verifier`:

```
pnpm --filter portal typecheck
pnpm --filter portal test
pnpm --filter clinic-landing typecheck
pnpm --filter clinic-landing validate
pnpm --filter portal db:migrate        (local Docker DB only)
```

- Check the UI in the browser on a preview server (portal, portal-b or portal-c). Practice views use a seed practice login, admin data via psql.
- Seed data: extend `src/db/seed.ts` with posts, publications, metrics and approvals for the seed Praxis, so every new screen has something to show. Use `TRUNCATE ... CASCADE` for reseeding (repo gotcha).
- Copy check before the verifier: no U+2014, no "Klinik", no all-caps or `uppercase`, Sie capitalized, KANON wording where it applies.

## Docs to update when phases land

- `PORTAL-ORGANISCH-STAND.md` after every phase; `PORTAL-ORGANISCH.md` with a status line per gap.
- Vault Portal-Referenz:
  - new tables, routes and jobs;
  - remove the non-existent `/auswertung` and `/was-waere-wenn`;
  - the queue is pg-boss now, not BullMQ.
- Vault tracking playbook: close the OFFEN items at O2 (code convention) and O5 (booking link) and the to-do list at the end.
- `docs/umbau-ki-organisch/STAND.md`: one line under "Phase 5: Bauen".
- At the end: `/session-handoff`.

## External steps for Karam (collect in STAND)

- Meta App Review (Phase 7, start at once).
- Sign up with the call-tracking provider and order the number pool.
- Set up the booking tool.
- After his OK: deploy and run prod migrations.
- Per new client: Instagram professional account, profile link on the start page, tracking number in the profile.
