# AGENTS.md

EINS monorepo. Read before editing.

## What this is

pnpm-workspaces monorepo for **EINS**, an acquisition system for **Praxen für ästhetische Medizin** (DACH). Sells KI-Videos with the owner's KI-Klon, organic reach first, then bezahlte Anzeigen behind what works, + AI-Filter für Patientenanfragen. Primary KPI: gebuchte Strategie-Gespräche (Calendly). User-facing copy is German, formal Sie.

**Audience for marketing copy:** Inhaber:innen of Praxen für ästhetische Medizin / plastische und ästhetische Chirurgie / Dermatologie, 40-65, non-technical. Must understand in seconds.

**Not targeted yet:** Zahnärzte.

## Session Start Protocol

**North Star (every session):** the content of `north-star.md` is inlined below, because Codex does not expand the `@north-star.md` import that Claude uses. If `north-star.md` changes, update this block (or re-read the file; it wins over this copy).

### EINS North Star

Source of truth: the Obsidian vault `D:\Desktop\Claude\Obsidian\Karam` (`10 EINS`: Infrastruktur/EINS Grundlagen, Angebot & Offer, Kunden/Ideales Kundenprofil (ICP), Kunden/Pain Register, Infrastruktur/Garantie). If this file and the vault disagree, the vault wins; refresh this file.

#### One sentence

EINS macht aus guten Praxen für ästhetische Medizin starke Premiummarken, die bessere Patienten anziehen, höhere Preise durchsetzen und Wachstum kontrollieren können.

#### Who we help

Inhaber:innen von Praxen für ästhetische Medizin (plastische und ästhetische Chirurgie, Dermatologie) im DACH-Raum. Typically 48-58, 1-5 Behandler, treatments priced 1.500-15.000 €. Non-technical, no marketing team, 50h+ weeks. Has burned through 2-5 agencies and believes "Werbung funktioniert bei meiner Praxis nicht". Often not under-booked but overloaded with the wrong patients.

#### The exact pain

Good medicine, badly sold. The Praxis is better than it looks online. Consequences:

* Wrong patient mix: Preis-Shopper, Türkei-Vergleicher, No-Shows fill the calendar while premium patients book elsewhere.
* Werbebudget burns (2.000-8.000 €/Monat) with no patient you can trace back to it. Reports full of vanity metrics, calendar empty.
* Every Beratung becomes a price negotiation. Discount or lose the patient.
* Marketing eats 4-8 owner hours a week and all decisions land on the owner.

EINS löst nicht Reichweite, sondern Unsicherheit. Vertrauen ist der Engpass, nicht Sichtbarkeit.

#### How we solve it

One integrated system, three layers, never sold separately:

1. **Content-Fundament (KI-gemacht)**: medically serious videos in which the owner's KI-Klon answers the questions patients don't dare ask, plus Erklär-Animationen and Bildmaterial for the most profitable treatment. HWG-checked, labelled "KI-generiert", published only after the owner's approval. The owner never has to face a camera: one short phone recording builds the Klon.
2. **Reichweite: organisch zuerst, Anzeigen optional**: posts run organically on the practice's channels first. Once it is visible which posts bring Anfragen, EINS puts bezahlte Anzeigen (Meta, Google) right behind them. Werbebudget goes directly to the platforms and is no requirement at the start, but the goal stays that every practice invests in it.
3. **Anfragen-Infrastruktur**: dedicated Zielseiten (target of the profile link as well as of ads; no navigation, one goal: Beratungsanfrage), KI-Vorqualifizierung (Budget, Indikation, Erwartung) with routing. Low-ticket goes to online booking, high-ticket goes to the team by phone. Reminders, follow-up, review requests, Auswertung down to Buchungen and Umsatz in the Portal, PVS-Bridge.

Result: fewer conversations, better ones. Higher Abschlussquote, defensible premium price, owner hours back. The moat: EINS scores posts and ads by treated patients, not by clicks (Portal plus PVS-Bridge).

#### The offer

1.900 € netto/Monat (Preis für den ersten Kunden). Nach dem ersten Kunden steigt der Preis für alle weiteren Kunden auf 2.900 € netto/Monat (Entscheidung Karam 19.10.2026). One package, no setup fee, monthly cancellable. No minimum Werbebudget: the start is organic. Once it is visible which posts bring Anfragen, EINS proposes how much Werbebudget goes behind them (paid directly to Meta and Google). The goal stays that every practice invests in Werbebudget; it is just no longer the entry ticket. No guarantee covers Werbebudget.

