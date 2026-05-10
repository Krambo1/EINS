import type { Treatment } from "@/lib/types";

export const templateBrust: Treatment = {
  slug: "brustchirurgie-stadt",
  clinicSlug: "_template",
  category: "brust",
  city: "[Stadt]",

  h1: "Brustchirurgie in [Stadt]",
  subline:
    "Brustvergrößerung, -verkleinerung oder -straffung — durchgeführt von [Dr. med. Vorname Nachname]. Eingehende Beratung und gesetzliche Bedenkzeit.",

  heroImage: {
    src: "/clinics/_template/hero-brust.svg",
    alt: "Beratungsraum für Brustchirurgie",
  },

  trustMicrocopy: "Eingehende Beratung · Persönliche Begleitung der Heilung",

  problem: {
    paragraphs: [
      "Sie überlegen seit langer Zeit, ob ein Eingriff an der Brust für Sie das Richtige sein könnte — sei es eine Vergrößerung, eine Verkleinerung oder eine Straffung. Sie wünschen sich eine Praxis, die Ihre Beweggründe ernst nimmt.",
      "Sie suchen ehrliche Aufklärung über Möglichkeiten, Grenzen und Risiken — ohne Verkaufsdruck und mit ausreichend Zeit für Ihre Entscheidung.",
    ],
  },

  explainer: {
    indication:
      "Bewährte Verfahren sind die Brustvergrößerung mit Implantaten oder Eigenfett, die Brustverkleinerung bei Beschwerden durch zu großes Brustgewebe und die Bruststraffung nach Schwangerschaft, Stillzeit oder starker Gewichtsabnahme. Welches Verfahren in Frage kommt, prüfen wir individuell.",
    process:
      "Brusteingriffe finden in Vollnarkose statt und dauern je nach Verfahren 1,5–3,5 Stunden. Je nach Befund und Methode wird die Brust für 1–2 Tage stationär überwacht.",
    recovery:
      "Ein Stütz-BH wird etwa 6 Wochen Tag und Nacht getragen. Schwellungen und Spannungsgefühl sind die ersten Wochen üblich. Sport ist je nach Befund nach 6–8 Wochen wieder möglich.",
    duration:
      "Das Ergebnis hält in der Regel viele Jahre. Brustimplantate werden je nach Hersteller und individueller Situation nach vielen Jahren überprüft oder gewechselt.",
    sideEffects:
      "Mögliche Nebenwirkungen: Schwellungen, Hämatome, Sensibilitätsstörungen, Narbenbildung, Asymmetrien, Kapselfibrose bei Implantaten, Wundheilungsstörungen. Die vollständige Aufklärung erfolgt im persönlichen Gespräch.",
    riskNotice:
      "Pflichtangabe HWG: Brustchirurgische Eingriffe sind Operationen. Sämtliche Risiken — einschließlich seltener Komplikationen — werden im persönlichen Aufklärungsgespräch ausführlich erläutert. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit.",
  },

  quiz: {
    treatmentOptions: [
      { id: "vergroesserung", label: "Brustvergrößerung", hint: "Implantat oder Eigenfett" },
      { id: "verkleinerung", label: "Brustverkleinerung", hint: "Bei Beschwerden" },
      { id: "straffung", label: "Bruststraffung", hint: "Nach Schwangerschaft / Gewichtsabnahme" },
      { id: "wechsel", label: "Implantatwechsel", hint: "Bestehendes Implantat" },
      { id: "asymmetrie", label: "Asymmetrie-Korrektur", hint: "Ausgleich" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Beratungsgespräch" },
    ],
    locationLabel: "Wo wäre Ihr Wunsch-Termin?",
    askExperience: true,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & Voruntersuchung",
        body:
          "60–90 Minuten Gespräch und Untersuchung. Wir prüfen die Indikation, klären über Verfahren, Risiken und mögliche Ergebnisse auf.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und Operation liegt eine gesetzliche Bedenkzeit. Sie entscheiden in Ruhe — gerne mit einem zweiten Termin für offene Fragen.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Der Eingriff erfolgt in Vollnarkose und dauert je nach Verfahren 1,5–3,5 Stunden. Die Nachsorge planen wir gemeinsam.",
      },
      {
        index: 4,
        title: "Nachsorge & Heilungsverlauf",
        body:
          "Stütz-BH, regelmäßige Kontrollen über mehrere Monate. Das endgültige Ergebnis zeigt sich nach 6–12 Monaten.",
      },
    ],
  },

  faq: [
    {
      q: "Welche Implantate werden verwendet?",
      a:
        "Wir verwenden Implantate von etablierten Herstellern mit dokumentierter Qualität. Form, Größe und Profil werden individuell auf Sie abgestimmt. Im Beratungsgespräch zeigen wir Ihnen die Optionen.",
    },
    {
      q: "Was kostet eine Brustoperation?",
      a:
        "Die Kosten hängen vom Verfahren, Implantat-Typ, Anästhesie und Klinik-Aufenthalt ab. Die Spanne beginnt bei etwa 5.500 € und kann je nach Umfang höher liegen. Sie erhalten ein konkretes Angebot.",
    },
    {
      q: "Wie lange bin ich krankgeschrieben?",
      a:
        "In der Regel 1–2 Wochen, je nach Beruf und Befund individuell länger. Die Krankschreibung besprechen wir vor der Operation.",
    },
    {
      q: "Kann ich danach noch stillen?",
      a:
        "Bei vielen Verfahren bleibt die Stillfähigkeit erhalten — eine Garantie kann jedoch niemand geben. Wir klären Sie individuell auf, falls dies für Sie relevant ist.",
    },
    {
      q: "Übernimmt die Krankenkasse die Kosten?",
      a:
        "Nur bei medizinischer Indikation (z.B. Brustverkleinerung bei nachgewiesenen Beschwerden) und nach individueller Begutachtung. Im rein ästhetischen Bereich werden die Kosten privat getragen.",
    },
    {
      q: "Wie lange halten Brustimplantate?",
      a:
        "Moderne Implantate werden je nach Hersteller und individuellem Befund über viele Jahre getragen. Routinekontrollen sind Teil der Nachsorge — ein automatischer Wechsel ist nicht generell vorgesehen.",
    },
    {
      q: "Was sind realistische Erwartungen?",
      a:
        "In der Beratung schauen wir Ihre Brust an und besprechen offen, welches Ergebnis erreichbar ist und welches nicht. Realistische Erwartungen sind die Grundlage für Zufriedenheit.",
    },
  ],

  priceRange: { fromCents: 550000, toCents: 1290000, currency: "EUR" },

  finalCtaPromise:
    "Sie verlassen die Beratung mit Klarheit über Optionen, Risiken und Ihren persönlichen Weg.",

  seo: {
    metaTitle: "Brustchirurgie in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Brustvergrößerung, -verkleinerung und -straffung in [Stadt]. Eingehende Beratung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, persönliche Begleitung der Heilung.",
  },
};
