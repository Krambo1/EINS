export type PainQuote = {
  id: number;
  quote: string;
  body: string;
  who: string;
  where: string;
  chapter: string;
};

export const PAIN_QUOTES: PainQuote[] = [
  {
    id: 1,
    quote: "Drei Agenturen in vier Jahren. Keine hat wirklich geliefert.",
    body: "Das Muster ist immer dasselbe: Standard-Funnel, austauschbare Reels, kein System dahinter. Es liegt nicht an Ihnen — es liegt am Modell.",
    who: "Dr. M.",
    where: "Düsseldorf",
    chapter: "Agenturen",
  },
  {
    id: 2,
    quote: "40.000 € im Jahr für Werbung. Und ich weiß bis heute nicht, was es bringt.",
    body: "Budget ohne System verbrennt. Sechzig Prozent fließen in Reichweite, die nie zum Erstgespräch wird — und niemand sagt Ihnen, welche.",
    who: "Dr. S.",
    where: "Köln",
    chapter: "Werbebudget",
  },
  {
    id: 3,
    quote: "Mein Kalender ist voll. Nur eben mit den falschen Patienten.",
    body: "Mehr Anfragen lösen das Problem nicht — sie verschärfen es. Was Sie brauchen, ist Qualifizierung vor dem ersten Anruf, nicht im Beratungsgespräch.",
    who: "Dr. K.",
    where: "Essen",
    chapter: "Patientenmix",
  },
  {
    id: 4,
    quote: "Marketing ist mein zweiter Vollzeitjob geworden.",
    body: "Wenn der Auftritt nur funktioniert, solange Sie selbst Reels drehen, ist es kein System. Es ist eine Belastung — und sie wird größer, nicht kleiner.",
    who: "Dr. L.",
    where: "Bonn",
    chapter: "Engpass",
  },
  {
    id: 5,
    quote: "Ich verstehe nicht genau, was meine Agentur eigentlich macht.",
    body: "Abhängigkeit entsteht, wenn die Mechanik in einer Black Box liegt. Zugänge, Reports, Übergabe — bei uns gehört das von Tag eins Ihnen.",
    who: "Dr. T.",
    where: "Köln",
    chapter: "Abhängigkeit",
  },
];
