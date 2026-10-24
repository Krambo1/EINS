# Portal for organic-first: gap analysis (step 1)

**Date:** 08.10.2026 · **Status:** analysis only, nothing built · **Next:** a separate build session works from section 10.

**Read first:** `KANON.md` (wording), `PLAN.md` § 4.5 and Phase 5, the vault note "Lead-Tracking & Attribution Playbook" (organic paths O1 to O5), and handoff `2026-09-29-0228-eins-organic-portal-economics` (section "Portal purpose under organic-first").

**How this was made:** vault context (Lessons & Decisions, KANON, STAND, Portal-Referenz, Tracking-Playbook, KI-Inhalte Regeln, handoffs 29.09, 01.10, 06.10), then a read-only code audit of `apps/portal` and `apps/clinic-landing`. Line numbers are as of 08.10.2026. The tree is shared and uncommitted, so re-read every file before editing it.

---

## 0. The short version

The portal was built to answer "what did the ad spend return?". Under organic-first it has to answer "which post brought which inquiry, which treated patient and which revenue?" (KANON § 3, the moat). Today it can tell organic **channels** apart, but it has no idea what a **post** is. Everything else follows from that.

The six gaps that matter most:

1. **Two of the three EINS-Messwege don't exist in code.** No call-tracking number and no booking link write anything into the portal. Today only the Zielseiten-Formular can trigger the first invoice.
2. **No post entity.** "Jede Anfrage mit Herkunft (Messweg, Beitrag oder Anzeige)" is a raw `utm_content` string, and a page reload loses it.
3. **The monthly view the offer sells instead of a Stückzahl-Zusage isn't built.** The FAQ promises it (`faq/content.ts:352`). The monthly PDF has no per-post breakdown.
4. **No approval workflow.** "Kein Beitrag ohne Ihre Freigabe", the 2-Werktage deadline and Verzug exist only as copy. An admin types Verzug days in by hand.
5. **No clone record.** There is nothing for consent, revocation ("stoppt EINS sofort alle Beiträge mit dem Klon"), tool training opt-out or the 30-day deletion deadline.
6. **The profile link has nowhere good to go.** There is no practice-level Zielseite, so the one link in the Instagram profile can only point at one treatment.

---

## 1. What already works for organic (don't rebuild)

- **Channel taxonomy** in `apps/portal/src/lib/sources.ts:29-53`: `instagram_organisch`, `facebook_organisch`, `tiktok_organisch`, `profil_link`, `dm_link` sit next to `meta_anzeige` and `google_anzeige`. `normalizeMedium` (`:160`) and `channelFromUtm` (`:185-216`) follow the playbook's UTM convention. A bare `fbclid` is correctly ignored (`:207`), because Instagram attaches it to organic clicks too.
- **Messweg classification** `classifyAttribution` (`sources.ts:225-261`) takes the Messweg only from `source`, never from UTM or self-report. That is correct for the guarantee. `post` is already read from `utm_content` (`:229`).
- **Garantie-Uhr** (`server/guarantee-clock.ts:361,382`) uses `classifyAttribution` and shows the post (`admin/garantie/[clinicId]/page.tsx:669-673`).
- **Dashboard sources breakdown** splits organic from paid (`attribution.ts:68-150`). Organic channels get `null` spend, so CPL and ROAS show "–" instead of a fake zero.
- **Werbebudget** nav entry is hidden without ad data (`PortalShellClient.tsx:88,268`), with an empty state "Noch keine bezahlten Anzeigen".
- **Ads consent gate** (06.10): no report to Meta or Google without consent plus a paid click. Organic patients are never reported. This stays correct when organic grows.
- **Antwortzeit rule:** the ads pause leaves organic posts running.
- **Reviews engine, Wiederbehandlungen, PVS-Bridge:** channel-neutral. They become more valuable under organic, because they close the loop to revenue.

---

## 2. P0: promises in offer and contract the portal doesn't keep yet

