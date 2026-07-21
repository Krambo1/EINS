import type { Treatment } from "@/lib/types";

/**
 * Faltenbehandlung (Botulinumtoxin).
 *
 * § 10 HWG: verschreibungspflichtige Arzneimittel dürfen gegenüber Patienten
 * nicht beworben werden — deshalb nennt KEINE patientenseitige Zeile den
 * Wirkstoff oder einen Markennamen. Patientensprache: "Faltenbehandlung" /
 * "muskelentspannendes Präparat". Nur die interne Kategorie bleibt `botox`.
 */
export const templateBotox: Treatment = {
  slug: "faltenbehandlung-stadt",
  clinicSlug: "_template",
  category: "botox",
  city: "[Stadt]",

  h1: "Faltenbehandlung in [Stadt]",
  subline:
    "Sanfte Behandlung mimischer Falten mit dem Ziel, dass man Ihnen die Behandlung nicht ansieht. Beratung, Behandlung und Nachkontrolle persönlich bei [Dr. med. Vorname Nachname].",

  heroImage: {
    src: "/clinics/_template/hero-botox.svg",
    alt: "Praxisansicht für die Faltenbehandlung",
  },

  trustMicrocopy: "Persönliche Beratung in [Stadt] · Termin in der Regel innerhalb von 7 Tagen",
  ctaLabel: "Beratungstermin anfragen",

  problem: {
    paragraphs: [
      "Sie sehen morgens müder aus, als Sie sich fühlen. Die Linien auf der Stirn oder zwischen den Augenbrauen werden deutlicher, und auf Fotos stört es Sie inzwischen.",
      "Gleichzeitig haben Sie eine klare Sorge: Sie möchten frischer aussehen, aber natürlich. Kein starres Gesicht, keine sichtbare Behandlung. Genau so arbeiten wir.",
    ],
  },

  explainer: {
    indication:
      "Behandelt werden mimische Linien an der Stirn, zwischen den Augenbrauen (Zornesfalte) und seitlich der Augen (Krähenfüße). Ob die Behandlung für Ihr Anliegen geeignet ist, prüft die Ärztin individuell im Beratungsgespräch.",
    process:
      "Nach der Beratung werden mit einer sehr feinen Nadel kleine Mengen eines muskelentspannenden Präparats gezielt in die verantwortlichen Muskelpartien injiziert. Die Behandlung dauert in der Regel 15 bis 20 Minuten.",
    recovery:
      "Direkt nach der Behandlung sind Sie wieder gesellschaftsfähig. Für 24 Stunden sollten Sport, Sauna und Gesichtsmassagen pausieren. Die volle Wirkung baut sich über 7 bis 14 Tage auf.",
    duration:
      "Die Wirkung hält in der Regel 3 bis 4 Monate an. Bei regelmäßiger Behandlung verlängert sich die Wirkdauer bei vielen Patientinnen leicht.",
    sideEffects:
      "Häufig: kleine Hämatome an der Einstichstelle, leichte Kopfschmerzen, vorübergehendes Spannungsgefühl. Selten: Asymmetrien oder eine leichte Lidsenkung, die sich in der Regel zurückbildet.",
    riskNotice:
      "Pflichtangabe HWG: Wie jede ärztliche Maßnahme bringt auch diese Behandlung Risiken mit sich. Mögliche Nebenwirkungen werden im persönlichen Aufklärungsgespräch detailliert besprochen. Bitte lesen Sie die Aufklärungsunterlagen sorgfältig durch.",
  },

  quiz: {
    treatmentOptions: [
      { id: "stirn", label: "Stirnfalten", hint: "Horizontale Linien" },
      { id: "glabella", label: "Zornesfalte", hint: "Zwischen den Augenbrauen" },
      { id: "kraehenfuesse", label: "Krähenfüße", hint: "Seitlich der Augen" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Gespräch" },
    ],
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratungstermin",
        body:
          "30 Minuten persönliches Gespräch in der Praxis. Wir schauen uns Ihre Mimik gemeinsam an und besprechen ehrlich, ob die Behandlung zu Ihrem Anliegen passt.",
      },
      {
        index: 2,
        title: "Behandlung",
        body:
          "Die eigentliche Behandlung dauert 15 bis 20 Minuten. Direkt im Anschluss sind Sie zurück im Alltag, ohne sichtbare Spuren des Termins.",
      },
      {
        index: 3,
        title: "Nachkontrolle",
        body:
          "Nach 10 bis 14 Tagen sehen wir uns erneut, beurteilen das Ergebnis gemeinsam und justieren bei Bedarf fein nach.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Natürlichkeit zuerst ("Maskengesicht" ist
  // die größte Angst bei Injektabels), dann Schmerz, Wirkung, Kosten, Diskretion.
  faq: [
    {
      q: "Sieht man, dass ich behandelt wurde?",
      a:
        "Das Ziel in unserer Praxis ist ein ausgeruhtes, natürliches Erscheinungsbild. Wir dosieren bewusst zurückhaltend: Ihre Mimik bleibt erhalten, nur die störenden Linien werden weicher. Lieber zweimal fein nachjustieren als einmal zu viel.",
    },
    {
      q: "Tut die Behandlung weh?",
      a:
        "Verwendet werden sehr feine Nadeln. Die meisten Patientinnen beschreiben ein kurzes Piksen, gut auszuhalten. Auf Wunsch tragen wir vorab eine betäubende Creme auf.",
    },
    {
      q: "Wann sehe ich das Ergebnis und wie lange hält es?",
      a:
        "Der Effekt baut sich über mehrere Tage auf und ist nach 7 bis 14 Tagen voll ausgeprägt. Er hält im Schnitt 3 bis 4 Monate; mit wiederholter Behandlung oft etwas länger.",
    },
    {
      q: "Was kostet die Behandlung?",
      a:
        "Der Preis hängt vom Bereich und der benötigten Menge ab. Die Spanne beginnt bei etwa 250 €. In der Beratung erhalten Sie vorab ein transparentes Angebot, es gibt keine versteckten Positionen.",
    },
    {
      q: "Bekommt jemand mit, dass ich in der Praxis war?",
      a:
        "Diskretion ist bei uns Standard: einzeln vergebene Termine, kein volles Wartezimmer, auf Wunsch Randzeiten. Direkt nach der Behandlung sind Sie gesellschaftsfähig.",
    },
    {
      q: "Wann sollte ich die Behandlung nicht machen lassen?",
      a:
        "In Schwangerschaft und Stillzeit, bei bestimmten neuromuskulären Erkrankungen oder akuten Hautentzündungen im Behandlungsbereich. Diese Punkte fragen wir im Aufklärungsgespräch ab.",
    },
    {
      q: "Wie schnell bekomme ich einen Termin?",
      a:
        "Beratungstermine sind in der Regel innerhalb einer Woche verfügbar. Die Behandlung kann je nach Befund oft direkt im Anschluss an die Beratung erfolgen.",
    },
  ],

  priceRange: { fromCents: 25000, toCents: 49000, currency: "EUR" },

  cost: {
    drivers: [
      "Anzahl der behandelten Bereiche",
      "Benötigte Menge des Präparats",
      "Umfang der Nachkontrolle",
    ],
  },

  finalCtaPromise:
    "Sie wissen nach dem Gespräch, ob die Behandlung zu Ihnen passt. Ohne Verpflichtung, ohne Druck.",

  seo: {
    metaTitle: "Faltenbehandlung in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Sanfte Behandlung mimischer Falten in [Stadt]. Persönliche Beratung durch [Dr. med. Vorname Nachname], natürliches Ergebnis, Termine meist innerhalb von 7 Tagen.",
  },
};
