# Clinic-Landing Redesign Blueprint (v2)

> **Status: IMPLEMENTED 2026-07-07.** Everything below is built and live in the template
> (quiz-in-hero, 12-section order, quiz v2 incl. investment gate + distance step, warm-neutral
> design system with Fraunces/Hanken Grotesk, all 7 treatment templates rewritten, Botox →
> Faltenbehandlung § 10 fix, marketing opt-in on confirmation via /api/lead/marketing-optin,
> portal intake extended with budget/distance). This file stays as the rationale record.

Research-backed rebuild of the landing-page templates. Goal: higher click-to-lead conversion
for paid Meta/IG + Google traffic, HWG-safe by construction, premium feel per Praxis.

Basis: 4 research sweeps (Juli 2026) — conversion benchmarks (Unbounce/Klientboost/NNGroup),
DACH/HWG specifics (BGH 31.07.2025, DGÄPC, live teardowns of KÖ-Klinik / Fort Malakoff /
Rosenpark / M1), quiz-funnel data (Perspective/Heyflow/Baymard/Zuko), premium medical design
(Lindgaard 50ms, Stanford credibility, Fogg, live premium-site analysis).

Planning targets: visit→lead ≥ 8 % (Injektabels) / ≥ 4 % (OP-Level), Quiz-Startrate ≥ 50 %,
Starter-Completion ≥ 50 %, kein Einzelschritt > 30 % relativer Drop-off, LCP < 1,5 s (Text-LCP).

---

## 1. Architecture decision: quiz-in-hero hybrid

The single biggest structural change. Evidence: quiz-first pages start at 40-70 % vs 30-50 %
embedded; attention ratio 1:1 (+31-40 % in Unbounce tests); 57 % of viewing time is above the
fold; breadcrumb pages (Klientboost) put step 1 in the hero.

- The **hero contains the live quiz card** — step 1 (treatment tiles) visible above the fold
  on mobile. No hero image beside it: LCP becomes text → sub-1s loads (every 0.1 s ≈ +8 %).
- The long-form persuasion path (doctor, explainer, proof, cost, FAQ) sits **below** for
  skeptics/scrollers — Google traffic wants it, Meta traffic never needs to scroll.
- Every CTA on the page anchors back to the hero quiz (`#anfrage` moves to the hero).
  Bottom-of-page readers can alternatively convert via phone/WhatsApp in the final CTA.
- One quiz instance only (no duplicated state).

## 2. New section order

