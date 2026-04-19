export type Station = {
  when: string;
  title: string;
  bullets: string[];
};

export const STATIONS: Station[] = [
  {
    when: "Woche 1 bis 2",
    title: "Aufbau",
    bullets: [
      "Videodreh und Foto-Shooting in Ihrer Praxis",
      "Anbindung an Ihre bestehende Software",
      "Rechtsprüfung Ihrer Werbebotschaften",
      "Vorbereitung der Anzeigen",
    ],
  },
  {
    when: "Woche 3",
    title: "Start",
    bullets: [
      "Anzeigen gehen live",
      "Erste Anfragen innerhalb einer Woche",
      "Tägliche Überwachung",
    ],
  },
  {
    when: "Ab Woche 6",
    title: "Feinjustierung",
    bullets: [
      "Anfragen werden weiter verbessert",
      "Wir testen verschiedene Varianten",
      "Fokus auf hochpreisige Behandlungen",
    ],
  },
  {
    when: "Tag 90",
    title: "Auswertung",
    bullets: [
      "Auswertung Ihrer Erträge",
      "Bewertung Ihres Patienten-Stroms",
      "Wachstumsplan für die nächsten 9 Monate",
    ],
  },
];
