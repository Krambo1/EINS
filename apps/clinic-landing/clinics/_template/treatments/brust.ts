import type { Treatment } from "@/lib/types";

export const templateBrust: Treatment = {
  slug: "brustvergroesserung-stadt",
  clinicSlug: "_template",
  category: "brust",
  city: "[Stadt]",

  h1: "Brustvergrößerung in [Stadt]",
  subline:
    "Mit Implantat oder Eigenfett, geplant für ein Ergebnis, das zu Ihrem Körper passt. Beratung, OP und jede Nachsorge bei [Dr. med. Vorname Nachname].",

  heroImage: {
    src: "/clinics/_template/hero-brust.svg",
    alt: "Beratungsraum für Brustchirurgie",
  },

  trustMicrocopy: "Eingehende Beratung · Gesetzliche Bedenkzeit · Nachsorge in einer Hand",

  problem: {
    paragraphs: [
      "Der Gedanke begleitet Sie schon lange, vielleicht seit Jahren: nach zwei Schwangerschaften, nach einer Gewichtsabnahme, oder einfach, weil Sie sich in Ihrem Körper nicht ganz zu Hause fühlen.",
      "Gleichzeitig haben Sie berechtigte Fragen: Wie sicher sind Implantate? Wer betreut mich, wenn Monate später etwas ist? Genau diese Fragen gehören ausführlich beantwortet, bevor irgendetwas entschieden wird.",
    ],
  },

  explainer: {
    indication:
      "Eine Brustvergrößerung kommt mit Implantaten oder mit Eigenfett in Frage; auch eine Straffung mit oder ohne Volumenaufbau kann je nach Ausgangslage das passendere Verfahren sein. Welche Methode zu Ihrem Körper und Ihrem Wunsch passt, klären wir in der Beratung.",
    process:
      "Der Eingriff erfolgt in Vollnarkose und dauert je nach Verfahren 1,5 bis 3,5 Stunden. Je nach Befund und Methode bleiben Sie eine Nacht zur Überwachung.",
    recovery:
      "Ein Stütz-BH wird etwa 6 Wochen Tag und Nacht getragen. Spannungsgefühl und Schwellungen sind die ersten Wochen üblich. Sport ist je nach Befund nach 6 bis 8 Wochen wieder möglich.",
    duration:
      "Das Ergebnis hält in der Regel viele Jahre. Moderne Implantate haben kein pauschales Ablaufdatum; regelmäßige Kontrollen sind Teil der Nachsorge.",
    sideEffects:
      "Möglich: Schwellungen, Hämatome, Sensibilitätsstörungen, Narbenbildung, Asymmetrien, Kapselfibrose bei Implantaten, Wundheilungsstörungen. Die vollständige Aufklärung erfolgt im persönlichen Gespräch.",
    riskNotice:
      "Pflichtangabe HWG: Brustchirurgische Eingriffe sind Operationen. Sämtliche Risiken, einschließlich seltener Komplikationen, werden im persönlichen Aufklärungsgespräch ausführlich erläutert. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit.",
  },

  quiz: {
    treatmentOptions: [
      { id: "vergroesserung", label: "Brustvergrößerung", hint: "Implantat oder Eigenfett" },
      { id: "straffung", label: "Bruststraffung", hint: "Nach Schwangerschaft, Gewichtsabnahme" },
      { id: "verkleinerung", label: "Brustverkleinerung", hint: "Bei Beschwerden" },
      { id: "wechsel", label: "Implantatwechsel", hint: "Bestehendes Implantat" },
      { id: "asymmetrie", label: "Asymmetrie-Korrektur", hint: "Ausgleich" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Gespräch" },
    ],
    askBudget: true,
    askDistance: true,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & Voruntersuchung",
        body:
          "60 bis 90 Minuten Gespräch und Untersuchung. Wir besprechen Verfahren, Implantatwahl oder Eigenfett, Risiken und das für Ihren Körper realistische Ergebnis.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und Operation liegt eine gesetzliche Bedenkzeit. Offene Fragen klären wir gerne in einem zweiten Termin.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "In Vollnarkose, je nach Verfahren 1,5 bis 3,5 Stunden. Je nach Befund bleiben Sie eine Nacht zur Überwachung.",
      },
      {
        index: 4,
        title: "Nachsorge & Heilungsverlauf",
        body:
          "Stütz-BH für 6 Wochen, Kontrollen über mehrere Monate, immer bei derselben Ärztin. Das endgültige Ergebnis zeigt sich nach 6 bis 12 Monaten.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Implantat-Sicherheit zuerst, dann
  // Natürlichkeit, Stillfähigkeit, Kosten, Nachsorge-Kontinuität.
  faq: [
    {
      q: "Wie sicher sind Brustimplantate heute?",
      a:
        "Wir verwenden ausschließlich Implantate etablierter Hersteller mit dokumentierter Qualität und lückenloser Chargen-Registrierung. Zusätzlich können Sie eine Folgekostenversicherung abschließen, die im Komplikationsfall greift. Beides zeigen wir Ihnen im Gespräch im Detail.",
    },
    {
      q: "Sieht das Ergebnis natürlich aus?",
      a:
        "Form, Größe und Profil werden an Ihrem Körperbau geplant, nicht an einem Katalogbild. Das Ziel ist eine Brust, die in Proportion und Bewegung zu Ihnen passt. Was das für Sie konkret bedeutet, zeigen wir Ihnen in der Beratung an Beispielen.",
    },
    {
      q: "Kann ich nach der OP noch stillen?",
      a:
        "Bei den meisten Verfahren bleibt die Stillfähigkeit erhalten, eine Garantie dafür kann seriös niemand geben. Wenn Familienplanung für Sie ein Thema ist, fließt das in die Wahl von Zugang und Implantatlage ein.",
    },
    {
      q: "Was kostet eine Brustvergrößerung?",
      a:
        "Je nach Verfahren, Implantat und Klinikaufenthalt beginnt der Preis bei etwa 5.500 € und kann je nach Umfang höher liegen. Nach der Beratung erhalten Sie ein schriftliches Festangebot ohne versteckte Positionen.",
    },
    {
      q: "Wer betreut mich nach der OP?",
      a:
        "Dieselbe Ärztin, die Sie berät und operiert. Alle Kontrollen laufen in der Praxis, und auch Monate später erreichen Sie uns direkt, nicht über eine Hotline.",
    },
    {
      q: "Wie lange bin ich krankgeschrieben?",
      a:
        "In der Regel 1 bis 2 Wochen, abhängig von Ihrem Beruf. Körperlich schwere Arbeit braucht länger Pause; das planen wir vor der OP gemeinsam.",
    },
    {
      q: "Übernimmt die Krankenkasse die Kosten?",
      a:
        "Bei rein ästhetischer Indikation nein. Bei medizinischer Indikation, etwa einer Brustverkleinerung wegen nachgewiesener Beschwerden, ist eine Beteiligung nach Begutachtung möglich. Wir ordnen Ihren Fall ehrlich ein.",
    },
  ],

  priceRange: { fromCents: 550000, toCents: 1290000, currency: "EUR" },

  cost: {
    drivers: [
      "Verfahren: Implantat oder Eigenfett",
      "Implantat-Typ und Hersteller",
      "Anästhesie und Klinikaufenthalt",
      "Folgekostenversicherung",
    ],
    financingNote: "Eine Zahlung in Raten ist auf Anfrage möglich.",
  },

  finalCtaPromise:
    "Sie verlassen die Beratung mit Klarheit über Verfahren, Risiken und Ihren persönlichen Weg.",

  seo: {
    metaTitle: "Brustvergrößerung in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Brustvergrößerung in [Stadt] mit Implantat oder Eigenfett. Eingehende Beratung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, Nachsorge in einer Hand.",
  },
};
