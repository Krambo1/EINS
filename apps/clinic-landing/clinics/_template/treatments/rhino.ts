import type { Treatment } from "@/lib/types";

export const templateRhino: Treatment = {
  slug: "nasenkorrektur-stadt",
  clinicSlug: "_template",
  category: "rhino",
  city: "[Stadt]",

  h1: "Nasenkorrektur in [Stadt]",
  subline:
    "Eine Nase, die zu Ihrem Gesicht passt, statt einer Nase aus dem Katalog. Beratung mit 3D-Simulation bei [Dr. med. Vorname Nachname], auf Wunsch inklusive Atmungs-Check.",

  heroImage: {
    src: "/clinics/_template/hero-rhino.svg",
    alt: "Beratungsraum für die Nasenkorrektur",
  },

  trustMicrocopy: "3D-Simulation in der Beratung · Ästhetik und Funktion gemeinsam gedacht",

  problem: {
    paragraphs: [
      "Die Nase stört Sie seit Jahren, auf Fotos, im Profil, im Spiegel. Vielleicht kommt eine behinderte Nasenatmung dazu. Und trotzdem zögern Sie, denn es ist Ihr Gesicht.",
      "Die entscheidende Frage ist nicht, was technisch machbar ist, sondern was zu Ihnen passt. Genau dafür gibt es die Beratung mit Simulation, bevor irgendetwas entschieden wird.",
    ],
  },

  explainer: {
    indication:
      "Eine Nasenkorrektur kann ästhetische Anliegen (Höcker, Nasenspitze, Schiefstand) und funktionelle Probleme wie eine behinderte Nasenatmung adressieren, häufig kombiniert in einem Eingriff. Was bei Ihnen sinnvoll ist, klären Beratung und Untersuchung.",
    process:
      "Der Eingriff erfolgt in Vollnarkose und dauert in der Regel 2 bis 3 Stunden. Je nach Befund wird offen oder geschlossen operiert. Eine Übernachtung zur Überwachung kann sinnvoll sein.",
    recovery:
      "Eine Schiene wird etwa 7 bis 10 Tage getragen. Schwellungen und Blutergüsse sind in den ersten 2 Wochen üblich. Die Nase verfeinert ihr Erscheinungsbild über 6 bis 12 Monate.",
    duration:
      "Das Ergebnis einer Nasenkorrektur ist dauerhaft. Kleine Veränderungen über Jahrzehnte durch den natürlichen Alterungsprozess sind möglich.",
    sideEffects:
      "Möglich: Schwellungen, Hämatome, vorübergehend behinderte Nasenatmung, Sensibilitätsstörungen, Asymmetrien, Narbenbildung, selten die Notwendigkeit eines Korrektureingriffs.",
    riskNotice:
      "Pflichtangabe HWG: Die Nasenkorrektur ist eine Operation. Sämtliche Risiken, auch seltene, werden im persönlichen Aufklärungsgespräch detailliert erläutert. Vor dem Eingriff besteht eine gesetzliche Bedenkzeit.",
  },

  quiz: {
    treatmentOptions: [
      { id: "hoecker", label: "Höckernase", hint: "Profilkorrektur" },
      { id: "spitze", label: "Nasenspitze", hint: "Form, Position" },
      { id: "schief", label: "Schiefnase", hint: "Geradestellung" },
      { id: "atmung", label: "Atembehinderung", hint: "Funktionell" },
      { id: "zweit-op", label: "Zweit-OP", hint: "Korrektur nach Voroperation" },
      { id: "kombination", label: "Kombination", hint: "Ästhetik und Funktion" },
    ],
    askBudget: true,
    askDistance: true,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & 3D-Simulation",
        body:
          "60 bis 90 Minuten Gespräch und Untersuchung, auf Wunsch mit 3D-Simulation. Wir besprechen ehrlich, was erreichbar ist und was zu Ihrem Gesicht passt.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und OP liegt eine gesetzliche Bedenkzeit. Sie entscheiden ohne Druck, mit allen Unterlagen zu Hause.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "2 bis 3 Stunden in Vollnarkose. Ob offen oder geschlossen operiert wird, hängt vom Befund ab und wird vorab begründet.",
      },
      {
        index: 4,
        title: "Nachsorge",
        body:
          "Schienenabnahme nach 7 bis 10 Tagen, Kontrollen über 12 Monate. Das endgültige Ergebnis beurteilen wir gemeinsam nach etwa einem Jahr.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Identitätsangst zuerst ("erkenne ich mich
  // noch?"), dann Simulation, Geduld bis zum Endergebnis, Kosten, Kasse.
  faq: [
    {
      q: "Erkenne ich mich nach der OP noch wieder?",
      a:
        "Das ist die wichtigste Frage, und das Ziel jeder guten Planung: eine Nase, die zu Ihrem Gesicht passt und nicht auffällt. Die 3D-Simulation in der Beratung zeigt vorab, wohin die Reise realistisch geht. Über das Ergebnis entscheiden Sie mit.",
    },
    {
      q: "Kann ich vorab sehen, was möglich ist?",
      a:
        "Ja. In der Beratung erstellen wir auf Wunsch eine 3D-Simulation Ihres Profils. Sie ist keine Ergebnisgarantie, macht aber sichtbar, welche Veränderung zu Ihnen passt, und was wir bewusst nicht empfehlen würden.",
    },
    {
      q: "Wann sehe ich das endgültige Ergebnis?",
      a:
        "Nach Schienenabnahme sehen Sie die neue Grundform. Die Feinheiten entwickeln sich über 6 bis 12 Monate, während die Schwellung vollständig abklingt. Diese Geduld gehört zur OP dazu.",
    },
    {
      q: "Was kostet eine Nasenkorrektur?",
      a:
        "Je nach Umfang, Methode und Klinikaufenthalt beginnt der Preis bei etwa 5.000 €. Nach Beratung und Untersuchung erhalten Sie ein schriftliches Festangebot.",
    },
    {
      q: "Zahlt die Krankenkasse bei Atemproblemen mit?",
      a:
        "Bei funktionellen Anteilen, etwa einer Begradigung der Nasenscheidewand, ist eine Beteiligung möglich. Wir klären das vor der OP verbindlich mit Ihnen und der Kasse.",
    },
    {
      q: "Wie lange bin ich raus aus dem Alltag?",
      a:
        "Mit Schiene und sichtbaren Spuren rechnen Sie 7 bis 10 Tage. Gesellschaftsfähig mit dezentem Make-up sind die meisten nach 2 bis 3 Wochen. Sport pausiert etwa 6 Wochen.",
    },
    {
      q: "Offen oder geschlossen, was ist besser?",
      a:
        "Keines von beiden pauschal. Die Wahl hängt vom Befund ab: was korrigiert werden soll und wie viel Struktur dafür erreichbar sein muss. Wir begründen die Empfehlung im Gespräch.",
    },
  ],

  priceRange: { fromCents: 500000, toCents: 990000, currency: "EUR" },

  cost: {
    drivers: [
      "Umfang der Korrektur",
      "Offene oder geschlossene Technik",
      "Funktioneller Anteil (Kassenbeteiligung möglich)",
      "Klinikaufenthalt",
    ],
    financingNote: "Eine Zahlung in Raten ist auf Anfrage möglich.",
  },

  finalCtaPromise:
    "Sie verlassen die Beratung mit Klarheit darüber, was möglich ist und was zu Ihrem Gesicht passt.",

  seo: {
    metaTitle: "Nasenkorrektur in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Nasenkorrektur in [Stadt] mit 3D-Simulation in der Beratung. Ästhetik und Funktion bei [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, Nachsorge über 12 Monate.",
  },
};
