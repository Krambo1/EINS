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
    title: "Content-Fundament",
    bullets: [
      "Professionelle Videos, Animationen und Fotos, die Behandlungen erklären und Vertrauen aufbauen.",
      "Kein reines Dokumentieren, sondern visuell aufbereitete Verkaufsargumente.",
      "Einwände werden reduziert, bevor der erste Patientenkontakt stattfindet.",
    ],
  },
  {
    number: "02",
    shape: "circle",
    title: "Performance-Werbung",
    bullets: [
      "Bezahlte Kampagnen auf Meta und Google für konkrete Behandlungen.",
      "Kaufkräftige Zielgruppen, Budget-Transparenz, kalkulierbare Kosten pro Lead.",
      "Kein Glücksspiel, sondern Marketing als Investition mit Erwartungswert.",
    ],
  },
  {
    number: "03",
    shape: "square",
    title: "KI-Lead-Infrastruktur",
    bullets: [
      "KI-gestütztes CRM mit automatisierter Vorqualifizierung, Scoring und Terminbuchung.",
      "KI filtert Preisjäger und Spam, bevor Ihr Team Zeit investiert.",
      "Low-Ticket läuft vollautomatisch, High-Ticket-Anfragen gehen vorqualifiziert an Ihr Team.",
      "Integration in DS-WIN, Z1, VISIdent, Doctolib. DSGVO-konform, AVV nach Art. 28 inklusive.",
    ],
  },
];
