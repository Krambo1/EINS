import type { Clinic } from "@/lib/types";
import privacySheet from "./privacy-sheet.json";

/**
 * Canonical placeholder clinic.
 *
 * Doubles as:
 *   1. Template seed for new onboardings (`cp -r clinics/_template clinics/<slug>`)
 *   2. Live demo at `_template.clinic-landing.vercel.app/<treatment>`
 *   3. CI sanity: validates the schema end-to-end on every build
 *
 * Every patient-facing string here is a tokenized placeholder — never go live
 * with this data. The `[Praxis-Name]`-style tokens are deliberate so a
 * partially-filled clinic config is obvious at a glance during preview.
 */
export const templateClinic: Clinic = {
  slug: "_template",
  // Real clinics: set to the UUID of the matching portal `clinics` row.
  // Empty string disables the portal mirror — leaving the template as-is
  // means the demo LP doesn't try to talk to the portal.
  portalClinicId: "c7d88b71-72da-4920-b939-5158b13d3449",
  // Real clinics: set to the env var name holding the per-clinic HMAC secret,
  // e.g. "PORTAL_INTAKE_SECRET_PRAXIS_MUELLER_MUENCHEN". Same plaintext lives
  // encrypted in the portal's `platform_credentials` row with platform='intake'.
  portalIntakeSecretEnv: "PORTAL_INTAKE_SECRET_TEMPLATE",
  domains: [], // Template never receives a custom domain.
  name: "[Praxis-Name]",
  logo: "/clinics/_template/logo.svg",
  logoAlt: "[Praxis-Name] Logo",

  // Warm-neutral premium palette (v2 design system): paper surfaces, deep
  // forest primary, bronze accent. Per-clinic overrides welcome — but stay
  // in warm-neutral territory; clinical white + stock blue reads "Kette".
  brand: {
    primary: "#2e453e",
    primarySoft: "#dde5e0",
    accent: "#a9865b",
    bg: "#fbf9f5",
    bgSoft: "#f2ede5",
    fg: "#1d1a16",
    fgMuted: "#6e655a",
    border: "#e5ded2",
    radius: "soft",
    fontFamily: "Hanken Grotesk",
    fontFamilyDisplay: "Fraunces",
    fonts: [
      {
        family: "Hanken Grotesk",
        filename: "HankenGrotesk-400.woff2",
        weight: 400,
        display: "swap",
      },
      {
        family: "Hanken Grotesk",
        filename: "HankenGrotesk-500.woff2",
        weight: 500,
        display: "swap",
      },
      {
        family: "Hanken Grotesk",
        filename: "HankenGrotesk-600.woff2",
        weight: 600,
        display: "swap",
      },
      {
        family: "Fraunces",
        filename: "Fraunces-500.woff2",
        weight: 500,
        display: "swap",
      },
      {
        family: "Fraunces",
        filename: "Fraunces-600.woff2",
        weight: 600,
        display: "swap",
      },
    ],
  },

  doctor: {
    name: "[Dr. med. Vorname Nachname]",
    facharzt: "[Fachärztin/Facharzt für Plastische und Ästhetische Chirurgie]",
    cv: [
      "Studium der Humanmedizin an der [Universität]",
      "Facharztweiterbildung an [Klinik / Lehrkrankenhaus]",
      "Eigene Praxis seit [Jahr]",
      "Schwerpunkt: [z.B. Gesicht, minimalinvasive Verfahren]",
      "Über [N] dokumentierte Behandlungen seit [Jahr]",
    ],
    memberships: [
      "[Mitgliedschaft 1, z.B. DGÄPC]",
      "[Mitgliedschaft 2, z.B. VDÄPC]",
    ],
    quote:
      "Ich behandle nur, was zu Ihrem Gesicht passt. Manchmal ist die ehrlichste Empfehlung, weniger zu machen.",
    portrait: "/clinics/_template/doctor-portrait.svg",
    portraitAlt: "Portrait von [Dr. med. Vorname Nachname]",
  },

  trust: {
    // Placeholder numbers for the demo preview — replace with the real
    // Google rating before go-live (the validator can't know your stars).
    google: { score: 4.9, count: 120 },
    practiceSince: 2014,
    treatmentVolume: { count: 4500, asOfYear: 2025 },
    press: [],
  },

  // Betreuungs-Zitate, keine Ergebnisversprechen (§ 11 Nr. 11 HWG).
  // source + consentedAt machen sie überprüfbar statt dekorativ.
  testimonials: [
    {
      name: "Anna K.",
      city: "[Stadt]",
      age: 42,
      quote:
        "Die Beratung war ehrlich und nicht aufdringlich. Mir wurde sogar von einer Behandlung abgeraten, die ich mir überlegt hatte. So etwas schafft Vertrauen.",
      source: "google",
      consentedAt: "2025-09-14",
    },
    {
      name: "Sabine L.",
      city: "[Stadt]",
      age: 51,
      quote:
        "Klare Aufklärung, realistische Erwartungen, und nach der Behandlung war die Praxis jederzeit erreichbar. Ich habe mich zu keinem Zeitpunkt als Nummer gefühlt.",
      source: "google",
      consentedAt: "2025-11-02",
    },
    {
      name: "Maria T.",
      city: "[Stadt]",
      age: 38,
      quote:
        "Vor dem Termin hatte ich viele Fragen und ehrlich gesagt auch Bedenken. Alles wurde in Ruhe beantwortet, nichts wurde beschönigt. Der Verlauf war genau wie besprochen.",
      source: "praxis",
      consentedAt: "2026-01-20",
    },
  ],

  legal: {
    berufsbezeichnung: "[Ärztin / Arzt: Bezeichnung exakt wie verliehen]",
    verleihungsstaat: "Bundesrepublik Deutschland",
    kammer: {
      name: "[Zuständige Landesärztekammer]",
      address: "[Anschrift der Landesärztekammer]",
      url: "https://example.com/landesaerztekammer",
    },
    berufsordnungUrl: "https://example.com/berufsordnung",
    heilberufekammergesetzUrl: "https://example.com/heilberufekammergesetz",
    ustId: "[USt-IdNr falls vorhanden, sonst diesen Eintrag entfernen]",
    berufshaftpflicht: {
      versicherer: "[Berufshaftpflicht-Versicherer]",
      adresse: "[Anschrift des Versicherers]",
      geltungsbereich: "Bundesrepublik Deutschland und international (auf Anfrage)",
    },
  },

  address: {
    street: "[Straße und Hausnummer]",
    zip: "00000",
    city: "[Stadt]",
    country: "DE",
  },

  contact: {
    phoneE164: "+49000000000",
    phoneDisplay: "+49 000 0000000",
    whatsappE164: "49000000000",
    email: "info@example.com",
    // Real clinics: set to the Cal.com / Doctolib / etc. embed URL to surface a
    // booking iframe on the confirmation screen. Leave undefined to omit the
    // iframe — better than shipping a placeholder that renders a vendor 404.
    bookingUrl: undefined,
  },

  practiceImages: [
    { src: "/clinics/_template/praxis-empfang.svg", alt: "Empfangsbereich der Praxis" },
    { src: "/clinics/_template/praxis-behandlungsraum.svg", alt: "Behandlungsraum" },
    { src: "/clinics/_template/praxis-wartebereich.svg", alt: "Wartebereich" },
  ],

  // Nur so eng versprechen, wie die Praxis es im Alltag wirklich hält —
  // die schnelle Reaktion selbst (5-Minuten-Ideal) ist ein Ops-Thema.
  responsePromise: "innerhalb eines Werktags",

  connectors: {
    // Webhook URL is best supplied via env var LEAD_WEBHOOK_URL_<SLUG> in production.
    webhookUrl: undefined,
    metaPixelId: undefined,
    googleAdsId: undefined,
    googleAdsConversionLabel: undefined,
    tiktokPixelId: undefined,
  },

  privacySheet,
};
