import type { Treatment } from "@/lib/types";

export const templateRhino: Treatment = {
  slug: "nasenkorrektur-stadt",
  clinicSlug: "_template",
  category: "rhino",
  city: "[Stadt]",

  h1: "Nasenkorrektur (Rhinoplastik) in [Stadt]",
  subline:
    "Ästhetische und funktionelle Nasenkorrektur — durchgeführt von [Dr. med. Vorname Nachname]. Ausführliche Beratung mit 3D-Visualisierung möglich.",

  heroImage: {
    src: "/clinics/_template/hero-rhino.svg",
    alt: "Beratungsraum für die Nasenkorrektur",
  },

  trustMicrocopy: "Funktionelle und ästhetische Beratung · Gesetzliche Bedenkzeit",

  problem: {
    paragraphs: [
      "Sie haben sich jahrelang an Ihrer Nasenform gestört und überlegen seit längerem, ob eine Korrektur möglich ist. Dabei sind Sie unsicher, was realistisch ist und welche Veränderungen wirklich zu Ihrem Gesicht passen würden.",
      "Sie suchen eine Praxis, die ehrlich aufklärt — über das, was technisch geht, und über das, was Ihnen am Ende stehen wird.",
    ],
  },

  explainer: {
    indication:
      "Eine Rhinoplastik kann ästhetische Anliegen (Höcker, Nasenspitze, Krümmung) sowie funktionelle Probleme (z.B. Atembehinderung durch Nasenscheidewand) adressieren. Häufig werden ästhetische und funktionelle Korrekturen in einem Eingriff kombiniert.",
    process:
      "Der Eingriff erfolgt in Vollnarkose und dauert in der Regel 2–3 Stunden. Je nach Methode (offen / geschlossen) wird durch kleine Schnitte gearbeitet. Eine kurze Klinik-Übernachtung kann sinnvoll sein.",
    recovery:
      "Eine Schiene wird etwa 7–10 Tage getragen. Schwellungen und Blutergüsse sind die ersten 2 Wochen üblich. Die Nase entwickelt ihr endgültiges Erscheinungsbild über 6–12 Monate.",
    duration:
      "Das Ergebnis einer Rhinoplastik ist dauerhaft. Kleine Veränderungen über Jahrzehnte sind durch den natürlichen Alterungsprozess möglich.",
    sideEffects:
      "Mögliche Nebenwirkungen: Schwellungen, Hämatome, vorübergehende Atembehinderung, Sensibilitätsstörungen, Asymmetrien, Narbenbildung, in seltenen Fällen Notwendigkeit einer Korrekturoperation. Vollständige Aufklärung im persönlichen Gespräch.",
    riskNotice:
      "Pflichtangabe HWG: Die Rhinoplastik ist eine Operation. Sämtliche Risiken — auch seltene — werden im persönlichen Aufklärungsgespräch detailliert erläutert. Vor dem Eingriff besteht eine gesetzliche Bedenkzeit.",
  },

  quiz: {
    treatmentOptions: [
      { id: "hoecker", label: "Höckernase", hint: "Profilkorrektur" },
      { id: "spitze", label: "Nasenspitze", hint: "Form / Position" },
      { id: "schief", label: "Schiefnase", hint: "Geradestellung" },
      { id: "atmung", label: "Atembehinderung", hint: "Funktionell" },
      { id: "zweit-op", label: "Zweit-OP", hint: "Korrektur nach Voroperation" },
      { id: "kombination", label: "Kombination", hint: "Ästhetik & Funktion" },
    ],
    locationLabel: "Wo wäre Ihr Wunsch-Termin?",
    askExperience: true,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & Analyse",
        body:
          "60–90 Minuten Gespräch und Untersuchung — auf Wunsch mit 3D-Visualisierung möglicher Ergebnisse. Wir besprechen ehrlich, was technisch erreichbar ist.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und OP liegt eine gesetzliche Bedenkzeit. Sie entscheiden ohne Druck.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Der Eingriff dauert 2–3 Stunden in Vollnarkose. Eine kurze Klinik-Übernachtung wird je nach Befund empfohlen.",
      },
      {
        index: 4,
        title: "Nachsorge",
        body:
          "Schienenabnahme nach 7–10 Tagen, weitere Kontrollen über 6–12 Monate. Das endgültige Ergebnis zeigt sich nach etwa einem Jahr.",
      },
    ],
  },

  faq: [
    {
      q: "Wann ist das endgültige Ergebnis sichtbar?",
      a:
        "Die Nase entwickelt ihre endgültige Form über 6–12 Monate. Erste deutliche Veränderungen sind nach Schienenabnahme sichtbar; feine Anpassungen brauchen Zeit.",
    },
    {
      q: "Bin ich danach lange ausgefallen?",
      a:
        "Mit Schiene und sichtbaren Schwellungen sind die ersten 7–10 Tage spürbar. Mit Make-up sind die meisten Patientinnen nach 2–3 Wochen wieder gesellschaftsfähig.",
    },
    {
      q: "Wird die Krankenkasse beteiligt?",
      a:
        "Bei rein ästhetischen Eingriffen nein. Bei funktionellen Anteilen (z.B. Septum-Korrektur) kann eine Beteiligung möglich sein. Die Klärung erfolgt vor der OP.",
    },
    {
      q: "Was kostet die Nasenkorrektur?",
      a:
        "Der Preis hängt von Methode, Aufwand, Anästhesie und Klinik-Aufenthalt ab. Die Spanne beginnt bei etwa 5.000 € und kann je nach Befund höher liegen.",
    },
    {
      q: "Was, wenn ich mit dem Ergebnis nicht zufrieden bin?",
      a:
        "Eine vollständige Korrektur ist erst nach 12 Monaten zu beurteilen, da die Nase über diesen Zeitraum nachreift. Bei begründeten Anpassungen besprechen wir gemeinsam, was sinnvoll ist.",
    },
    {
      q: "Wann ist von der Operation abzuraten?",
      a:
        "Bei akuten Erkrankungen, bestimmten Vorerkrankungen, Gerinnungsstörungen oder wenn die Erwartungen nicht realistisch sind. Diese Punkte werden in der Voruntersuchung besprochen.",
    },
    {
      q: "Wie wird operiert — offen oder geschlossen?",
      a:
        "Welches Verfahren in Frage kommt, hängt vom individuellen Befund ab. Wir besprechen die Wahl und ihre Begründung im Aufklärungsgespräch.",
    },
  ],

  priceRange: { fromCents: 500000, toCents: 990000, currency: "EUR" },

  finalCtaPromise:
    "Sie verlassen die Beratung mit Klarheit darüber, was möglich ist — und was zu Ihrem Gesicht passt.",

  seo: {
    metaTitle: "Nasenkorrektur in [Stadt] – Rhinoplastik bei [Praxis-Name]",
    metaDescription:
      "Ästhetische und funktionelle Nasenkorrektur in [Stadt]. Eingehende Beratung durch [Dr. med. Vorname Nachname], 3D-Visualisierung möglich, gesetzliche Bedenkzeit.",
  },
};