Guarantee "Keine Anfrage, keine Rechnung" (decided 2026-09-30, applies to every practice):

> Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt.

* **Frist**: 90 calendar days from the day of signing. Every day the practice is late with a Mitwirkung extends it by one day, but only if EINS has told the practice about the Verzug by e-mail. Mitwirkung: within 3 Werktagen after signing Klon-Aufnahme, signed Einwilligung KI-Abbild und Stimme and Zugänge; posts approved or concretely changed within 2 Werktagen (weekly batch); profile link and tracking number stay in place. No automatic approval, "Kein Beitrag ohne Ihre Freigabe" applies.
* **First invoice** (1.900 € netto, the first paid month starts that day): the first qualified Anfrage that arrives through an EINS-Messweg (Formular on an EINS-Zielseite, also via profile link or a DM link from EINS; Anruf auf EINS-Tracking-Nummer; Buchung über den EINS-Buchungslink). Not the first booked Beratung. Self-reported sources never trigger it. The KI-Score never decides whether an Anfrage counts.
* **Until the first invoice** the practice can end by e-mail at any time, no reasons, no costs. If the 90 days pass without an Anfrage, the collaboration ends and the practice owes nothing.
* **Not guaranteed**: Aufrufe, Follower, Reichweite, number of posts (no Stückzahl-Zusage), Umsatz, Werbeertrag, gebuchte Beratungen. Text rule: always both limits ("erste qualifizierte Anfrage über EINS", "90 Tage") in the same paragraph; never write "wir garantieren Anfragen".
* **Das Material gehört Ihnen**: once the first invoice is paid, the practice may use and edit everything produced for it permanently ("dauerhaft nutzen", never "Urheberrecht"), also after cancellation and with another agency. If the 90 days end without an Anfrage, already published posts may stay up. The Klon belongs to the owner: face and voice only for this practice, never for EINS's own ads without separate written consent, model deleted at the latest 30 days after contract end. Not included: EINS templates, prompts, tools, software, ad accounts. Inquiry data as export at contract end.

#### What EINS is not

Not a video studio, not a social-media agency that counts likes and reach, not a single service. We deliver Entscheidungsargumente, not files.

#### How we measure

Primary KPI for EINS itself: gebuchte Strategie-Gespräche (Calendly). Per Praxis: erste qualifizierte Anfrage über einen EINS-Messweg (also the trigger for the first invoice), cost per qualified Anfrage, cost per won patient, Abschlussquote, Behandlungsmix, Werbeertrag (once ads run). No own performance numbers yet; never invent them.

At the start of every session on this project, read `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Angebot & Offer\-Intern, Angebot- Das EINS Wachstumssystem.(Praxen für ästhetische Medizin).md` (core offer / Wachstumssystem note in the Obsidian vault) before tackling any task. The other source notes (`D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Ideales Kundenprofil (ICP).md`, `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Avatar\Avatar- Master-Synthese (alle 28 Felder).md`, `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Pain Register- Vollständige Rangliste der Avatar-Schmerzpunkte.md`, `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Niche dictionary.md`, `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Infrastruktur\Garantie\Garantie (intern, vollständig).md`) stay manual-lookup only, read on demand, not auto-loaded.

## Apps

| Path | What |
|---|---|
| `apps/website` | Marketing site. Next.js 14 App Router, Tailwind, Framer Motion. |
| `apps/portal` | Kunden-Portal: dashboard, Anfragen, Auswertung, Fortschritt, Einstellungen, admin/pvs-bridge. Next.js 15, Postgres, password + magic-link auth (no TOTP). Boot guide: `apps/portal/RUN.md`. |
| `apps/clinic-landing` | Per-Praxis Landing-Pages mit Lead-Intake + Review-Tokens. |
| `apps/bridge` + `apps/bridge/agent` | PVS-Bridge (CharlyTel, Tomedo, Dampsoft, ...). Category moat, nicht als Feature behandeln. Agent läuft auf Praxis-Maschine. Adapter-Guide: `apps/bridge/UNIVERSAL_ADAPTER_BUILD.md`. |
| `packages/ui` | Shared shadcn-style primitives. |

Scripts at repo root: `pnpm dev:website`, `dev:portal`, `dev:clinic`, `dev:worker`. `pnpm db:up` boots Postgres + Redis via docker-compose.

