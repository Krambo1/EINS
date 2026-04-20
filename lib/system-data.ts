export type Layer = {
  number: string;
  shape: "triangle" | "circle" | "square";
  title: string;
  bullets: string[];
};

export const LAYERS: Layer[] = [
  {
    number: "01",
    shape: "triangle",
    title: "Videos & Fotos",
    bullets: [
      "Wir kommen in Ihre Praxis und produzieren Videos, Animationen und Fotos mit Ihnen und Ihrem Team.",
      "Potenzielle Patienten bauen Vertrauen auf, bevor sie überhaupt anrufen.",
      "Sie führen Beratungen mit informierten Patienten, nicht mit Fragezeichen.",
    ],
  },
  {
    number: "02",
    shape: "circle",
    title: "Anzeigen auf Social Media",
    bullets: [
      "Wir schalten Ihre Anzeigen auf Instagram, Facebook und Google, gezielt in Ihrer Region.",
      "Erreicht genau die Menschen, die gerade nach Implantaten, Veneers oder Invisalign suchen.",
      "Sie sehen täglich, wie viele Anfragen jeder Euro bringt.",
    ],
  },
  {
    number: "03",
    shape: "square",
    title: "KI sortiert Anfragen vor",
    bullets: [
      "Eine KI prüft jede neue Anfrage automatisch, bevor sie bei Ihrem Team landet.",
      "Preisjäger und Spam werden aussortiert. Ihre Mitarbeiter verlieren keine Zeit mehr damit.",
      "Ernsthafte Patienten melden sich bereits mit Wunschbehandlung und Terminvorschlag.",
      "Läuft parallel zu Ihrer Praxis-Software. 100 % DSGVO-konform.",
    ],
  },
];