### P0-1 Messweg "Anruf auf EINS-Tracking-Nummer" has no producer
- **Evidence:** `sources.ts:121-143` knows `anruf`/`tracking_anruf`. The intake enum `REQUEST_SOURCES` (`lib/constants.ts:111`, enforced at `api/leads/intake/route.ts:124-129`) is `meta, google, formular, manuell, whatsapp`, so `anruf` is **rejected**. No call-tracking integration exists. The playbook names Matelso and a number pool (profile number, Zielseite number).
- **Why it matters:** contract Messweg 2. Organic patients call more than ads patients do, since a Reel has no form button. Profile and checklist block G tell the Praxis "Tracking-Nummer nicht entfernen", but nothing reads it.
- **Build:** a call-tracking webhook writes a request with `source = anruf`, the number (and so the channel), caller number, duration, and a recording flag (only with the consent announcement). Add dedupe against an existing request from the same number within 30 days (qualification rule "dieselbe Person ein zweites Mal innerhalb von 30 Tagen").

### P0-2 Messweg "Buchung über EINS-Buchungslink" has no producer
- **Evidence:** `buchung` is in the entry-point set but rejected by intake. `bookingUrl` is only an iframe on the confirmation screen (`clinic-landing .../pre-qualifier/confirmation.tsx:60-74`) and carries no tag. The playbook marks it `[OFFEN: Technische Umsetzung des EINS-Buchungslinks]`.
- **Build:** pick the tool (decision D2), then a webhook writes `source = buchung` with UTM passed through. Booking via the Praxis's own link must stay a non-Messweg.

### P0-3 "Beitrag" in "Herkunft (Messweg, Beitrag oder Anzeige)" is only a string
- **Evidence:** there is no posts/content table. `content_id` and `post_id` appear in no file. `utm_content` lives only in `requests.utm` jsonb (`queries/requests.ts:347`). `attribution-script.tsx:26-32` strips `utm_content` from the URL (06.10 privacy rule) and keeps it only in memory, so **one reload loses the post** (`pre-qualifier/index.tsx:330-346`). `ttclid` is captured but not persisted (`portal-intake.ts:131-147`, no column).
- **Build:** see section 3. Post codes must be **opaque by construction** (for example `b7k2`, generated by the portal, never a treatment word). An opaque code reveals nothing, so it could stay in the URL next to `utm_source` and `utm_medium` and survive a reload. That changes the 06.10 rule for one parameter, so it is decision D6.

### P0-4 The monthly view that replaces the Stückzahl-Zusage
- **Promise:** KANON § 9 and Lessons ("Keine Stückzahl-Zusage"): "Im Portal jeden Monat sichtbar, welche Beiträge und Anzeigen liefen, welche gestoppt wurden, wie viele Anfragen kamen und wie viele Behandlungen daraus wurden." FAQ `faq/content.ts:352` says the same to the Praxis, and so does journey step 90 (migration 0074).
- **Today:** `server/reports/monthly-pdf.tsx:84-120` has clinic-wide totals plus Finanzen (Werbebudget always printed, even 0 €; Werbeertrag "k. A."). It lists no posts, no stopped items and no per-post inquiries or treatments.
- **Build:** a per-post table (in the portal and in the PDF) with Beitrag, Plattform, live seit, gestoppt am, Aufrufe, Anfragen (by Messweg), Termine, Behandlungen, Umsatz. Add the same for Anzeigen once they run. Hide Finanzen while there is no Werbebudget.

### P0-5 Approval: "Kein Beitrag ohne Ihre Freigabe", 2 Werktage, Verzug
- **Today:** no implementation. Copy only (`faq/content.ts:310-329`, `medien/page.tsx:146`). Verzug is entered by hand in `admin/garantie/[clinicId]` (`admin/garantie/actions.ts:262-333`, table `guarantee_delays`), and nothing connects it to approvals.
- **Decision in force:** approvals go by e-mail for the first 3 clients, in the portal after that.
- **Build:** `content_approvals` (batch sent at, due at = 2 Werktage via `lib/werkstunden.ts`, approved / changes requested with the concrete change text, by whom). Clone posts must be approved by the **Inhaber** (KI-Regeln). Even in e-mail mode, the e-mail can carry signed one-click links ("Freigeben" / "Ändern"), so every approval lands in the portal as proof without a login. An overdue batch creates a **Verzug draft** in the Garantie-Uhr. The admin confirms it and sends the notice, because Verzug only counts after the e-mail notice.

