import type { Treatment } from "@/lib/types";

export const templateAntiAging: Treatment = {
  slug: "anti-aging-stadt",
  clinicSlug: "_template",
  category: "anti-aging",
  city: "[Stadt]",

  h1: "Anti-Aging-Programm in [Stadt]",
  subline:
    "Ein individueller Behandlungsplan aus Hautverbesserung, Volumen und Konturierung — abgestimmt von [Dr. med. Vorname Nachname].",

  heroImage: {
    src: "/clinics/_template/hero-anti-aging.svg",
    alt: "Beratungsraum für ein Anti-Aging-Programm",
  },

  trustMicrocopy: "Individueller Behandlungsplan · Aufklärung statt Verkauf",

  problem: {
    paragraphs: [
      "Sie merken, dass die Haut an mehreren Stellen Veränderungen zeigt — feine Linien, Volumenverlust, ein veränderter Hauttonus. Sie suchen nicht nach einer einzelnen Behandlung, sondern nach einer durchdachten Gesamtstrategie.",
      "Sie wünschen sich eine Praxis, die das Gesicht als Ganzes betrachtet, mehrere Verfahren sinnvoll kombiniert und Sie über mehrere Termine begleitet.",
    ],
  },

  explainer: {
    indication:
      "Das Programm besteht aus aufeinander abgestimmten Modulen — z.B. Botulinumtoxin für mimische Linien, Filler für Volumen und Konturen, energiebasierte Verfahren oder Microneedling für die Hautqualität. Welche Module sinnvoll sind, prüfen wir individuell.",
    process:
      "Im ersten Schritt erstellen wir gemeinsam einen Behandlungsplan über mehrere Termine. Die einzelnen Behandlungen werden über Wochen bis Monate verteilt und nach Bedarf angepasst.",
    recovery:
      "Die Erholungszeiten variieren je nach Modul. Injektionen erlauben in der Regel die sofortige Rückkehr in den Alltag; energiebasierte Verfahren oder Peelings können kurze Ausfallzeiten haben.",
    duration:
      "Die Wirkung der einzelnen Module variiert (Botulinumtoxin: 3–4 Monate, Filler: 9–18 Monate, energiebasierte Verfahren: 6–12 Monate). Das Programm wird langfristig fortgeführt — wie eine medizinische Hautpflege auf höherem Niveau.",
    sideEffects:
      "Modulabhängig: bei Injektionen Schwellungen, Hämatome; bei Lasern und Peelings vorübergehende Rötung. Die Risiken jedes einzelnen Verfahrens werden vor der jeweiligen Behandlung detailliert besprochen.",
    riskNotice:
      "Pflichtangabe HWG: Jedes Modul des Programms ist eine eigenständige medizinische Maßnahme mit individuellen Risiken. Vor jeder Einzelbehandlung erfolgt eine eigene Aufklärung. Bitte lesen Sie die jeweiligen Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "haut", label: "Hautqualität verbessern", hint: "Tonus, Textur, Poren" },
      { id: "volumen", label: "Volumen wiederherstellen", hint: "Wangen, Mund-Region" },
      { id: "linien", label: "Mimische Linien glätten", hint: "Stirn, Augen" },
      { id: "konturen", label: "Konturen schärfen", hint: "Kiefer, Kinn" },
      { id: "rundum", label: "Rundum-Programm", hint: "Mehrere Module" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Beratungsgespräch" },
    ],
    locationLabel: "Wo wäre Ihr Wunsch-Termin?",
    askExperience: false,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Erstanalyse & Behandlungsplan",
        body:
          "60 Minuten ausführliche Analyse von Hautqualität, Volumen, Mimik und Konturen. Wir entwickeln gemeinsam einen Plan über mehrere Termine.",
      },
      {
        index: 2,
        title: "Modulare Behandlungen",
        body:
          "Die einzelnen Module werden über Wochen bis Monate verteilt durchgeführt und nach Wirkung individuell angepasst.",
      },
      {
        index: 3,
        title: "Langzeitbegleitung",
        body:
          "Wir begleiten Sie über die Zeit hinweg und passen das Programm Ihrem Alter und Ihrer Hautentwicklung an.",
      },
    ],
  },

  faq: [
    {
      q: "Was kostet ein Anti-Aging-Programm?",
      a:
        "Die Kosten hängen vollständig vom individuellen Behandlungsplan ab. In der Erstberatung erstellen wir einen Plan mit transparenten Einzel- und Gesamtpreisen. Die Spanne beginnt bei etwa 800 € pro Modul.",
    },
    {
      q: "Wie viele Termine sind nötig?",
      a:
        "Je nach Modul-Mix und Zielsetzung 3–8 Termine über 6–18 Monate. Die genaue Frequenz besprechen wir im Behandlungsplan.",
    },
    {
      q: "Sehe ich nach einem Termin schon einen Effekt?",
      a:
        "Ja, je nach Modul. Eine umfassende Veränderung baut sich aber über mehrere Behandlungen auf — das ist Sinn und Stärke eines Programms.",
    },
    {
      q: "Sieht das Ergebnis natürlich aus?",
      a:
        "Unser Ansatz ist bewusst zurückhaltend. Ziel ist ein gepflegtes, frisches Erscheinungsbild — nicht ein verändertes Gesicht.",
    },
    {
      q: "Kann ich einzelne Module weglassen?",
      a:
        "Ja, der Plan ist modular. Wir besprechen, welche Bestandteile für Ihr Anliegen besonders relevant sind und welche optional bleiben.",
    },
    {
      q: "Welche Module gibt es?",
      a:
        "Häufig kombiniert werden: Botulinumtoxin, Hyaluronsäure-Filler, Microneedling, energiebasierte Hautverbesserung und medizinische Hautpflege. Welche zu Ihnen passen, klären wir in der Beratung.",
    },
  ],

  priceRange: { fromCents: 80000, currency: "EUR" },

  finalCtaPromise:
    "Sie verlassen die Erstberatung mit einem konkreten Plan — verständlich, transparent, ohne Verkaufsdruck.",

  seo: {
    metaTitle: "Anti-Aging-Programm in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Modulares Anti-Aging-Programm in [Stadt]: Hautqualität, Volumen, Mimik und Konturen. Individuelle Behandlungsplanung durch [Dr. med. Vorname Nachname].",
  },
};
