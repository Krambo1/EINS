/**
 * Canonical types for the clinic-landing template.
 *
 * Every clinic config is a typed TypeScript module that satisfies these shapes.
 * The matching zod schemas in `./schema.ts` validate the same shapes at build time.
 * If you change a type, change the zod schema too — the build will yell otherwise.
 *
 * HARD RULES baked into these types (don't subvert):
 *   - No medical data fields in `Treatment.quiz` — DSGVO Art. 9 forbids collecting
 *     allergies/medications/pregnancy state without an explicit, documented basis.
 *   - `riskNotice` on every treatment is required — HWG § 4 mandates a Pflichtangabe.
 *   - Impressum carries every Pflichtfeld for healthcare professionals (DDG § 5).
 */

export type Country = "DE" | "AT" | "CH";

export type RadiusStyle = "sharp" | "soft" | "pill";

export type TreatmentCategory =
  | "botox"
  | "filler"
  | "lid-op"
  | "liposuktion"
  | "brust"
  | "rhino"
  | "anti-aging"
  | "skin"
  | "other";

export interface BrandTokens {
  /** Primary brand color, used for CTAs and accents. Hex. */
  primary: string;
  /** Soft tint of primary, used for backgrounds and dividers. Hex. */
  primarySoft: string;
  /** Optional secondary accent (e.g. gold for premium positioning). Hex. */
  accent: string;
  /** Page background. Hex. */
  bg: string;
  /** Soft alt background for sections. Hex. */
  bgSoft: string;
  /** Foreground text. Hex. */
  fg: string;
  /** Muted foreground for body copy. Hex. */
  fgMuted: string;
  /** Border / divider color. Hex. */
  border: string;
  /** Corner-radius style. */
  radius: RadiusStyle;
  /** CSS font-family value (single name, no fallbacks — those are appended in layout). */
  fontFamily: string;
  /**
   * Optional display font for headlines / pull-quotes (e.g. a serif like
   * "Fraunces"). Falls back to `fontFamily` when omitted, so existing clinic
   * configs stay valid.
   */
  fontFamilyDisplay?: string;
  /**
   * Optional self-hosted font stack. WOFF2 files live under
   * `public/clinics/<slug>/fonts/`. The clinic layout emits a `<style>` block
   * with one `@font-face` per entry.
   */
  fonts?: BrandFontFace[];
  /**
   * Optional Google Fonts URL (e.g. `https://fonts.googleapis.com/css2?family=...&display=swap`).
   * Self-hosted is the default — only opt-in to Google Fonts if the clinic explicitly wants it
   * and accepts the EuGH München 2022 risk surface (datenschutz must mention it).
   */
  googleFontsUrl?: string;
}

export interface BrandFontFace {
  family: string;
  /** Path under public/clinics/<slug>/fonts/, e.g. "Inter-Regular.woff2" */
  filename: string;
  weight: number | string;
  style?: "normal" | "italic";
  display?: "swap" | "block" | "fallback" | "optional";
}

export interface Doctor {
  /** Full salutation incl. title, e.g. "Dr. med. Anna Müller". */
  name: string;
  /** Exact Facharztbezeichnung as conferred — Berufsordnung-Risiko on Phantasie. */
  facharzt: string;
  /** 3–6 CV bullets (Studium, Weiterbildung, Praxis seit, Schwerpunkte). */
  cv: string[];
  /** Society memberships — only those actually held. */
  memberships?: string[];
  /**
   * Optional 1-sentence philosophy pull-quote, rendered in the authority
   * block. Sachlich — no outcome promises (HWG-linted like all copy).
   */
  quote?: string;
  /** Path under /public, e.g. "/clinics/<slug>/doctor-portrait.webp" */
  portrait: string;
  portraitAlt: string;
}

export interface TrustAnchors {
  google?: { score: number; count: number };
  /** Year of practice founding (number, e.g. 2014). */
  practiceSince?: number;
  /** Belegbares treatment volume — e.g. { count: 4500, asOfYear: 2024 } */
  treatmentVolume?: { count: number; asOfYear: number };
  /** Press mentions, name + year. */
  press?: { name: string; year: number }[];
}

export interface Testimonial {
  /** First name + initial only, never full name. */
  name: string;
  /** City of the patient, optional. */
  city?: string;
  /** Age, optional. Range OK. */
  age?: number | string;
  /** Sachlich, kein Heilversprechen, kein "endlich glücklich". */
  quote: string;
  /** Where the quote was published — renders as a source line ("Google, 2026"). */
  source?: "google" | "jameda" | "praxis";
  /** When the patient consented in writing (Art. 9 DSGVO + § 22 KUG). ISO date. */
  consentedAt?: string;
}

export interface Address {
  street: string;
  zip: string;
  city: string;
  country: Country;
  /** Optional Maps URL — leave empty if not needed. */
  mapsUrl?: string;
}