### P0-6 Clone consent, revocation, deletion
- **Promise:** "Widerruft der Inhaber die Einwilligung, stoppt EINS sofort alle Beiträge mit dem Klon und löscht das Modell." Model deleted at the latest 30 days after contract end. Training opt-out confirmation must be filed **before** clone data is uploaded (Betriebspflicht, confirmed 07.10).
- **Today:** the signed consent is only a checklist upload (`checkliste/content.ts:736-745`, A5 has a TODO at `:222-234`). There is no status, no revocation, and no link from posts to "uses clone".
- **Build:** a `clone_records` table (consent signed at plus document, tool, training opt-out document, model created at, revoked at, deletion due, deleted at). A code gate: a clone cannot be marked created without the opt-out document for that tool. A revocation flags every `content_item.uses_clone` as "stoppen" and puts it on the admin to-do list. Contract end plus 30 days triggers an admin alarm.

### P0-7 (small) Profile link destination
- **Today:** clinic-landing has only `[clinicSlug]/[treatmentSlug]` (`middleware.ts:76-80` rewrites the bare domain to `/{slug}`, and that route has no page). The index says "Real patient traffic always lands on `praxis-X.de/<treatment>` directly".
- **Why:** an organic profile serves posts about several treatments, but the profile has one link (Instagram allows up to 5, of which the practice keeps one or two).
- **Build:** a neutral practice-level Zielseite (`praxis.de/` or `/start`): a treatment choice, then the same pre-qualifier. Neutral title, UTM handling and consent as on the treatment pages. Keep the 06.10 rule: no treatment in the URL.

---

## 3. The organic data layer (the core build)

Order from the 29.09 handoff: data model first, then ingestion, then UI.

| Table (proposal) | Purpose | Key fields |
|---|---|---|
| `content_items` (Beitrag) | One idea or asset as EINS made it | clinic_id, code (opaque, unique per Praxis), title, treatment_id, format (Reel, Story, Karussell, Bild), uses_clone, asset_id, caption, ki_label_ok, hwg_check_id, status (`entwurf, zur_freigabe, freigegeben, aenderung, geplant, live, gestoppt`), stop_reason |
| `content_publications` | Where and when it went live | content_item_id, platform, platform_media_id, permalink, published_at, stopped_at, published_by (api / manuell) |
| `content_metrics_daily` | Organic numbers per day | publication_id, date, views, reach, likes, comments, saves, shares, follows, profile_visits (only what the API returns; null, never 0, when unavailable) |
| `content_links` | Generated tagged links | content_item_id, medium (`profil_link, dm, story_link, organisch`), url, short code |
| `content_approvals` | See P0-5 | batch_id, due_at, decided_at, decision, change_text, decided_by_user_id |
| `clone_records` | See P0-6 | see above |
| `requests` additions | Join to the post | `content_item_id` (FK, resolved from `utm_content` at intake), `attribution_confidence` (`messweg`, `selbstauskunft`, `praxis_eingabe`, `unbekannt`), `self_reported_source`, `ttclid` |
| `patients` | Revenue per post over time | first-touch channel plus first-touch content_item_id (today `firstTouchSource` is raw text and loses UTMs, `request-patient-link.ts:102-121`) |

The finished join is **content_item → requests → patient → PVS treatment → revenue**. That is the table EINS sells as the moat ("bewertet Beiträge und Anzeigen nach behandelten Patienten, nicht nach Klicks").

**One source vocabulary.** Two vocabularies exist today: legacy `REQUEST_SOURCES` in `constants.ts:111` (5 values, used by intake and UI labels) and the entry-point sets in `sources.ts:121-143`. They disagree (the intake rejects `anruf`, `buchung`, `instagram`). Replace both with one typed contract in `sources.ts`, used by intake, UI and reports. Do this before P0-1 and P0-2.

**Assets have no write path.** No app code inserts into `assets`. The seeded `asset_ready` notification is never emitted. EINS needs an admin upload (or a storage import) that creates the asset and its `content_item` together.