| # | Section | Change | Why (evidence) |
|---|---|---|---|
| 0 | StickyNav | keep, slim | tap-to-call converts 25-40 % vs ~2 % forms |
| 1 | **Hero + QuizCard** | rebuilt | quiz-first, message match, Google stars + doctor chip in view 1 |
| 2 | **TrustBar** | rebuilt from TrustStrip | Google rating gates 69 % of patients; Facharzt title needs a 1-line explainer (35,5 % don't know it) |
| 3 | ProblemMirror | tightened, 2 short paras | empathy mirror, warm traffic skips |
| 4 | **DoctorSection** | MOVED UP + dark "anchor" block | authority before the ask; 92 % read physician profiles; anti-M1 continuity promise |
| 5 | TreatmentExplainer | restyled, same data | upfront disclosure = NNGroup trust factor; HWG riskNotice stays |
| 6 | **ResultsTease (NEW)** | added | BGH-Verbot inverted into a lead magnet: "Echte Behandlungsbeispiele zeigen wir Ihnen im persönlichen Gespräch" |
| 7 | Testimonials | restyled + source/date | Betreuungs-quotes, not outcome promises (HWG § 11 Nr. 11); dated + source line |
| 8 | ProcessSteps | timeline restyle | reduces anxiety; Bedenkzeit step = seriousness signal |
| 9 | **CostSection (NEW)** | added | price transparency books ~31 % of patients; "ab X €" + drivers + Finanzierung line; never price-first (M1 signal) |
| 10 | FAQ | reordered per objection weight | objection defusing is "the cheapest conversion measure" |
| 11 | FinalCta | 3 channels | Termin (anchor up) + Anrufen + WhatsApp |
| 12 | Footer + StickyBottomCta | rebalanced | one dominant primary + icon secondaries |

## 3. Quiz flow v2

**Injectables (3 steps):** Behandlungsbereich → Zeitrahmen → Kontakt
**OP-Level (4-5 steps):** Behandlungsbereich → Zeitrahmen → Investitionsrahmen → (Entfernung) → Kontakt

Changes vs v1:

- **Auto-advance on tile selection** (Perspective/Heyflow default; saves 1 tap per step).
  Explicit button only on the contact step.
- **Experience step CUT** (qualifies nothing, sits in the question-3 danger zone).
- **Free-text city step CUT.** OP flows get optional distance tiles ("Ich wohne in der Nähe /
  bis 1 Stunde / weiter entfernt") — service-framed, auto-advance.
- **NEW investment gate (OP flows only):** price anchor + self-selection —
  "Eine [Brustvergrößerung] beginnt bei uns ab ca. 5.500 €. Passt das grundsätzlich in Ihren
  Rahmen?" → Ja / Ich bin unsicher / Ich möchte erst mehr erfahren (→ Info-Branch).
  Anchor derived from `priceRange.fromCents`.
- **Contact step: 3 fields** — Vorname → Telefon (Pflicht, microcopy: "Nur zur
  Terminabstimmung. Kein Verkaufsanruf.") → E-Mail. Phone required on the qualified branch
  (speed-to-lead is the 21x lever; email-only surgery leads are unreachable while hot).
- **Consent wall → one checkbox + one line.** Single combined checkbox (Datenschutz + 18+),
  legal basis Art. 6 (1) b. Marketing opt-in MOVES to the confirmation screen (DOI infra
  unchanged). Notes field + AI-processing checkbox REMOVED from the quiz (payload keeps the
  fields, always `aiProcessing: false`, `notes` empty).
- **Progress bar** slim, starts visibly at ~15 % (endowed progress, Nunes & Drèze 34 vs 19 %).
  Back arrow persists, state never destroyed (Baymard).
- **Info-Branch** stays (63 % of inquirers buy 3+ months out): email-only, tagged
  `branch: info-only`, no Lead event to Meta (keeps pixel optimizing on full leads).
- **Confirmation screen v2:** personalized mirror ("Ihre Anfrage zur Faltenbehandlung in
  [Stadt] ist eingegangen"), booking embed as primary action when `bookingUrl` set, concrete
  callback window as fallback, "So geht es weiter" 3-step strip, doctor photo chip,
  marketing opt-in offer.

Tracking contract unchanged: same eventId Pixel+CAPI dedup, QuizStep events per step;
Lead fires **only** for the qualified branch (check `meta-capi.ts`/`api/lead` during build).

## 4. Design system (template defaults; per-clinic overridable as before)

- **Fonts:** Fraunces variable (display, headlines/pull-quotes only) + Hanken Grotesk
  (body/UI 400/500/600). Both OFL, self-hosted WOFF2 under `public/clinics/_template/fonts/`.
  New CSS var `--brand-font-display` + `BrandTokens.fontFamilyDisplay?` (optional — falls
  back to body font, so existing clinic configs stay valid).
- **Palette (warm-neutral premium, replaces navy/gold):**
  paper `#FBF9F5` (bg) · paper-alt `#F2EDE5` (bgSoft) · ink `#1D1A16` (fg) ·
  ink-soft `#6E655A` (fgMuted) · line `#E5DED2` (border) · forest `#2E453E` (primary) ·
  bronze `#A9865B` (accent) · blush-forest tint for primarySoft.
- **Dark anchor block:** DoctorSection renders on `--brand-primary` (forest) — the one tonal
  break that resets attention two-thirds down. Needs `on-primary` text handling in CSS.
- **Buttons:** pill radius, primary = solid primary color w/ white text, ≥ 52 px, full-width
  mobile. Label everywhere: **"Beratungstermin anfragen"** (specific, low-commitment,
  premium; "kostenlos"/"Jetzt sichern" banned). Anxiety microcopy under primary CTAs:
  "Unverbindlich. Diskret. Antwort innerhalb eines Werktags."
- **Rhythm:** alternating paper/paper-alt, chapter eyebrows ("01 · Ihre Behandlung"),
  generous spacing (72 px mobile / 120 px desktop sections), hairline borders over shadows.
- **Motion:** CSS-only fade-up reveals (existing view-timeline approach), transform/opacity
  only, `prefers-reduced-motion` honored, hero never waits on animation.
- **Photography brief** (documented for onboarding, SVG placeholders in template): real
  doctor + real rooms only (stock is ignored — NNGroup eyetracking; real photos +35-46 %),
  natural light, one warm grade. No Vorher/Nachher anywhere (BGH 2025 incl. injectables).

## 5. Copy system (all 7 treatment templates rewritten)

- **H1 formula:** plain-language treatment + Stadt (exact message match with the ad term;
  5th-7th grade German converts 11,1 % vs 5,3 % for clinical register). Latin only in
  parentheses after the plain word.
- **"Botox" § 10 HWG fix:** patient-facing copy switches to "Faltenbehandlung" /
  "Behandlung mimischer Falten" + "muskelentspannendes Präparat". Slug →
  `faltenbehandlung-stadt`. Internal category id `botox` stays (code, not copy).
- **Facharzt explainer line** (TrustBar + doctor section): title + one sentence why it is
  the protected qualification vs "Beauty Doc".
- **Continuity promise** (doctor section): Beratung, Behandlung und jede Nachsorge bei
  derselben Ärztin / demselben Arzt — auch Monate später erreichbar. (Anti-M1, anti-Türkei
  counter without Angstwerbung.)
- **Testimonial rules:** about Betreuung/Aufklärung/Ehrlichkeit, never outcomes; first name,
  age, city, source + date.
- **FAQ reordered per treatment by objection weight** (DGÄPC/Stiftung-Warentest evidence):
  - Faltenbehandlung/Filler: Natürlichkeit ("Maskengesicht") first, then Schmerz, Dauer, Kosten, Diskretion
  - Lid-OP: Narben + "wirke ich verändert?" first, Downtime in Tagen, Kosten, Krankenkasse
  - Liposuktion: "kein Ersatz fürs Abnehmen" honesty, Schmerz, Dellen, Kompression, Kosten
  - Brust: Implantat-Sicherheit + Folgekostenversicherung, Natürlichkeit, Stillfähigkeit, Kosten(rahmen offen!), Nachsorge-Kontinuität
  - Rhino: "erkenne ich mich noch?", 3D-Simulation im Gespräch, Dauer bis Endergebnis, Kosten
- **Diskretion** as explicit element (unterschätzter Hebel): discreet contact paths,
  "vertraulich" microcopy at the form.
- All copy: Sie, sentence case, no em-dashes, 8-16-word sentences, banned-phrase lint clean.

## 6. Type/schema changes (`lib/types.ts` + `lib/schema.ts`)

- `TreatmentQuiz`: remove `locationLabel`, `askExperience`; add `askBudget?: boolean`,
  `askDistance?: boolean` (`.strict()` stays — still no Art. 9 fields possible).
- `BrandTokens.fontFamilyDisplay?: string` (optional).
- `Doctor.quote?: string` (philosophy pull-quote for the authority block).
- `Testimonial.source?: "google" | "jameda" | "praxis"`.
- `Clinic.responsePromise?: string` (callback-window copy, default "innerhalb eines Werktags").
- `QuizSubmissionPayload`: add optional `budget?: string`, `distance?: string`; `experience`/
  `city` stay optional for wire-compat. **Check portal `/api/leads/intake` zod + CRM adapters
  accept/ignore the new keys; extend portal schema if strict.**

## 7. Open decisions (Karam)

1. **Notes + AI-consent removed from the quiz** — recommended yes (conversion >> optional
   notes; portal scorer falls back to deterministic). Flip back with one component if needed.
2. **Marketing opt-in moved to confirmation screen** — recommended yes.
3. **Callback-window default copy** — "Antwort innerhalb eines Werktags" is the safe default;
   tighten per clinic via `responsePromise` when ops can honor it (5-min speed-to-lead is
   the single strongest lever post-submit — that's an EINS ops SLA, not page copy).
4. **Botox → Faltenbehandlung rename** incl. template slug — recommended yes (§ 10 HWG).

## 8. Not changing

Middleware/domain routing, consent-manager + cookie categories, API routes contract
(additive only), CRM adapters, DOI flow, JSON-LD/SEO plumbing, validate-clinics + hwg-lint
pipeline (extended, not replaced), review-token routes (`/r/*`), Impressum/Datenschutz pages.