export interface Contact {
  /** E.164 form, e.g. "+49891234567". */
  phoneE164: string;
  /** Display variant, e.g. "+49 89 1234 567". */
  phoneDisplay: string;
  /** Digits only for wa.me link, e.g. "49891234567". */
  whatsappE164?: string;
  email: string;
  /** Cal.com EU URL or Calendly-DPF URL — embedded after quiz submit. */
  bookingUrl?: string;
}

export interface ImpressumLegal {
  /** Exact Berufsbezeichnung as conferred. */
  berufsbezeichnung: string;
  /** Country where the title was conferred (e.g. "Bundesrepublik Deutschland"). */
  verleihungsstaat: string;
  /** Responsible Landesärztekammer — name + address + URL all required. */
  kammer: { name: string; address: string; url: string };
  /** URL of the Berufsordnung (BO) of the Kammer. */
  berufsordnungUrl: string;
  /** URL of the Heilberufekammergesetz of the relevant Bundesland. */
  heilberufekammergesetzUrl: string;
  /** USt-IdNr if assigned. */
  ustId?: string;
  /** Berufshaftpflicht details — Versicherer, Adresse, Geltungsbereich. */
  berufshaftpflicht: {
    versicherer: string;
    adresse: string;
    geltungsbereich: string;
  };
  /** Datenschutzbeauftragter — required if ≥20 employees process personal data. */
  datenschutzbeauftragter?: { name: string; email: string };
}

export interface Connectors {
  /** CRM ingest endpoint — n8n / Make / direct CRM webhook. */
  webhookUrl?: string;
  metaPixelId?: string;
  googleAdsId?: string;
  googleAdsConversionLabel?: string;
  tiktokPixelId?: string;
}

export interface Clinic {
  slug: string;
  /**
   * UUID of the matching clinic row in the EINS portal database. Used by the
   * lead-intake fan-out to address the portal's `/api/leads/intake` route.
   * Empty string disables the portal mirror for this clinic.
   */
  portalClinicId: string;
  /**
   * Name of the env var holding the HMAC shared secret used to sign portal
   * intake payloads, e.g. `PORTAL_INTAKE_SECRET_TEMPLATE`. The same plaintext
   * lives encrypted in the portal's `platform_credentials` row with
   * `platform='intake'` for this clinic.
   */
  portalIntakeSecretEnv: string;
  /** Custom domains the clinic owns (apex + www, plus aliases). */
  domains: string[];
  /** Public name as shown in the nav and footer. */
  name: string;
  /** Path to logo asset, SVG strongly preferred. */
  logo: string;
  logoAlt: string;
  brand: BrandTokens;
  doctor: Doctor;
  trust: TrustAnchors;
  testimonials?: Testimonial[];
  legal: ImpressumLegal;
  address: Address;
  contact: Contact;
  /** Optional praxis ambient photos (NOT before/after, NOT patient faces). */
  practiceImages?: { src: string; alt: string }[];
  /**
   * Callback-window copy shown under CTAs and on the confirmation screen,
   * e.g. "innerhalb eines Werktags". Only tighten ("innerhalb von 2 Stunden")
   * when the Praxis can actually honor it — speed-to-lead is an ops SLA,
   * not page copy. Default: "innerhalb eines Werktags".
   */
  responsePromise?: string;
  connectors: Connectors;
  /**
   * Datenschutz copy — Markdown allowed. The template carries a Pflicht-Boilerplate
   * that should only be replaced with a lawyer-reviewed final version pre-launch.
   */
  datenschutzMarkdown: string;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Treatment
 * ────────────────────────────────────────────────────────────────────────── */

export interface QuizTreatmentOption {
  /** stable id, used as form value */
  id: string;
  label: string;
  /** Optional supporting line. */
  hint?: string;
}

/**
 * Quiz config per treatment.
 *
 * IMPORTANT: this type intentionally carries NO field for medical data —
 * allergies, medications, pregnancy, conditions. Collecting Art. 9 health data
 * via a public landing page without explicit basis is unlawful.
 */
export interface TreatmentQuiz {
  /** Step 1 — clarify which sub-treatment / area the patient wants. */
  treatmentOptions: QuizTreatmentOption[];
  /**
   * OP-level flows only: adds the investment-gate step. The price anchor is
   * derived from `priceRange.fromCents`; "erst mehr erfahren" routes to the
   * info-only branch. Default false (injectables skip it).
   */
  askBudget?: boolean;
  /**
   * OP-level flows only: adds the service-framed distance step
   * ("in der Nähe / bis 1 Stunde / weiter entfernt"). Default false.
   */
  askDistance?: boolean;
}

export interface ProcessStep {
  index: number;
  title: string;
  body: string;
}

export interface FAQItem {
  q: string;
  a: string;
}

export interface PriceRange {
  /** Minimum price in cents. */
  fromCents: number;
  /** Optional upper bound in cents — omit for "ab"-pricing. */
  toCents?: number;
  currency: "EUR" | "CHF";
}

export interface Treatment {
  /** URL slug under the clinic, e.g. "botox-muenchen". */
  slug: string;
  /** Bound to one clinic via the file location — kept here for fast lookups. */
  clinicSlug: string;
  category: TreatmentCategory;
  city: string;

