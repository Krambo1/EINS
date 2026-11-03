// FAQ / Einwände. Kernsätze stehen wörtlich in docs/umbau-ki-organisch/KANON.md,
// Abschnitt 10 (Garantie: Abschnitt 5, Material und Klon: Abschnitt 7,
// Ablauf: Abschnitt 9). Jede Aussage zur Garantie nennt beide Grenzen im selben
// Absatz: "erste qualifizierte Anfrage über EINS" und "90 Tage".
export type Objection = { q: string; a: string };

export const OBJECTIONS: Objection[] = [
  {
    q: "Brauchen wir das, wir haben doch schon eine Website?",
    a: "Ihre Website ist gut, um gefunden zu werden. Für Ihre Beiträge und Anzeigen brauchen Sie aber eigene Zielseiten ohne Menü und ohne Ablenkung, mit nur einem Ziel: die Anfrage. Dorthin führt der Profil-Link Ihrer Kanäle. In Branchenvergleichen liegt bei bezahlten Anzeigen die Abschlussquote einer eigenen Zielseite etwa dreimal so hoch wie die einer Startseite.",
  },
  {
    q: "Was, wenn Werbung bei uns noch nie funktioniert hat?",
    a: "Meistens lag es nicht am Geld, sondern am System dahinter. Schwache Seiten, austauschbare Videos und fehlende Filter verbrennen jedes Budget. Genau das ersetzen wir. Und wir setzen kein Werbebudget auf Vermutungen: Wir starten organisch, sehen, welche Beiträge Anfragen bringen, und setzen Anzeigen erst dahinter.",
  },
  {
    q: "Brauchen wir Werbebudget, oder können wir klein mit 500 bis 1.000 € anfangen?",
    a: "Zu Beginn brauchen Sie kein Werbebudget. Wir starten organisch und sehen, welche Beiträge Anfragen bringen. Dahinter setzen wir dann Anzeigen, auch mit kleinem Budget. So geben Sie kein Geld für Vermutungen aus. Ab der ersten qualifizierten Anfrage schlagen wir konkret vor, welches Werbebudget hinter welche Beiträge und Behandlungen gehört. Das Budget zahlen Sie direkt an Meta und Google.",
  },
  {
    q: "Was, wenn es nicht funktioniert?",
    a: "Dann zahlen Sie nichts. Sie zahlen erst, wenn die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt. Die 90 Tage beginnen am Tag der Unterschrift. Die vollständigen Garantie-Bedingungen stehen vor der Beauftragung schriftlich im Vertrag.",
  },
  {
    q: "Kann ich nach der Unterschrift noch zurück?",
    a: "Ja. Bis zur ersten Rechnung können Sie jederzeit per E-Mail beenden, ohne Begründung und ohne Kosten. Die erste Rechnung kommt erst, wenn die erste qualifizierte Anfrage über EINS in Ihrem Portal liegt. Kommt in 90 Tagen keine, endet die Zusammenarbeit, und Sie haben nichts bezahlt. Danach ist EINS monatlich kündbar.",
  },
  {
    q: "Muss ich vor die Kamera?",
    a: "Nein. Sie nehmen einmal wenige Minuten Video und Stimme mit dem Handy auf. Daraus entsteht Ihr Klon.",
  },
  {
    q: "Ist das KI?",
    a: "Ja. Die Videos entstehen mit einem KI-Klon von Ihnen und sind als KI-generiert gekennzeichnet, wie es das Gesetz verlangt. Jeder Beitrag geht erst nach Ihrer Freigabe raus.",
  },
  {
    q: "Was passiert mit meinem Gesicht und meiner Stimme?",
    a: "Ihr Klon gehört Ihnen. Wir nutzen ihn nur für Ihre Praxis und löschen ihn spätestens 30 Tage nach Vertragsende. Widerrufen Sie Ihre Einwilligung, stoppen wir sofort alle Beiträge mit Ihrem Klon.",
  },
  {
    q: "Wem gehört das Material, wenn ich kündige?",
    a: "Sobald die erste Rechnung bezahlt ist, dürfen Sie alles, was für Ihre Praxis entstanden ist, dauerhaft nutzen und bearbeiten, auch nach einer Kündigung und mit einer anderen Agentur. Die Daten Ihrer Anfragen bekommen Sie bei Vertragsende als Export. Endet die Zusammenarbeit nach 90 Tagen ohne Anfrage, dürfen bereits veröffentlichte Beiträge auf Ihren Kanälen stehen bleiben.",
  },
  {
    q: "Organische Beiträge bringen doch nur Likes.",
    a: "Deshalb zählen wir keine Likes. Wir zählen Anfragen, und die erste davon ist der Moment, ab dem Sie zahlen. Jede Anfrage steht mit Herkunft in Ihrem Portal.",
  },
  {
    q: "Wie viel Arbeit habe ich damit?",
    a: "In der ersten Woche wenige Minuten Aufnahme, die Einwilligung und die Zugänge. Danach geben Sie die Beiträge einmal pro Woche frei, das dauert wenige Minuten. Klon-Aufnahme, Einwilligung und Zugänge liefern Sie innerhalb von 3 Werktagen nach der Unterschrift, Beiträge geben Sie innerhalb von 2 Werktagen frei oder ändern sie konkret. Jeder Tag, an dem eine dieser Mitwirkungen aussteht, verlängert die 90 Tage um einen Tag. Wir teilen Ihnen das per E-Mail mit.",
  },
  {
    q: "Wie lange dauert der Start?",
    a: "Am Tag der Unterschrift beginnen die 90 Tage. In Woche 1 folgen das Onboarding-Gespräch per Video, Ihre Einwilligung, die Zugänge und die Klon-Aufnahme am Handy. In Woche 1 bis 2 stehen Klon und Zielseite, die ersten Beiträge gehen zur Freigabe. Ab Woche 2 sind die ersten Beiträge live, und Anfragen laufen mit Herkunft in Ihr Portal. Mit der ersten qualifizierten Anfrage kommt die erste Rechnung, und wir schlagen vor, welches Werbebudget hinter welche Beiträge gehört.",
  },
  {
    q: "Sind Sie DSGVO-konform?",
    a: "Ja, vollständig. Zusätzlich prüfen wir jeden Beitrag und jede Anzeige KI-gestützt gegen die typischen HWG-Abmahnmuster. Grenzfälle gehen zur anwaltlichen Einzelprüfung, bevor sie live gehen.",
  },
  {
    q: "Was ist mit unserer bestehenden Software (Doctolib, samedi, CGM, MedITEX)?",
    a: "Bleibt unverändert. Wir docken an Ihre bestehende Praxis-Software an. Einfache Anfragen wie Folgetermine für Botox oder Laser laufen direkt in Ihr Buchungssystem, hochpreisige Anfragen werden geprüft und gehen vorbereitet an Ihr Team.",
  },
  {
    q: "Kann ich nur die Videos oder nur die Anzeigen haben?",
    a: "Es gibt ein Paket. Beiträge allein bringen Reichweite. Erst Zielseite, Vorqualifizierung und Portal machen daraus Anfragen, die Sie bis zur Behandlung nachverfolgen können.",
  },
  {
    q: "Wie genau arbeitet die KI bei der Patienten-Filterung?",
    a: "Jede Anfrage durchläuft ein zweistufiges Bewertungssystem: Strukturierte Angaben (Wunschbehandlung, Zeitfenster, Entfernung, Erreichbarkeit, Behandlungs-Erfahrung) werden nach einem objektiven Punkteschema bewertet. Die Freitextangaben der Patient:innen werden zusätzlich durch ein KI-Modell auf Behandlungsabsicht, Dringlichkeit und Ernsthaftigkeit analysiert. Niedrigpreisige Standardbehandlungen wie Botox-Auffrischungen oder Laser-Termine bekommen direkt einen Buchungslink in Ihr bestehendes System (Doctolib, samedi, CGM). Hochpreisige Beratungs-Anfragen werden vorqualifiziert an Ihr Team weitergeleitet. Die finale Qualifizierung bleibt bei Ihrem Praxis-Team. Der KI-Wert entscheidet nie darüber, ob eine Anfrage für die Garantie zählt.",
  },
  {
    q: "Was, wenn unser Team die vielen Anfragen nicht bewältigen kann?",
    a: "Die Vorqualifizierung filtert Preisjäger und unpassende Anfragen automatisch aus, sodass nur ernsthafte Patienten an Ihr Team gehen. Zusätzlich enthalten ist ein Vertriebsleitfaden mit Antwort-Vorgaben, WhatsApp-Skripten, Telefonleitfäden und einer Anleitung zur Patientenverwaltung, damit Ihr Team jede Anfrage strukturiert und ohne zusätzlichen Schulungsaufwand verarbeitet.",
  },
  {
    q: "Was zählt für Sie als qualifizierte Anfrage?",
    a: "Eine qualifizierte Anfrage ist eine echte Person, die über einen EINS-Messweg nach einer Behandlung aus dem Leistungsspektrum Ihrer Praxis fragt und erreichbare Kontaktdaten hinterlässt, also Telefon oder E-Mail. EINS-Messwege sind: das Formular auf einer EINS-Zielseite, auch über Ihren Profil-Link oder einen Link aus einer Direktnachricht, ein Anruf auf einer EINS-Tracking-Nummer und eine Buchung über den EINS-Buchungslink. Nicht als qualifiziert zählen offensichtlicher Spam oder automatisierte Eingaben, dieselbe Person ein zweites Mal innerhalb von 30 Tagen, Bewerbungen sowie Verkaufs- und Werbeangebote an Ihre Praxis. Der KI-Wert entscheidet nie darüber, ob eine Anfrage zählt.",
  },
];
