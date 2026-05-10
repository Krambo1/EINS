# clinic-landing

Multi-tenant, config-driven landing-page platform for paid-ad traffic to
aesthetic-medicine clinics in the DACH region.

> One Next.js codebase, one Vercel project, N clinics. Each clinic gets one
> config file + one asset folder; treatments are added the same way.

## Why this exists

EINS Visuals runs paid-ad campaigns for clinics. Those campaigns need landing
pages that:

- convert paid traffic at 5–10% click-to-lead,
- pre-qualify (timeframe, location, intent — never medical data),
- show every clinic's brand, **never** EINS's,
- are LCP < 2.5 s on 4G mobile (where 85%+ of patient traffic comes from),
- are HWG / DSGVO / TDDDG / DDG compliant by construction.

This app delivers all four.

## Quick start

```bash
pnpm install
pnpm --filter clinic-landing dev    # http://localhost:3002
```

The internal index at `/` lists every clinic + treatment route. Real patient
traffic never sees this — it lands directly on `praxis-X.de/<treatment>`,
which the middleware rewrites to `/<clinic>/<treatment>` server-side.

## How a new clinic is onboarded

Target onboarding time: **< 30 min** of active work, given assets + content.

1. **Copy the template:**
   ```bash
   cp -r clinics/_template clinics/<new-slug>
   cp -r public/clinics/_template public/clinics/<new-slug>
   ```
2. **Edit `clinics/<new-slug>/clinic.ts`** — brand, logo, doctor, address,
   contact, Impressum (Kammer, Berufsordnung-URL, Heilberufekammergesetz-URL,
   Berufshaftpflicht). Schema validation runs on save.
3. **Edit each `clinics/<new-slug>/treatments/*.ts`** — H1, subline, FAQ,
   process steps, price range. Or delete the ones you don't need.
4. **Drop assets into `public/clinics/<new-slug>/`** — logo, doctor portrait,
   2–3 practice photos, hero per treatment.
5. **Register the clinic in `lib/clinic-registry.ts`** — add the imports and
   include the new entry in `ENTRIES`. TypeScript will refuse to build if any
   field is mistyped.
6. **Set per-clinic env vars in Vercel:**
   - `LEAD_WEBHOOK_URL_<UPPER_SLUG>` — n8n / Make / CRM ingest URL
   - `META_CAPI_TOKEN_<UPPER_SLUG>` — Meta Conversions API access token
   Slug → env: dashes become underscores, all uppercase.
   `praxis-mueller-muenchen` → `META_CAPI_TOKEN_PRAXIS_MUELLER_MUENCHEN`
7. **Add custom domains in Vercel** — apex + www. DNS at the registrar pointed
   at Vercel.
8. **Anwaltliche Sichtprüfung** of Impressum + Datenschutz before go-live.
   The template carries placeholders that are explicitly NOT a final document.

## What's already enforced by the code

Things you cannot accidentally subvert without ripping out the type system:

- **HWG-Pflichthinweis** — `Treatment.explainer.riskNotice` is required and
  schema-validated at build.
- **No banned phrases** — `pnpm validate` (run on every build) greps every
  config and section for `garantiert`, `100%`, `vorher/nachher`, `bester`,
  `Marktführer`, `Nr. 1`, etc. Build fails on a hit.
- **No Art. 9 health data in the quiz** — the `TreatmentQuiz` zod schema is
  `.strict()`, so any field outside the whitelist (treatmentOptions,
  locationLabel, askExperience) is a compile-time error.
- **Impressum-Vollständigkeit** — Berufsbezeichnung, Verleihungsstaat,
  Kammer (name + address + URL), Berufsordnung-URL, Heilberufekammergesetz-URL
  and Berufshaftpflicht are required by `clinicSchema`.
- **Cookie default = essential** — three categories (essential / statistik /
  marketing). All non-essential off until the user clicks "Alle akzeptieren"
  or saves a custom selection.
- **IP anonymization** in `/api/lead` — last octet zeroed before any logging.
- **Idempotency** — same (email + treatment + UTC day) = same hash; duplicate
  posts within 6 h return `duplicate: true` without firing CAPI again.

## Architecture