  /** 6–12 words. */
  h1: string;
  /** 1–2 sentences. */
  subline: string;

  heroImage: { src: string; alt: string };
  /** Optional 15–30s muted MP4 + WebM. Lazy-mounted, never the LCP element. */
  heroVideo?: { mp4: string; webm?: string; poster: string };

  /** Optional one-line trust line under the hero CTA. */
  trustMicrocopy?: string;
  /** Optional CTA label override. */
  ctaLabel?: string;

  /** Section 4 (problem mirror), optional for warm traffic. */
  problem?: { paragraphs: string[] };

  explainer: {
    indication: string;
    process: string;
    recovery: string;
    duration: string;
    sideEffects: string;
    /** HWG-Pflichtangabe — required field. */
    riskNotice: string;
  };

  quiz: TreatmentQuiz;

  /** 3 steps for injectables, 4 for surgery (incl. § 8 HWG bedenkzeit). */
  process: { steps: ProcessStep[] };

  faq: FAQItem[];

  /** Used to answer "Was kostet ..." truthfully in FAQ. */
  priceRange: PriceRange;

  /**
   * Optional data for the cost-transparency section. `drivers` lists what
   * moves the price (Areal, Anästhesie, Umfang, ...). `financingNote` is a
   * factual one-liner ("Ratenzahlung auf Anfrage möglich") — never promote
   * credit terms (HWG/UWG risk).
   */
  cost?: {
    drivers?: string[];
    financingNote?: string;
  };

  /** Closing promise sentence, e.g. "Sie wissen heute, ob es zu Ihnen passt." */
  finalCtaPromise: string;

  seo: {
    metaTitle: string;
    metaDescription: string;
    /** Optional OG override. If omitted, falls back to opengraph-image.tsx. */
    ogImage?: string;
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Quiz submission shapes (server-side only)
 * ────────────────────────────────────────────────────────────────────────── */

export type QuizBranch = "qualified" | "info-only";

export interface QuizSubmissionPayload {
  clinicSlug: string;
  treatmentSlug: string;
  branch: QuizBranch;
  treatment: string;
  timeframe?: string;
  /** Legacy (quiz v1) — kept optional for wire-compat, no longer collected. */
  experience?: string;
  /** Legacy (quiz v1) — kept optional for wire-compat, no longer collected. */
  city?: string;
  /** Investment-gate answer (OP flows): "ja" | "unsicher" | "erst-informieren". */
  budget?: string;
  /** Distance answer (OP flows): "in-der-naehe" | "bis-1-stunde" | "weiter-entfernt". */
  distance?: string;
  /** Patient contact (collected last). */
  firstName?: string;
  email: string;
  phone?: string;
  /** Optional free-text note from the patient. */
  notes?: string;
  /**
   * Four booleans:
   *   - privacy      — Datenschutz acknowledged (required, Art. 6(1)(b)+13 DSGVO)
   *   - ageGate      — ≥18 self-declared (required)
   *   - marketing    — nurture e-mails (optional, requires double-opt-in confirmation)
   *   - aiProcessing — optional explicit consent for AI-assisted notes scoring
   *     via OpenAI (US transfer + Art. 9 / Art. 22 DSGVO). Without it the portal
   *     worker uses the deterministic fallback and never sends notes to OpenAI.
   */
  consents: {
    privacy: boolean;
    ageGate: boolean;
    marketing: boolean;
    aiProcessing: boolean;
  };
  /**
   * Set by the lead intake route. ISO timestamp once the patient has confirmed
   * the double-opt-in link sent to their email. While null, downstream CRMs
   * MUST treat `consents.marketing` as pending and not start a nurture flow.
   */
  marketingConfirmedAt?: string | null;
  /** Client metadata for CAPI deduplication. */
  meta: {
    /** External event id for Meta Pixel + CAPI dedup. */
    eventId: string;
    /** Anonymized URL of the page where the lead was generated. */
    sourceUrl: string;
    /** UTM params, if present. */
    utm?: Record<string, string>;
    /** Meta click id (fbc) and browser id (fbp), if present. */
    fbc?: string;
    fbp?: string;
    /** User agent. */
    ua?: string;
  };
}

export interface CRMAdapterResult {
  ok: boolean;
  /** Adapter-specific identifier, useful for support. */
  externalId?: string;
  /** Soft-fail message — do NOT block the patient on this. */
  message?: string;
}
