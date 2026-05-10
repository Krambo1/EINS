import type { Treatment } from "@/lib/types";

export const templateLiposuktion: Treatment = {
  slug: "liposuktion-stadt",
  clinicSlug: "_template",
  category: "liposuktion",
  city: "[Stadt]",

  h1: "Liposuktion (Fettabsaugung) in [Stadt]",
  subline:
    "Konturierung von Bauch, Hüfte, Beinen oder Kinn — durchgeführt von [Dr. med. Vorname Nachname]. Nach gründlicher Voruntersuchung und gesetzlicher Bedenkzeit.",

  heroImage: {
    src: "/clinics/_template/hero-liposuktion.svg",
    alt: "Beratungsraum für die Liposuktion",
  },

  trustMicrocopy: "Eingehende Voruntersuchung · Persönliche Begleitung der Heilung",

  problem: {
    paragraphs: [
      "Sie trainieren regelmäßig und ernähren sich bewusst, aber bestimmte Fettpolster — am Bauch, an den Hüften, an den Reiterhosen oder am Kinn — bleiben hartnäckig bestehen. Sie wünschen sich eine Möglichkeit, diese Bereiche gezielt zu konturieren.",
      "Sie suchen eine Praxis, die Sie ehrlich darüber aufklärt, wofür eine Liposuktion geeignet ist und wofür nicht — und die nicht jede OP empfiehlt.",
    ],
  },

  explainer: {
    indication:
      "Die Liposuktion eignet sich zur Konturierung lokal abgegrenzter Fettpolster, die sich durch Training und Ernährung nicht reduzieren lassen. Sie ist keine Methode zur Gewichtsreduktion. Die Indikation prüfen wir in Ruhe gemeinsam.",
    process:
      "Der Eingriff erfolgt in der Regel in Tumeszenz-Lokalanästhesie oder Vollnarkose, je nach Umfang. Über kleine Zugänge wird mit feinen Kanülen Fettgewebe abgetragen. Die OP-Dauer beträgt 1–3 Stunden.",
    recovery:
      "Eine Kompressionswäsche wird etwa 4–6 Wochen Tag und Nacht getragen. Schwellungen und Blutergüsse sind die ersten Wochen üblich. Sport ist je nach Befund nach 4–6 Wochen wieder möglich.",
    duration:
      "Das Ergebnis ist dauerhaft, sofern das Körpergewicht stabil bleibt. Fettzellen, die entfernt wurden, bilden sich nicht neu — das übrige Gewebe kann jedoch bei Gewichtszunahme weiter Fett einlagern.",
    sideEffects:
      "Mögliche Nebenwirkungen: Schwellungen, Hämatome, Sensibilitätsstörungen, Konturunregelmäßigkeiten, in seltenen Fällen Infektionen oder Wundheilungsstörungen. Vollständige Aufklärung im persönlichen Gespräch.",
    riskNotice:
      "Pflichtangabe HWG: Die Liposuktion ist eine Operation. Sämtliche Risiken — auch seltene — werden im persönlichen Aufklärungsgespräch erläutert. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "bauch", label: "Bauch", hint: "Ober-/Unterbauch" },
      { id: "huefte", label: "Hüfte / Reiterhosen", hint: "Außenseite Oberschenkel" },
      { id: "innenseite", label: "Innenseite Oberschenkel", hint: "Konturierung" },
      { id: "kinn", label: "Kinn / Hals", hint: "Submentale Region" },
      { id: "arme", label: "Oberarme", hint: "Konturierung" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
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
          "60 Minuten persönliches Gespräch und Untersuchung. Wir besprechen Anliegen, Indikation und Ablauf und klären ehrlich über Möglichkeiten und Grenzen auf.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und Operation liegt eine gesetzliche Bedenkzeit. Sie entscheiden in Ruhe und ohne Druck.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Der Eingriff dauert je nach Umfang 1–3 Stunden. Die Wahl der Anästhesie besprechen wir individuell mit Ihnen.",
      },
      {
        index: 4,
        title: "Nachsorge & Heilungsverlauf",
        body:
          "Kompressionswäsche, regelmäßige Kontrollen, Lymphdrainage nach Bedarf. Das endgültige Ergebnis zeigt sich nach etwa 6 Monaten.",
      },
    ],
  },

  faq: [
    {
      q: "Ist die Liposuktion eine Methode zur Gewichtsabnahme?",
      a:
        "Nein. Die Liposuktion dient der Konturierung lokal abgegrenzter Fettpolster und ist nicht zur Gewichtsreduktion geeignet. Voraussetzung ist ein stabiles, körpergerechtes Gewicht.",
    },
    {
      q: "Wie lange muss ich Kompressionswäsche tragen?",
      a:
        "In der Regel 4–6 Wochen Tag und Nacht, je nach Befund individuell länger. Die Wäsche unterstützt die Konturierung und reduziert Schwellungen.",
    },
    {
      q: "Wann kann ich wieder Sport machen?",
      a:
        "Leichte Bewegung ist nach 1–2 Wochen möglich. Belastendes Training in der Regel nach 4–6 Wochen — abhängig vom Befund.",
    },
    {
      q: "Was kostet die Liposuktion?",
      a:
        "Der Preis hängt von Anzahl und Größe der Areale, Anästhesie und Klinik-Aufenthalt ab. Die Spanne beginnt bei etwa 2.500 € und kann je nach Umfang höher liegen.",
    },
    {
      q: "Bleibt das Ergebnis dauerhaft?",
      a:
        "Ja, sofern Ihr Gewicht stabil bleibt. Die entfernten Fettzellen bilden sich nicht neu. Bei Gewichtszunahme kann das übrige Gewebe jedoch Fett einlagern.",
    },
    {
      q: "Hilft die Liposuktion bei Cellulite?",
      a:
        "Cellulite ist ein eigenständiges Hautbild und wird durch die Liposuktion nicht direkt verbessert. Wir klären in der Beratung, welche Maßnahmen in Frage kommen.",
    },
    {
      q: "Wann sollte ich nicht operieren lassen?",
      a:
        "Bei Schwangerschaft, akuten Erkrankungen, Gerinnungsstörungen oder bestimmten Vorerkrankungen. Diese Punkte besprechen wir in der Voruntersuchung.",
    },
  ],

  priceRange: { fromCents: 250000, toCents: 690000, currency: "EUR" },

  finalCtaPromise:
    "Sie verlassen die Beratung mit Klarheit — über Möglichkeiten, Grenzen und einen für Sie passenden Weg.",

  seo: {
    metaTitle: "Liposuktion in [Stadt] – Fettabsaugung bei [Praxis-Name]",
    metaDescription:
      "Liposuktion in [Stadt] für Bauch, Hüfte, Beine oder Kinn. Eingehende Beratung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, persönliche Begleitung der Heilung.",
  },
};
