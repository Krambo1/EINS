# CLAUDE.md

Project-specific context for the EINS Visuals landing site. Read this before making changes.

## What this is

Single-page landing site for **EINS Visuals** — an acquisition system for dental & aesthetic clinics in the DACH region. Sells a 3-layer product (videos, paid ads, AI-filter for patient requests). Primary goal: convert clinic owners into booked strategy calls (Calendly). All copy is German, formal ("Sie").

**Audience:** Clinic owners, 40-65, non-technical. They need to understand in 10 seconds. If an elderly dentist can't read it, it's wrong.

## Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS (design tokens via CSS custom properties in `app/globals.css`)
- Framer Motion for animations
- shadcn-style primitives in `components/ui/`
- Local fonts (Neue Haas Display) via `next/font/local`
- Deployed on Vercel

## File layout

```
app/
  page.tsx           # Section order — edit here to reorder
  layout.tsx         # Fonts, metadata, hero background gradients
  globals.css        # CSS vars, utilities, keyframes, container overrides
  kontakt/           # /kontakt route
components/
  nav.tsx            # Sticky nav, mobile menu, IntersectionObserver for logo↔CTA swap
  footer.tsx
  sections/          # One file per page section
  ui/                # button, shiny-button, accordion, tabs, reveal, roi-slider, etc.
lib/
  *-data.ts          # Content lives here — edit copy here, not in JSX
  constants.ts       # CALENDLY_URL, CONTACT_EMAIL, CONTACT_PHONE
  utils.ts           # cn(), formatEuro()
public/
  eins-logo.png      # Nav/footer wordmark (5311×2119)
  eins-mark.png      # Standalone "1" mark
```

## Brand tokens (CSS vars in globals.css)

Light theme. Dark text on white background.

| Token | Value | Use |
|---|---|---|
| `--bg-primary` | `#ffffff` | Page background |
| `--bg-secondary` | `#f5f5f7` | Cards |
| `--bg-tertiary` | `#ebebef` | |
| `--fg-primary` | `#10101a` | **Main text** — use this, not fg-secondary, for body copy |
| `--fg-secondary` | `#4a4a52` | Truly minor/helper text only |
| `--fg-tertiary` | `#8a8a94` | Rare |
| `--accent` | `#58BAB5` | Mint teal |
| `--accent-glow` | `rgba(88, 186, 181, 0.3)` | |
| `--border` | `#e4e4e7` | |

Accent gradient (for large text, readable on light bg):
`linear-gradient(180deg, #58BAB5 0%, #64CEC9 100%)` — darker top for contrast.

`.text-accent-gradient` has a white drop-shadow halo so it stays readable when it overlaps the mint background shapes in `layout.tsx`. `.text-accent` has a matching `text-shadow` halo. Don't remove them without checking all use cases.

**Trap:** The old class combo `bg-accent text-bg-primary` makes WHITE text on mint — unreadable. Use `bg-accent text-fg-primary` (dark text on mint).

## Typography

- `.display-xl` → Hero headline, `clamp(2.875rem, 8vw, 6.75rem)`
- `.display-l` → Section H2s, `clamp(2.5rem, 6.8vw, 5.75rem)`
- `.display-m` → Smaller headlines, `clamp(2rem, 4.5vw, 3.5rem)`
- Body: `text-lg md:text-xl` for important prose, `text-base` for details
- Labels: `font-mono text-base` minimum — NO all-caps + tracking-wider unless user asks
- Metric numbers: `font-display font-semibold tracking-tighter tabular-nums whitespace-nowrap`

## Copy rules (strict)

1. **Formal "Sie"** throughout. Always capitalize Sie/Ihr/Ihnen.
2. **No em-dashes** (`—` U+2014). Use comma, period, or hyphen `-`. The source docs had many; they all got rewritten.
3. **No Anglicisms** unless there's no natural German word:
   - "Call" → "Gespräch"
   - "Lead" → "Anfrage"
   - "Content / Asset" → "Medien" / "Video"
   - "Landingpage" → "Zielseite"
   - "Funnel" → "Strecke"
   - "Adspend" → "Werbebudget"
   - "Conversion" → "Abschluss" / "Abschlussquote"
   - "ROAS" → "Werbeertrag"
   - "Paid Ads" → "bezahlte Anzeigen"
   - "Sales-Playbook" → "Vertriebsleitfaden"
   - "Reporting" → "Auswertung"
   - "Testimonials" → "Patientenstimmen"
   - "Marketing" → "Werbung" (sometimes Marketing is fine — judgment call)
   - Proper nouns (Instagram, Facebook, Google, Meta, Invisalign, All-on-4) stay.
