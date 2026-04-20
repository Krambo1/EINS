export type Station = {
  when: string;
  title: string;
  bullets: string[];
};

export const STATIONS: Station[] = [
  {
    when: "Woche 1–2",
    title: "Wir kommen zu Ihnen",
    bullets: [
      "Videodreh und Fotoshooting in Ihrer Praxis",
      "Anbindung an Ihre Praxis-Software",
      "Rechtsprüfung aller Werbebotschaften",
    ],
  },
  {
    when: "Woche 3",
    title: "Anzeigen gehen live",
    bullets: [
      "Ihre Anzeigen laufen auf Instagram, Facebook und Google",
      "Erste Patientenanfragen innerhalb weniger Tage",
      "Wir überwachen täglich die Performance",
    ],
  },
  {
    when: "Ab Woche 6",
    title: "Wir optimieren",
    bullets: [
      "Wir testen verschiedene Varianten, was am besten funktioniert",
      "Fokus auf Ihre profitabelsten Behandlungen",
      "Die Kosten pro Anfrage sinken kontinuierlich",
    ],
  },
  {
    when: "Tag 90",
    title: "Bilanz ziehen",
    bullets: [
      "Vollständige Auswertung Ihrer Ergebnisse",
      "Konkrete Zahlen zu Anfragen, Patienten und Umsatz",
      "Wachstumsplan für die nächsten 9 Monate",
    ],
  },
];
