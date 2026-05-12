export type BasispaketSection = {
  id: string;
  title: string;
  bullets: string[];
};

// One single Basispaket. Foto and Motion-Archiv are folded into Medienproduktion;
// Rechtsprüfung and Landingpages remain as their own sub-sections inside the same package.
export const BASISPAKET: BasispaketSection[] = [
  {
    id: "medienproduktion",
    title: "Medienproduktion",
    bullets: [
      "Voller Produktionstag in Ihrer Praxis für Ihre profitabelste Behandlung (z. B. Facelift, Liposuktion, Lippenunterspritzung, Kryolipolyse).",
      "Exklusives Strategie-Meeting: Zielgruppen, Positionierung, USPs und Tonalität.",
      "Hochauflösendes Hauptvideo mit medizinischer Videoanimation. Erklärt komplexe Eingriffe verständlich und vertrauensbildend: Ablauf, Ausfallzeit, realistische Ergebnisse.",
      "20 hochwertige Fotos für Website, Anzeigen und soziale Medien: Praxis, Team, Behandlungsräume, Technologie. Professionelle Premium-Nachbearbeitung, sofort einsetzbar.",
      "Eigene Bibliothek an 2D-Animationen, maßgeschneidert auf Ihre Praxis: Faltenunterspritzung, Lippenunterspritzung, Botox, Hyaluron-Filler, Kryolipolyse, HIFU, Laser-Behandlungen, Body Contouring.",
      "Reduziert Patientenangst vor dem ersten Kontakt durch visuelle Aufklärung der Behandlungsschritte. Besonders wirksam für erklärungsbedürftige Eingriffe.",
    ],
  },
  {
    id: "hwg-zhg",
    title: "Rechtsprüfung der Werbung",
    bullets: [
      "KI-gestützte Prüfung aller Werbebotschaften, Anzeigentexte und Video-Scripts gegen die typischen HWG-Abmahnmuster.",
      "Erfasst Vorher-Nachher-Logik, Heilsversprechen, Lockangebote, Superlative und Verharmlosung.",
      "Schutz vor den häufigsten Abmahnfallen des Heilmittelwerbegesetzes und ärztlichen Berufsrechts.",
      "Grenzfälle werden zur anwaltlichen Einzelfallprüfung eskaliert.",
    ],
  },
  {
    id: "landingpages",
    title: "Maßgeschneiderte Ziel-Websites",
    bullets: [
      "Eigene Ziel-Websites für hochpreisige Behandlungen, ausschließlich für bezahlte Anzeigen gebaut.",
      "Voroptimierte Vorlagen für Faltenbehandlung, Lippenunterspritzung, Kryolipolyse, Laser-Behandlungen, Facelift.",
      "Keine Navigation, kein Ablenkungsmenü, einziges Ziel: Beratungsanfrage.",
      "Vertrauenselemente sichtbar: Bewertungen, Zertifikate, HWG-konforme Vorher-Nachher-Dokumentation, Arzt-Profil, verwendete Technologien und Produkte.",
      "DSGVO-konforme Formularlogik mit maximal 5 Feldern. Mobiloptimiert, unter 2 Sekunden Ladezeit.",
    ],
  },
];

export const RETAINER = {
  name: "Wachstumssystem",
  price: "3.900 €",
  priceSuffix: "/ Monat",
  description:
    "Ein Paket. Alles drin. Komplette Steuerung, Optimierung und Begleitung Ihrer Patientengewinnung.",
} as const;
