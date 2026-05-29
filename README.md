# EINS — Design System

Brand system for **EINS**, a DACH-region (DE / AT / CH) acquisition system for dental and aesthetic clinics. Single-page German landing site that converts clinic owners (40–65) into booked **Strategie-Gespräche** (Calendly strategy calls).

The product is a three-layer stack:

1. **Medien** — video + photo production on-site at the clinic.
2. **Bezahlte Anzeigen** — Meta + Google ads targeted to the clinic's region.
3. **KI-Anfragesystem** — AI pre-qualifies requests, filters price-hunters and spam before they hit clinic staff.

Audience: non-technical clinic owners. **"If an elderly dentist can't read it, it's wrong."**

---

## Index

| File | Purpose |
|---|---|
| `README.md` | This file — brand overview, content + visual foundations, iconography |
| `SKILL.md` | Agent-skill front-matter; loadable in Claude Code |
| `colors_and_type.css` | Drop-in CSS custom properties + base type + `.card` / `.eyebrow` / `.text-accent` / `.text-accent-gradient` |
| `fonts/` | Neue Haas Display (Light 300, Roman 400, Medium 500, Bold 700) in woff2 |
| `assets/` | Logos (`eins-logo.svg`, `eins-logo.png`, `eins-mark.png`), social platform marks, product imagery, AI Lottie |
| `preview/` | Individual design-system cards (tokens, specimens, components) shown in the Design System tab |
| `ui_kits/website/` | Interactive recreation of the EINS landing page: nav, hero, system trio, offer block, stats, final CTA |

## Sources

- **Production codebase:** `EINSWebsite/` (Next.js 14 App Router, Tailwind, Framer Motion, shadcn primitives). Attached as a read-only mount via File System Access. The site's `CLAUDE.md` is the canonical authority for copy and contrast rules.
- **Font files:** Uploaded directly (`uploads/NeueHaasDisplay-*.woff2`) and copied into `fonts/`.
- **Logos:** Uploaded directly (`uploads/eins-logo.*`, `uploads/eins-mark.png`) and copied into `assets/`.
- **GitHub mirror:** `Krambo1/EINS` — not pulled; everything needed was already in the local mount.

---

## Content fundamentals

### Voice

- **Formal "Sie" only.** Always capitalized: *Sie, Ihr, Ihre, Ihnen.* Never "du", never "wir per du".
- **Direct.** A clinic owner should understand every sentence in ≤10 seconds. No abstract nouns, no marketing poetry.
- **Plain German. No Anglicisms** where a natural German word exists:

  | ❌ English | ✅ German |
  |---|---|
  | Call | Gespräch |
  | Lead | Anfrage |
  | Content / Asset | Medien / Video |
  | Landingpage | Zielseite / Ziel-Website |
  | Funnel | Strecke |
  | Adspend | Werbebudget |
  | Conversion / ROAS | Abschluss(quote) / Werbeertrag |
  | Paid Ads | bezahlte Anzeigen |
  | Testimonials | Patientenstimmen |
  | Reporting | Auswertung |
  | Sales Playbook | Vertriebsleitfaden |

  Proper nouns (Instagram, Facebook, Google, Meta, Invisalign, All-on-4) stay.
- **No em-dashes** (`—` U+2014). Use comma, period, or a short hyphen.
- **"€" not "EUR".** Locale is `de-DE`. German decimal comma (`1.500,00 €`).
- **No emoji.** No unicode cute characters. No `:)`.
- **No all-caps / tracking-wider labels.** Mono `eyebrow` is the only acceptable small label style.

### Headline pattern

A section almost always opens with an H2 + a semibold subtitle one font-size step down:

```tsx
<h2 className="display-l text-center">Marketing für Ihre Klinik.</h2>
<p className="mt-5 font-display text-3xl md:text-5xl font-semibold text-fg-primary">
  Werden Sie zur EINS in Ihrer Region.
</p>
```

### Copy examples (verbatim from production)

- Hero: *"Mehr Patienten. Mehr Umsatz. Mehr Sicherheit."*
- System: *"Marketing für Ihre Klinik. Werden Sie zur EINS in Ihrer Region."*
- Offer: *"Das EINS Akquisitions-System."*
- Final CTA: *"Nichts zu ändern ist auch eine Entscheidung. Meist die teuerste."*
- Primary button: *"Strategie-Gespräch buchen"*
- Availability tag: *"Verfügbar · 30 Minuten"*

---

## Visual foundations

### Colors

