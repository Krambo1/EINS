import type { Clinic } from "@/lib/types";

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
  domains: [], // Template never receives a custom domain.
  name: "[Praxis-Name]",
  logo: "/clinics/_template/logo.svg",
  logoAlt: "[Praxis-Name] Logo",

  brand: {
    primary: "#1e3a5f",
    primarySoft: "#cfd9e6",
    accent: "#c9a96e",
    bg: "#ffffff",
    bgSoft: "#f7f7f9",
    fg: "#15151b",
    fgMuted: "#555560",
    border: "#e6e6ea",
    radius: "soft",
    fontFamily: "Inter",
    fonts: [
      {
        family: "Inter",
        filename: "Inter-Regular.woff2",
        weight: 400,
        display: "swap",
      },
      {
        family: "Inter",
        filename: "Inter-Medium.woff2",
        weight: 500,
        display: "swap",
      },
      {
        family: "Inter",
        filename: "Inter-SemiBold.woff2",
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
      "[Mitgliedschaft 1 — z.B. DGÄPC]",
      "[Mitgliedschaft 2 — z.B. VDÄPC]",
    ],
    portrait: "/clinics/_template/doctor-portrait.svg",
    portraitAlt: "Portrait von [Dr. med. Vorname Nachname]",
  },

  trust: {
    google: { score: 4.9, count: 0 },
    practiceSince: 2014,
    treatmentVolume: { count: 0, asOfYear: 2024 },
    press: [],
  },

  testimonials: [
    {
      name: "Anna K.",
      city: "[Stadt]",
      age: 42,
      quote:
        "Die Beratung war ehrlich und nicht aufdringlich. Ich habe mich gut aufgehoben gefühlt und das Ergebnis sieht natürlich aus.",
    },
    {
      name: "Sabine L.",
      city: "[Stadt]",
      age: 51,
      quote:
        "Klare Aufklärung über den Eingriff, realistische Erwartungen, freundliches Team. Ich würde wieder hierher gehen.",
    },
    {
      name: "Maria T.",
      city: "[Stadt]",
      age: 38,
      quote:
        "Vor dem Termin hatte ich viele Fragen. Sie wurden alle beantwortet. Der Heilungsverlauf war wie besprochen.",
    },
  ],

  legal: {
    berufsbezeichnung: "[Ärztin / Arzt — Bezeichnung exakt wie verliehen]",
    verleihungsstaat: "Bundesrepublik Deutschland",
    kammer: {
      name: "[Zuständige Landesärztekammer]",
      address: "[Anschrift der Landesärztekammer]",
      url: "https://example.com/landesaerztekammer",
    },
    berufsordnungUrl: "https://example.com/berufsordnung",
    heilberufekammergesetzUrl: "https://example.com/heilberufekammergesetz",
    ustId: "[USt-IdNr falls vorhanden — sonst diesen Eintrag entfernen]",
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
    bookingUrl: "https://cal.com/example/beratung",
  },

  practiceImages: [
    { src: "/clinics/_template/praxis-empfang.svg", alt: "Empfangsbereich der Praxis" },
    { src: "/clinics/_template/praxis-behandlungsraum.svg", alt: "Behandlungsraum" },
    { src: "/clinics/_template/praxis-wartebereich.svg", alt: "Wartebereich" },
  ],

  connectors: {
    // Webhook URL is best supplied via env var LEAD_WEBHOOK_URL_<SLUG> in production.
    webhookUrl: undefined,
    metaPixelId: undefined,
    googleAdsId: undefined,
    googleAdsConversionLabel: undefined,
    tiktokPixelId: undefined,
  },

  datenschutzMarkdown: `## Datenschutzerklärung

Diese Datenschutzerklärung beschreibt, wie [Praxis-Name] personenbezogene Daten verarbeitet, die im Zusammenhang mit dem Besuch dieser Website oder der Anfrage einer Behandlung erhoben werden.

## 1. Verantwortlicher

[Praxis-Name]
[Straße und Hausnummer]
[PLZ Stadt]

E-Mail: info@example.com
Telefon: +49 000 0000000

## 2. Welche Daten erhoben werden

Beim Aufruf dieser Website werden technisch notwendige Daten verarbeitet (IP-Adresse, User-Agent, Zeitstempel). Die IP-Adresse wird vor jeder Speicherung anonymisiert (das letzte Oktett wird auf 0 gesetzt).

Wenn Sie das Anfrage-Formular ausfüllen, übermitteln Sie freiwillig: Vorname, E-Mail-Adresse, Telefonnummer (optional), Stadt sowie Ihre Antworten auf die Vorqualifizierungs-Fragen.

## 3. Zwecke und Rechtsgrundlagen

- **Beantwortung Ihrer Anfrage** — Art. 6 Abs. 1 lit. b DSGVO (Vertragsanbahnung).
- **Reichweitenmessung (nur mit Einwilligung)** — Art. 6 Abs. 1 lit. a DSGVO i.V.m. § 25 Abs. 1 TDDDG.
- **Werbenetzwerk-Pixel und Conversions API (nur mit Einwilligung)** — Art. 6 Abs. 1 lit. a DSGVO i.V.m. § 25 Abs. 1 TDDDG.

Sie können Ihre Einwilligung jederzeit über die Cookie-Einstellungen widerrufen. Die Rechtmäßigkeit der bis zum Widerruf erfolgten Verarbeitung bleibt unberührt.

## 4. Empfänger und Drittlandtransfer

Bei aktivem Marketing-Consent werden über den Meta-Pixel und die Meta Conversions API gehashte personenbezogene Daten an Meta Platforms Ireland Ltd. übermittelt. Eine Übermittlung in die USA findet auf Grundlage des EU-US Data Privacy Framework und der EU-Standardvertragsklauseln statt.

## 5. Speicherdauer

Anfragedaten werden bis zur abschließenden Bearbeitung Ihrer Anfrage gespeichert und danach gemäß den gesetzlichen Aufbewahrungspflichten gelöscht oder eingeschränkt verarbeitet.

## 6. Ihre Rechte

Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch. Sie haben außerdem das Recht, sich bei der zuständigen Aufsichtsbehörde zu beschweren.

## 7. Hosting

Diese Website wird in einem Rechenzentrum innerhalb der Europäischen Union gehostet (Frankfurt/Main, Vercel Inc., bzw. EU-Region des Hosting-Providers).

> **Hinweis für den Mandanten**: Diese Datenschutzerklärung ist eine Vorlage. Vor Go-Live ist eine anwaltliche Sichtprüfung unter Berücksichtigung Ihrer konkreten Praxis-Konfiguration zwingend erforderlich.`,
};
