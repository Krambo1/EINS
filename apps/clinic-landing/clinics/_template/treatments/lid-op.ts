import type { Treatment } from "@/lib/types";

export const templateLidOp: Treatment = {
  slug: "lidstraffung-stadt",
  clinicSlug: "_template",
  category: "lid-op",
  city: "[Stadt]",

  h1: "Lidstraffung (Blepharoplastik) in [Stadt]",
  subline:
    "Operation der Ober- oder Unterlider — durchgeführt von [Dr. med. Vorname Nachname]. Persönliches Aufklärungsgespräch und gesetzliche Bedenkzeit.",

  heroImage: {
    src: "/clinics/_template/hero-lid-op.svg",
    alt: "Beratungsgespräch zur Lidstraffung",
  },

  trustMicrocopy: "OP nach gesetzlicher Bedenkzeit · Eingehende Voruntersuchung",

  problem: {
    paragraphs: [
      "Sie nehmen wahr, dass Ihre Oberlider schwerer geworden sind, das Sichtfeld einschränken oder dass Sie auf Fotos müder wirken, als Sie sind. Sie überlegen seit längerem, ob eine Operation sinnvoll wäre.",
      "Sie suchen eine Praxis, die Sie ehrlich aufklärt — auch über die Grenzen einer Lidstraffung — und die sich Zeit nimmt, bevor sie operiert.",
    ],
  },

  explainer: {
    indication:
      "Eine Oberlidstraffung kommt bei Hautüberschuss am Oberlid in Frage, der das Erscheinungsbild oder das Sichtfeld einschränkt. Eine Unterlidstraffung kann bei Tränensäcken oder Hautüberschuss am Unterlid sinnvoll sein. Die Indikation prüfen wir gemeinsam mit Ihnen.",
    process:
      "Der Eingriff erfolgt in der Regel ambulant und unter örtlicher Betäubung mit Dämmerschlaf, je nach Befund auch in Vollnarkose. Die Operation dauert etwa 60–90 Minuten.",
    recovery:
      "Schwellungen und leichte Blutergüsse sind in den ersten 7–10 Tagen üblich. Fäden werden in der Regel nach 5–7 Tagen entfernt. Gesellschaftsfähig sind die meisten Patientinnen nach 10–14 Tagen.",
    duration:
      "Das Ergebnis einer Lidstraffung hält meist über viele Jahre. Der natürliche Alterungsprozess setzt sich aber fort.",
    sideEffects:
      "Mögliche Nebenwirkungen: Schwellungen, Hämatome, vorübergehend trockene Augen, Narbenbildung, Asymmetrien, in seltenen Fällen Wundheilungsstörungen oder Über-/Unterkorrektur.",
    riskNotice:
      "Pflichtangabe HWG: Eine Lidstraffung ist eine Operation. Mögliche Nebenwirkungen und Risiken werden im persönlichen Aufklärungsgespräch ausführlich besprochen. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "oberlid", label: "Oberlid", hint: "Hautüberschuss / Schweres Lid" },
      { id: "unterlid", label: "Unterlid", hint: "Tränensäcke / Hautüberschuss" },
      { id: "beide", label: "Ober- und Unterlid", hint: "Kombiniert" },
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
          "60 Minuten persönliches Gespräch und Untersuchung. Wir prüfen die Indikation, klären über Ablauf und Risiken auf und beantworten Ihre Fragen.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und Eingriff liegt eine gesetzlich vorgeschriebene Bedenkzeit. Sie nehmen die Aufklärungsunterlagen mit und entscheiden in Ruhe.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Der Eingriff dauert etwa 60–90 Minuten und erfolgt in der Regel ambulant. Die Anästhesie besprechen wir individuell.",
      },
      {
        index: 4,
        title: "Nachsorge",
        body:
          "Fadenzug nach 5–7 Tagen, weitere Kontrollen nach 4 und 12 Wochen. Wir begleiten Sie durch den gesamten Heilungsverlauf.",
      },
    ],
  },

  faq: [
    {
      q: "Wie lange dauert es, bis ich wieder gesellschaftsfähig bin?",
      a:
        "Mit dezenter Make-up-Abdeckung sind die meisten Patientinnen nach etwa 10–14 Tagen wieder im Alltag. Die endgültige Verheilung dauert mehrere Wochen.",
    },
    {
      q: "Welche Narkose wird verwendet?",
      a:
        "In der Regel örtliche Betäubung mit Dämmerschlaf. Bei umfangreicheren Befunden oder auf Wunsch ist auch eine Vollnarkose möglich. Die Wahl besprechen wir individuell.",
    },
    {
      q: "Was kostet die Lidstraffung?",
      a:
        "Die Kosten hängen davon ab, ob Ober-, Unter- oder beide Lider operiert werden, sowie von Anästhesie und Klinik-Aufenthalt. Der Preis beginnt bei etwa 1.800 €. Sie erhalten ein konkretes Angebot.",
    },
    {
      q: "Wann sollte ich nicht operieren lassen?",
      a:
        "Bei akuten Augenerkrankungen, Schwangerschaft, bestimmten Vorerkrankungen oder Gerinnungsstörungen. Diese Punkte werden im Aufklärungsgespräch erfragt.",
    },
    {
      q: "Sind die Narben sichtbar?",
      a:
        "Die Schnittführung verläuft in der natürlichen Lidfalte und ist nach Abheilung meist kaum noch sichtbar. Eine Restspur kann individuell sichtbar bleiben.",
    },
    {
      q: "Wie lange hält das Ergebnis?",
      a:
        "Eine Lidstraffung wirkt in der Regel über viele Jahre. Der natürliche Alterungsprozess wird durch den Eingriff nicht aufgehalten.",
    },
    {
      q: "Wird die Operation von der Krankenkasse übernommen?",
      a:
        "Nur bei medizinischer Indikation (z.B. Sichtfeldeinschränkung) und nach individueller Begutachtung durch die Krankenkasse. Im ästhetischen Bereich werden die Kosten privat getragen.",
    },
  ],

  priceRange: { fromCents: 180000, toCents: 380000, currency: "EUR" },

  finalCtaPromise:
    "Sie verlassen die Beratung mit einer klaren Einschätzung — ohne Zeitdruck und ohne Festlegung.",

  seo: {
    metaTitle: "Lidstraffung in [Stadt] – Blepharoplastik bei [Praxis-Name]",
    metaDescription:
      "Ober- und Unterlidstraffung in [Stadt]. Eingehende Beratung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, persönliche Begleitung im Heilungsverlauf.",
  },
};
