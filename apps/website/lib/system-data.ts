export type OfferCard = {
  id:
    | "medienproduktion"
    | "rechtspruefung"
    | "landingpages"
    | "social-ads"
    | "reputation"
    | "ki-sortier"
    | "begleitung";
  title: string;
  teaser: string;
  bullets: string[];
};

export const OFFER_CARDS: OfferCard[] = [
  {
    id: "medienproduktion",
    title: "Medienproduktion",
    teaser:
      "Videos, Animationen und Fotos in Ihrer Praxis, mit Ihrem Team. Patienten bauen Vertrauen auf, bevor sie anrufen.",
    bullets: [
      "Voller Produktionstag in Ihrer Praxis für Ihre profitabelste Behandlung (z. B. Facelift, Liposuktion, Lippenunterspritzung, Kryolipolyse).",
      "Exklusives Strategie-Meeting: Zielgruppen, Positionierung, USPs und Tonalität.",
      "Hochauflösendes Hauptvideo mit medizinischer Videoanimation. Erklärt komplexe Eingriffe verständlich und vertrauensbildend: Ablauf, Ausfallzeit, realistische Ergebnisse.",
      "20 hochwertige Fotos für Website, Anzeigen und soziale Medien: Praxis, Team, Behandlungsräume, Technologie. Professionelle Premium-Nachbearbeitung, sofort einsetzbar.",
      "Eigene Bibliothek an 2D-Animationen, maßgeschneidert auf Ihre Praxis: Faltenunterspritzung, Lippenunterspritzung, Botox, Hyaluron-Filler, Kryolipolyse, HIFU, Laser-Behandlungen, Körperformung.",
      "Reduziert Patientenangst vor dem ersten Kontakt durch visuelle Aufklärung der Behandlungsschritte. Besonders wirksam für erklärungsbedürftige Eingriffe.",
    ],
  },
  {
    id: "rechtspruefung",
    title: "Rechtsprüfung der Werbung",
    teaser:
      "KI-gestützte Prüfung jeder Werbebotschaft gegen typische HWG-Abmahnmuster. Schutz vor den teuersten Fallen.",
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
    teaser:
      "Eigene Ziel-Websites für hochpreisige Behandlungen, ausschließlich für bezahlte Anzeigen gebaut.",
    bullets: [
      "Eigene Ziel-Websites für hochpreisige Behandlungen, ausschließlich für bezahlte Anzeigen gebaut.",
      "Voroptimierte Vorlagen für Faltenbehandlung, Lippenunterspritzung, Kryolipolyse, Laser-Behandlungen, Facelift.",
      "Keine Navigation, kein Ablenkungsmenü, einziges Ziel: Beratungsanfrage.",
      "Vertrauenselemente sichtbar: Bewertungen, Zertifikate, HWG-konforme Vorher-Nachher-Dokumentation, Arzt-Profil, verwendete Technologien und Produkte.",
      "DSGVO-konforme Formularlogik mit maximal 5 Feldern. Mobiloptimiert, unter 2 Sekunden Ladezeit.",
    ],
  },
  {
    id: "social-ads",
    title: "Anzeigen auf sozialen Medien",
    teaser:
      "Anzeigen auf Instagram, Facebook und Google, gezielt in Ihrer Region. Sie sehen täglich, was jeder Euro an Anfragen bringt.",
    bullets: [
      "Anzeigen auf Instagram, Facebook und Google, gezielt in Ihrer Region.",
      "Erreicht Menschen, die gerade nach Faltenbehandlung, Lippenunterspritzung oder Körperformung suchen.",
      "Sie sehen täglich, was jeder Euro an Anfragen bringt.",
      "Tägliche Kampagnensteuerung & Optimierung durch das EINS-Optimierungsteam.",
      "Volle Werbebudget-Kontrolle: jeder Euro live einsehbar, direkt an Meta und Google gezahlt.",
      "Laufende Strecken-Optimierung, von der Anzeige über die Ziel-Website bis zur Anfrage.",
      "Monatliche Auswertung mit kompakter Übersicht aller relevanten Kennzahlen.",
    ],
  },
  {
    id: "reputation",
    title: "Praxis-Reputationssystem",
    teaser:
      "Eine schlechte Bewertung kostet schnell einen Monat Anfragen. Wir bauen kontinuierlich echte 5-Sterne-Bewertungen auf Google und Jameda auf, sodass einzelne Ausreißer untergehen.",
    bullets: [
      "Kontinuierlicher Aufbau echter 5-Sterne-Bewertungen auf Google und Jameda, damit eine einzelne negative Stimme nicht den Ausschlag gibt.",
      "Hält Ihre Praxis sicher über der 4-Sterne-Schwelle, ab der die meisten Patienten überhaupt erst anfragen.",
      "Strukturierte Erfassung von Patientenstimmen für Website, Anzeigen und Ziel-Websites.",
      "Organische Beiträge auf sozialen Medien begleiten die bezahlten Kampagnen und halten Ihre Praxis sichtbar.",
    ],
  },
  {
    id: "ki-sortier",
    title: "KI sortiert Anfragen vor",
    teaser:
      "Preisjäger und Spam werden klar markiert, Ihr Team sieht sofort, welche Anfragen ernst gemeint sind",
    bullets: [
      "KI prüft jede Anfrage, bevor sie Ihr Team erreicht.",
      "Preisjäger und Spam fliegen raus. Ernsthafte Patienten kommen mit Wunschbehandlung und Wunschtermin.",
      "Läuft parallel zu Ihrer Praxis-Software. DSGVO-konform.",
    ],
  },
  {
    id: "begleitung",
    title: "Strategische Begleitung",
    teaser:
      "Regelmäßige Strategie-Meetings, technischer Support und ein erprobter Vertriebsleitfaden für Ihr Praxisteam.",
    bullets: [
      "Regelmäßige Strategie-Meetings mit Ihrem dedizierten EINS-Ansprechpartner.",
      "Vertriebsleitfaden für Ihr Praxisteam: erprobte Skripte für die Annahme qualifizierter Anfragen.",
      "Technischer Support für Portal, Ziel-Websites und Anfrage-Strecken: direkter Draht statt Servicewarteschleife.",
    ],
  },
];
