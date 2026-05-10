import type { Treatment } from "@/lib/types";

export const templateBotox: Treatment = {
  slug: "botox-stadt",
  clinicSlug: "_template",
  category: "botox",
  city: "[Stadt]",

  h1: "Faltenbehandlung mit Botulinumtoxin in [Stadt]",
  subline:
    "Beratung, Aufklärung und sanfte Behandlung — durchgeführt von [Dr. med. Vorname Nachname]. Termine in der Regel innerhalb von 7 Tagen.",

  heroImage: {
    src: "/clinics/_template/hero-botox.svg",
    alt: "Praxisansicht für die Behandlung mit Botulinumtoxin",
  },

  trustMicrocopy: "Persönliche Beratung in [Stadt] · Termin in der Regel innerhalb von 7 Tagen",
  ctaLabel: "Beratungstermin vereinbaren",

  problem: {
    paragraphs: [
      "Sie sehen morgens müder aus, als Sie sich fühlen, und kleine Linien zwischen den Augenbrauen oder auf der Stirn werden von Tag zu Tag deutlicher. Sie möchten frischer wirken — aber natürlich, ohne dass es jemand auf den ersten Blick erkennt.",
      "Sie suchen eine Praxis, die ehrlich aufklärt, eine Empfehlung gibt, und das Ergebnis am Ende auch hält, was sie verspricht.",
    ],
  },

  explainer: {
    indication:
      "Behandelt werden in der Regel mimische Linien an Stirn, Glabella (Zornesfalte) und seitlich der Augen (Krähenfüße). Die Indikation prüft die behandelnde Ärztin individuell im Beratungsgespräch.",
    process:
      "Nach der Beratung werden mit einer sehr feinen Nadel kleine Mengen Botulinumtoxin in genau definierte Muskelpartien injiziert. Die Behandlung dauert in der Regel 15–20 Minuten.",
    recovery:
      "Direkt nach der Behandlung sind Sie wieder gesellschaftsfähig. Für 24 Stunden sollten Massagen, Sport und Sauna vermieden werden. Die volle Wirkung tritt nach 7–14 Tagen ein.",
    duration:
      "Die Wirkung hält in der Regel 3–4 Monate an. Erfahrungswerte zeigen, dass sich die Wirkdauer mit wiederholter Anwendung leicht verlängern kann.",
    sideEffects:
      "Häufige Nebenwirkungen: kleine Hämatome an der Einstichstelle, leichte Kopfschmerzen, vorübergehendes Spannungsgefühl. Selten: Asymmetrien oder leichte Lidsenkung, die sich in der Regel zurückbildet.",
    riskNotice:
      "Pflichtangabe HWG: Wie jede ärztliche Maßnahme bringt auch die Behandlung mit Botulinumtoxin Risiken mit sich. Mögliche Nebenwirkungen werden im persönlichen Aufklärungsgespräch detailliert besprochen. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig durch.",
  },

  quiz: {
    treatmentOptions: [
      { id: "stirn", label: "Stirnfalten", hint: "Horizontale Linien" },
      { id: "glabella", label: "Zornesfalte", hint: "Zwischen den Augenbrauen" },
      { id: "kraehenfuesse", label: "Krähenfüße", hint: "Seitlich der Augen" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Beratungsgespräch" },
    ],
    locationLabel: "Wo wäre Ihr Wunsch-Termin?",
    askExperience: false,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratungstermin",
        body:
          "30 Minuten persönliches Gespräch in der Praxis. Wir schauen uns Ihre Anliegen gemeinsam an und besprechen, ob die Behandlung für Sie geeignet ist.",
      },
      {
        index: 2,
        title: "Behandlung",
        body:
          "Die eigentliche Behandlung dauert 15–20 Minuten. Direkt im Anschluss sind Sie wieder im Alltag.",
      },
      {
        index: 3,
        title: "Nachkontrolle",
        body:
          "Nach 10–14 Tagen sehen wir uns erneut, um das Ergebnis gemeinsam zu beurteilen und ggf. fein nachzujustieren.",
      },
    ],
  },

  faq: [
    {
      q: "Wirkt die Behandlung sofort?",
      a: "Der Effekt baut sich über mehrere Tage auf und ist nach 7–14 Tagen voll ausgeprägt.",
    },
    {
      q: "Sieht man, dass ich behandelt wurde?",
      a: "Ziel der Behandlung in unserer Praxis ist ein natürliches, ausgeruhtes Erscheinungsbild. Wir dosieren bewusst zurückhaltend.",
    },
    {
      q: "Tut die Behandlung weh?",
      a: "Verwendet werden sehr feine Nadeln. Die meisten Patientinnen empfinden die Behandlung als gut auszuhalten; auf Wunsch ist eine Betäubungscreme möglich.",
    },
    {
      q: "Wie lange hält das Ergebnis?",
      a: "Im Schnitt 3–4 Monate. Mit wiederholter Behandlung verlängert sich die Wirkdauer bei vielen Patientinnen leicht.",
    },
    {
      q: "Was kostet die Behandlung?",
      a:
        "Der konkrete Preis hängt vom Bereich und der benötigten Menge ab. In der Beratung erhalten Sie ein transparentes Angebot. Die Spanne beginnt bei etwa 250 €.",
    },
    {
      q: "Wann sollte ich die Behandlung nicht durchführen lassen?",
      a:
        "In der Schwangerschaft, Stillzeit, bei bestimmten neuromuskulären Erkrankungen oder akuten Hautentzündungen. Diese Punkte werden im Aufklärungsgespräch erfragt.",
    },
    {
      q: "Wie schnell bekomme ich einen Termin?",
      a:
        "Beratungstermine sind in der Regel innerhalb einer Woche verfügbar. Behandlungstermine vereinbaren wir im Anschluss an die Beratung.",
    },
  ],

  priceRange: { fromCents: 25000, toCents: 49000, currency: "EUR" },

  finalCtaPromise:
    "Sie wissen heute, ob die Behandlung zu Ihnen passt — ohne Verpflichtung, ohne Druck.",

  seo: {
    metaTitle: "Faltenbehandlung mit Botulinumtoxin in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Sanfte Faltenbehandlung mit Botulinumtoxin in [Stadt]. Persönliche Beratung durch [Dr. med. Vorname Nachname]. Termine in der Regel innerhalb von 7 Tagen.",
  },
};
