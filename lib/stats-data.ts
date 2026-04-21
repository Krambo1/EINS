export type Viz =
  | { kind: "radial"; value: number }
  | { kind: "horizontalBar"; value: number; comparison: number; labels: [string, string] }
  | { kind: "comparativeBar"; a: { label: string; value: number }; b: { label: string; value: number }; unit: string }
  | { kind: "stars"; value: number }
  | { kind: "gauge"; value: number }
  | { kind: "lineGrowth"; points: { year: string; value: number }[]; suffix?: string }
  | { kind: "priceRange"; items: { label: string; min: number; max: number }[] }
  | { kind: "bigNumber"; prefix?: string; value: string; suffix?: string; caption: string };

export type Stat = {
  id: string;
  tab: "conversion" | "vertrauen" | "markt" | "case";
  headline: string;
  bigNumber: {
    value: number;
    prefix?: string;
    suffix?: string;
    decimals?: number;
  };
  salesFrame: string;
  source: string;
  viz: Viz;
};

export const STATS: Stat[] = [
  {
    id: "video-conversion",
    tab: "conversion",
    headline: "mehr Abschlüsse mit Video auf der Ziel-Website",
    bigNumber: { value: 86, suffix: "%" },
    salesFrame:
      "Ohne Video auf Ihrer Behandlungsseite verlieren Sie den Großteil der Besucher, für die Sie bezahlt haben. Ein einziges Erklärvideo kann die Kosten pro Anfrage halbieren.",
    source: "ZealousWeb / Firework Healthcare Landingpage-Analyse, 2024",
    viz: { kind: "radial", value: 86 },
  },
  {
    id: "mobile-bounce",
    tab: "conversion",
    headline: "der mobilen Besucher verlassen Seiten mit mehr als 3 Sek. Ladezeit",
    bigNumber: { value: 53, suffix: "%" },
    salesFrame:
      "Sie zahlen für jeden Klick. Bei einer langsamen Seite verlieren Sie mehr als die Hälfte des Budgets, bevor der Patient Ihr Logo gesehen hat.",
    source: "Google Industry Mobile Speed Report",
    viz: {
      kind: "horizontalBar",
      value: 53,
      comparison: 47,
      labels: ["Sprung bei > 3 Sek.", "Bleiben trotzdem"],
    },
  },
  {
    id: "landingpage-3x",
    tab: "conversion",
    headline: "höhere Abschlussquote: Ziel-Website vs. Startseite bei bezahlten Anzeigen",
    bigNumber: { value: 3, suffix: "x" },
    salesFrame:
      "Wer bezahlte Anzeigen auf die Startseite schickt, verbrennt Geld. Jede Behandlung braucht eine eigene Seite mit nur einem Ziel: die Anfrage.",
    source: "Instapage & Unbounce Conversion Benchmarks, 2019 bis 2025",
    viz: {
      kind: "comparativeBar",
      a: { label: "Startseite", value: 2.5 },
      b: { label: "Eigene Ziel-Website", value: 6.6 },
      unit: "% Abschluss",
    },
  },
  {
    id: "reviews-4plus",
    tab: "vertrauen",
    headline: "der Patienten buchen ausschließlich bei Anbietern mit 4+ Sternen",
    bigNumber: { value: 72, suffix: "%" },
    salesFrame:
      "Eine schwache Bewertungsseite schließt 72 Prozent Ihrer potenziellen Patienten aus, bevor sie Ihre Website je gesehen haben.",
    source: "Reputation / YouGov 2022 Healthcare Trends Report",
    viz: { kind: "stars", value: 4 },
  },
  {
    id: "germans-research",
    tab: "vertrauen",
    headline: "der deutschen Internetnutzer recherchieren Praxen vor der Buchung",
    bigNumber: { value: 55, suffix: "%" },
    salesFrame:
      "Über die Hälfte der potenziellen Patienten beurteilt Ihre Klinik online, bevor sie anruft. Wer in diesem Moment nicht überzeugt, verliert die Anfrage still und leise.",
    source: "Bitkom Research, repräsentative Befragung, 2026",
    viz: { kind: "gauge", value: 55 },
  },
  {
    id: "compare-providers",
    tab: "vertrauen",
    headline: "der Suchenden vergleichen 2 bis 5 Anbieter vor der Entscheidung",
    bigNumber: { value: 70, suffix: "%" },
    salesFrame:
      "Ihre Klinik wird fast nie isoliert betrachtet. Fotos, Videos, Bewertungen und Ziel-Website werden nebeneinander mit 2 bis 5 Mitbewerbern verglichen.",
    source: "Software Advice How Patients Use Online Reviews, 2022",
    viz: { kind: "gauge", value: 70 },
  },
  {
    id: "review-cancellation",
    tab: "vertrauen",
    headline: "haben bereits Termine wegen schlechter Bewertungen storniert",
    bigNumber: { value: 40, suffix: "%" },
    salesFrame:
      "Negative oder unbeantwortete Bewertungen zerstören nicht nur Neuanfragen, sie kosten bereits gebuchte Patienten.",
    source: "rater8 How Patients Choose Their Doctors, 2025",
    viz: {
      kind: "horizontalBar",
      value: 40,
      comparison: 60,
      labels: ["Stornieren Termin", "Behalten Termin"],
    },
  },
  {
    id: "stammkunden-umsatz",
    tab: "markt",
    headline: "des Umsatzes in Ästhetik-Kliniken stammen von Stammkunden",
    bigNumber: { value: 80, suffix: "%" },
    salesFrame:
      "Ästhetik ist ein Stammkunden-Geschäft. Wer den ersten Termin gut inszeniert und visuell überzeugt, verdient über Jahre. Jede neue Patientin ist kein Einmal-Umsatz, sondern eine langfristige Beziehung.",
    source: "Zenoti Medical Spa & Aesthetic Benchmark Report",
    viz: {
      kind: "horizontalBar",
      value: 80,
      comparison: 20,
      labels: ["Stammkunden-Umsatz", "Neukunden-Umsatz"],
    },
  },
  {
    id: "isaps-growth",
    tab: "markt",
    headline: "Anstieg ästhetischer Eingriffe weltweit in 4 Jahren",
    bigNumber: { value: 41.3, suffix: "%", decimals: 1, prefix: "+" },
    salesFrame:
      "Der Markt wächst schnell. Kliniken, die jetzt sichtbar und professionell auftreten, sichern sich den größten Teil davon.",
    source: "ISAPS Global Survey 2022",
    viz: {
      kind: "lineGrowth",
      points: [
        { year: "2018", value: 100 },
        { year: "2019", value: 108 },
        { year: "2020", value: 112 },
        { year: "2021", value: 128 },
        { year: "2022", value: 141.3 },
      ],
    },
  },
  {
    id: "price-range",
    tab: "markt",
    headline: "Marktpreise in Deutschland für hochpreisige ästhetische Behandlungen",
    bigNumber: { value: 3000, prefix: "Ø ", suffix: " €" },
    salesFrame:
      "Bei einem durchschnittlichen Behandlungswert von 3.000 € und regelmäßigen Re-Treatments rechnet sich jede seriöse Kampagne schnell. Wenige zusätzliche Patienten pro Monat finanzieren die gesamte Strategie mehrfach.",
    source: "VDÄPC und Marktrecherche ästhetische Medizin DACH, 2023 bis 2025",
    viz: {
      kind: "priceRange",
      items: [
        { label: "Lippenunterspritzung", min: 300, max: 800 },
        { label: "Hyaluron-Filler pro Sitzung", min: 400, max: 1500 },
        { label: "Liposuktion / Fettabsaugung", min: 3000, max: 8000 },
        { label: "Facelift", min: 6000, max: 15000 },
      ],
    },
  },
  {
    id: "roas-aesthetic",
    tab: "case",
    headline: "Werbeertrag einer gut aufgebauten Ästhetik-Kampagne über 12 Monate",
    bigNumber: { value: 480, suffix: "%" },
    salesFrame:
      "Gut aufgebaute Ästhetik-Kampagnen verdienen das Vielfache des eingesetzten Budgets zurück. Was meistens fehlt, sind gute Videos und eine überzeugende Seite, nicht das Geld.",
    source: "Zenoti Medical Spa & Aesthetic Ad Performance Benchmark, 2023",
    viz: {
      kind: "bigNumber",
      value: "45.000 €",
      caption: "Werbebudget, 140+ qualifizierte Beratungen, 480 % Werbeertrag",
    },
  },
  {
    id: "high-ticket-case",
    tab: "case",
    headline: "neuer Ästhetik-Umsatz aus 3 Patienten in einem Monat",
    bigNumber: { value: 75000, prefix: "", suffix: " €" },
    salesFrame:
      "Bei 5.000 bis 25.000 € pro Ästhetik-Patient in Premium-Behandlungen reichen wenige ernsthafte Anfragen, um die gesamten Werbekosten mehrfach wieder einzuspielen.",
    source: "UK Aesthetic Clinic Marketing Case Study, 2024",
    viz: {
      kind: "bigNumber",
      value: "3 Patienten",
      caption: "Facebook- und Instagram-Anzeigen, ein Monat, 75.000€ Neuumsatz",
    },
  },
];

export const TAB_DEFS: { id: Stat["tab"]; label: string }[] = [
  { id: "conversion", label: "Abschluss" },
  { id: "vertrauen", label: "Vertrauen" },
  { id: "markt", label: "Markt" },
  { id: "case", label: "Fallbeispiele" },
];
