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
    headline: "höhere Conversions mit Video auf der Landingpage",
    bigNumber: { value: 86, suffix: "%" },
    salesFrame:
      "Ihre Implantat-Landingpage ohne Video lässt den Großteil des bezahlten Traffics ungenutzt verpuffen. Ein einzelnes professionelles Erklärvideo kann die Lead-Kosten halbieren.",
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
    headline: "bessere Conversion: Landingpage vs. Homepage bei Paid Traffic",
    bigNumber: { value: 3, suffix: "x" },
    salesFrame:
      "Wer Meta- oder Google-Anzeigen auf die Startseite schickt, verbrennt Budget. Jede Behandlung braucht eine eigene, fokussierte Seite.",
    source: "Instapage & Unbounce Conversion Benchmarks, 2019 bis 2025",
    viz: {
      kind: "comparativeBar",
      a: { label: "Homepage", value: 2.5 },
      b: { label: "Dedizierte Landingpage", value: 6.6 },
      unit: "% CR",
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
      "Über die Hälfte der potenziellen Patienten beurteilt Ihre Praxis online, bevor sie anruft. Wer in diesem Moment nicht überzeugt, verliert den Lead still und leise.",
    source: "Bitkom Research, repräsentative Befragung, 2026",
    viz: { kind: "gauge", value: 55 },
  },
  {
    id: "compare-providers",
    tab: "vertrauen",
    headline: "der Suchenden vergleichen 2 bis 5 Anbieter vor der Entscheidung",
    bigNumber: { value: 70, suffix: "%" },
    salesFrame:
      "Ihre Praxis wird fast nie isoliert betrachtet. Fotos, Videos, Bewertungen und Landingpage werden nebeneinander mit 2 bis 5 Mitbewerbern verglichen.",
    source: "MyAdvice 2024 Dental Patient Survey Report",
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
    id: "selbstzahler-2030",
    tab: "markt",
    headline: "Wachstum im Selbstzahler-Umsatz deutscher Zahnarztpraxen bis 2030",
    bigNumber: { value: 70, prefix: "+", suffix: "%" },
    salesFrame:
      "Das Wachstum passiert nicht bei Kassenleistungen. Es passiert dort, wo EINS Visuals Patienten gewinnt: Implantate, Veneers, Aligner, IGeL.",
    source: "Bundeszahnärztekammer / KZBV, Wachstumseffekte der Mundgesundheitswirtschaft",
    viz: {
      kind: "lineGrowth",
      points: [
        { year: "2024", value: 100 },
        { year: "2026", value: 122 },
        { year: "2028", value: 148 },
        { year: "2030", value: 170 },
      ],
      suffix: " Index",
    },
  },
  {
    id: "isaps-growth",
    tab: "markt",
    headline: "Anstieg ästhetischer Eingriffe weltweit in 4 Jahren",
    bigNumber: { value: 41.3, suffix: "%", decimals: 1, prefix: "+" },
    salesFrame:
      "Der Markt wächst strukturell und schnell. Kliniken, die jetzt sichtbar und professionell aufgestellt sind, sichern sich überproportionale Marktanteile.",
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
    headline: "Marktpreise in Deutschland für hochpreisige Zahnbehandlungen",
    bigNumber: { value: 4700, prefix: "Ø ", suffix: " EUR" },
    salesFrame:
      "Bei einem Implantat-Fallwert von 3.500 EUR finanzieren drei zusätzliche Patienten pro Monat einen vollständigen Video-Funnel mehrfach.",
    source: "Deutsche Mundgesundheitsstiftung, Check24, GZFA, 2022 bis 2025",
    viz: {
      kind: "priceRange",
      items: [
        { label: "Einzelimplantat", min: 2200, max: 4700 },
        { label: "All-on-4 pro Kiefer", min: 20000, max: 30000 },
        { label: "Invisalign Full", min: 3500, max: 8500 },
        { label: "Keramikveneers / Zahn", min: 600, max: 1200 },
      ],
    },
  },
  {
    id: "roas-implant",
    tab: "case",
    headline: "ROAS bei einer dokumentierten Implantat-Kampagne über 3 Jahre",
    bigNumber: { value: 1252, suffix: "%" },
    salesFrame:
      "Strukturierte Implantat-Funnels mit starken Landingpages erzielen zweistellige ROAS-Faktoren. Der Engpass ist fast immer das Creative und die Funnel-Qualität, nicht das Budget.",
    source: "Dental Metrics All-on-4 & Dental Implant Marketing Case Study, 2018",
    viz: {
      kind: "bigNumber",
      value: "66.400 EUR",
      caption: "Adspend, 160 qualifizierte Konsultationen, 1.252 % ROAS",
    },
  },
  {
    id: "uk-case",
    tab: "case",
    headline: "neuer Implantat-Umsatz aus 3 Patienten in einem Monat",
    bigNumber: { value: 70000, prefix: "£ ", suffix: "" },
    salesFrame:
      "Bei Fallwerten von 3.000 bis 5.000 EUR pro Implantat reichen wenige qualifizierte Leads, um Kampagnenkosten und Creative-Investition vielfach zurückzuverdienen.",
    source: "UK Dental Marketing Agency Case Study, 2024",
    viz: {
      kind: "bigNumber",
      value: "3 Patienten",
      caption: "Facebook- und Instagram-Ads, ein Monat, £ 70.000 Neuumsatz",
    },
  },
];

export const TAB_DEFS: { id: Stat["tab"]; label: string }[] = [
  { id: "conversion", label: "Conversion" },
  { id: "vertrauen", label: "Vertrauen" },
  { id: "markt", label: "Markt" },
  { id: "case", label: "Case Studies" },
];
