export type BasispaketItem = {
  id: string;
  number: string;
  title: string;
  bullets: string[];
};

export const BASISPAKET: BasispaketItem[] = [
  {
    id: "haupt-asset",
    number: "01",
    title: "Haupt-Medien Produktion",
    bullets: [
      "Voller Produktionstag für Ihre profitabelste Behandlung (z. B. Facelift, Liposuktion, Lippenunterspritzung, Kryolipolyse).",
      "Exklusives Strategie-Meeting: Zielgruppen, Positionierung, USPs und Tonalität.",
      "Hochauflösendes Video mit medizinischer Videoanimation.",
      "Erklärt komplexe Eingriffe verständlich und vertrauensbildend: Ablauf, Ausfallzeit, realistische Ergebnisse.",
      "Fokus: hohe Marge, emotional, medizinisch seriös.",
    ],
  },
  {
    id: "foto-suite",
    number: "02",
    title: "Foto-Suite",
    bullets: [
      "20 hochwertige Fotos für Website, Anzeigen und soziale Medien.",
      "Klinik, Team, Behandlungsräume, Technologie, alles was Vertrauen schafft.",
      "Professionelle Nachbearbeitung auf Premium-Niveau.",
      "Sofort einsetzbar für alle Werbekanäle.",
    ],
  },
  {
    id: "motion-archiv",
    number: "03",
    title: "Behandlungs-Motion-Archiv",
    bullets: [
      "Bibliothek an 2D-Animationen, maßgeschneidert auf Ihre Klinik.",
      "Abgedeckt: Faltenunterspritzung, Lippenunterspritzung, Botox, Hyaluron-Filler, Kryolipolyse, HIFU, Laser-Behandlungen, Body Contouring.",
      "Reduziert Patientenangst vor dem ersten Kontakt durch visuelle Aufklärung der Behandlungsschritte.",
      "Besonders wirksam für erklärungsbedürftige Eingriffe wie Facelift, Liposuktion oder Kryolipolyse.",
    ],
  },
  {
    id: "hwg-zhg",
    number: "04",
    title: "Rechtsprüfung der Werbung",
    bullets: [
      "KI-gestützte Prüfung aller Werbebotschaften, Anzeigentexte und Video-Scripts gegen die typischen HWG-Abmahnmuster.",
      "Erfasst Vorher-Nachher-Logik, Heilsversprechen, Lockangebote, Superlative und Verharmlosung.",
      "Schutz vor den häufigsten Abmahnfallen des Heilmittelwerbegesetzes und ärztlichen Berufsrechts.",
      "Grenzfälle werden zur anwaltlichen Einzelfallprüfung eskaliert. Ersetzt keine Prüfung durch einen Fachanwalt.",
    ],
  },
  {
    id: "landingpages",
    number: "05",
    title: "Konvertierende Ziel-Websites",
    bullets: [
      "Eigene Ziel-Websites für hochpreisige Behandlungen, ausschließlich für bezahlte Anzeigen gebaut.",
      "Voroptimierte Vorlagen für Faltenbehandlung, Lippenunterspritzung, Kryolipolyse, Laser-Behandlungen, Facelift.",
      "Keine Navigation, kein Ablenkungsmenü, einziges Ziel: Beratungsanfrage.",
      "Vertrauenselemente sichtbar: Bewertungen, Zertifikate, HWG-konforme Vorher-Nachher-Dokumentation, Arzt-Profil, verwendete Technologien und Produkte.",
      "DSGVO-konforme Formularlogik mit maximal 5 Feldern. Mobiloptimiert, unter 2 Sekunden Ladezeit.",
    ],
  },
];

export type Tier = {
  id: "standard" | "erweitert" | "premium";
  name: string;
  price: string;
  priceSuffix: string;
  description: string;
  badge?: string;
  highlight?: boolean;
};

export const TIERS: Tier[] = [
  {
    id: "standard",
    name: "Standard",
    price: "2.600 €",
    priceSuffix: "/ Monat",
    description: "Für kleine oder neue Klinikteams.",
  },
  {
    id: "erweitert",
    name: "Erweitert",
    price: "3.900 €",
    priceSuffix: "/ Monat",
    badge: "Für die meisten Praxen",
    highlight: true,
    description: "Engere Steuerung, zwei Strategie-Meetings pro Monat.",
  },
  {
    id: "premium",
    name: "Premium",
    price: "7.900 €",
    priceSuffix: "/ Monat",
    description: "Für Klinikgruppen mit mehreren Standorten.",
  },
];

export type RetainerRow = {
  label: string;
  standard: string | boolean;
  erweitert: string | boolean;
  premium: string | boolean;
};

export const RETAINER_ROWS: RetainerRow[] = [
  { label: "Standorte inklusive", standard: "1", erweitert: "1", premium: "bis zu 3" },
  { label: "Kampagnensteuerung & Optimierung", standard: true, erweitert: true, premium: true },
  { label: "Werbebudget-Kontrolle", standard: true, erweitert: true, premium: true },
  { label: "Strecken-Optimierung", standard: true, erweitert: true, premium: true },
  { label: "Organische Beiträge auf sozialen Medien", standard: true, erweitert: true, premium: true },
  { label: "KI-Vorqualifizierung und automatische Verteilung", standard: true, erweitert: true, premium: true },
  { label: "Monatliche Auswertung", standard: true, erweitert: true, premium: true },
  { label: "Klinik-Reputationssystem (Google-Bewertungen, Patientenstimmen)", standard: true, erweitert: true, premium: true },
  { label: "Vertriebsleitfaden für Ihr Klinikteam", standard: true, erweitert: true, premium: true },
  { label: "EINS Portal-Zugang (24/7 Live-Dashboard)", standard: true, erweitert: true, premium: true },
  { label: "Technischer Support", standard: "Standard", erweitert: "Priorität < 3h", premium: "Priorität < 1h" },
  { label: "Strategie-Meetings", standard: "Monatlich", erweitert: "2x monatlich", premium: "Wöchentlich" },
  { label: "Neue Medien", standard: false, erweitert: "1 / Quartal", premium: "1 / Monat" },
  { label: "Auswertungs-Übersicht", standard: "Standard", erweitert: "Erweitert", premium: "Erweitert + Standort-Drilldown" },
  { label: "Account Management", standard: "Team", erweitert: "Manager", premium: "Account Director" },
  { label: "Standortspezifische Kampagnen mit eigenem Werbekonto", standard: false, erweitert: false, premium: true },
  { label: "Patienten-Routing zum nächstgelegenen Standort", standard: false, erweitert: false, premium: true },
  { label: "Lokale Wettbewerbsbeobachtung pro Standort", standard: false, erweitert: false, premium: true },
  { label: "Erfolgreiche Methoden zwischen Standorten teilen", standard: false, erweitert: false, premium: true },
];

export type Scenario = {
  label: string;
  leads: number;
  conversion: number;
  patients: number;
  returnEur: number;
  highlight?: boolean;
};

export const SCENARIOS: Scenario[] = [
  { label: "Untergrenze", leads: 90, conversion: 15, patients: 13, returnEur: 39000 },
  { label: "Konservativ", leads: 90, conversion: 20, patients: 18, returnEur: 54000 },
  { label: "Durchschnitt", leads: 130, conversion: 30, patients: 39, returnEur: 117000, highlight: true },
  { label: "Gut", leads: 130, conversion: 40, patients: 52, returnEur: 156000 },
  { label: "Top", leads: 170, conversion: 50, patients: 85, returnEur: 255000 },
];