4. 5. **"€" not "EUR"** for currency display.
6. **Copy style:** Direct. Clinic owner must understand in 10 seconds. Every card should have a clear headline, a plain-language explanation, then details. Avoid abstract nouns.
7. **Section headlines often have a H2 + subtitle pattern**:
   ```tsx
   <h2 className="display-l text-center">Main headline.</h2>
   <p className="mt-5 text-center font-display text-3xl font-semibold text-fg-primary md:text-4xl">Supporting claim.</p>
   ```

## Visual/UX rules

- **Contrast first.** If I ever use `text-fg-secondary` for main body copy, it's wrong. User has called this out repeatedly.
- **Bigger than you think.** Defaults for body `text-lg md:text-xl`. For anything informational (cards, bullets), not `text-base`.
- **No all-caps labels** unless requested. No `uppercase tracking-wider`.
- **Card pattern (semi-transparent):**
  ```
  card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 backdrop-blur-sm md:p-8
  ```
  All major cards use this. Don't make a card solid (`bg-bg-secondary`) unless there's a reason.
- **`card-glow`** has soft dark shadows in globals.css — works on light bg.
- **Mobile container padding** is forced to 9px in `globals.css` via `!important` under `@media (max-width: 767px)`. Tablet/desktop use Tailwind's `container.padding` from `tailwind.config.ts` (sm: 1.5rem, md: 2.5rem, lg: 3rem).
- **Nav on mobile:** burger on RIGHT, logo/CTA on LEFT. Nav logo shows only while hero-CTA or final-CTA is visible (IntersectionObserver tracks #hero-cta and #final-cta), CTA shows when they're off-screen. On desktop both always visible.
- **Scroll snap:** `html { scroll-snap-type: y mandatory }` on all sections. This is aggressive — if toggle/state-change feels janky, suspect scroll-snap interacting with layout shifts. Already mitigated in `roi-slider.tsx` with `contain: layout style` + `tabular-nums whitespace-nowrap`.

## Common component patterns

- **ShinyButton** (`components/ui/shiny-button.tsx`) — the primary CTA. Dark bg with mint animated border. Props: `href`, `target`, `rel`, `size`, `className`. The inline `style` from the `size` prop wins; use `!px-*` Tailwind overrides for responsive sizing.
- **Button** (`components/ui/button.tsx`) — shadcn-style with variants: primary (mint), outline, ghost.
- **Reveal** (`components/ui/reveal.tsx`) — wraps content with Framer Motion fade+y scroll-into-view. `delay`, `y`, `className` props. Respects `prefers-reduced-motion`.
- **Accordion** (`components/ui/accordion.tsx`) — Radix primitives.
- **ROI slider** has a JS-positioned pulse overlay because `::-webkit-slider-thumb` doesn't reliably animate. Uses `ResizeObserver` + `useLayoutEffect` to track thumb x-position.

## User preferences (learned from this session)

- **Speaks German/English mixed.** Match their language in replies.
- **Direct communication.** Short, no fluff. No "Great! I've now…" preambles.
- **Pushes back works.** When a request is counterproductive (e.g. custom scroll hijacking, trendy but fragile UX), explain the tradeoff and offer an alternative. They've accepted my pushback before.
- **Hates low contrast.** Multiple explicit complaints about grey text.
- **Hates all-caps labels.**
- **Wants "genuinely understand instantly" copy.** They will tell you the copy is bad and ask you to rewrite data files, not just styles.
- **Iterative:** expect them to flag things like "a bit bigger" or "not that much" — be ready to tune, not redo.
- **Don't auto-commit.** Commits only on explicit request.
- **No unasked Markdown docs/readmes.**

## Known gotchas

- **Git merge state:** This repo has had merge conflict markers (`<<<<<<< HEAD`) leak into source files twice. If you see them, resolve with `git checkout --ours <files>` to keep local work, then re-apply any recent edits that got reverted.
- **`formatEuro`** outputs `€` (not "EUR") via `de-DE` locale. Don't manually append " €".
- **`stat-viz.tsx`** exists but is no longer imported (charts removed from StatsShowcase). Leave it in place unless asked to delete.
- **Tailwind config** hot-reload is unreliable on Windows dev setups. For quick color iteration edit CSS vars in `globals.css` instead.
- **ShinyButton inline style** overrides CSS padding. To shrink on mobile, pass `className="!px-4 !py-2.5 !text-sm md:!px-8 md:!py-4 md:!text-base"`.

## When unsure

1. Check if similar copy exists nearby and match the tone.
2. Prefer editing `lib/*-data.ts` for content, components for structure.
3. Ask the user before big architectural changes (adding pages, routing, state libs).
4. Don't add accessibility, testing, or tooling changes unless asked.
