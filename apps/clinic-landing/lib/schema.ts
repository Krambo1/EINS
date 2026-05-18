import { z } from "zod";

/**
 * Build-time validation for clinic + treatment configs.
 *
 * Used by:
 *   - `scripts/validate-clinics.ts` (CI / pre-build)
 *   - `lib/clinic-registry.ts` (runtime sanity check on first import)
 *
 * The schema enforces every HWG / DSGVO / DDG hard rule we can express in
 * data: required Pflichtangaben, banned phrases, no Art. 9 health data in
 * quiz fields, complete Impressum.
 */

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Phrases that are illegal or borderline-illegal under HWG / UWG.
 * Matched case-insensitively as whole-word-ish substrings.
 *
 * Sources: HWG § 3 (Irreführung), § 11 (Verbotene Werbeaussagen),
 *   UWG § 5 (Spitzenstellung), BGH I ZR 222/19 (Vorher-Nachher).
 */
export const BANNED_PHRASES: readonly string[] = [
  "garantiert",
  "garantie auf das ergebnis",
  "100 %",
  "100%",
  "ohne risiko",
  "schmerzfrei",
  "vorher",
  "nachher",
  "vorher-nachher",
  "vor-nachher",
  "before-after",
  "bester",
  "beste",
  "marktführer",
  "nr. 1",
  "nr.1",
  "nummer 1",
  "endlich glücklich",
  "wieder wie 30",
  "wirkt sofort",
  "sofortige wirkung",
  "ohne nebenwirkungen",
];

/**
 * Banned-phrase matcher with word-boundary sensitivity.
 *
 * For single-word phrases (no whitespace, no punctuation other than dashes)
 * we use `\b…\b` word boundaries so substrings inside ordinary German verbs
 * don't trigger false positives ("beste" vs. "besteht", "vor" vs. "Vorbereitung").
 * For multi-word phrases ("vorher-nachher", "100 %", "endlich glücklich") we
 * fall back to literal substring matching since they're already specific.
 */
function isSingleWordToken(p: string): boolean {
  return !/[\s.]/.test(p) && !p.includes("-");
}

const BANNED_PATTERNS: { phrase: string; rx: RegExp }[] = BANNED_PHRASES.map((p) => {
  const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rx = isSingleWordToken(p)
    ? new RegExp(`\\b${escaped}\\b`, "i")
    : new RegExp(escaped, "i");
  return { phrase: p, rx };
});

export function findBannedPhrases(input: string): string[] {
  return BANNED_PATTERNS.filter(({ rx }) => rx.test(input)).map((p) => p.phrase);
}

/**
 * Wrap an existing string-shaped schema with HWG/UWG banned-phrase enforcement.
 *
 * Wrapping (rather than starting from `z.string()`) lets callers retain their
 * `.min()` / `.max()` constraints — the wrapper applies banned-phrase checks
 * on top via `.superRefine`.
 */
