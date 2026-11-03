// Copy for the guarantee section and the hero promise.
// Wording is taken 1:1 from docs/umbau-ki-organisch/KANON.md (sections 4, 5, 7, 10).
// Every text that states the guarantee keeps both limits in the same
// paragraph: "erste qualifizierte Anfrage über EINS" and "90 Tage".

export type GuaranteeItem = { n: number; title: string; body: string };
export type InfoCard = { title: string; body: string };

// Promise next to the guarantee (no guarantee, but controllable). Also used
// as the hero benefit line, so it lives here once.
export const NEVER_ON_CAMERA = "Sie müssen nie vor die Kamera.";

export const GUARANTEE_ITEMS: GuaranteeItem[] = [
  {
    n: 1,
    title: "Keine Anfrage, keine Rechnung",
    body: "Sie zahlen nichts, bis die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt. Die 90 Tage beginnen am Tag der Unterschrift.",
  },
  {
    n: 2,
    title: "Beenden bis zur ersten Rechnung",
    body: "Bis zur ersten Rechnung können Sie jederzeit per E-Mail beenden, ohne Begründung und ohne Kosten. Danach ist EINS monatlich kündbar.",
  },
];

export const OWNERSHIP_HEADING = "Das gehört Ihnen";

export const OWNERSHIP_CARDS: InfoCard[] = [
  {
    title: "Das Material gehört Ihnen",
    body: "Sobald die erste Rechnung bezahlt ist, dürfen Sie alles, was für Ihre Praxis entstanden ist, dauerhaft nutzen und bearbeiten, auch nach einer Kündigung und mit einer anderen Agentur.",
  },
  {
    title: "Ihr Gesicht und Ihre Stimme",
    body: "Ihr KI-Klon gehört Ihnen. Wir nutzen Ihr Gesicht und Ihre Stimme nur für Ihre Praxis, nie für eigene Werbung ohne Ihre gesonderte schriftliche Einwilligung, und löschen das Klon-Modell spätestens 30 Tage nach Vertragsende. Widerrufen Sie Ihre Einwilligung, stoppen wir sofort alle Beiträge mit Ihrem Klon.",
  },
];

export const PROMISES_HEADING = "Dazu drei Versprechen";

export const PROMISES: InfoCard[] = [
  {
    title: "Kein Beitrag ohne Ihre Freigabe.",
    body: "Jeder Beitrag geht erst nach Ihrer Freigabe raus. Ansehen, ja oder nein, das dauert wenige Minuten.",
  },
  {
    title: NEVER_ON_CAMERA,
    body: "Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf. Daraus entsteht Ihr KI-Klon.",
  },
  {
    title: "Jede Anfrage mit Herkunft im Portal.",
    body: "Jede Anfrage steht mit Herkunft in Ihrem Portal: über welchen Weg sie kam und von welchem Beitrag oder welcher Anzeige.",
  },
];

export const GUARANTEE_FOOTNOTE =
  "Nicht Teil dieser Zusage: Aufrufe, Follower, Umsatz und gebuchte Beratungen. Die vollständigen Bedingungen stehen vor der Beauftragung schriftlich im Vertrag.";