Single light theme. Near-black text (#10101a) on white (#ffffff). Mint teal is the ONLY accent.

| Role | Token | Hex |
|---|---|---|
| Page | `--bg-primary` | `#ffffff` |
| Card | `--bg-secondary` | `#f5f5f7` (used at 60% opacity + blur) |
| Deep surface | `--bg-tertiary` | `#ebebef` |
| Body text | `--fg-primary` | `#10101a` |
| Helper text | `--fg-secondary` | `#4a4a52` |
| Rare | `--fg-tertiary` | `#6a6a74` |
| Accent | `--accent` | `#58BAB5` |
| Accent bright | `--accent-bright` | `#64CEC9` |
| Accent glow | `--accent-glow` | `rgba(88,186,181,.30)` |
| Border | `--border` | `#e4e4e7` |

**High-contrast rule:** body text is always `--fg-primary`. Using `--fg-secondary` for main copy is always wrong — the audience is 40–65, elderly readers included.

**Accent gradient** (large text only): `linear-gradient(180deg, #58BAB5, #64CEC9)`. Darker on top keeps it readable against the diffuse mint shapes in the page background.

Background has two large, heavily blurred mint blobs (`blur-3xl`, 30% opacity, clip-path diamond). That's the only decoration — everything else is white.

### Typography

- **Neue Haas Display** at all weights. No secondary family.
- Fluid display sizes: `display-xl` / `-l` / `-m` using `clamp()`.
- **Body is intentionally large** — `text-lg` (18px) on mobile, `text-xl` (20px) md+. `text-base` only for table rows or fine print.
- **Mono**: same family (no dedicated mono) — used only for the `.eyebrow` label and footer/meta text.
- Letter-spacing is tight on displays (`0` on H1/H2, `0.005em` on H3). Body gets `0.012em` + `0.08em` word-spacing for readability.

### Spacing & layout

- Section rhythm: `padding-top/bottom: 5rem` mobile, `8rem` md+.
- `scroll-snap-type: y mandatory` on `<html>`, each section is a snap target.
- Container: `1240px` max width, `2xl` breakpoint. Mobile padding locked to 16px.
- Cards: `rounded-2xl` (16px), `.card-glow` shadow.

### Cards

Canonical card = semi-transparent fill + blur + soft dark drop:
```
rounded-2xl border border-border bg-bg-secondary/60 p-6 md:p-8 backdrop-blur-sm card-glow
```

### Buttons

- **ShinyButton** — primary CTA only. Dark pill (`#10101a`), mint animated conic-gradient border, dot-pattern inner, radial shimmer sweep, 360px radius. Hovered: gradient expands to 25%, shine brightens.
- **Button primary** — mint fill, white text, subtle drop-shadow glow, shine sweep on hover.
- **Button outline** — 1px border, transparent, tint on hover.
- **Button ghost** — text only.
- Radii: all pill (`rounded-full` / 360px).

### Motion

- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` ("expo out"). The only easing used across the product.
- Durations: `200ms` fast (hover), `300ms` base, `700ms` Reveal (entrance).
- Reveal-on-scroll via Framer Motion: `opacity 0→1`, `y 20→0`, `once: true`, `-10%` viewport margin.
- `prefers-reduced-motion: reduce` → all animations collapse to ~0ms, scroll-behavior auto.

### Hover / press

- Links & nav: color to `--accent`, underline scales in horizontally.
- Cards: shadow lifts (no scale, no translate).
- Buttons: shine sweep across, no scale.
- Press: ShinyButton translates `0 1px`.

### Shadows

Soft dark drop glow — never colored, always dark. See `--shadow-card` / `--shadow-card-hover` in `colors_and_type.css`. CTA has a mint radial glow underneath (`shadow-[0_0_40px_-8px_var(--accent-glow)]`).

### Borders, radii, transparency

- Borders: single 1px `--border` (#e4e4e7), hover `--border-hover` (#d1d1d6). Never thicker.
- Radii: `12px` inputs, `16px` cards, `360px` pills. No sharp corners anywhere.
- Transparency + blur used for nav (`bg-bg-primary/70 backdrop-blur-xl`) and cards (`/60` + blur-sm). Never for text backgrounds.

### Imagery

Warm, professional, clinic-real. Product photography (hands with camera) is used cropped off the card's bleed. Headshot uses a webp. No illustrations, no 3D, no stock-photo feel. No grain filter by default — `.bg-noise` exists but is off-menu unless asked.

### Layout rules

- **Nav** is fixed top, 72px, crossfades from transparent to `/70` + blur when scrolled.
- **Back-to-top** button appears on final CTA.
- **No horizontal scroll anywhere** (`overflow-x: hidden` on html + body).
- Center-aligned headlines are the default. Card grids are left-aligned content.

---

## Iconography

- **Primary icon library: `lucide-react`** (present in the codebase). Stroke icons, 1.5px weight default, 20–24px canvas. Examples in use: `ArrowUpRight`, `Menu`, `X`, `Check`, `Minus`. Link from CDN (`https://unpkg.com/lucide-static@latest/icons/<name>.svg`) or inline the SVG.
- **Platform logos** are PNG assets (Facebook, Instagram, TikTok) — copied into `assets/`. These are the actual brand marks, not reinterpretations. Use them at 80–96px in the System trio.
- **AI icon** is a Lottie JSON (`assets/ai-icon.json`), played via `lottie-react`. Kept at large scale (`h-44 md:h-56`) with negative margins that push it past the card bleed.
- **Logo:** `eins-logo.svg` is the wordmark (600×240 native). `eins-mark.png` is the solitary "1" mark (favicon, OG, Apple touch).
- **No emoji** in product surfaces. **No unicode glyphs** as icons. **No hand-drawn SVGs**.
- The only custom bit of iconography in the codebase is a green pulsing availability dot (hand-composed from two overlapping `bg-green-500` circles with a `ping` animation) and the eyebrow dot (`--accent` 8px circle).

### Substitutions

None flagged — all fonts, icons, and assets requested are present.
