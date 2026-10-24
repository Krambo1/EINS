# CLAUDE.md

EINS monorepo. Read before editing.

## What this is

pnpm-workspaces monorepo for **EINS**, an acquisition system for **Praxen für ästhetische Medizin** (DACH). Sells KI-Videos with the owner's KI-Klon, organic reach first, then bezahlte Anzeigen behind what works, + AI-Filter für Patientenanfragen. Primary KPI: gebuchte Strategie-Gespräche (Calendly). User-facing copy is German, formal Sie.

**Audience for marketing copy:** Inhaber:innen of Praxen für ästhetische Medizin / plastische und ästhetische Chirurgie / Dermatologie, 40-65, non-technical. Must understand in seconds.

**Not targeted yet:** Zahnärzte.

## Session Start Protocol

**North Star (auto-loaded every session):**

@north-star.md

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

**Preview servers (don't ask, just do):** the preview registry is shared across sessions, so `portal` (3001) is often taken. If `preview_start("portal")` returns `reused:true` or another session is driving it, immediately start `portal-b` (3005), then `portal-c` (3006) from `.claude/launch.json`. Never report a busy port as a blocker. localhost cookies are not port-scoped, so a :3001 login carries over. Same `-b`/`-c` pattern for other apps.

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
- Offer: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Angebot & Offer\-Intern, Angebot- Das EINS Wachstumssystem.(Praxen für ästhetische Medizin).md` (auto-loaded, see Session Start Protocol); ICP: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Ideales Kundenprofil (ICP).md`; Avatar: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Avatar\Avatar- Master-Synthese (alle 28 Felder).md`; Pain Register: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Pain Register- Vollständige Rangliste der Avatar-Schmerzpunkte.md`; Niche dictionary: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Kunden\Niche dictionary.md`; Garantie: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Infrastruktur\Garantie\Garantie (intern, vollständig).md`; Grundlagen: `D:\Desktop\Claude\Obsidian\Karam\10 EINS\Infrastruktur\EINS Grundlagen.md` (all manual-read only except the offer).

## Code gotchas (learned the hard way)

- **tsx CLI scripts** (migrate/seed/worker) need a manual dotenv loader that reads `.env.local` before `.env`. Next.js loads `.env.local` itself, standalone tsx does not ("DATABASE_URL is not set").
- **`@eins/ui` Button has no `variant="destructive"`.** Use `variant="danger"`; the cva does not define `destructive`.
- **`Card` hardcodes `bg-bg-primary` and a Tailwind shadow.** Overrides need the `!` prefix; custom utilities like `card-glow` already win by CSS order.
- **Shared components** (e.g. `SimpleMetric`) used by several surfaces: never change them in place, wrap at the call site. Never truncate data to fit a tile; show fewer columns at the call site instead.
- **Seed scripts** deleting a row with many FK dependents: use `TRUNCATE ... CASCADE`, not single `DELETE`s (FKs without `ON DELETE CASCADE` break it).
- **Drizzle returns `jsonb` as `unknown`.** Guard with `!!x && typeof x === "object"` before rendering it as a ReactNode.
- **Inserts with an FK to a parent row that may not exist yet:** create a minimal parent row first, then update aggregates.

## When unsure

- Copy lives in `lib/*-data.ts`, not JSX.
- Repo has had merge-conflict markers (`<<<<<<<`) leak into source twice. If you see them: `git checkout --ours <files>`, then re-apply edits.
- Ask before new pages/routes/state libs.
- More docs: `docs/INDEX.md`.