```
apps/clinic-landing/
├── app/
│   ├── layout.tsx                          neutral root (de, no brand)
│   ├── [clinicSlug]/
│   │   ├── layout.tsx                      injects brand CSS vars + fonts
│   │   ├── [treatmentSlug]/
│   │   │   ├── page.tsx                    composes 12 sections
│   │   │   └── opengraph-image.tsx         auto OG (edge runtime)
│   │   ├── datenschutz/page.tsx            renders clinic.datenschutzMarkdown
│   │   └── impressum/page.tsx              renders clinic.legal.*
│   └── api/
│       ├── lead/route.ts                   CRM ingest + Meta CAPI
│       ├── track/route.ts                  CAPI relay (consent-gated)
│       └── rum/route.ts                    first-party Web-Vitals sink
├── components/
│   ├── sections/         (12 sections + sticky-bottom-cta + footer)
│   ├── ui/               (Button, Input, Checkbox, Accordion, RadioCardGroup)
│   ├── consent/          (CookieConsent dialog + ConsentProvider)
│   └── tracking/         (MetaPixel, GoogleAds, TikTokPixel, RUM, track helper)
├── lib/
│   ├── types.ts                            canonical types
│   ├── schema.ts                           zod, banned phrases, HWG enforcement
│   ├── clinic-registry.ts                  static map of clinics + treatments
│   ├── domain-map.ts                       host-header → slug
│   ├── seo.ts / jsonld.ts                  metadata + MedicalBusiness JSON-LD
│   ├── consent.ts                          three-category consent state
│   ├── meta-capi.ts                        direct Graph-API CAPI relay
│   ├── crm/                                hubspot / ghl / raw adapters
│   ├── format.ts / markdown.ts / idempotency.ts
├── clinics/_template/                      placeholder clinic + 7 treatments
├── public/clinics/_template/               placeholder SVGs + Inter WOFF2s
├── scripts/
│   ├── validate-clinics.ts                 zod + asset existence + domain uniqueness
│   └── hwg-lint.ts                         banned-phrase grep
└── middleware.ts                           host → clinic-slug rewrite
```

## Performance budget

- LCP < 2.5 s on Mobile 4G — hero image is `priority` + `fetchpriority="high"`
  with correct `sizes`.
- CLS < 0.05 — every image has aspect-ratio reservation; no layout-shifting
  banners before LCP.
- INP < 200 ms — no Framer Motion / Lottie at first render. CSS-only motion
  with `prefers-reduced-motion` honored.
- First-load JS budget per route: < 110 KB. Cookie banner + tracking pixels
  load only after consent and after `requestIdleCallback`.
- Self-hosted WOFF2 fonts (Inter Variable bundled), `font-display: swap`,
  preloaded only the display weight.

## Tracking & deduplication

- Browser pixel and server CAPI fire the same `event_id`, derived from a
  `crypto.randomUUID()` minted on quiz start. Meta dedups across Pixel+CAPI.
- The `Lead` event includes hashed `em` / `ph` / `fn` / `ct` (SHA-256 of
  lowercased values). `fbc` / `fbp` are forwarded if cookies are present.
- The lead idempotency hash (SHA-256 of `email|treatment|UTC-day`) is
  separate from the event_id — it covers double-submits across browser
  retries even if the event_id changed.

## CRM adapters

Pick one with `LEAD_CRM_ADAPTER`:

- `raw` — POST normalized JSON to `clinic.connectors.webhookUrl` (n8n / Make /
  Zapier). Recommended default.
- `hubspot` — POSTs to a HubSpot Forms API URL.
- `ghl` — POSTs flat fields to a GoHighLevel inbound webhook.

Each adapter is < 60 lines; adding a new one is grep-and-paste.

## Verification before go-live

Per the master plan §9 and §11:

- [ ] Lighthouse mobile (throttled 4G): Perf ≥ 90, A11y ≥ 95, SEO ≥ 95, BP ≥ 95.
- [ ] Playwright smoke: 5 quiz steps + submit + webhook + Meta-Test event.
- [ ] Info-Only branch: email-only submit, no phone, branch=`info-only` in CRM.
- [ ] Consent-gating: fresh profile shows zero requests to
  `connect.facebook.net`, `googletagmanager.com`, `analytics.tiktok.com`
  before any click.
- [ ] HWG grep over compiled HTML: zero banned phrases.
- [ ] Domain routing: `curl -H "Host: praxis-X.de" ...` returns 200.
- [ ] Anwaltliche Sichtprüfung Impressum + Datenschutz.

## Scripts

```bash
pnpm dev                         # next dev on 3002
pnpm typecheck                   # tsc --noEmit
pnpm lint                        # eslint
pnpm lint:hwg                    # banned-phrase grep
pnpm validate                    # validate-clinics + hwg-lint (runs on build)
pnpm build                       # production build (validates first)
```