**Preview servers (don't ask, just do):** the preview registry is shared across sessions, so `portal` (3001) is often taken. If starting the `portal` preview reuses an existing server or another session is driving it, immediately start `portal-b` (3005), then `portal-c` (3006) (launch configs in `.claude/launch.json`). Never report a busy port as a blocker. localhost cookies are not port-scoped, so a :3001 login carries over. Same `-b`/`-c` pattern for other apps.

## Copy rules (apply to all user-facing strings)

1. Formal **Sie**. Capitalize Sie/Ihr/Ihnen.
2. **No em-dashes** (U+2014). Comma, period, colon, or `-`.
3. **No Klinik.** Use Praxis (für ästhetische Medizin / plastische und ästhetische Chirurgie / Dermatologie und ästhetische Medizin). English identifiers like `clinicId` stay.
4. **Anti-Anglicism** (full mappings: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Niche dictionary.md`):
   Lead→Anfrage, Funnel→Strecke, ROAS→Werbeertrag, Conversion→Abschluss(quote), Landingpage→Zielseite, Adspend→Werbebudget, Call→Gespräch, Paid Ads→bezahlte Anzeigen, Testimonials→Patientenstimmen, Reporting→Auswertung, Content→Medien/Video. Proper nouns (Instagram, Meta, Google) stay.
5. **€**, not EUR. `formatEuro` already outputs `€` via `de-DE` locale; never append.
6. **No all-caps.** No `uppercase`, no `tracking-wider` shouty labels. Sentence case.
7. Direct copy: plain-language headline, then explanation, then details. Avoid abstract nouns. Owner must understand in seconds.

## `apps/website` specifics

**File layout:**
```
app/page.tsx          # Section order, edit here to reorder
app/layout.tsx        # Fonts, metadata, hero gradients
app/globals.css       # CSS vars, container overrides, scroll-snap
components/sections/  # One per page section
components/ui/        # button, shiny-button, accordion, reveal, roi-slider
lib/*-data.ts         # Copy lives here, NOT in JSX
lib/constants.ts      # CALENDLY_URL, CONTACT_EMAIL, CONTACT_PHONE
```

**Brand (CSS vars in `globals.css`):** light theme, dark text on white.
- `--fg-primary` `#10101a` for body. Never `--fg-secondary` or lighter for main text (repeated grey-on-white complaints).
- `--accent` `#58BAB5` mint teal. Gradient: `linear-gradient(180deg, #58BAB5, #64CEC9)`.
- Text-on-mint trap: never put body text directly on `--accent` (white-on-mint is unreadable, dark `#10101a` on mint looks muddy and cheap). Keep mint for borders, icons, badges, gradient strips, or display headlines on white. If a mint fill must carry text, darken the fill so white contrasts, or invert (mint text on white).

**Typography:**
- `.display-xl` hero, `.display-l` H2s, `.display-m` smaller headlines.
- Body `text-lg md:text-xl` for prose, never below `text-base` for any informational text.

**Card pattern (use this exact string for major cards):**
```
card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 backdrop-blur-sm md:p-8
```

**Layout gotchas:**
- Mobile container padding forced to 9px via `!important` in `globals.css` under `@media (max-width: 767px)`.
- Nav mobile: burger right, logo/CTA left. Logo↔CTA swap via IntersectionObserver on `#hero-cta` and `#final-cta`.
- **ShinyButton:** inline `style` from `size` prop overrides Tailwind padding. To shrink on mobile: `className="!px-4 !py-2.5 !text-sm md:!px-8 md:!py-4 md:!text-base"`.

## Offer / avatar / guarantee context

Source of truth is the Obsidian vault `D:\Desktop\Claude\Obsidian\Karam`:
- Offer: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Angebot & Offer\-Intern, Angebot- Das EINS Wachstumssystem.(Praxen für ästhetische Medizin).md` (read at session start, see Session Start Protocol); ICP: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Ideales Kundenprofil (ICP).md`; Avatar: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Avatar\Avatar- Master-Synthese (alle 28 Felder).md`; Pain Register: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Pain Register- Vollständige Rangliste der Avatar-Schmerzpunkte.md`; Niche dictionary: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Niche dictionary.md`; Garantie: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Infrastruktur\Garantie\Garantie (intern, vollständig).md`; Grundlagen: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Infrastruktur\EINS Grundlagen.md` (all manual-read only except the offer).

## When unsure

- Copy lives in `lib/*-data.ts`, not JSX.
- Repo has had merge-conflict markers (`<<<<<<<`) leak into source twice. If you see them: `git checkout --ours <files>`, then re-apply edits.
- Ask before new pages/routes/state libs.
- More docs: `docs/INDEX.md`.
