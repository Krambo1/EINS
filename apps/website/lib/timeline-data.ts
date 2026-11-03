// Ablauf nach der Unterschrift. Wording follows docs/umbau-ki-organisch/KANON.md,
// section 9. The section renders four stations side by side (md:grid-cols-4).

export type Station = {
  when: string;
  title: string;
  bullets: string[];
};

export const STATIONS: Station[] = [
  {
    when: "Woche 1",
    title: "Sie nehmen einmal kurz auf",
    bullets: [
      "Die 90 Tage beginnen am Tag der Unterschrift",
      "Onboarding-Gespräch per Video: Einwilligung und Zugänge",
      "Klon-Aufnahme am Handy: einmal wenige Minuten Video und Stimme",
    ],
  },
  {
    when: "Woche 1 bis 2",
    title: "Klon und Zielseite stehen",
    bullets: [
      "Die ersten Beiträge gehen zur Freigabe",
      "Anbindung an Ihre Praxis-Software",
      "KI-Rechtsprüfung aller Beiträge",
    ],
  },
  {
    when: "Ab Woche 2",
    title: "Beiträge gehen live",
    bullets: [
      "Die ersten Beiträge laufen auf Ihren Kanälen",
      "Anfragen laufen mit Herkunft in Ihr Portal",
      "Wöchentliche Freigabe in wenigen Minuten, monatliche Auswertung im Portal",
    ],
  },
  {
    when: "Erste qualifizierte Anfrage",
    title: "Erste Rechnung, dann Werbebudget",
    bullets: [
      "Erst jetzt kommt die erste Rechnung",
      "Wir schlagen vor, welches Werbebudget hinter welche Beiträge gehört",
      "Kommt bis Tag 90 keine erste qualifizierte Anfrage über EINS, endet die Zusammenarbeit ohne Kosten. Steht eine Mitwirkung von Ihnen aus, verlängern sich die 90 Tage um diese Tage, aber nur, wenn wir Ihnen den Verzug per E-Mail mitgeteilt haben",
    ],
  },
];
