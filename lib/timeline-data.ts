export type Station = {
  when: string;
  title: string;
  bullets: string[];
};

export const STATIONS: Station[] = [
  {
    when: "Woche 1 bis 2",
    title: "Basis",
    bullets: [
      "Produktionstag und Content-Erstellung",
      "CRM-Integration in bestehende Praxissysteme",
      "HWG- und ZHG-Rechtsprüfung wird eingeleitet",
      "Kampagnen-Setup",
    ],
  },
  {
    when: "Woche 3",
    title: "Launch",
    bullets: [
      "Kampagnen gehen live",
      "Erste Leads innerhalb einer Woche",
      "Tägliches Monitoring",
    ],
  },
  {
    when: "Ab Woche 6",
    title: "Optimierung",
    bullets: [
      "Lead-Qualität wird verfeinert",
      "A/B-Testing läuft",
      "Konversion-Optimierung auf Implantat- und High-Ticket-Anfragen",
    ],
  },
  {
    when: "Tag 90",
    title: "Performance Review",
    bullets: [
      "ROI-Analyse",
      "Pipeline-Bewertung",
      "Scale-Strategie für Monat 4 bis 12",
    ],
  },
];
