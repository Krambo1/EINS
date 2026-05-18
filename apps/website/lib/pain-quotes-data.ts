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
    body: "Jedes Mal die gleichen Vorlagen, die gleichen Videos, die gleichen Versprechen. Am Ende bleibt nichts in meiner Praxis hängen.",
    who: "Dr. M.",
    where: "Düsseldorf",
    chapter: "Agenturen",
  },
  {
    id: 2,
    quote: "40.000 € im Jahr für Werbung. Und ich weiß bis heute nicht, was es bringt.",
    body: "Das Geld geht jeden Monat raus. Aber niemand kann mir sagen, welche Werbung wirklich neue Patienten in meine Praxis bringt.",
    who: "Dr. S.",
    where: "Köln",
    chapter: "Werbebudget",
  },
  {
    id: 3,
    quote: "Mein Kalender ist voll. Nur eben mit den falschen Patienten.",
    body: "Mehr Anfragen helfen mir nichts, wenn die meisten gar nicht zu meiner Praxis passen. Mein Team verbringt Stunden mit Gesprächen, aus denen am Ende keine Behandlung wird.",
    who: "Dr. K.",
    where: "Essen",
    chapter: "Patientenmix",
  },
  {
    id: 4,
    quote: "Marketing ist mein zweiter Vollzeitjob geworden.",
    body: "Abends sitze ich am Schreibtisch und drehe Videos für Instagram. Sobald ich damit aufhöre, ist auch meine Praxis im Internet nicht mehr zu sehen. So kann das auf Dauer keiner durchhalten.",
    who: "Dr. L.",
    where: "Bonn",
    chapter: "Engpass",
  },
  {
    id: 5,
    quote: "Ich verstehe nicht genau, was meine Agentur eigentlich macht.",
    body: "Ich bezahle jeden Monat, ohne wirklich zu sehen, was passiert. Wenn die Agentur morgen weg wäre, hätte ich in meiner eigenen Praxis nichts in der Hand.",
    who: "Dr. T.",
    where: "Köln",
    chapter: "Abhängigkeit",
  },
];
