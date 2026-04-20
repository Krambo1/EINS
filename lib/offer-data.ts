export type BasispaketItem = {
  id: string;
  number: string;
  title: string;
  value: number;
  bullets: string[];
};

export const BASISPAKET: BasispaketItem[] = [
  {
    id: "haupt-asset",
    number: "01",
    title: "Haupt-Medien Produktion",
    value: 8000,
    bullets: [
      "Voller Produktionstag für Ihre profitabelste Behandlung (z. B. Implantate, All-on-4, Vollkeramik, Invisalign).",
      "Exklusives Strategie-Meeting: Zielgruppen, Positionierung, USPs und Tonalität.",
      "Hochauflösendes Video mit medizinischer Videoanimation.",
      "Erklärt komplexe Eingriffe verständlich und vertrauensbildend: Knochenstatus, Einheilzeit, Vorher-Nachher.",
      "Fokus: hohe Marge, emotionale Sicherheit, zahnmedizinisch seriös.",
    ],
  },
  {
    id: "foto-suite",
    number: "02",
    title: "Foto-Suite",
    value: 3500,
    bullets: [
      "20 hochwertige Fotos für Website, Anzeigen und soziale Medien.",
      "Praxis, Team, Behandlungsräume, Technologie, alles was Vertrauen schafft.",
      "Professionelle Nachbearbeitung auf Premium-Niveau.",
      "Sofort einsetzbar für alle Werbekanäle.",
    ],
  },
  {
    id: "motion-archiv",
    number: "03",
    title: "Dental Motion Archiv",
    value: 3000,
    bullets: [
      "Bibliothek an 2D-Animationen, maßgeschneidert auf Ihre Praxis.",
      "Abgedeckt: Implantate, Knochenaufbau, Zahnersatz, Invisalign, Bleaching, Wurzelkanal, Veneers, Parodontitis-Therapie.",
      "Reduziert Patientenangst vor dem ersten Kontakt durch visuelle Aufklärung der Behandlungsschritte.",
      "Besonders wirksam für erklärungsbedürftige Eingriffe wie Sofortimplantation oder All-on-4.",
    ],
  },
  {
    id: "hwg-zhg",
    number: "04",
    title: "Rechtsprüfung der Werbung",
    value: 1500,
    bullets: [
      "Prüfung aller Werbebotschaften auf Konformität mit Heilmittelwerbegesetz und zahnärztlichem Berufsrecht.",
      "Schutz vor Abmahnungen und Berufsrechtsverstößen.",
      "Dokumentierte Rechtssicherheit für Zahnärzte und Praxisinhaber.",
      "Besonders relevant: Vorher-Nachher-Darstellungen, Preisangaben, Erfolgsversprechen.",
    ],
  },
  {
    id: "landingpages",
    number: "05",
    title: "Konvertierende Zielseiten",
    value: 3000,
    bullets: [
      "Eigene Zielseiten für hochpreisige Behandlungen, ausschließlich für bezahlte Anzeigen gebaut.",
      "Voroptimierte Vorlagen für Implantate, All-on-4, Invisalign, Veneers, Zahnersatz.",
      "Keine Navigation, kein Ablenkungsmenü, einziges Ziel: Beratungsanfrage.",
      "Vertrauenselemente sichtbar: Bewertungen, Zertifikate, Vorher-Nachher, Zahnarzt-Profil, Implantatsystem (Straumann, Nobel Biocare).",
      "DSGVO-konforme Formularlogik mit maximal 5 Feldern. Mobiloptimiert, unter 2 Sekunden Ladezeit.",
    ],
  },
];

export const BASISPAKET_PRICE = 12999;
export const BASISPAKET_VALUE = 19000;

export type RetainerRow = {
  label: string;
  standard: string | boolean;
  premium: string | boolean;
};

export const RETAINER_ROWS: RetainerRow[] = [
  { label: "Monatliche Investition", standard: "2.600 € / Monat", premium: "3.900 € / Monat" },
  { label: "Kampagnensteuerung & Optimierung", standard: true, premium: true },
  { label: "Werbebudget-Kontrolle", standard: true, premium: true },
  { label: "Strecken-Optimierung", standard: true, premium: true },
  { label: "Organische Beiträge auf sozialen Medien", standard: true, premium: true },
  { label: "KI-Vorqualifizierung und automatische Verteilung", standard: true, premium: true },
  { label: "Monatliche Auswertung", standard: true, premium: true },
  { label: "Praxis-Reputationssystem (Google-Bewertungen, Patientenstimmen)", standard: true, premium: true },
  { label: "Vertriebsleitfaden für Ihr Praxisteam", standard: true, premium: true },
  { label: "Technischer Support", standard: "Standard", premium: "Priorität < 3h" },
  { label: "Strategie-Meetings", standard: "Monatlich", premium: "2x monatlich" },
  { label: "Neue Medien", standard: false, premium: "1 / Quartal" },
  { label: "Auswertungs-Übersicht", standard: "Standard", premium: "Erweitert" },
  { label: "Account Management", standard: "Team", premium: "Manager" },
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
  { label: "Garantie", leads: 90, conversion: 15, patients: 13, returnEur: 58500 },
  { label: "Konservativ", leads: 90, conversion: 20, patients: 18, returnEur: 81000 },
  { label: "Durchschnitt", leads: 130, conversion: 30, patients: 39, returnEur: 175500, highlight: true },
  { label: "Gut", leads: 130, conversion: 40, patients: 52, returnEur: 234000 },
  { label: "Top", leads: 170, conversion: 50, patients: 85, returnEur: 382500 },
];
