import type { Treatment } from "@/lib/types";

export const templateFiller: Treatment = {
  slug: "filler-stadt",
  clinicSlug: "_template",
  category: "filler",
  city: "[Stadt]",

  h1: "Hyaluronsäure-Filler in [Stadt]",
  subline:
    "Volumen, Konturen und Hautqualität — durchgeführt von [Dr. med. Vorname Nachname]. Sichtbares Ergebnis ohne den Wunsch nach mehr.",

  heroImage: {
    src: "/clinics/_template/hero-filler.svg",
    alt: "Beratungssituation für Hyaluronsäure-Behandlung",
  },

  trustMicrocopy: "Behandlung mit zertifizierten Präparaten · Persönliches Aufklärungsgespräch",

  problem: {
    paragraphs: [
      "Sie merken, dass das Gesicht im Wangenbereich oder rund um den Mund schmaler geworden ist, oder dass eine Lippenkontur unruhig wirkt. Sie möchten dies behutsam korrigieren — ohne dass das Ergebnis aufgesetzt aussieht.",
      "Sie wünschen sich eine ehrliche Einschätzung dazu, ob ein Filler überhaupt das richtige Mittel ist, oder ob Hautqualität und Mimik im Vordergrund stehen.",
    ],
  },

  explainer: {
    indication:
      "Hyaluronsäure-Filler eignen sich u.a. für die Konturierung von Wangen und Kinn, dezente Modellierung der Lippen und die Behandlung von Nasolabialfalten oder Marionettenlinien. Die Indikation prüfen wir individuell.",
    process:
      "Nach gründlicher Beratung wird das jeweils passende Präparat mit feinen Nadeln oder Kanülen in die zu behandelnden Bereiche eingebracht. Die Behandlung dauert je nach Region 20–45 Minuten.",
    recovery:
      "Direkt nach der Behandlung sind kleine Schwellungen oder Druckempfindlichkeit möglich, die sich meist innerhalb weniger Tage zurückbilden. Sport und Sauna sollten 24–48 Stunden vermieden werden.",
    duration:
      "Je nach Präparat und Behandlungsareal hält das Ergebnis etwa 9–18 Monate. Der Körper baut Hyaluronsäure langsam und natürlich ab.",
    sideEffects:
      "Häufige Nebenwirkungen: Schwellungen, Hämatome, Druckempfindlichkeit. Selten: Knötchenbildung, Asymmetrien, Gefäßereignisse. Letztere werden im Aufklärungsgespräch detailliert erklärt.",
    riskNotice:
      "Pflichtangabe HWG: Eine Filler-Behandlung ist ein medizinischer Eingriff. Mögliche Nebenwirkungen und Risiken — einschließlich seltener Komplikationen — werden im persönlichen Aufklärungsgespräch detailliert mit Ihnen besprochen.",
  },

  quiz: {
    treatmentOptions: [
      { id: "lippen", label: "Lippen", hint: "Kontur, Volumen, Symmetrie" },
      { id: "nasolabial", label: "Nasolabialfalten", hint: "Mund-Nase" },
      { id: "wangen", label: "Wangen", hint: "Volumenaufbau, Definition" },
      { id: "kinn", label: "Kinn / Kieferlinie", hint: "Konturierung" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Beratungsgespräch" },
    ],
    locationLabel: "Wo wäre Ihr Wunsch-Termin?",
    askExperience: false,
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & Analyse",
        body:
          "Wir schauen uns Ihre Wünsche und Ihr Gesicht in Ruhe an und besprechen, ob ein Filler die richtige Wahl ist oder andere Optionen sinnvoller sind.",
      },
      {
        index: 2,
        title: "Behandlung",
        body:
          "Die eigentliche Behandlung dauert je nach Areal 20–45 Minuten. Auf Wunsch wird eine Betäubungscreme aufgetragen.",
      },
      {
        index: 3,
        title: "Nachkontrolle",
        body:
          "Nach 10–14 Tagen sehen wir uns erneut, um das Ergebnis gemeinsam zu beurteilen und feinzujustieren.",
      },
    ],
  },

  faq: [
    {
      q: "Was kostet eine Filler-Behandlung?",
      a:
        "Der Preis richtet sich nach Bereich und benötigter Menge. Die Spanne beginnt bei etwa 350 € und kann je nach Umfang höher liegen. Sie erhalten in der Beratung ein transparentes Angebot.",
    },
    {
      q: "Sieht das Ergebnis natürlich aus?",
      a:
        "Unser Behandlungsansatz ist bewusst zurückhaltend. Ziel ist eine Verbesserung, die zu Ihnen passt und nicht erkennbar ist als Behandlung.",
    },
    {
      q: "Wie lange hält das Ergebnis?",
      a:
        "Je nach Präparat und Areal etwa 9–18 Monate. Der Abbau erfolgt langsam und gleichmäßig.",
    },
    {
      q: "Kann man das Ergebnis rückgängig machen?",
      a:
        "Hyaluronsäure-Filler können in der Regel mit Hyaluronidase aufgelöst werden, falls das Ergebnis nicht den Erwartungen entspricht oder Korrekturen nötig sind.",
    },
    {
      q: "Wie viele Sitzungen sind nötig?",
      a:
        "In den meisten Fällen reicht eine Sitzung. Bei größeren Konturierungen wird das Ergebnis in zwei Etappen aufgebaut, um die Veränderung behutsam zu gestalten.",
    },
    {
      q: "Wann ist von der Behandlung abzuraten?",
      a:
        "Während Schwangerschaft und Stillzeit, bei akuten Hauterkrankungen im Behandlungsareal oder bestimmten Vorerkrankungen. Diese Punkte besprechen wir im Aufklärungsgespräch.",
    },
    {
      q: "Habe ich nach der Behandlung gleich einen normalen Alltag?",
      a:
        "In der Regel ja. Leichte Schwellungen oder Druckempfindlichkeit klingen meist nach 1–3 Tagen ab. Sport und Sauna sollten 24–48 Stunden pausieren.",
    },
  ],

  priceRange: { fromCents: 35000, toCents: 89000, currency: "EUR" },

  finalCtaPromise:
    "Sie wissen heute, ob ein Filler zu Ihnen passt — ehrliche Einschätzung statt Verkaufsgespräch.",

  seo: {
    metaTitle: "Hyaluronsäure-Filler in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Filler-Behandlung in [Stadt]: Wangen, Lippen, Nasolabialfalten. Persönliche Beratung durch [Dr. med. Vorname Nachname]. Zertifizierte Präparate, behutsame Dosierung.",
  },
};
