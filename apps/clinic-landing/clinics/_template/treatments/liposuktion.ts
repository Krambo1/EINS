import type { Treatment } from "@/lib/types";

export const templateLiposuktion: Treatment = {
  slug: "liposuktion-stadt",
  clinicSlug: "_template",
  category: "liposuktion",
  city: "[Stadt]",

  h1: "Fettabsaugung (Liposuktion) in [Stadt]",
  subline:
    "Für hartnäckige Fettpolster, die Training und Ernährung nicht erreichen. Ehrliche Einschätzung von [Dr. med. Vorname Nachname], wofür eine Liposuktion geeignet ist und wofür nicht.",

  heroImage: {
    src: "/clinics/_template/hero-liposuktion.svg",
    alt: "Beratungsraum für die Liposuktion",
  },

  trustMicrocopy: "Eingehende Voruntersuchung · Persönliche Begleitung der Heilung",

  problem: {
    paragraphs: [
      "Sie trainieren regelmäßig und achten auf Ihre Ernährung, aber bestimmte Polster am Bauch, an den Hüften oder am Kinn bleiben, egal was Sie tun. Das ist keine Frage der Disziplin, sondern der Veranlagung.",
      "Sie suchen eine Praxis, die ehrlich einordnet, was eine Liposuktion leisten kann und was nicht, und die nicht jede OP empfiehlt, nur weil sie machbar ist.",
    ],
  },

  explainer: {
    indication:
      "Die Liposuktion eignet sich zur Konturierung einzelner, klar abgegrenzter Fettdepots, die auf Training und Ernährung nicht ansprechen. Sie ist keine Methode zur Gewichtsreduktion. Ob Ihr Befund geeignet ist, prüfen wir in Ruhe gemeinsam.",
    process:
      "Der Eingriff erfolgt je nach Umfang in Tumeszenz-Lokalanästhesie oder Vollnarkose. Über wenige Millimeter kleine Zugänge wird das Fettgewebe mit feinen Kanülen entfernt. Die OP dauert 1 bis 3 Stunden.",
    recovery:
      "Kompressionswäsche wird etwa 4 bis 6 Wochen getragen. Schwellungen und Blutergüsse sind in den ersten Wochen normal. Sport ist je nach Befund nach 4 bis 6 Wochen wieder möglich.",
    duration:
      "Entfernte Fettzellen bilden sich nicht neu; das Ergebnis ist bei stabilem Gewicht dauerhaft. Bei deutlicher Gewichtszunahme kann das verbliebene Gewebe weiterhin Fett einlagern.",
    sideEffects:
      "Möglich: Schwellungen, Hämatome, Sensibilitätsstörungen, Konturunregelmäßigkeiten, selten Infektionen oder Wundheilungsstörungen. Die vollständige Aufklärung erfolgt im persönlichen Gespräch.",
    riskNotice:
      "Pflichtangabe HWG: Die Liposuktion ist eine Operation. Sämtliche Risiken, auch seltene, werden im persönlichen Aufklärungsgespräch erläutert. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "bauch", label: "Bauch", hint: "Ober- und Unterbauch" },
      { id: "huefte", label: "Hüfte / Reiterhosen", hint: "Außenseite Oberschenkel" },
      { id: "innenseite", label: "Innenseite Oberschenkel", hint: "Konturierung" },
      { id: "kinn", label: "Kinn / Hals", hint: "Doppelkinn" },
      { id: "arme", label: "Oberarme", hint: "Konturierung" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
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
          "Wir untersuchen die betroffenen Bereiche, prüfen Haut und Gewebe und sagen Ihnen ehrlich, ob eine Liposuktion Ihr Anliegen löst, oder ob sie es nicht tut.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und OP liegt eine gesetzliche Bedenkzeit. Sie entscheiden ohne Druck, gerne mit einem zweiten Termin für offene Fragen.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Je nach Umfang in Lokalanästhesie oder Vollnarkose, Dauer 1 bis 3 Stunden. Die Zugänge sind wenige Millimeter klein.",
      },
      {
        index: 4,
        title: "Nachsorge & Kontrollen",
        body:
          "Kompressionswäsche für 4 bis 6 Wochen, regelmäßige Kontrollen. Das endgültige Ergebnis zeigt sich nach 3 bis 6 Monaten.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: die Abnehm-Ehrlichkeit zuerst (falsche
  // Erwartung = unzufriedene Patientin), dann Schmerz, Dellen, Kompression, Kosten.
  faq: [
    {
      q: "Ist eine Fettabsaugung ein Ersatz fürs Abnehmen?",
      a:
        "Nein, und jede seriöse Beratung sagt Ihnen das deutlich. Die Liposuktion formt einzelne, hartnäckige Depots bei weitgehend stabilem Gewicht. Zur Gewichtsreduktion ist sie nicht geeignet; dafür besprechen wir andere Wege.",
    },
    {
      q: "Wie schmerzhaft ist der Eingriff und die Zeit danach?",
      a:
        "Während der OP spüren Sie durch die Anästhesie nichts. Danach beschreiben die meisten Patientinnen einen Muskelkater-artigen Schmerz für einige Tage, der mit üblichen Schmerzmitteln gut beherrschbar ist.",
    },
    {
      q: "Können Dellen oder Unebenheiten entstehen?",
      a:
        "Konturunregelmäßigkeiten sind ein reales Risiko dieser OP. Wir reduzieren es durch feine Kanülen, systematische Technik und realistische Mengenplanung, und besprechen es offen in der Aufklärung statt es kleinzureden.",
    },
    {
      q: "Muss ich wirklich 6 Wochen Kompressionswäsche tragen?",
      a:
        "Ja, in der Regel 4 bis 6 Wochen. Die Kompression ist entscheidend dafür, dass sich das Gewebe glatt anlegt. Moderne Wäsche ist unter Alltagskleidung nicht sichtbar.",
    },
    {
      q: "Was kostet eine Liposuktion?",
      a:
        "Je nach Anzahl der Zonen, Umfang und Anästhesie beginnt der Preis bei etwa 2.500 €. Nach der Voruntersuchung erhalten Sie ein schriftliches Angebot für Ihren konkreten Befund.",
    },
    {
      q: "Wann sehe ich das endgültige Ergebnis?",
      a:
        "Erste Veränderungen sehen Sie nach dem Abklingen der Schwellung, das endgültige Ergebnis nach 3 bis 6 Monaten, wenn sich das Gewebe vollständig angelegt hat.",
    },
    {
      q: "Wann ist von einer Liposuktion abzuraten?",
      a:
        "Bei starkem Übergewicht, ausgeprägter Hauterschlaffung, bestimmten Vorerkrankungen oder unrealistischen Erwartungen. Genau dafür ist die Voruntersuchung da.",
    },
  ],

  priceRange: { fromCents: 250000, toCents: 750000, currency: "EUR" },

  cost: {
    drivers: [
      "Anzahl und Größe der Zonen",
      "Art der Anästhesie",
      "Kompressionswäsche und Nachsorge",
    ],
    financingNote: "Eine Zahlung in Raten ist auf Anfrage möglich.",
  },

  finalCtaPromise:
    "Sie erfahren in der Beratung ehrlich, ob Ihr Befund geeignet ist, und was realistisch erreichbar ist.",

  seo: {
    metaTitle: "Fettabsaugung in [Stadt] – Liposuktion bei [Praxis-Name]",
    metaDescription:
      "Liposuktion in [Stadt]: Bauch, Hüfte, Kinn, Oberschenkel. Ehrliche Voruntersuchung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, persönliche Nachsorge.",
  },
};
