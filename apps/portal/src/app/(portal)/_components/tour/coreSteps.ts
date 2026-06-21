import type { TourStep } from "./types";

/**
 * The core showcase tour every Inhaber sees once on first login (and can
 * re-launch from Einstellungen). It drives the *real* UI past each major area
 * and explains, in plain Sie-German, what EINS does there. Value-framed, not
 * feature-counting; copy assumes no data exists yet (empty-state safe).
 *
 * Steps without an `element` render as a centered EINS card (welcome / finish).
 * The rest navigate to `route` and spotlight a stable `data-tour` anchor on the
 * page header / KPI section, so the tour survives empty accounts and refactors.
 * Deep-dive chapters per area are a separate, on-demand tour (Bucket 4).
 */
export const CORE_STEPS: TourStep[] = [
  {
    title: "Willkommen in Ihrem Portal",
    body: "In zwei Minuten zeigen wir Ihnen, wo alles liegt und was EINS für Sie übernimmt. Sie können jederzeit abbrechen und später in den Einstellungen weitermachen.",
  },
  {
    route: "/dashboard",
    element: '[data-tour="dashboard-header"]',
    title: "Ihre Praxis auf einen Blick",
    body: "Gleich darunter sehen Sie Ihre wichtigsten Zahlen: neue Anfragen, Ihren Werbeertrag und Ihre Bewertungen. So erkennen Sie in Sekunden, wie es gerade läuft.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/anfragen",
    element: '[data-tour="anfragen-header"]',
    title: "Jede Anfrage an einem Ort",
    body: "Jeder Mensch, der sich für Ihre Praxis interessiert, landet hier. Unser Filter hebt die ernsthaften Interessenten nach oben, damit Ihr Team die richtigen zuerst anruft.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/werbebudget",
    element: '[data-tour="werbebudget-header"]',
    title: "Was Ihre Anzeigen wirklich bringen",
    body: "Hier sehen Sie live, was Ihre bezahlten Anzeigen kosten und wie viele Anfragen daraus werden. Kein Schätzen, kein Warten aufs Monatsende.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/bewertungen/feedback",
    element: '[data-tour="feedback-header"]',
    title: "Mehr gute Bewertungen, weniger Risiko",
    body: "Zufriedene Patienten leiten wir zu Google und Jameda. Kritische Rückmeldungen kommen zuerst privat zu Ihnen, bevor sie öffentlich werden.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/fortschritt",
    element: '[data-tour="fortschritt-header"]',
    title: "Ihr Plan mit EINS",
    body: "Was wir gerade für Sie umsetzen und was als Nächstes ansteht, von der ersten Woche bis zum 90-Tage-Ziel.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/medien",
    element: '[data-tour="medien-header"]',
    title: "Ihre Videos und Vorlagen",
    body: "Alle Aufnahmen und fertigen Vorlagen für Ihre Praxis liegen hier bereit, zum Ansehen und Herunterladen, wann immer Sie sie brauchen.",
    side: "bottom",
    align: "start",
  },
  {
    route: "/dashboard",
    title: "Sie kennen jetzt den Weg",
    body: "Das war der Rundgang. Bei Fragen erreichen Sie uns jederzeit über die Kontaktkarte links. Sie können den Rundgang in den Einstellungen erneut starten.",
  },
];
