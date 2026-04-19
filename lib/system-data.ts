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
    title: "Professionelle Inhalte",
    bullets: [
      "Hochwertige Videos, Animationen und Fotos für Ihre Praxis.",
      "Erklärt Behandlungen klar und baut Vertrauen auf, schon bevor der Patient anruft.",
      "Patienten kommen vorbereitet in die Beratung, nicht mit offenen Fragen.",
    ],
  },
  {
    number: "02",
    shape: "circle",
    title: "Bezahlte Werbung",
    bullets: [
      "Anzeigen auf Instagram, Facebook und Google.",
      "Wir zeigen Ihre Praxis genau den Menschen, die Implantate, Veneers oder Invisalign suchen.",
      "Sie sehen jeden Tag, was jeder Euro gebracht hat.",
    ],
  },
  {
    number: "03",
    shape: "square",
    title: "KI-Patientenfilter",
    bullets: [
      "Eine KI prüft jede Anfrage, bevor sie bei Ihnen landet.",
      "Preisjäger und Spam werden automatisch aussortiert.",
      "Nur ernsthafte Patienten erreichen Ihr Team, mit Wunschbehandlung und Terminvorschlag.",
      "Funktioniert mit Ihrer bestehenden Praxis-Software. DSGVO-konform.",
    ],
  },
];
