import type { Treatment } from "@/lib/types";

export const templateLidOp: Treatment = {
  slug: "lidstraffung-stadt",
  clinicSlug: "_template",
  category: "lid-op",
  city: "[Stadt]",

  h1: "Lidstraffung in [Stadt]",
  subline:
    "Für einen wachen, offenen Blick, der immer noch nach Ihnen aussieht. Operation und komplette Nachsorge bei [Dr. med. Vorname Nachname], mit gesetzlicher Bedenkzeit.",

  heroImage: {
    src: "/clinics/_template/hero-lid-op.svg",
    alt: "Beratungsgespräch zur Lidstraffung",
  },

  trustMicrocopy: "Eingehende Voruntersuchung · OP erst nach gesetzlicher Bedenkzeit",

  problem: {
    paragraphs: [
      "Die Oberlider sind schwerer geworden, auf Fotos wirken Sie müder, als Sie sind, und vielleicht drückt die Haut inzwischen sogar aufs Sichtfeld. Das Thema begleitet Sie schon länger.",
      "Was Sie zögern lässt: die Angst vor sichtbaren Narben und davor, nach der OP verändert auszusehen. Beides gehört in eine ehrliche Beratung, bevor irgendetwas entschieden wird.",
    ],
  },

  explainer: {
    indication:
      "Eine Oberlidstraffung kommt bei Hautüberschuss am Oberlid in Frage, der das Erscheinungsbild oder das Sichtfeld beeinträchtigt. Eine Unterlidstraffung kann bei Tränensäcken oder Hautüberschuss am Unterlid sinnvoll sein. Die Indikation prüfen wir gemeinsam in der Voruntersuchung.",
    process:
      "Der Eingriff erfolgt in der Regel ambulant, in örtlicher Betäubung mit Dämmerschlaf, je nach Befund auch in Vollnarkose. Die Operation dauert etwa 60 bis 90 Minuten.",
    recovery:
      "Schwellungen und leichte Blutergüsse sind in den ersten 7 bis 10 Tagen üblich. Die Fäden werden nach 5 bis 7 Tagen entfernt. Gesellschaftsfähig sind die meisten Patientinnen nach 10 bis 14 Tagen.",
    duration:
      "Das Ergebnis einer Lidstraffung hält meist viele Jahre. Der natürliche Alterungsprozess setzt sich fort, wird durch den Eingriff aber von einem deutlich strafferen Ausgangspunkt fortgeführt.",
    sideEffects:
      "Möglich: Schwellungen, Hämatome, vorübergehend trockene Augen, Narbenbildung, Asymmetrien, selten Wundheilungsstörungen oder Über- beziehungsweise Unterkorrektur.",
    riskNotice:
      "Pflichtangabe HWG: Eine Lidstraffung ist eine Operation. Mögliche Nebenwirkungen und Risiken werden im persönlichen Aufklärungsgespräch ausführlich besprochen. Vor einem operativen Eingriff besteht eine gesetzliche Bedenkzeit. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig.",
  },

  quiz: {
    treatmentOptions: [
      { id: "oberlid", label: "Oberlid", hint: "Hautüberschuss, schweres Lid" },
      { id: "unterlid", label: "Unterlid", hint: "Tränensäcke, Hautüberschuss" },
      { id: "beide", label: "Ober- und Unterlid", hint: "Kombiniert" },
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
          "60 Minuten Gespräch und Untersuchung. Wir prüfen die Indikation, klären über Ablauf, Risiken und die zu erwartende Ausfallzeit auf und beantworten alle Ihre Fragen.",
      },
      {
        index: 2,
        title: "Gesetzliche Bedenkzeit",
        body:
          "Zwischen Aufklärung und Eingriff liegt eine gesetzlich vorgeschriebene Bedenkzeit. Sie nehmen die Unterlagen mit nach Hause und entscheiden in Ruhe.",
      },
      {
        index: 3,
        title: "Operation",
        body:
          "Der Eingriff dauert etwa 60 bis 90 Minuten und erfolgt in der Regel ambulant. Die passende Anästhesie besprechen wir individuell.",
      },
      {
        index: 4,
        title: "Nachsorge",
        body:
          "Fadenzug nach 5 bis 7 Tagen, weitere Kontrollen nach 4 und 12 Wochen. Sie haben durchgehend dieselbe Ansprechpartnerin.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Narben + verändertes Aussehen zuerst,
  // dann Downtime, Kosten, Krankenkasse, Narkose, Haltbarkeit.
  faq: [
    {
      q: "Sind die Narben später sichtbar?",
      a:
        "Die Schnittführung liegt in der natürlichen Lidfalte und ist nach der Abheilung meist kaum noch zu erkennen. Eine feine Restspur kann individuell sichtbar bleiben; wie Ihre Haut typischerweise vernarbt, besprechen wir in der Voruntersuchung.",
    },
    {
      q: "Wirke ich nach der OP verändert?",
      a:
        "Das Ziel ist ein wacherer, erholter Blick, kein anderes Gesicht. Es wird nur so viel Haut entfernt, wie für ein natürliches Ergebnis nötig ist. In der Beratung zeigen wir Ihnen, was das für Ihr Lid konkret bedeutet.",
    },
    {
      q: "Wie lange bin ich raus aus dem Alltag?",
      a:
        "Planbar: Fäden nach 5 bis 7 Tagen, gesellschaftsfähig mit dezentem Make-up meist nach 10 bis 14 Tagen. Büroarbeit ist oft nach einer Woche wieder möglich, Sport nach etwa 3 Wochen.",
    },
    {
      q: "Was kostet die Lidstraffung?",
      a:
        "Je nachdem, ob Ober-, Unter- oder beide Lider operiert werden, und je nach Anästhesie beginnt der Preis bei etwa 1.800 €. Nach der Voruntersuchung erhalten Sie ein schriftliches Festangebot.",
    },
    {
      q: "Zahlt die Krankenkasse etwas dazu?",
      a:
        "Nur bei medizinischer Indikation, zum Beispiel einer nachgewiesenen Sichtfeldeinschränkung, und nach Begutachtung durch die Kasse. Bei ästhetischer Indikation tragen Sie die Kosten privat; wir sagen Ihnen ehrlich, welcher Fall bei Ihnen vorliegt.",
    },
    {
      q: "Welche Narkose wird verwendet?",
      a:
        "In der Regel örtliche Betäubung mit Dämmerschlaf: Sie bekommen von der OP nichts mit, sind aber schnell wieder fit. Auf Wunsch oder bei größeren Befunden ist Vollnarkose möglich.",
    },
    {
      q: "Wie lange hält das Ergebnis?",
      a:
        "Meist viele Jahre. Der natürliche Alterungsprozess läuft weiter, startet aber von einem strafferen Ausgangspunkt. Eine Wiederholung ist selten vor Ablauf von 10 Jahren ein Thema.",
    },
  ],

  priceRange: { fromCents: 180000, toCents: 380000, currency: "EUR" },

  cost: {
    drivers: [
      "Oberlid, Unterlid oder beides",
      "Art der Anästhesie",
      "Umfang des Befunds",
    ],
    financingNote: "Eine Zahlung in Raten ist auf Anfrage möglich.",
  },

  finalCtaPromise:
    "Sie verlassen die Beratung mit einer klaren Einschätzung. Ohne Zeitdruck, ohne Festlegung.",

  seo: {
    metaTitle: "Lidstraffung in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Ober- und Unterlidstraffung in [Stadt]. Eingehende Voruntersuchung durch [Dr. med. Vorname Nachname], gesetzliche Bedenkzeit, persönliche Nachsorge.",
  },
};