---

## 4. Bridges and integrations for organic

| Bridge | What it gives | How | Priority | Notes |
|---|---|---|---|---|
| Call tracking (Matelso per playbook) | Messweg 2 | webhook → intake `anruf` | **P0** | number pool: profile, Zielseite, later per ad platform |
| EINS booking link | Messweg 3 | webhook of the chosen tool → intake `buchung` | **P0** | tool open (D2) |
| Link builder | per-post attribution without any API | the portal generates DM links, story link-sticker links and the profile link, each with `utm_content = code` | **P1** | cheapest real per-post signal: a story link sticker carries the code by itself |
| Instagram insights | views, reach, saves, shares per post, account followers | Meta OAuth: add Instagram scopes to the existing Facebook Login (today only `ads_read, leads_retrieval, business_management, pages_show_list, pages_manage_metadata`, `server/meta-pages.ts:75-81`) plus a nightly `sync-instagram` job | **P1** | needs Meta App Review with Advanced Access, because EINS serves accounts it doesn't own. Lead time, start early. Instagram professional account required. Facebook Login also returns the `total_*` metrics that include promoted reach |
| Permalink linking (manual) | links a live post to its `content_item` without the publishing API | EINS pastes the permalink, the job resolves the media ID | **P1** | phase 1 before API publishing |
| DM keyword and comment-to-DM | Messweg 1 via "Link per Direktnachricht" with the post code; the most direct Reel → inquiry path ("Schreiben Sie uns NASE") | Instagram Messaging API webhooks; private reply within 7 days of the comment, one message per commenter | **P2** | who answers DMs is open (D3). Store event metadata only (keyword, post, time), **never message text**: DMs carry health data (Art. 9 DSGVO), and storing them in the portal widens processing for little gain. Moderately sure this is the safest setup |
| Publishing API | scheduled Reels with caption and label, permalink and media ID filled automatically | `instagram_content_publish` (FB Login) | **P3** | only once manual publishing is the bottleneck |
| Ad ↔ post link (VALIDATE/SCALE) | shows a post's organic and paid inquiries side by side once it is boosted | Meta Marketing API: the ad creative references the source Instagram media; join `campaign_snapshots` to `content_items` | **P2** | verify field names at build time |
| Self-report question | "Wie sind Sie auf uns aufmerksam geworden?" | new optional step in the pre-qualifier (`pre-qualifier/types.ts:18`) and in manual entry | **P1** | goes into the Auswertung, **never** triggers the invoice (Garantie-Anhang § 2) |
| Frontdesk manual entry | phone and walk-in inquiries with "auf Instagram gesehen" | create-request action and UI (today FAQ `faq/content.ts:140-142`: "Im Moment nicht") | **P1** | `manuell` exists in the enum; source = `manuell`, confidence `praxis_eingabe`, never a Messweg |
| Facebook Page insights | the same for Facebook posts | `pages_read_engagement`, `read_insights` | P3 | most ICP practices are Instagram-first |
| TikTok organic | views and engagement per video | TikTok API for Business, organic endpoints (Business accounts only) | P3 | only if a practice is on TikTok |
| Google Business Profile performance | calls, website clicks and searches for the practice name as an "assisted" signal | Business Profile Performance API | P3 | measurement only, not SEO (EINS does no search optimisation) |

**Honest attribution, built in.** Show confidence on every inquiry and in every total: Messweg (deterministic), Selbstauskunft, Praxis-Eingabe, unbekannt. Add an "assisted" view: posts published and their views as a timeline next to inquiries per day, including `direkt` and `unbekannt`, with no causal claim. Never promise perfect organic attribution, in the product or in sales.

---

## 5. Screens and copy that still think paid-first

