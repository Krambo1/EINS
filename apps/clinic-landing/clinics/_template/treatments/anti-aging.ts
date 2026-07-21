import type { Treatment } from "@/lib/types";

export const templateAntiAging: Treatment = {
  slug: "anti-aging-stadt",
  clinicSlug: "_template",
  category: "anti-aging",
  city: "[Stadt]",

  h1: "Anti-Aging-Behandlungsplan in [Stadt]",
  subline:
    "Kein Einzeleingriff, sondern ein abgestimmter Plan für Hautqualität, Volumen und Konturen. Entwickelt und begleitet von [Dr. med. Vorname Nachname].",

  heroImage: {
    src: "/clinics/_template/hero-anti-aging.svg",
    alt: "Beratungsraum für einen Anti-Aging-Behandlungsplan",
  },

  trustMicrocopy: "Individueller Behandlungsplan · Aufklärung statt Verkauf",

  problem: {
    paragraphs: [
      "Die Haut zeigt an mehreren Stellen Veränderungen: feine Linien, weniger Spannkraft, ein müderes Gesamtbild. Eine einzelne Behandlung würde daran wenig ändern, das spüren Sie selbst.",
      "Sie suchen keine Sammlung von Einzelterminen, sondern eine Ärztin, die das Gesicht als Ganzes betrachtet, einen Plan entwickelt und Sie über Monate begleitet.",
    ],
  },

  explainer: {
    indication:
      "Der Plan kombiniert aufeinander abgestimmte Module: die Behandlung mimischer Linien, Volumenaufbau mit Hyaluronsäure, Microneedling oder energiebasierte Verfahren für die Hautqualität sowie medizinische Hautpflege. Welche Module für Sie sinnvoll sind, ergibt die Analyse.",
    process:
      "Im ersten Termin analysieren wir Hautqualität, Volumen, Mimik und Konturen und erstellen gemeinsam einen Plan. Die Behandlungen verteilen sich über Wochen bis Monate und werden laufend angepasst.",
    recovery:
      "Je nach Modul unterschiedlich: Injektionen erlauben meist die sofortige Rückkehr in den Alltag, energiebasierte Verfahren oder Peelings können 1 bis 3 Tage sichtbare Rötung bedeuten.",
    duration:
      "Die Wirkdauer variiert je Modul zwischen etwa 3 Monaten (mimische Behandlungen) und 9 bis 18 Monaten (Volumenaufbau). Der Plan ist auf Kontinuität angelegt, wie eine medizinische Hautpflege auf höherem Niveau.",
    sideEffects:
      "Modulabhängig: bei Injektionen Schwellungen und Hämatome, bei energiebasierten Verfahren und Peelings vorübergehende Rötung. Vor jeder Einzelbehandlung klären wir die jeweiligen Risiken auf.",
    riskNotice:
      "Pflichtangabe HWG: Jedes Modul des Behandlungsplans ist eine eigenständige medizinische Maßnahme mit individuellen Risiken. Vor jeder Einzelbehandlung erfolgt eine eigene Aufklärung. Bitte lesen Sie die jeweiligen Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "haut", label: "Hautqualität verbessern", hint: "Tonus, Textur, Poren" },
      { id: "volumen", label: "Volumen wiederherstellen", hint: "Wangen, Mund-Region" },
      { id: "linien", label: "Mimische Linien glätten", hint: "Stirn, Augen" },
      { id: "konturen", label: "Konturen schärfen", hint: "Kiefer, Kinn" },
      { id: "rundum", label: "Gesamtes Gesicht", hint: "Mehrere Module" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Gespräch" },
    ],
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Analyse & Behandlungsplan",
        body:
          "60 Minuten Analyse von Hautqualität, Volumen, Mimik und Konturen. Sie erhalten einen Plan mit transparenten Einzel- und Gesamtpreisen.",
      },
      {
        index: 2,
        title: "Behandlungen nach Plan",
        body:
          "Die Module werden über Wochen bis Monate durchgeführt und nach Wirkung angepasst. Sie sehen die Entwicklung Schritt für Schritt.",
      },
      {
        index: 3,
        title: "Langfristige Begleitung",
        body:
          "Wir begleiten Sie über die Zeit, passen den Plan an Ihre Haut und Ihr Alter an und sagen ehrlich, wann weniger mehr ist.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Natürlichkeit zuerst, dann Aufwand/Terminanzahl,
  // sichtbarer Effekt, Kosten, Flexibilität, Module.
  faq: [
    {
      q: "Sieht man mir die Behandlungen an?",
      a:
        "Das Gegenteil ist das Ziel: ein gepflegtes, frisches Gesamtbild, das niemand einer Behandlung zuordnen kann. Der Plan arbeitet mit vielen kleinen, zurückhaltenden Schritten statt einer großen Veränderung.",
    },
    {
      q: "Wie viele Termine kommen auf mich zu?",
      a:
        "Je nach Modul-Auswahl und Ziel meist 3 bis 8 Termine über 6 bis 18 Monate. Die genaue Frequenz steht in Ihrem Behandlungsplan, den Sie nach dem ersten Termin schriftlich erhalten.",
    },
    {
      q: "Sehe ich nach dem ersten Termin schon einen Effekt?",
      a:
        "Je nach Modul ja. Die eigentliche Stärke des Plans baut sich aber über mehrere Behandlungen auf, das ist der Unterschied zu einer Einzelbehandlung.",
    },
    {
      q: "Was kostet ein Behandlungsplan?",
      a:
        "Die Module beginnen bei etwa 800 €. Der Gesamtrahmen hängt von Auswahl und Frequenz ab und steht transparent im Plan, bevor Sie sich für irgendetwas entscheiden.",
    },
    {
      q: "Kann ich Module weglassen oder pausieren?",
      a:
        "Ja, der Plan ist modular und gehört Ihnen. Wir priorisieren gemeinsam, was für Ihr Anliegen den größten Unterschied macht, und was optional bleibt.",
    },
    {
      q: "Welche Module gibt es?",
      a:
        "Häufig kombiniert werden: die Behandlung mimischer Linien, Volumenaufbau mit Hyaluronsäure, Microneedling, energiebasierte Hautverbesserung und medizinische Hautpflege. Welche zu Ihnen passen, ergibt die Analyse.",
    },
  ],

  priceRange: { fromCents: 80000, currency: "EUR" },

  cost: {
    drivers: [
      "Anzahl und Art der Module",
      "Behandlungsfrequenz",
      "Präparate und Verfahren",
    ],
  },

  finalCtaPromise:
    "Sie verlassen die Analyse mit einem konkreten Plan: verständlich, transparent, ohne Verkaufsdruck.",

  seo: {
    metaTitle: "Anti-Aging-Behandlungsplan in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Abgestimmter Anti-Aging-Plan in [Stadt]: Hautqualität, Volumen, Mimik, Konturen. Analyse und Begleitung durch [Dr. med. Vorname Nachname], transparente Preise.",
  },
};
