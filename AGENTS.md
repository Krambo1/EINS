# AGENTS.md

EINS monorepo. Read before editing.

## What this is

pnpm-workspaces monorepo for **EINS**, an acquisition system for **Praxen für ästhetische Medizin** (DACH). Sells videos + bezahlte Anzeigen + AI-Filter für Patientenanfragen. Primary KPI: gebuchte Strategie-Gespräche (Calendly). User-facing copy is German, formal Sie.

**Audience for marketing copy:** Inhaber:innen of Praxen für ästhetische Medizin / plastische und ästhetische Chirurgie / Dermatologie, 40-65, non-technical. Must understand in seconds.

**Not targeted yet:** Zahnärzte.

## Apps

| Path | What |
|---|---|
| `apps/website` | Marketing site. Next.js 14 App Router, Tailwind, Framer Motion. |
| `apps/portal` | Kunden-Portal: dashboard, Anfragen, Auswertung, Fortschritt, Einstellungen, admin/pvs-bridge. Next.js 14, Postgres, password + magic-link auth (no TOTP). Boot guide: `apps/portal/RUN.md`. |
| `apps/clinic-landing` | Per-Praxis Landing-Pages mit Lead-Intake + Review-Tokens. |
| `apps/bridge` + `apps/bridge/agent` | PVS-Bridge (CharlyTel, Tomedo, Dampsoft, ...). Category moat, nicht als Feature behandeln. Agent läuft auf Praxis-Maschine. Adapter-Guide: `apps/bridge/UNIVERSAL_ADAPTER_BUILD.md`. |
| `packages/ui` | Shared shadcn-style primitives. |

Scripts at repo root: `pnpm dev:website`, `dev:portal`, `dev:clinic`, `dev:worker`. `pnpm db:up` boots Postgres + Redis via docker-compose.

**Preview servers (don't ask, just do):** the Codex preview registry is shared across sessions, so `portal` (3001) is often already taken by another session. If it's taken (`preview_start("portal")` → `reused:true`, the page keeps navigating away, or another session is driving it), **immediately start `portal-b` (3005), then `portal-c` (3006)** from `.Codex/launch.json` instead. Never fight over 3001 or report a busy port as a blocker. Cookies are not port-scoped on `localhost`, so an existing :3001 login carries over to :3005/:3006, no re-login. Same pattern for other apps: add a `-b`/`-c` config if you need a second instance.

## Copy rules (apply to all user-facing strings)

1. Formal **Sie**. Capitalize Sie/Ihr/Ihnen.
2. **No em-dashes** (U+2014). Comma, period, colon, or `-`.
3. **No Klinik.** Use Praxis (für ästhetische Medizin / plastische und ästhetische Chirurgie / Dermatologie und ästhetische Medizin). English identifiers like `clinicId` stay.
4. **Anti-Anglicism** (full mappings: `C:\Users\karam\Documents\Codex\Projects\EINS\context\05-niche-dictionary.md`):
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
- Text-on-mint traps (both look bad, avoid):
  - `bg-accent text-bg-primary` = white-on-mint, unreadable low contrast.
  - `bg-accent text-fg-primary` = dark navy `#10101a` on mint, looks muddy and cheap ("like shit" per Karam).
  - Rule: do not paint body text directly on `--accent`. Keep mint for borders, icons, small badges, gradient strips, or large display headlines on a white surface. If you must put text on a mint fill, use a darker mint/teal variant for the fill so white text actually contrasts, or invert (mint text on white).

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

Local mirrors of the Notion source-of-truth at `C:\Users\karam\Documents\Codex\Projects\EINS\context\`:
- `01-offer-wachstumssystem.md`, `02-icp.md`, `03-avatar.md`, `04-pain-register.md`, `05-niche-dictionary.md`, `06-garantie.md`

If Notion conflicts with these, trust Notion.

## When unsure

- Copy lives in `lib/*-data.ts`, not JSX.
- Repo has had merge-conflict markers (`<<<<<<<`) leak into source twice. If you see them: `git checkout --ours <files>`, then re-apply edits.
- Ask before new pages/routes/state libs.
- More docs: `docs/INDEX.md`.