| Where | Problem | Fix direction |
|---|---|---|
| `/dashboard` (`DashboardTopMetricsEnhanced.tsx`, `DashboardDetailBundle.tsx`, `kpis.ts`) | no organic metric at all (posts live, views, follower growth) | an organic block first while there is no ad data: Beiträge live, Aufrufe, Anfragen über Beiträge, top post |
| `kpis.ts:247-249` | the ROAS sparkline pushes `0` when spend is 0 and plots a real zero | push `null` (gap) |
| `DashboardTopMetricsEnhanced.tsx:500-505` | organic channels use tone `warn` (amber), which reads as a warning | own neutral or positive hue |
| `DashboardDetailBundle.tsx:624, 783-789` | "Kosten pro Anfrage" footer and per-treatment ROAS shown to all-organic practices | hide without ad data |
| `monthly-pdf.tsx:84-104` | Werbebudget always printed (0 €), no organic section | see P0-4 |
| Admin `clinics/page.tsx:111` | default sort `roas`, which means nothing at 0 spend | sort by Garantie-Uhr (day X of 90, first qualifying inquiry) |
| Admin `leistung`, `revenue`, `MetricStrip` | paid only, `leistung` and `revenue` not gated | gate like the overview; add an organic counterpart (section 6) |
| Onboarding checklist B3 "Meta-Werbekonto: Zugriff und Zahlungsmittel" (`required: true`), B4 Google Ads, B6 Analytics | an ad account with payment at the start of an organic-first contract | mark "ab erster Anfrage" or optional; add organic items: Instagram professional account, Instagram connected, profile link set, tracking number live, booking link, DM keyword plan |
| FAQ `faq/content.ts:12, 166, 171-172, 238, 244, 256` | "wie wirtschaftlich Ihre Anzeigen laufen", Werbeertrag as the main value | organic first, ads as the step after |
| `leitfaden/content.ts` | not checked for paid-only copy | check in the build session |
| `/medien` (`medien/page.tsx`) | assets only, no status, platform, live link or numbers | becomes the Beiträge view (status, live link, Anfragen per post) |

---

## 6. EINS admin: operating organic delivery

- **Content board across practices:** entwurf → zur Freigabe → freigegeben → live → gestoppt, with overdue approvals highlighted.
- **Cadence monitor:** practices with no new post in N days, and practices at day X of 90 without a qualifying inquiry. The day EINS starts steering is open for Karam (STAND "Offen für Karam"), so make the threshold a setting, not a hard-coded number.
- **"Kandidat für Anzeigen":** a ranking of posts by Anfragen and Behandlungen. EINS sets the flag by hand, with no hard-coded threshold (Lessons: no KPI targets before own data). The flag becomes a **Werbebudget proposal** the Praxis sees and accepts in the portal ("EINS schlägt vor, welches Werbebudget hinter welche Beiträge gehört").
- **Baseline at connect:** snapshot the Instagram account (followers, recent post views) and the Fragebogen answers on inquiries before EINS, so "against the practice's own baseline" (CREATE → PROVE) has a number.
- **Founder hours per client:** a simple time log by category. Lessons 30.09: "Die neue Grenze sind Karams Stunden pro Kunde, gemessen an den ersten 3 Kunden." Organic-first is cheap in cash and heavy in hours, and nothing measures that today.

---

## 7. Compliance gate before a post goes out

Today `/hwg-check` (`server/hwg.ts`) is a regex check on free text, saved to `hwg_checks` with no link to any post. There is no "KI-generiert" check.

Make it a **gate on `content_items`** that blocks the status `zur_freigabe` until:
- the HWG check of the caption is clean or warnings are acknowledged;
- the caption contains "KI-generiert" when `uses_clone` or other AI content is set (AI Act Art. 50);
- the checkbox "keine Vorher-Nachher-Darstellung, keine KI-Patientin, kein KI-Ergebnis" is confirmed (KI-Regeln, § 3 and § 11 HWG);
- for clone posts, the clone record is valid (consent present, not revoked).

Add HWG-checked reply templates for comments and DMs, because public replies by the Praxis are advertising too (P3).

---

## 8. Doc drift found

- The Portal-Referenz (vault, § 4.2 and § 4.5) describes `/auswertung` (with PDF export) and `/was-waere-wenn`. **Neither route exists** in `apps/portal/src/app/(portal)/`. "Organic channels split in the Auswertung" (01.10 handoff) actually lives in the dashboard sources breakdown.
- Vault "KI-Inhalte: Regeln", section "Recht", still says "Anwalt vor der ersten Unterschrift". That is outdated (no-lawyer rule): read it as an open point Karam decides himself.

