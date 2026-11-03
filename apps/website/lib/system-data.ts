// Copy for the offer cards and the budget note. Wording follows
// docs/umbau-ki-organisch/KANON.md (sections 3, 4, 8, 9). Card ids are internal
// keys for the card visuals in components/sections/system.tsx and stay stable.

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
    title: "KI-Videos mit Ihrem Klon",
    teaser:
      "Medizinisch seriöse Videos, in denen Ihr KI-Klon die Fragen beantwortet, die Patientinnen sich nicht zu stellen trauen. Sie müssen nie vor die Kamera.",
    bullets: [
      "Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf. Daraus entsteht Ihr KI-Klon.",
      "Videos für Ihre profitabelste Behandlung (z. B. Facelift, Liposuktion, Lippenunterspritzung, Kryolipolyse): Ihr Klon erklärt Ablauf, Ausfallzeit und was Patientinnen realistisch erwarten dürfen.",
      "Erklär-Animationen zeigen komplexe Eingriffe verständlich und vertrauensbildend: Faltenunterspritzung, Lippenunterspritzung, Botox, Hyaluron-Filler, Kryolipolyse, HIFU, Laser-Behandlungen, Körperformung.",
      "Bildmaterial für Website, Zielseite und soziale Medien.",
      "Reduziert Patientenangst vor dem ersten Kontakt durch visuelle Aufklärung der Behandlungsschritte. Besonders wirksam für erklärungsbedürftige Eingriffe.",
      "Themen, Tonfall und was Ihr Klon nie sagen darf, legen Sie fest.",
      "Erlaubt ist KI rund um den Arzt: Animation, Erklärvideos, Bildmaterial, dazu Ihr Klon als einzige künstliche Person. Keine KI-erzeugten Patientinnen, keine KI-erzeugten Behandlungsergebnisse, keine Vorher-Nachher-Darstellungen.",
      "Jedes Video ist als KI-generiert gekennzeichnet, wie es das Gesetz verlangt. Kein Beitrag geht ohne Ihre Freigabe raus.",
    ],
  },
  {
    id: "rechtspruefung",
    title: "Rechtsprüfung Ihrer Beiträge und Anzeigen",
    teaser:
      "KI-gestützte Prüfung jedes Beitrags und jeder Anzeige gegen typische HWG-Abmahnmuster. Schutz vor den teuersten Fallen.",
    bullets: [
      "KI-gestützte Prüfung aller Beiträge, Anzeigentexte und Video-Skripte gegen die typischen HWG-Abmahnmuster.",
      "Die Prüfung gilt für organische Beiträge genauso wie für bezahlte Anzeigen.",
      "Erfasst Vorher-Nachher-Logik, Heilsversprechen, Lockangebote, Superlative und Verharmlosung.",
      "Kennzeichnung als KI-generiert im Video und im Beitragstext.",
      "Schutz vor den häufigsten Abmahnfallen des Heilmittelwerbegesetzes und ärztlichen Berufsrechts.",
      "Grenzfälle werden zur anwaltlichen Einzelfallprüfung eskaliert.",
    ],
  },
  {
    id: "landingpages",
    title: "Maßgeschneiderte Ziel-Websites",
    teaser:
      "Eigene Ziel-Websites für hochpreisige Behandlungen: das Ziel Ihres Profil-Links und Ihrer Anzeigen.",
    bullets: [
      "Eigene Ziel-Websites für hochpreisige Behandlungen. Der Profil-Link Ihrer Kanäle führt hierhin, später auch Ihre Anzeigen.",
      "Voroptimierte Vorlagen für Faltenbehandlung, Lippenunterspritzung, Kryolipolyse, Laser-Behandlungen, Facelift.",
      "Keine Navigation, kein Ablenkungsmenü, einziges Ziel: Beratungsanfrage.",
      "Vertrauenselemente sichtbar: Bewertungen, Zertifikate, Arzt-Profil, verwendete Technologien und Produkte.",
      "DSGVO-konforme Formularlogik mit maximal 5 Feldern. Mobiloptimiert, unter 2 Sekunden Ladezeit.",
    ],
  },
  {
    id: "social-ads",
    title: "Reichweite: organisch zuerst, Anzeigen optional",
    teaser:
      "Wir veröffentlichen Ihre Beiträge organisch auf den Kanälen Ihrer Praxis. Sobald sichtbar ist, welche Beiträge Anfragen bringen, setzen wir bezahlte Anzeigen auf Meta und Google genau dahinter.",
    bullets: [
      "Zuerst organisch: Ihre freigegebenen Beiträge laufen auf den Kanälen Ihrer Praxis, der Profil-Link führt zu Ihrer Zielseite.",
      "Dann Anzeigen: Sobald sichtbar ist, welche Beiträge Anfragen bringen, setzen wir bezahlte Anzeigen auf Instagram, Facebook und Google genau dahinter, gezielt in Ihrer Region.",
      "Zu Beginn brauchen Sie kein Werbebudget. Ab der ersten qualifizierten Anfrage schlagen wir konkret vor, welches Werbebudget hinter welche Beiträge und Behandlungen gehört.",
      "Volle Werbebudget-Kontrolle: jeder Euro live einsehbar, direkt an Meta und Google gezahlt.",
      "Die Betreuung der Anzeigen ist im Preis enthalten: tägliche Steuerung und Optimierung durch das EINS-Optimierungsteam.",
      "Wir bewerten Beiträge und Anzeigen nach behandelten Patienten, nicht nach Klicks.",
      "Monatliche Auswertung im Portal: welche Beiträge und Anzeigen liefen, welche gestoppt wurden, wie viele Anfragen kamen und wie viele Behandlungen daraus wurden.",
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
      "Organische Beiträge auf den Kanälen Ihrer Praxis halten Sie sichtbar, bevor und während Anzeigen laufen.",
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
      "Monatliche Strategie-Meetings, technischer Support und ein erprobter Vertriebsleitfaden für Ihr Praxisteam.",
    bullets: [
      "Monatliche Strategie-Meetings, direkt mit dem Gründer.",
      "Vertriebsleitfaden für Ihr Praxisteam: erprobte Skripte für die Annahme qualifizierter Anfragen.",
      "Technischer Support für Portal, Ziel-Websites und Anfrage-Strecken: direkter Draht statt Servicewarteschleife.",
    ],
  },
];

// Note under the cards (components/sections/offer.tsx). Wording: KANON section 4.
export const BUDGET_NOTE = {
  label: "Wichtig zu wissen",
  title: "Zu Beginn brauchen Sie kein Werbebudget.",
  body: "Wir starten organisch. Sobald wir sehen, welche Beiträge Anfragen bringen, schlagen wir vor, wie viel Werbebudget dahinter gehört. Das Budget zahlen Sie direkt an Meta und Google.",
};
