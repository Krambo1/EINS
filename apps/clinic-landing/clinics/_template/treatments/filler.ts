import type { Treatment } from "@/lib/types";

export const templateFiller: Treatment = {
  slug: "hyaluron-stadt",
  clinicSlug: "_template",
  category: "filler",
  city: "[Stadt]",

  h1: "Hyaluron-Behandlung in [Stadt]",
  subline:
    "Volumen, Konturen und Lippen, behutsam dosiert statt aufgespritzt. Ehrliche Einschätzung von [Dr. med. Vorname Nachname], ob ein Filler überhaupt das Richtige für Sie ist.",

  heroImage: {
    src: "/clinics/_template/hero-filler.svg",
    alt: "Beratungssituation für eine Hyaluron-Behandlung",
  },

  trustMicrocopy: "Zertifizierte Präparate · Ehrliche Beratung, auch mal ein Abraten",

  problem: {
    paragraphs: [
      "Das Gesicht wirkt im Wangenbereich oder um den Mund schmaler als früher, oder die Lippenkontur ist unruhiger geworden. Sie möchten das behutsam korrigieren.",
      "Ihre größte Sorge dabei: ein aufgespritztes, künstliches Ergebnis. Sie wünschen sich eine Ärztin, die ehrlich sagt, was sinnvoll ist, und was man besser lässt.",
    ],
  },

  explainer: {
    indication:
      "Hyaluronsäure-Filler eignen sich für die Konturierung von Wangen und Kinn, die dezente Modellierung der Lippen und die Behandlung von Nasolabialfalten oder Marionettenlinien. Ob ein Filler für Ihr Anliegen die richtige Wahl ist, prüfen wir gemeinsam.",
    process:
      "Nach gründlicher Beratung wird das passende Präparat mit feinen Nadeln oder stumpfen Kanülen in die zu behandelnden Bereiche eingebracht. Je nach Region dauert die Behandlung 20 bis 45 Minuten.",
    recovery:
      "Direkt danach sind kleine Schwellungen oder Druckempfindlichkeit möglich; beides bildet sich meist innerhalb weniger Tage zurück. Sport und Sauna sollten 24 bis 48 Stunden pausieren.",
    duration:
      "Je nach Präparat und Behandlungsbereich hält das Ergebnis etwa 9 bis 18 Monate. Der Körper baut Hyaluronsäure langsam und gleichmäßig ab.",
    sideEffects:
      "Häufig: Schwellungen, Hämatome, Druckempfindlichkeit. Selten: Knötchenbildung, Asymmetrien, Gefäßereignisse. Die seltenen Komplikationen werden im Aufklärungsgespräch ausführlich erklärt.",
    riskNotice:
      "Pflichtangabe HWG: Eine Filler-Behandlung ist ein medizinischer Eingriff. Mögliche Nebenwirkungen und Risiken, einschließlich seltener Komplikationen, werden im persönlichen Aufklärungsgespräch detailliert mit Ihnen besprochen.",
  },

  quiz: {
    treatmentOptions: [
      { id: "lippen", label: "Lippen", hint: "Kontur, Volumen, Symmetrie" },
      { id: "nasolabial", label: "Nasolabialfalten", hint: "Mund-Nase-Bereich" },
      { id: "wangen", label: "Wangen", hint: "Volumen, Definition" },
      { id: "kinn", label: "Kinn / Kieferlinie", hint: "Konturierung" },
      { id: "kombination", label: "Kombination", hint: "Mehrere Bereiche" },
      { id: "unsicher", label: "Bin unsicher", hint: "Empfehlung im Gespräch" },
    ],
  },

  process: {
    steps: [
      {
        index: 1,
        title: "Beratung & Analyse",
        body:
          "Wir schauen uns Ihr Gesicht in Ruhe an und besprechen ehrlich, ob ein Filler die richtige Wahl ist oder ob eine andere Option besser zu Ihrem Anliegen passt.",
      },
      {
        index: 2,
        title: "Behandlung",
        body:
          "Je nach Bereich dauert die Behandlung 20 bis 45 Minuten. Auf Wunsch mit betäubender Creme; viele Präparate enthalten zusätzlich ein lokales Betäubungsmittel.",
      },
      {
        index: 3,
        title: "Nachkontrolle",
        body:
          "Nach 10 bis 14 Tagen beurteilen wir das Ergebnis gemeinsam und justieren fein nach, wenn nötig.",
      },
    ],
  },

  // Reihenfolge = Einwandgewicht: Natürlichkeit, Reversibilität, Schmerz,
  // Haltbarkeit, Kosten, Alltag, Kontraindikationen.
  faq: [
    {
      q: "Sieht das Ergebnis natürlich aus oder aufgespritzt?",
      a:
        "Unser Ansatz ist bewusst zurückhaltend: lieber in zwei Etappen aufbauen als einmal zu viel einbringen. Ziel ist eine Veränderung, die Ihnen niemand als Behandlung ansieht.",
    },
    {
      q: "Kann man das Ergebnis rückgängig machen?",
      a:
        "Ja. Hyaluronsäure-Filler lassen sich in der Regel mit dem Enzym Hyaluronidase wieder auflösen, falls das Ergebnis nicht Ihren Vorstellungen entspricht. Das unterscheidet Hyaluron von dauerhaften Fillern, die wir bewusst nicht einsetzen.",
    },
    {
      q: "Tut die Behandlung weh?",
      a:
        "Die meisten Patientinnen empfinden die Behandlung als gut auszuhalten. Wir arbeiten mit sehr feinen Nadeln oder stumpfen Kanülen, auf Wunsch mit betäubender Creme.",
    },
    {
      q: "Wie lange hält das Ergebnis?",
      a:
        "Je nach Präparat und Bereich etwa 9 bis 18 Monate. Der Abbau erfolgt langsam und gleichmäßig, das Ergebnis verschwindet also nicht von einem Tag auf den anderen.",
    },
    {
      q: "Was kostet eine Hyaluron-Behandlung?",
      a:
        "Der Preis richtet sich nach Bereich und benötigter Menge. Die Spanne beginnt bei etwa 350 €. Sie erhalten in der Beratung ein transparentes Angebot vor der Behandlung.",
    },
    {
      q: "Bin ich danach direkt wieder alltagstauglich?",
      a:
        "In der Regel ja. Leichte Schwellungen oder Rötungen klingen meist nach 1 bis 3 Tagen ab. Sport und Sauna sollten 24 bis 48 Stunden pausieren.",
    },
    {
      q: "Wann ist von der Behandlung abzuraten?",
      a:
        "In Schwangerschaft und Stillzeit, bei akuten Hauterkrankungen im Behandlungsbereich oder bestimmten Vorerkrankungen. Diese Punkte besprechen wir im Aufklärungsgespräch.",
    },
  ],

  priceRange: { fromCents: 35000, toCents: 89000, currency: "EUR" },

  cost: {
    drivers: [
      "Behandelter Bereich",
      "Benötigte Menge und Präparat",
      "Aufbau in einer oder zwei Etappen",
    ],
  },

  finalCtaPromise:
    "Sie bekommen eine ehrliche Einschätzung, ob ein Filler zu Ihnen passt. Kein Verkaufsgespräch.",

  seo: {
    metaTitle: "Hyaluron-Behandlung in [Stadt] – [Praxis-Name]",
    metaDescription:
      "Hyaluron-Behandlung in [Stadt]: Wangen, Lippen, Konturen. Behutsame Dosierung, zertifizierte Präparate, ehrliche Beratung durch [Dr. med. Vorname Nachname].",
  },
};