---

## 9. Decisions Karam needs to make (before or during the build)

| ID | Question | My recommendation |
|---|---|---|
| D1 | Call-tracking provider and number pool | Matelso, as the playbook already plans: one number for profile and organic, one for the Zielseite |
| D2 | EINS booking link tool (Calendly, Doctolib, samedi) | whichever passes UTM parameters through to a webhook; many ICP practices already use Doctolib, so check first whether its link carries UTM to a webhook |
| D3 | Who answers Instagram DMs: EINS or the Praxis? | Praxis team answers; EINS automates only the keyword → link reply. That keeps health conversations out of EINS's hands |
| D4 | Publishing: manual with permalink, or API | manual first (P1), API later (P3) |
| D5 | `utm_content` convention | portal-generated opaque codes only; closes the playbook OFFEN at O2 |
| D6 | Keep the opaque post code in the URL so a reload doesn't lose it | yes: it reveals nothing, unlike campaign names (changes the 06.10 strip rule for this one parameter) |
| D7 | Approvals for the first 3 clients | e-mail with one-click signed links that log into the portal; full portal approval after client 3 |
| D8 | TikTok and Facebook insights in scope now? | no, Instagram first |

---

## 10. Suggested build order

1. **Contract-critical foundation:** one typed source vocabulary (§ 3), then P0-1 call tracking and P0-2 booking link into intake, then `requests.content_item_id` plus `attribution_confidence`.
2. **Post entity:** `content_items`, `content_publications`, `content_links` (link builder), admin upload path for assets, manual permalink linking, P0-7 practice-level Zielseite, opaque code kept on reload (after D6).
3. **Approval and clone:** `content_approvals` with e-mail one-click links, Verzug drafts into the Garantie-Uhr, `clone_records` with the opt-out gate and revocation stop, the compliance gate (§ 7).
4. **Reporting:** per-post table in the portal and the monthly PDF (P0-4), dashboard organic block, paid widgets hidden without ad data, admin sort by Garantie-Uhr, onboarding and FAQ copy (§ 5).
5. **Instagram insights:** start Meta App Review early (lead time), then scopes, `sync-instagram`, `content_metrics_daily`, baseline snapshot.
6. **Bridges:** self-report step, frontdesk manual entry, DM keyword automation (after D3), ad ↔ post link for VALIDATE/SCALE, "Kandidat für Anzeigen" plus the Werbebudget proposal.
7. **Later:** publishing API, Facebook and TikTok insights, Business Profile performance, reply templates, founder-hours log if not done earlier.

---

## Appendix: API facts checked on 08.10.2026 (re-verify at build time)

- Instagram media insights: `impressions`, `plays`, `clips_replays_count` and `ig_reels_aggregated_all_plays_count` are deprecated (April 2025). `views` replaces them. Data can lag up to 48 hours. An unavailable metric returns an empty set, not 0, so store `null`. The `total_*` metrics that include promoted engagement exist only with Facebook Login. Sources: [Meta media insights reference](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights), [Graph API v22.0 changelog](https://developers.facebook.com/docs/graph-api/changelog/version22.0), [Instagram Platform changelog](https://developers.facebook.com/docs/instagram-platform/changelog).
- Private replies (comment → DM): webhook on new comment, reply within 7 days, one message per commenter. It lands in message requests if the person doesn't follow the account. Apps serving accounts they don't own need Advanced Access. Instagram Login scope names are `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_messages` and `instagram_business_manage_comments`. Sources: [Meta private replies](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/private-replies), [Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md).
- TikTok organic insights: through TikTok API for Business, Business or Creator accounts only; personal accounts return nothing. Secondhand sources only, so check the TikTok developer docs. Sources: [Improvado TikTok organic](https://improvado.io/integrations/tiktok-organic), [Funnel TikTok organic](https://help.funnel.io/en/articles/8061123-what-data-can-i-get-from-tiktok-organic).