function noBanned<T extends z.ZodType<string, z.ZodTypeDef, string>>(
  schema: T,
  label: string,
): z.ZodEffects<T, string, string> {
  return schema.superRefine((val, ctx) => {
    const found = findBannedPhrases(val);
    if (found.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label}: enthält verbotene HWG/UWG-Phrasen: ${found.join(", ")}`,
      });
    }
  });
}

/* ── Brand ─────────────────────────────────────────────────────────────── */

const brandFontFaceSchema = z.object({
  family: z.string().min(1),
  filename: z.string().min(1),
  weight: z.union([z.number(), z.string()]),
  style: z.enum(["normal", "italic"]).optional(),
  display: z.enum(["swap", "block", "fallback", "optional"]).optional(),
});

const brandSchema = z.object({
  primary: z.string().regex(HEX, "primary must be a hex color"),
  primarySoft: z.string().regex(HEX),
  accent: z.string().regex(HEX),
  bg: z.string().regex(HEX),
  bgSoft: z.string().regex(HEX),
  fg: z.string().regex(HEX),
  fgMuted: z.string().regex(HEX),
  border: z.string().regex(HEX),
  radius: z.enum(["sharp", "soft", "pill"]),
  fontFamily: z.string().min(1),
  fonts: z.array(brandFontFaceSchema).optional(),
  googleFontsUrl: z.string().url().optional(),
});

/* ── Doctor / Trust / Testimonial ──────────────────────────────────────── */

const doctorSchema = z.object({
  name: z.string().min(2),
  facharzt: z.string().min(2),
  cv: z.array(z.string().min(2)).min(2).max(8),
  memberships: z.array(z.string().min(2)).optional(),
  portrait: z.string().min(1),
  portraitAlt: z.string().min(2),
});

const trustSchema = z.object({
  google: z
    .object({
      score: z.number().min(0).max(5),
      count: z.number().int().min(0),
    })
    .optional(),
  practiceSince: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
  treatmentVolume: z
    .object({
      count: z.number().int().min(0),
      asOfYear: z.number().int().min(2000).max(new Date().getFullYear()),
    })
    .optional(),
  press: z
    .array(
      z.object({
        name: z.string().min(2),
        year: z.number().int().min(1990).max(new Date().getFullYear()),
      }),
    )
    .optional(),
});

const testimonialSchema = z.object({
  name: z.string().min(2).max(40),
  city: z.string().optional(),
  age: z.union([z.number(), z.string()]).optional(),
  quote: noBanned(z.string().min(20).max(400), "testimonial.quote"),
  consentedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "consentedAt must be ISO date YYYY-MM-DD")
    .optional(),
});

/* ── Address / Contact / Impressum ─────────────────────────────────────── */

const addressSchema = z.object({
  street: z.string().min(2),
  zip: z.string().min(4).max(6),
  city: z.string().min(2),
  country: z.enum(["DE", "AT", "CH"]),
  mapsUrl: z.string().url().optional(),
});

const contactSchema = z.object({
  phoneE164: z.string().regex(/^\+\d{8,15}$/, "phoneE164 must be E.164 starting with +"),
  phoneDisplay: z.string().min(6),
  whatsappE164: z
    .string()
    .regex(/^\d{8,15}$/, "whatsappE164 must be digits only, 8-15 digits")
    .optional(),
  email: z.string().email(),
  bookingUrl: z.string().url().optional(),
});

const impressumLegalSchema = z.object({
  berufsbezeichnung: z.string().min(2),
  verleihungsstaat: z.string().min(2),
  kammer: z.object({
    name: z.string().min(2),
    address: z.string().min(5),
    url: z.string().url(),
  }),
  berufsordnungUrl: z.string().url(),
  heilberufekammergesetzUrl: z.string().url(),
  ustId: z.string().optional(),
  berufshaftpflicht: z.object({
    versicherer: z.string().min(2),
    adresse: z.string().min(5),
    geltungsbereich: z.string().min(2),
  }),
  datenschutzbeauftragter: z
    .object({
      name: z.string().min(2),
      email: z.string().email(),
    })
    .optional(),
});

const connectorsSchema = z.object({
  webhookUrl: z.string().url().optional(),
  metaPixelId: z.string().optional(),
  googleAdsId: z.string().optional(),
  googleAdsConversionLabel: z.string().optional(),
  tiktokPixelId: z.string().optional(),
});

/* ── Clinic ────────────────────────────────────────────────────────────── */

export const clinicSchema = z.object({
  // Slugs are URL path segments. Convention: lowercase, dash-separated.
  // A leading underscore marks an internal template (e.g. "_template"), which
  // never receives a custom domain.
  slug: z.string().regex(/^_?[a-z0-9-]+$/, "slug must be lowercase, dash-separated (underscore prefix allowed for internal templates)"),
  /** UUID of the matching clinic row in the EINS portal. Empty string disables portal mirror. */
  portalClinicId: z.string(),
  /** Name of the env var holding the HMAC shared secret for portal intake signing. */
  portalIntakeSecretEnv: z.string(),
  domains: z.array(z.string().min(3)),
  name: z.string().min(2),
  logo: z.string().min(1),
  logoAlt: z.string().min(2),
  brand: brandSchema,
  doctor: doctorSchema,
  trust: trustSchema,
  testimonials: z.array(testimonialSchema).max(8).optional(),
  legal: impressumLegalSchema,
  address: addressSchema,
  contact: contactSchema,
  practiceImages: z
    .array(z.object({ src: z.string().min(1), alt: z.string().min(2) }))
    .max(8)
    .optional(),
  connectors: connectorsSchema,
  datenschutzMarkdown: z.string().min(200),
});

/* ── Treatment ─────────────────────────────────────────────────────────── */

const quizOptionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-_]+$/),
  label: z.string().min(2),
  hint: z.string().optional(),
});

const quizSchema = z
  .object({
    treatmentOptions: z.array(quizOptionSchema).min(2).max(8),
    locationLabel: z.string().min(2),
    askExperience: z.boolean().optional(),
  })
  .strict("Quiz schema rejects unknown keys — Art. 9 health-data fields are NOT allowed here");

const processStepSchema = z.object({
  index: z.number().int().min(1).max(6),
  title: z.string().min(2),
  body: z.string().min(10),
});

const faqSchema = z
  .array(
    z.object({
      q: noBanned(z.string().min(4), "faq.q"),
      a: noBanned(z.string().min(10), "faq.a"),
    }),
  )
  .min(4)
  .max(14);

const priceRangeSchema = z
  .object({
    fromCents: z.number().int().min(0),
    toCents: z.number().int().min(0).optional(),
    currency: z.enum(["EUR", "CHF"]),
  })
  .refine(
    (v) => v.toCents === undefined || v.toCents >= v.fromCents,
    "toCents must be ≥ fromCents",
  );

export const treatmentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  clinicSlug: z.string().regex(/^_?[a-z0-9-]+$/),
  category: z.enum([
    "botox",
    "filler",
    "lid-op",
    "liposuktion",
    "brust",
    "rhino",
    "anti-aging",
    "skin",
    "other",
  ]),
  city: z.string().min(2),

  h1: noBanned(z.string().min(8).max(120), "h1"),
  subline: noBanned(z.string().min(10).max(280), "subline"),

  heroImage: z.object({
    src: z.string().min(1),
    alt: z.string().min(2),
  }),
  heroVideo: z
    .object({
      mp4: z.string().min(1),
      webm: z.string().optional(),
      poster: z.string().min(1),
    })
    .optional(),

  trustMicrocopy: z.string().max(120).optional(),
  ctaLabel: z.string().min(2).max(40).optional(),

  problem: z.object({ paragraphs: z.array(z.string().min(20)).min(1).max(4) }).optional(),

  explainer: z.object({
    indication: noBanned(z.string().min(10), "explainer.indication"),
    process: noBanned(z.string().min(10), "explainer.process"),
    recovery: noBanned(z.string().min(10), "explainer.recovery"),
    duration: noBanned(z.string().min(4), "explainer.duration"),
    sideEffects: noBanned(z.string().min(10), "explainer.sideEffects"),
    /** HWG § 4 — required Pflichtangabe. Cannot be empty, cannot be sanitized. */
    riskNotice: z.string().min(40, "riskNotice (HWG § 4 Pflichtangabe) must be present"),
  }),

  quiz: quizSchema,
  process: z.object({ steps: z.array(processStepSchema).min(2).max(6) }),
  faq: faqSchema,
  priceRange: priceRangeSchema,
  finalCtaPromise: noBanned(z.string().min(10).max(200), "finalCtaPromise"),
  seo: z.object({
    metaTitle: noBanned(z.string().min(20).max(70), "seo.metaTitle"),
    metaDescription: noBanned(z.string().min(60).max(180), "seo.metaDescription"),
    ogImage: z.string().optional(),
  }),
});

/* ── Inferred types: ensure schema and types stay in sync ───────────── */
export type ClinicSchema = z.infer<typeof clinicSchema>;
export type TreatmentSchema = z.infer<typeof treatmentSchema>;
