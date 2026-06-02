/**
 * Vertriebsleitfaden — single source of truth.
 *
 * Both the slimmed page (`page.tsx`, which renders only items where
 * `core === true`) and the full downloadable PDF
 * (`@/server/reports/leitfaden-pdf`, which renders everything) read from this
 * module. Editing copy here updates both at once, so the staff-facing page
 * and the printable PDF can never drift.
 *
 * Pure data — no React, no `server-only` import — so the page (server
 * component), the PDF generator (Node / tsx), the seed script, and tests can
 * all import it without pulling a client/server boundary in.
 *
 * HWG-konform, Sie-Form. Quellen sind im internen Notion-Plan gelistet; die
 * staff-facing Darstellung hält Zitate bewusst sparsam.
 */

// ---------------------------------------------------------------
// 1. Sechs goldene Prinzipien (alle core)
// ---------------------------------------------------------------
export type PrincipleIcon =
  | "HeartHandshake"
  | "Scale"
  | "CheckCircle2"
  | "MessageCircle"
  | "ShieldCheck"
  | "Clock";

export interface Principle {
  id: string;
  icon: PrincipleIcon;
  title: string;
  body: string;
  core: boolean;
}

export const PRINCIPLES: Principle[] = [
  {
    id: "anerkennen",
    icon: "HeartHandshake",
    title: "Anerkennen, reframen, Termin anbieten",
    body: "Niemals dagegen argumentieren, nie drängen. Erst die Sorge ernst nehmen, dann den Rahmen wechseln, dann konkret einen Termin vorschlagen.",
    core: true,
  },
  {
    id: "kein-endpreis",
    icon: "Scale",
    title: "Niemals einen Endpreis am Telefon nennen",
    body: "Nur Spannen, Beratungsgebühr und was im Termin passiert. Begründung ist medizinisch (Individualität), nicht verkäuferisch. Den verbindlichen Kostenvoranschlag erstellt der Arzt nach der Untersuchung.",
    core: true,
  },
  {
    id: "ein-termin-angebot",
    icon: "CheckCircle2",
    title: "Eine Antwort, ein Termin-Angebot",
    body: "Jede Antwort endet mit zwei konkreten Termin-Vorschlägen („Donnerstag oder eher nächste Woche?“), nie mit offener „Wollen Sie?“-Frage.",
    core: true,
  },
  {
    id: "spiegeln",
    icon: "MessageCircle",
    title: "Spiegeln statt widerlegen",
    body: "„Ich verstehe, dass …“ statt „Aber …“. Patienten kaufen Sicherheit, nicht Argumente.",
    core: true,
  },
  {
    id: "routen",
    icon: "ShieldCheck",
    title: "Bei medizinischen Fragen: routen, nicht antworten",
    body: "Risiken, Diagnosen, konkrete Methoden gehören in die ärztliche Aufklärung. Nicht-ärztliches Personal darf keine medizinische Empfehlung geben (§ 7 Abs. 4 MBO-Ä, § 1 HeilprG).",
    core: true,
  },
  {
    id: "stille",
    icon: "Clock",
    title: "Stille aushalten",
    body: "Nach dem Termin-Angebot drei Sekunden schweigen. Wer nachschiebt, wirkt unsicher und gibt das Frame ab.",
    core: true,
  },
];

// ---------------------------------------------------------------
// 2. KPI-Ziele (alle core)
// ---------------------------------------------------------------
export interface Kpi {
  id: string;
  label: string;
  value: string;
  hint: string;
  core: boolean;
}

export const KPIS: Kpi[] = [
  { id: "reaktionszeit", label: "Reaktionszeit", value: "< 5 Min", hint: "ab Anfrage-Eingang", core: true },
  { id: "abschlussquote", label: "Abschlussquote", value: "> 25 %", hint: "aus Beratungsterminen", core: true },
  { id: "no-show", label: "No-Show-Rate", value: "< 20 %", hint: "bei Erstberatung", core: true },
];

// ---------------------------------------------------------------
// 3. Vor jedem Anruf in 30 Sekunden (Prep, alle core)
// ---------------------------------------------------------------
export interface PrepStep {
  id: string;
  text: string;
  core: boolean;
}

export const PREP_STEPS: PrepStep[] = [
  { id: "p1", text: "Anrufer-Profil aus der KI-Bewertung öffnen (Heiß, Warm, Kalt).", core: true },
  { id: "p2", text: "Behandlungswunsch und Budget-Indikation lesen, falls vorhanden.", core: true },
  {
    id: "p3",
    text: "Notiz-Block parat halten: Anrede, Name, Geburtsdatum, Mobil, E-Mail, PLZ, Behandlungswunsch, bevorzugter Kanal, Empfehlungsquelle.",
    core: true,
  },
  { id: "p4", text: "Stimme hochbringen, leise Umgebung, kein Hintergrundgeräusch.", core: true },
];

// ---------------------------------------------------------------
// 4. Gesprächs-Eröffnung, wortwörtlich (3 von 4 core)
// ---------------------------------------------------------------
export interface OpeningScript {
  id: string;
  title: string;
  /** Optional patient line shown above the quote. */
  patientLine?: string;
  quote: string;
  note: string;
  core: boolean;
}

export const OPENING_SCRIPTS: OpeningScript[] = [
  {
    id: "standard",
    title: "Standard-Eröffnung",
    quote: "[Praxisname], guten Tag, Sie sprechen mit [Vorname Nachname]. Was kann ich für Sie tun?",
    note: "DACH-Standard. Praxis, Person, Bereitschaft, in einem Satz.",
    core: true,
  },
  {
    id: "behandlung",
    title: "Patient nennt sofort eine Behandlung",
    patientLine: "Patient: „Ich habe Ihre Anzeige gesehen, ich interessiere mich für [Behandlung].“",
    quote: "Schön, dass Sie sich melden, Frau / Herr [Nachname]. Ich nehme mir gerne fünf Minuten für Sie, damit ich verstehe, worum es Ihnen geht und Ihnen den passenden Termin anbieten kann. Ist das in Ordnung?",
    note: "Frame übernehmen, Zustimmung holen, Discovery ankündigen.",
    core: false,
  },
  {
    id: "preis",
    title: "Patient fragt sofort den Preis",
    patientLine: "Patient: „Was kostet das?“",
    quote: "Den genauen Preis kann ich Ihnen nicht am Telefon nennen, weil unsere Ärzte ihn erst nach der individuellen Beratung festlegen. Bei [Behandlung] bewegen wir uns typischerweise zwischen [von €] und [bis €], abhängig von Aufwand und Material. Den verbindlichen Kostenvoranschlag erstellt Ihr Arzt nach der Untersuchung. Möchten Sie einen Beratungstermin?",
    note: "HWG-konform (kein Lockpreis). § 630c Abs. 3 BGB verlangt schriftlichen Kostenvoranschlag in der Sprechstunde.",
    core: true,
  },
  {
    id: "unsicher",
    title: "Patient klingt unsicher",
    patientLine: "Patient: „Eigentlich wollte ich mich nur erstmal informieren …“",
    quote: "Das ist genau richtig. Bei uns ist das Erstgespräch dazu da, dass Sie ohne Druck Fragen stellen und sich ein eigenes Bild machen. Wir entscheiden nichts in diesem Gespräch, wir klären nur, ob die Behandlung für Sie überhaupt geeignet ist. Ist das ein guter Rahmen für Sie?",
    note: "Druck rausnehmen, Beratung als unverbindlich rahmen.",
    core: true,
  },
];

// ---------------------------------------------------------------
// 5. Discovery (Block A + rote Flaggen core)
// ---------------------------------------------------------------
export interface DiscoveryBlock {
  id: string;
  title: string;
  /** "ol" = ordered (numbered), "ul" = bulleted. */
  list: "ol" | "ul";
  /** Starting number for ordered lists that continue across blocks. */
  start?: number;
  items: string[];
  note?: string;
  core: boolean;
}

export const DISCOVERY_INTRO =
  "Nicht jede Frage in jedem Anruf. Der Block leitet das Gespräch. Prinzip: offene Frage zuerst, geschlossene Folge-Frage zur Präzisierung.";

export const DISCOVERY_BLOCKS: DiscoveryBlock[] = [
  {
    id: "d-a",
    title: "A. Behandlungs-Interesse (3 Fragen)",
    list: "ol",
    start: 1,
    items: [
      "„Welche Behandlung schwebt Ihnen vor?“",
      "„Was hat Sie auf das Thema aufmerksam gemacht? Stand das schon länger im Raum oder ist die Idee neu?“",
      "„Haben Sie sich vorab schon irgendwo darüber informiert, etwa im Internet oder in einer anderen Praxis?“",
    ],
    core: true,
  },
  {
    id: "d-b",
    title: "B. Dringlichkeit und Anlass (4 Fragen)",
    list: "ol",
    start: 4,
    items: [
      "„Gibt es einen Anlass, der den Zeitpunkt für Sie wichtig macht? Eine Hochzeit, ein Geburtstag, ein Urlaub?“",
      "„Wann würden Sie die Behandlung idealerweise umsetzen? Eher in den nächsten Wochen oder eher in mehreren Monaten?“",
      "„Sind Sie zeitlich flexibel für ein Beratungsgespräch in den nächsten zwei Wochen?“",
      "„Sind Sie auf eine Erholungsphase angewiesen, die wir berücksichtigen müssen?“",
    ],
    core: false,
  },
  {
    id: "d-c",
    title: "C. Budget-Indikatoren (3 Fragen, indirekt)",
    list: "ol",
    start: 8,
    items: [
      "„Haben Sie bei der Recherche schon eine grobe Vorstellung bekommen, was die Behandlung kosten kann?“",
      "„Ist das Thema Investition für Sie schon eingeplant oder klären Sie das parallel?“",
      "„Spielt eine Finanzierung über Ratenzahlung eine Rolle für Sie? Wir bieten das in Kooperation mit [Finanzierungspartner] an.“",
    ],
    note: "Niemals direkt fragen „Wie viel können Sie ausgeben?“. Das ist im DACH-Raum unhöflich und beschädigt Vertrauen.",
    core: false,
  },
  {
    id: "d-d",
    title: "D. Vertrauenssignale und Eignung (4 Fragen)",
    list: "ol",
    start: 11,
    items: [
      "„Wo wohnen Sie ungefähr? Ist [Praxisstadt] gut für Sie zu erreichen?“",
      "„Gab es einen Grund, warum Sie sich gerade für unsere Praxis interessieren? Empfehlung, Anzeige, Recherche?“",
      "„Haben Sie aktuell gesundheitliche Themen, die wir vor dem Termin wissen sollten? Medikamente, Allergien, Vor-Operationen?“",
      "„Haben Sie Vorbehalte oder etwas, das Sie nervös macht beim Gedanken an die Behandlung? Das klären wir gern offen.“",
    ],
    core: false,
  },
  {
    id: "d-rote-flaggen",
    title: "Rote Flaggen, bei denen kein Termin vereinbart wird",
    list: "ul",
    items: [
      "Patient ist unter 18 oder fragt für Minderjährige.",
      "Unrealistische Erwartungen („Ich möchte aussehen wie [Promi]“).",
      "Patient wirkt unter Druck einer dritten Person („Mein Mann sagt, ich soll das machen lassen“).",
      "Anzeichen einer körperdysmorphen Wahrnehmung (extreme Fokussierung auf minimale „Makel“).",
      "Wiederholungs-OP nach mehreren misslungenen Eingriffen anderswo.",
    ],
    core: true,
  },
];

// ---------------------------------------------------------------
// 6. Einwandbehandlung: 23 Patienten-Einwände (9 core)
// ---------------------------------------------------------------
export interface ObjectionGroupMeta {
  id: string;
  label: string;
}

/** Group order + labels for the grouped accordion / PDF headings. */
export const OBJECTION_GROUPS: ObjectionGroupMeta[] = [
  { id: "A", label: "A. Preis-Einwände" },
  { id: "B", label: "B. Vertrauens- und Sicherheits-Einwände" },
  { id: "C", label: "C. Timing-Einwände" },
  { id: "D", label: "D. Ergebnis- und Realismus-Einwände" },
  { id: "E", label: "E. Psychologische und Scham-Einwände" },
];

export interface Objection {
  id: string;
  /** Group id, references OBJECTION_GROUPS. */
  group: string;
  title: string;
  concern: string;
  answer: string;
  avoid: string[];
  core: boolean;
}

export const OBJECTIONS: Objection[] = [
  // --- A. Preis-Einwände ---
  {
    id: "a1",
    group: "A",
    title: "A1. „Das ist mir zu teuer.“",
    concern: "Wert noch nicht eingeordnet, oder reales Budgetproblem. Häufigster Vorwand für ungelöste Werteklarheit.",
    answer: "Das kann ich gut nachvollziehen, jede ästhetische Behandlung ist eine bewusste Entscheidung, und der Preis ist ein Teil davon. Bei uns hängen die Kosten immer von Ihrer individuellen Anatomie und vom medizinischen Vorgehen ab. Deshalb können wir seriös erst nach dem persönlichen Gespräch mit Frau Dr. [Name] eine konkrete Summe nennen. Im Beratungstermin schauen wir genau, was zu Ihnen passt, und Sie entscheiden danach in Ruhe, ohne Verpflichtung. Hätten Sie eher Anfang oder Ende nächster Woche Zeit?",
    avoid: [
      "„Schönheit hat ihren Preis.“ (wertend)",
      "„Das ist im Vergleich günstig.“ (Preisvergleich)",
      "„Aktion …“ (verstößt gegen § 7 HWG)",
      "„Sparen Sie nicht an Ihrer Gesundheit.“ (Angst-Trigger)",
    ],
    core: true,
  },
  {
    id: "a2",
    group: "A",
    title: "A2. „Bei einer anderen Praxis ist das günstiger.“",
    concern: "Sicherheitsfrage in Preisform.",
    answer: "Es ist absolut richtig, dass Sie vergleichen, das ist Ihr gutes Recht. Über die Preise von Kolleginnen und Kollegen kann ich seriös nichts sagen, weil dort jeweils andere Methoden, Materialien und Verläufe zugrunde liegen. Was ich Ihnen für unsere Praxis sagen kann: Frau Dr. [Name] ist [Fachärztin für Plastische und Ästhetische Chirurgie], wir nehmen uns für die Beratung 45 Minuten Zeit, und Sie bekommen einen schriftlichen Heil- und Kostenplan, den Sie in Ruhe mitnehmen. Möchten Sie das bei uns einmal persönlich erleben?",
    avoid: [
      "„Bei denen ist das nicht so sicher.“ (üble Nachrede, abmahnfähig)",
      "„Wir haben den besten Arzt.“ (§ 3 HWG, § 27 MBO-Ä)",
      "„Da gibt es bestimmt einen Grund, warum es billiger ist.“ (suggestiv)",
    ],
    core: false,
  },
  {
    id: "a3",
    group: "A",
    title: "A3. „Was kostet das genau?“",
    concern: "Triage. Reine Preisnennung am Telefon senkt die Abschlussquote und schafft falsche Anker.",
    answer: "Das ist die Frage, die uns am häufigsten erreicht, sehr verständlich. Eine seriöse Antwort kann ich Ihnen am Telefon nicht geben, weil die Kosten von Ihrer Anatomie, dem genauen Vorgehen und dem zeitlichen Aufwand abhängen. Was ich Ihnen aber sagen kann: Behandlungen in diesem Bereich bewegen sich bei uns üblicherweise in einer Spanne von [grobe Spanne]. Das persönliche Beratungsgespräch kostet [50 €] und wird bei Behandlung in vielen Fällen angerechnet. Im Termin bekommen Sie einen schriftlichen Kostenvoranschlag, den Sie ohne Verpflichtung mitnehmen. Wann passt es Ihnen?",
    avoid: [
      "Konkrete Einzelzahl („3.200 €“)",
      "Frage abwimmeln („Kann ich Ihnen nicht sagen.“)",
      "„Ab“-Preise (§ 11 HWG, irreführende Anlock-Werbung)",
    ],
    core: true,
  },
  {
    id: "a4",
    group: "A",
    title: "A4. „Warum ist das so teuer?“",
    concern: "Sie möchte den Preis vor sich selbst rechtfertigen können, will Transparenz, keinen Rabatt.",
    answer: "Eine sehr gute Frage. In dem Preis stecken im Wesentlichen drei Dinge: erstens die Zeit und Erfahrung der behandelnden Ärztin oder des Arztes, zweitens das Material und die Anästhesie auf medizinischem Standard, und drittens die Nachsorge mit allen Kontrollterminen. Wir rechnen das im Beratungstermin transparent für Sie auf, Sie bekommen den Kostenvoranschlag schriftlich, mit allen Posten einzeln. Soll ich Ihnen einen Termin in dieser oder nächster Woche reservieren?",
    avoid: [
      "„Qualität hat ihren Preis.“ (Floskel)",
      "„Wenn Sie sehen, wie schön das wird, denken Sie nicht mehr an den Preis.“ (§ 3 HWG-Risiko)",
    ],
    core: false,
  },
  {
    id: "a5",
    group: "A",
    title: "A5. „Gibt es Ratenzahlung?“",
    concern: "Kaufsignal mit Liquiditätsfrage. Sie ist innerlich weiter als sie klingt.",
    answer: "Ja, das ist eine Frage, die viele Patientinnen stellen. Wir arbeiten mit dem etablierten Anbieter [Finanzierungspartner] zusammen. Die Antragsstrecke ist unkompliziert, Sie machen das eigenständig nach der Beratung, ganz ohne Druck unsererseits. Die genauen Konditionen besprechen wir, sobald wir wissen, um welche Behandlung es konkret geht. Wann darf ich Sie für die Beratung eintragen?",
    avoid: [
      "Konkrete Monatsraten am Telefon",
      "„Sie können sich das definitiv leisten.“ (übergriffig)",
      "Drittanbieter ungenannt lassen (Transparenzpflicht)",
    ],
    core: false,
  },
  // --- B. Vertrauens- und Sicherheits-Einwände ---
  {
    id: "b1",
    group: "B",
    title: "B1. „Was, wenn etwas schiefgeht?“",
    concern: "Kontrollverlust. Sie braucht das Gefühl, dass jemand das schon zigmal gemacht hat und es einen Plan B gibt.",
    answer: "Diese Sorge ist verständlich, und sie gehört zu jedem ehrlichen Beratungsgespräch dazu. Jeder Eingriff ist mit Risiken verbunden, das gehört zur ärztlichen Aufklärung, und Frau Dr. [Name] geht im Termin offen mit Ihnen jedes mögliche Risiko durch und erklärt, wie wir damit umgehen, von der Voruntersuchung bis zur Nachsorge. Was ich Ihnen am Telefon zusichern kann: Sie verlassen die Beratung mit allen Informationen schriftlich und entscheiden in Ruhe zuhause. Ohne Termindruck. Hätten Sie diese Woche oder nächste Woche Zeit?",
    avoid: [
      "„Bei uns geht nichts schief.“ (§ 3 HWG Heilversprechen)",
      "„Das ist ungefährlich.“ (§ 3 HWG, § 11 HWG)",
      "Konkrete Komplikationsraten zitieren (§ 630e BGB Aufklärungspflicht ist Arztaufgabe)",
    ],
    core: true,
  },
  {
    id: "b2",
    group: "B",
    title: "B2. „Tut das weh?“",
    concern: "Antizipation von Schmerz, häufig mit konkreter Vor-Erfahrung.",
    answer: "Schmerz ist sehr individuell, manche Patientinnen empfinden eine Behandlung als kaum spürbar, andere brauchen mehr Lokalanästhesie oder eine Sedierung. Im Beratungstermin bespricht der Arzt mit Ihnen genau, welche Schmerzlinderung in Ihrem Fall sinnvoll ist und was Sie während und nach der Behandlung erwartet. Sind Sie schon einmal beim Zahnarzt lokal betäubt worden? Dann haben Sie eine ungefähre Vorstellung. Mehr darf und kann ich Ihnen seriös am Telefon nicht versprechen. Soll ich Ihnen einen Termin reservieren?",
    avoid: [
      "„Das tut nicht weh.“ / „Sie spüren nichts.“ (§ 3 HWG Bagatellisierung)",
      "„Das halten Sie schon aus.“ (entwertend)",
    ],
    core: false,
  },
  {
    id: "b3",
    group: "B",
    title: "B3. „Ich habe Angst vor OPs oder vor Spritzen.“",
    concern: "Reale Angst, eventuell Trypanophobie. Wer dagegen argumentiert, eskaliert sie.",
    answer: "Danke, dass Sie das so offen sagen, damit sind Sie überhaupt nicht allein, das hören wir sehr oft. Genau deshalb beginnt bei uns nichts ohne ein ausführliches Gespräch mit dem Arzt. Sie kommen erstmal nur zur Beratung, ohne dass irgendetwas behandelt wird. Wir nehmen uns Zeit, Sie lernen die Räume und das Team kennen, und Sie entscheiden danach völlig frei, ob und wann es weitergeht. Wäre Ihnen ein Vormittag oder lieber ein später Nachmittag angenehmer?",
    avoid: [
      "„Stellen Sie sich nicht so an.“ (entwertend)",
      "„Sie werden es lieben.“ (Heilversprechen)",
      "Sofortige Behandlungstermine anbieten (verschärft die Angst)",
    ],
    core: false,
  },
  {
    id: "b4",
    group: "B",
    title: "B4. „Wie qualifiziert ist der Arzt oder die Ärztin?“",
    concern: "Sie hat Horrorgeschichten gelesen und sucht Sicherheit über die Person.",
    answer: "Sehr berechtigte Frage. Bei uns behandelt Sie ausschließlich [Frau Dr. Müller], Fachärztin für Plastische und Ästhetische Chirurgie, Mitglied der [DGPRÄC / VDÄPC], approbiert seit [Jahr], in dem Eingriff seit über 12 Jahren tätig. Auf unserer Website finden Sie ihren vollständigen Lebenslauf. Im Beratungstermin lernen Sie die Ärztin persönlich kennen, das halten wir für die ehrlichste Form der Antwort auf Ihre Frage. Wann passt es Ihnen, vorbeizukommen?",
    avoid: [
      "„Der ist der Beste.“ / „Top-Doc 2025.“ (§ 3 HWG Spitzenstellung)",
      "„Alle sagen, sie ist die Beste.“ (§ 11 Abs. 1 Nr. 11 HWG)",
      "Vage Aussagen („erfahrenes Team“) ohne nachprüfbare Qualifikation",
    ],
    core: true,
  },
  {
    id: "b5",
    group: "B",
    title: "B5. „Welche Risiken gibt es?“",
    concern: "Sie testet, ob Sie ehrlich antworten oder etwas verschweigen. Falsche Beruhigung kostet hier am meisten Vertrauen.",
    answer: "Vielen Dank, dass Sie das fragen, das ist genau die richtige Frage vor einer ästhetischen Behandlung. Jeder Eingriff hat Risiken, von Rötung und Schwellung bis zu seltenen Komplikationen. Welche Risiken konkret in Ihrem Fall relevant sind, hängt von Ihrer Anatomie, Ihren Medikamenten und der gewählten Methode ab. Deshalb bekommen Sie im Beratungstermin eine vollständige ärztliche Aufklärung, schriftlich, mit Bedenkzeit, bevor Sie irgendetwas unterschreiben. Möchten Sie, dass ich Ihnen einen Termin vorschlage?",
    avoid: [
      "„Eigentlich keine.“ / „Nichts Nennenswertes.“ (§ 3 HWG Bagatellisierung)",
      "Alle Risiken am Telefon aufzählen (Fernbehandlungsverbot, § 7 Abs. 4 MBO-Ä)",
    ],
    core: true,
  },
  // --- C. Timing-Einwände ---
  {
    id: "c1",
    group: "C",
    title: "C1. „Ich überlege es mir noch.“",
    concern: "Ambivalenz, oft mit ungenannter Sub-Sorge (Geld, Partner, Schmerz, Ergebnis).",
    answer: "Das ist absolut richtig, eine ästhetische Behandlung ist nichts, was man am Telefon entscheidet. Darf ich Sie etwas fragen: Gibt es einen konkreten Punkt, der Sie noch zögern lässt, Ergebnis, Risiken, Kosten, Termin? Dann kann ich gezielt darauf eingehen. Und falls Sie einfach in Ruhe weiter überlegen wollen: Soll ich Ihnen unverbindlich einen Beratungstermin in zwei oder drei Wochen vormerken, den Sie jederzeit kostenfrei verschieben können?",
    avoid: [
      "„Aber das ist eine super Investition.“ (Druck)",
      "„Heute haben wir Aktionspreis.“ (§ 11 HWG)",
      "Weiteren Schub geben (vertieft die Ambivalenz)",
    ],
    core: true,
  },
  {
    id: "c2",
    group: "C",
    title: "C2. „Ich rede erst mit meinem Mann oder Partner.“",
    concern: "Familien-Entscheidung, Erlaubnis, finanzielle Abstimmung oder Test.",
    answer: "Selbstverständlich, das ist eine persönliche Entscheidung, und es ist absolut richtig, das mit Ihrem Partner zu besprechen. Was vielen Patientinnen geholfen hat: erst zur unverbindlichen Beratung zu kommen, sich konkrete Informationen, Kosten und Fragen schriftlich mitzunehmen, und dann zuhause in Ruhe zu zweit zu sprechen, mit Fakten statt Vermutungen. Möchten Sie, dass ich Ihnen einen Termin reserviere? Ihr Partner ist auch herzlich eingeladen mitzukommen, wenn Sie das möchten.",
    avoid: [
      "„Sie sind doch erwachsen, das ist Ihre Entscheidung.“ (übergriffig)",
      "„Sie müssen das nicht mit Ihrem Mann besprechen.“ (in Konstellationen mit häuslicher Kontrolle gefährlich)",
      "Unterstellungen über die Partnerschaft",
    ],
    core: true,
  },
  {
    id: "c3",
    group: "C",
    title: "C3. „Aktuell ist gerade nicht der richtige Zeitpunkt.“",
    concern: "Lebensphase oder sanfter Abschied.",
    answer: "Das ist mehr als nachvollziehbar. Eine ästhetische Behandlung passt am besten in eine ruhige Phase, ohne anstehende Veränderungen wie Schwangerschaft, Stillzeit oder größere berufliche Belastungen. Wenn Sie möchten, vermerken wir Sie unverbindlich, ich rufe Sie zum Beispiel in drei oder sechs Monaten einmal an, ob es dann für Sie passt. Wenn Sie sich bis dahin schon mal informieren wollen, kann ich Ihnen auch gerne unverbindliche Informationen per E-Mail schicken.",
    avoid: [
      "„Es gibt nie den perfekten Zeitpunkt.“ (abwertend)",
      "„Aber jetzt ist die beste Zeit.“ (Druck)",
    ],
    core: false,
  },
  {
    id: "c4",
    group: "C",
    title: "C4. „Ich möchte mir noch andere Praxen ansehen.“",
    concern: "Sie nimmt die Entscheidung ernst. Druck wirkt kontraproduktiv.",
    answer: "Das halte ich für absolut sinnvoll und ich würde es Ihnen sogar empfehlen, bei einer ästhetischen Behandlung sollten Sie sich rundum sicher fühlen. Wenn ich Ihnen einen Tipp geben darf für Ihre Vergleichsrunde: Achten Sie auf die Facharzt-Qualifikation der behandelnden Person, auf die Dauer des Beratungsgesprächs und darauf, dass Sie schriftlich aufgeklärt werden. Wir laden Sie gerne unabhängig davon zu einem ersten Beratungstermin ein, damit Sie eine Vergleichsbasis haben. Wann würde Ihnen das passen?",
    avoid: [
      "„Das brauchen Sie nicht, wir sind die Besten.“ (§ 3 HWG, § 27 MBO-Ä)",
      "Konkurrenten benennen oder abwerten",
    ],
    core: false,
  },
  {
    id: "c5",
    group: "C",
    title: "C5. „Ich habe keine Zeit für die Beratung.“",
    concern: "Echtes Zeitproblem oder höfliche Absage.",
    answer: "Das verstehe ich, das geht vielen so. Wir bieten deshalb auch Termine am späten Nachmittag und Samstagsvormittage an. Wenn ein erstes Kennenlernen telefonisch oder per Video für Sie einfacher wäre, könnte Frau Dr. [Name] Sie auch kurz in einem 15-minütigen Vorgespräch zurückrufen, um Ihre Fragen zu klären, die ausführliche Beratung folgt dann persönlich vor Ort. Was passt Ihnen besser?",
    avoid: [
      "„Dafür müssen Sie sich Zeit nehmen.“ (belehrend)",
      "„Das geht ganz schnell.“ (Heilversprechen-nah)",
    ],
    core: false,
  },
  // --- D. Ergebnis- und Realismus-Einwände ---
  {
    id: "d1",
    group: "D",
    title: "D1. „Sieht man danach, dass ich etwas gemacht habe?“",
    concern: "Soziale Sorge und Downtime-Frage zugleich.",
    answer: "Das ist sehr unterschiedlich, je nach Behandlung, Methode und Ihrer individuellen Heilung. Bei manchen Eingriffen sieht man direkt nach der Behandlung leichte Schwellungen oder Rötungen, das kann ein paar Tage bis Wochen anhalten. Wie das Endergebnis bei Ihnen aussehen kann und wann es sich zeigt, erklärt Frau Dr. [Name] im Beratungstermin, mit ehrlichen Zeitangaben, einschließlich der typischen Erholungsphase. Möchten Sie, dass ich Ihnen einen Termin vorschlage?",
    avoid: [
      "„Sie können sofort wieder arbeiten.“ (§ 3 HWG)",
      "Vorher-Nachher-Bilder anbieten oder per WhatsApp schicken (§ 11 Abs. 1 Satz 3 HWG, BGH 31.07.2025 inkl. Hyaluron)",
    ],
    core: true,
  },
  {
    id: "d2",
    group: "D",
    title: "D2. „Wirkt das natürlich?“",
    concern: "Furcht vor unnatürlich operierter Wirkung und sozialer Beschämung.",
    answer: "Das ist die Frage, die uns wahrscheinlich am häufigsten gestellt wird, und die uns selbst sehr wichtig ist. Unser Anspruch ist eine Behandlung, die zu Ihnen und Ihren Proportionen passt, nicht eine, die auffällt. Wie weit man gehen kann und was sich für Sie natürlich anfühlt, ist sehr individuell, und das bespricht Frau Dr. [Name] im Beratungsgespräch sehr genau mit Ihnen, inklusive realistischer Vorstellungen, was im Rahmen Ihrer Anatomie möglich ist. Wann darf ich Ihnen einen Termin vorschlagen?",
    avoid: [
      "„Sie werden 100 % natürlich aussehen.“ (§ 3 HWG)",
      "„Niemand wird etwas merken.“ (Garantie)",
      "Vergleich mit Promi-Bildern",
    ],
    core: true,
  },
  {
    id: "d3",
    group: "D",
    title: "D3. „Werde ich danach so aussehen wie [Influencer / Promi]?“",
    concern: "Unrealistische Bildreferenz, eventuell Body-Image-Red-Flag.",
    answer: "Das ist eine gute Frage, und sie verdient eine ehrliche Antwort: Niemand sieht nach einer Behandlung aus wie eine andere Person, jede Patientin hat ihre eigene Knochenstruktur, Hautqualität und Mimik. Was wir tun können, ist gemeinsam mit Ihnen herausarbeiten, welche Aspekte Ihres Erscheinungsbilds Sie verändern möchten und was im Rahmen Ihrer Anatomie sinnvoll ist. Wenn Sie ein Bild zur Beratung mitbringen möchten, gerne, Frau Dr. [Name] schaut sich das mit Ihnen an und erklärt offen, was davon realistisch ist. Möchten Sie einen Termin?",
    avoid: [
      "„Klar, das machen wir.“ (Heilversprechen plus Body-Image-Trigger)",
      "Spott über die Referenz",
      "„Wir machen Sie noch hübscher als …“",
    ],
    core: false,
  },
  {
    id: "d4",
    group: "D",
    title: "D4. „Wie lange hält das?“",
    concern: "ROI-Frage. „Lohnt sich das für mich?“",
    answer: "Das ist je nach Behandlung sehr unterschiedlich, und auch innerhalb derselben Behandlung sehr individuell, weil das von Stoffwechsel, Lebensstil und Ihrem Körper abhängt. Übliche Zeiträume liegen zum Beispiel bei Faltenunterspritzungen sechs bis zwölf Monate, je nach Präparat und Region. Was in Ihrem konkreten Fall realistisch ist, kann Ihnen Frau Dr. [Name] im Beratungstermin sagen, inklusive der Frage, wann eine Auffrischung sinnvoll wäre. Soll ich Ihnen einen Termin vorschlagen?",
    avoid: [
      "Garantierte Zeiträume („Hält genau fünf Jahre“)",
      "Pauschal-Versprechen („Permanent“) ohne medizinischen Beleg",
    ],
    core: false,
  },
  {
    id: "d5",
    group: "D",
    title: "D5. „Was, wenn ich enttäuscht bin?“",
    concern: "Reue-Antizipation. Hier nie mit Garantien arbeiten.",
    answer: "Das ist eine wichtige und sehr ehrliche Frage. Genau deshalb arbeiten wir bewusst mit einem zweistufigen Vorgehen: Im Beratungstermin gehen wir mit Ihnen detailliert durch, was im Rahmen Ihrer Anatomie realistisch ist und was nicht, mit klarer ärztlicher Sprache, ohne Schönfärberei. Sie unterschreiben nichts an dem Tag. Sie nehmen sich die schriftlichen Unterlagen mit, lassen alles auf sich wirken, und entscheiden frei. Falls Sie nach der Behandlung das Gefühl haben, dass etwas nachjustiert werden sollte, sprechen Sie mit der Ärztin, wir besprechen jeden Fall individuell in der Nachsorge. Möchten Sie zuerst zur Beratung kommen?",
    avoid: [
      "„Bei uns ist noch keiner enttäuscht weggegangen.“ (§ 3 HWG)",
      "„Geld-zurück-Garantie.“ (medizinethisch heikel, HWG-Risiko)",
      "„Wir korrigieren das kostenlos.“ (Pauschal-Versprechen)",
    ],
    core: false,
  },
  // --- E. Psychologische und Scham-Einwände ---
  {
    id: "e1",
    group: "E",
    title: "E1. „Mein Partner soll davon nichts wissen.“",
    concern: "Diskretion, Scham oder Autonomie in einer kontrollierenden Beziehung.",
    answer: "Das respektieren wir selbstverständlich, Diskretion gehört zu unserem Berufsverständnis, und Ihre Daten und Ihr Termin bleiben bei uns. Wichtig ist mir nur, dass Sie wissen: Eine ästhetische Behandlung hat eine Erholungsphase, das wird Ihre Ärztin im Beratungstermin sehr genau mit Ihnen besprechen, damit Sie für sich planen können, was offen kommunizierbar ist und was nicht. Möchten Sie einen Beratungstermin?",
    avoid: [
      "Verschwörerisch werden („Klar, das merkt niemand“)",
      "Druck zur Offenlegung",
      "Heilversprechen „nach der OP wird nichts sichtbar sein“",
    ],
    core: false,
  },
  {
    id: "e2",
    group: "E",
    title: "E2. „Was werden die Leute denken?“",
    concern: "Soziale Beschämung.",
    answer: "Diese Sorge teilen sehr viele Patientinnen, und das ist menschlich. Was uns aus Erfahrung wichtig ist: Eine gut durchgeführte ästhetische Behandlung ist meist viel unauffälliger, als die meisten Menschen glauben, die Veränderung ist subtil und passt zu Ihrem Gesicht. Aber das Wichtigste vorweg: Es ist Ihr Körper, Ihre Entscheidung, und Sie schulden niemandem eine Erklärung. Im Beratungsgespräch besprechen wir auch, wie viel Veränderung für Sie persönlich richtig ist. Wann hätten Sie Zeit?",
    avoid: [
      "„Das merkt eh keiner.“ (spielt das Anliegen klein)",
      "„Was Sie machen, geht niemanden etwas an.“ (übergriffig)",
    ],
    core: false,
  },
  {
    id: "e3",
    group: "E",
    title: "E3. „Ist das oberflächlich?“",
    concern: "Wertekonflikt mit Selbstbild.",
    answer: "Diese Frage stellen sich viele Patientinnen, und allein dass Sie sie stellen, zeigt, dass Sie sich Gedanken machen. Wir sehen das so: Ästhetische Medizin ist dann gut, wenn sie etwas verändert, das Sie selbst stört, nicht, wenn sie einem äußeren Ideal hinterherläuft. Das ist auch der Grund, warum Frau Dr. [Name] sich im Beratungsgespräch Zeit nimmt, mit Ihnen zu klären, was Sie genau möchten und warum. Wenn Sie das Gefühl haben, das ist nichts für Sie, ist das ein völlig legitimes Ergebnis einer Beratung. Möchten Sie unverbindlich einen Termin reservieren?",
    avoid: [
      "„Nein, überhaupt nicht.“ / „Sie haben es verdient.“ (übergriffig)",
      "„Alle machen das heute.“ (Social-Proof-Druck)",
      "Empowerment-Phrasen",
    ],
    core: false,
  },
];

// ---------------------------------------------------------------
// 7. HWG-Quick-Reference: Sag-So, Sag-So-Nicht (7 Tabellen, 3 core)
// ---------------------------------------------------------------
export interface HwgTable {
  id: string;
  title: string;
  /** Each row: [Sag-So-Nicht, Sag-So]. */
  rows: [string, string][];
  core: boolean;
}

export const HWG_TABLES: HwgTable[] = [
  {
    id: "ss-1",
    title: "1. Heilversprechen, Erfolg",
    core: true,
    rows: [
      [
        "„Sie werden auf jeden Fall zufrieden sein.“",
        "„Welches Ergebnis bei Ihnen erreichbar ist, kann nur Frau / Herr Dr. … nach persönlicher Untersuchung beurteilen.“",
      ],
      [
        "„Garantiert faltenfrei.“",
        "„Viele Patientinnen berichten über eine deutliche Glättung; das Ergebnis ist individuell.“",
      ],
      [
        "„100 % schmerzfrei.“",
        "„Wir arbeiten mit modernen Lokalanästhetika; Schmerzempfinden ist individuell und wird in der Sprechstunde besprochen.“",
      ],
      [
        "„Das hält ein Leben lang.“",
        "„Die Wirkdauer hängt von Verfahren und individuellen Faktoren ab; Details bespricht Dr. … im Termin.“",
      ],
    ],
  },
  {
    id: "ss-2",
    title: "2. Diagnose, Eignung am Telefon",
    core: false,
    rows: [
      [
        "„Bei Ihrer Schilderung ist Hyaluron das Richtige.“",
        "„Welche Methode geeignet ist, klärt die Ärztin oder der Arzt in der persönlichen Sprechstunde.“",
      ],
      [
        "„Sie brauchen keine OP, eine Unterspritzung reicht.“",
        "„Die Auswahl zwischen den Verfahren hängt vom Befund ab und wird ärztlich entschieden.“",
      ],
      [
        "„Schicken Sie mir ein Foto, dann sage ich Ihnen, was Sie brauchen.“",
        "„Eine seriöse Beurteilung ist nur im persönlichen Untersuchungskontext möglich.“",
      ],
    ],
  },
  {
    id: "ss-3",
    title: "3. Vergleich, Superlative",
    core: false,
    rows: [
      [
        "„Wir sind die beste Praxis in [Stadt].“",
        "„Wir sind eine [Fachgebiet]-Praxis mit Schwerpunkt …“",
      ],
      [
        "„Besser als die Praxis X.“",
        "(kein vergleichender Bezug; eigene Leistungen sachlich darstellen)",
      ],
      [
        "„Marktführer für Hyaluron in NRW.“",
        "„Wir führen Hyaluron-Behandlungen regelmäßig durch und haben Erfahrung mit …“",
      ],
    ],
  },
  {
    id: "ss-4",
    title: "4. Preis, Rabatt, Lockangebot",
    core: true,
    rows: [
      [
        "„Heute 30 % Rabatt.“",
        "„Die Abrechnung erfolgt nach GOÄ; ein verbindlicher Kostenvoranschlag wird in der Sprechstunde erstellt.“",
      ],
      [
        "„Erstberatung kostenlos.“",
        "„Die Erstberatung in der Sprechstunde kostet [50 €] und wird bei Behandlung verrechnet.“",
      ],
      [
        "„Pauschalpreis 1.500 € für Botox.“",
        "„Die Behandlung beginnt typischerweise bei [von €]; der individuelle Betrag richtet sich nach Aufwand und GOÄ-Bemessung.“",
      ],
      [
        "„Frühlingsaktion: Botox -20 %.“",
        "(komplett streichen, § 7 HWG)",
      ],
    ],
  },
  {
    id: "ss-5",
    title: "5. Empfehlung, Testimonials",
    core: false,
    rows: [
      [
        "„Prof. Dr. X von der Universitätsmedizin empfiehlt uns.“",
        "(weglassen, § 11 Abs. 1 Nr. 2 HWG)",
      ],
      [
        "„Eine Patientin mit Ihrem Problem war nach 2 Wochen begeistert.“",
        "„Erfahrungen sind individuell. Frau Dr. … bespricht mit Ihnen, was in Ihrem Fall realistisch ist.“",
      ],
      [
        "„Promi Y lässt das bei uns machen.“",
        "(weglassen, § 11 HWG)",
      ],
      [
        "„Alle sagen, sie ist die Beste.“",
        "(weglassen, § 11 Abs. 1 Nr. 11 HWG)",
      ],
    ],
  },
  {
    id: "ss-6",
    title: "6. Risiko, Nichtschädlichkeit",
    core: false,
    rows: [
      [
        "„Komplett risikofrei.“",
        "„Wie bei jedem medizinischen Eingriff bestehen Risiken; diese werden vor der Behandlung ärztlich aufgeklärt.“",
      ],
      [
        "„Ohne Nebenwirkungen.“",
        "„Mögliche Nebenwirkungen werden in der ärztlichen Aufklärung besprochen.“",
      ],
      [
        "„Bei uns kann nichts passieren.“",
        "„Wir arbeiten nach den geltenden medizinischen Standards; alle Risiken werden persönlich erläutert.“",
      ],
    ],
  },
  {
    id: "ss-7",
    title: "7. Vorher-Nachher (kritisch)",
    core: true,
    rows: [
      [
        "„Sie werden so aussehen wie auf den Bildern auf Instagram.“",
        "„Vergleichsbilder sind kein verlässlicher Maßstab für Ihr Ergebnis. Im Termin schauen wir Ihre Anatomie an.“",
      ],
      [
        "„Wir schicken Ihnen Vorher-Nachher-Bilder per WhatsApp.“",
        "Verboten. § 11 Abs. 1 Satz 3 HWG, BGH 31.07.2025 (I ZR 170/24) gilt auch für Hyaluron und Botox. Bußgeld bis 50.000 €.",
      ],
    ],
  },
];

// ---------------------------------------------------------------
// 8. Termin-Close und DSGVO-Datenaufnahme (5 von 7 core)
// ---------------------------------------------------------------
export interface CloseStep {
  id: string;
  title: string;
  quote?: string;
  note?: string;
  /** Ordered list (e.g. the Datenfelder enumeration). */
  list?: string[];
  core: boolean;
}

export const CLOSE_STEPS: CloseStep[] = [
  {
    id: "close",
    title: "Either-Or-Close (wortwörtlich)",
    quote: "Ich nehme das so mit, dass Sie sich [Behandlung] anschauen möchten und ein Beratungsgespräch der nächste sinnvolle Schritt ist. Ich habe nächste Woche [Tag], [Datum], um [Uhrzeit] frei, oder am [Tag], [Datum], um [Uhrzeit]. Welcher Termin passt Ihnen besser?",
    core: true,
  },
  {
    id: "gebuehr",
    title: "Beratungsgebühr proaktiv kommunizieren",
    quote: "Unsere ärztliche Beratung dauert bis zu einer Stunde und kostet [50 €]. Diese Gebühr verrechnen wir vollständig auf die Behandlung, falls Sie sich für einen Eingriff entscheiden. Damit stellen wir sicher, dass die Beratung wirklich Zeit hat und nicht zwischen Tür und Angel passiert. Ist das in Ordnung für Sie?",
    note: "Vorab-Erhebung der Beratungsgebühr (Kreditkarte, Vorkasse, SEPA-Mandat) ist die robusteste Methode, No-Shows in der Erstberatung zu reduzieren („skin in the game“).",
    core: true,
  },
  {
    id: "dsgvo",
    title: "DSGVO-konformer Datenaufnahme-Satz",
    quote: "Bevor wir Ihre Daten aufnehmen, ein kurzer Hinweis: Wir, [Praxisname], speichern Ihre Angaben ausschließlich zur Terminvereinbarung und Beratung. Die ausführlichen Datenschutzhinweise nach Artikel 13 DSGVO finden Sie auf unserer Website unter [URL] und liegen bei Ihrem Besuch in der Praxis aus. Sind Sie damit einverstanden, dass ich Ihre Daten für die Terminvereinbarung notiere?",
    note: "Aufsichtsbehörden akzeptieren „zeitlichen Zusammenhang“, die vollständige Belehrung muss nicht am Telefon erfolgen. Zustimmung im CRM mit Zeitstempel dokumentieren.",
    core: true,
  },
  {
    id: "datenfelder",
    title: "Datenfelder in fester Reihenfolge",
    list: [
      "Anrede und vollständiger Name",
      "Geburtsdatum (Identifikation, Mindestalter)",
      "Mobilnummer",
      "E-Mail-Adresse",
      "Postleitzahl und Ort",
      "Behandlungs-Interesse in einem Satz",
      "Bevorzugter Kanal (E-Mail, SMS, Anruf, WhatsApp nur mit Opt-In)",
      "Empfehlungsquelle (optional)",
    ],
    core: true,
  },
  {
    id: "whatsapp",
    title: "WhatsApp-Einwilligung optional einholen",
    quote: "Wir bieten an, Termin-Erinnerungen auch über WhatsApp zu schicken, das ist für viele Patienten praktischer. Möchten Sie das nutzen, oder bleiben wir bei E-Mail und SMS?",
    note: "Nur über WhatsApp Business API mit zertifiziertem Anbieter (z.B. mateo, Superchat, Chatarmin), Pre-approved-Templates, AVV. Standard-WhatsApp und WhatsApp-Business-App sind in Praxen nicht DSGVO-konform.",
    core: false,
  },
  {
    id: "reaktivierung",
    title: "Reaktivierungs-Einwilligung am Ende",
    quote: "Dürfen wir Sie auch zu künftigen Angeboten und Informationsveranstaltungen per E-Mail oder SMS kontaktieren? Sie können diese Einwilligung jederzeit widerrufen.",
    note: "Wenn ja: dokumentieren mit Zeitstempel, Aufbewahrung 5 Jahre nach § 7a UWG. Pflicht: Opt-Out-Hinweis in jeder Marketing-Nachricht.",
    core: false,
  },
  {
    id: "abschluss",
    title: "Abschluss-Satz",
    quote: "Ihr Termin ist gebucht. Sie bekommen jetzt gleich eine Bestätigung per [Kanal]. 24 Stunden vor dem Termin schicken wir Ihnen eine kurze Erinnerung. Falls Sie noch Fragen haben oder verschieben müssen, melden Sie sich einfach unter [Telefonnummer] oder per E-Mail an [Adresse]. Wir freuen uns auf Sie.",
    core: true,
  },
];

// ---------------------------------------------------------------
// 9. No-Show-Prävention: Cadence + Vorlagen (Cadence + 2 Templates core)
// ---------------------------------------------------------------
export const NO_SHOW_INTRO =
  "Mehrkanal-Cadence reduziert No-Shows in deutschen Praxen messbar (Doctolib 30 bis 60 %, Universität Lübeck zitiert von LINK Mobility bis 82 %, Frontiers in Digital Health 2025 bei n=98.067 Terminen signifikant). Hauptgrund: 64 % vergessen den Termin schlicht.";

export interface CadenceRow {
  time: string;
  channel: string;
  purpose: string;
}

export const NO_SHOW_CADENCE: CadenceRow[] = [
  { time: "T+0 sofort", channel: "E-Mail mit iCal + SMS", purpose: "Bestätigung mit Adresse, Anfahrt, Vorbereitung" },
  { time: "T-7 Tage (optional)", channel: "E-Mail", purpose: "Vorab-Befragung, Erwartungsmanagement" },
  { time: "T-24h", channel: "SMS primär + E-Mail", purpose: "Haupt-Erinnerung mit JA / NEIN-Bestätigung" },
  { time: "T-2h", channel: "SMS oder WhatsApp", purpose: "Kurzfristige Erinnerung mit Adresse + Karte" },
  { time: "T+30 Min No-Show", channel: "Anruf + SMS", purpose: "Wo bleiben Sie? sanft, lösungsorientiert" },
  { time: "T+24h", channel: "E-Mail", purpose: "Empathische Nachfass-Mail mit Termin-Link" },
  { time: "T+7 Tage", channel: "E-Mail oder Anruf", purpose: "Reaktivierung 1: Termin-Angebot" },
  { time: "T+14 Tage", channel: "SMS oder E-Mail", purpose: "Reaktivierung 2: neue Erstberatung" },
];

export interface NoShowTemplate {
  id: string;
  title: string;
  text: string;
  core: boolean;
}

export const NO_SHOW_TEMPLATES: NoShowTemplate[] = [
  {
    id: "t1",
    title: "1. Sofort-Bestätigung E-Mail (mit iCal)",
    core: true,
    text: `Betreff: Ihre Erstberatung bei [Praxis] am [Datum], alle wichtigen Infos

Liebe / Lieber [Vorname Nachname],

vielen Dank für Ihr Vertrauen. Wir haben Ihre persönliche Erstberatung wie folgt für Sie reserviert:

  Termin:        [Wochentag], [Datum] um [Uhrzeit] Uhr
  Dauer:         ca. 45 bis 60 Minuten
  Behandler:     [Dr. Vorname Nachname]
  Adresse:       [Straße Hausnr., PLZ Ort]
  Anfahrt:       [Link Google Maps]
  Parken:        [Hinweis Parkplatz / Tiefgarage]

Was Sie mitbringen sollten:
  - Personalausweis
  - ggf. Vorbefunde, Medikamentenliste, Allergie-Pass
  - Eine Liste Ihrer Fragen, wir nehmen uns Zeit

Was Sie erwartet:
Ein vertrauliches, ergebnisoffenes Gespräch. Sie verlassen die Praxis mit einer ehrlichen Einschätzung, nicht mit Verkaufsdruck.

Sollten Sie verhindert sein, geben Sie uns bitte mindestens 24 Stunden vorher Bescheid: [Tel] oder [E-Mail].

Datenschutz: Ausführliche Information zur Verarbeitung Ihrer Daten nach Art. 13 DSGVO: [Link]

Termin im Kalender speichern: [iCal-Link]

Herzliche Grüße
[Empfangsteam-Name]
[Praxis]
[Tel] | [Web]`,
  },
  {
    id: "t2",
    title: "2. Sofort-Bestätigung SMS (160 Zeichen)",
    core: false,
    text: `Hallo [Vorname], Ihr Beratungstermin bei [Praxis] am [Datum] um [Uhrzeit] ist bestätigt. Adresse: [Straße]. Bei Verhinderung: [Tel]. Wir freuen uns auf Sie.`,
  },
  {
    id: "t3",
    title: "3. Sofort-Bestätigung WhatsApp (nur via Business API)",
    core: false,
    text: `Hallo [Vorname]

Ihr Beratungstermin bei [Praxis] ist bestätigt:

Termin: [Wochentag], [Datum]
Uhrzeit: [Uhrzeit] Uhr
Adresse: [Straße], [PLZ Ort]
Anfahrt: [Maps-Link]

Was Sie mitbringen: Ausweis, ggf. Vorbefunde.

Bei Verhinderung antworten Sie einfach mit ABSAGE oder rufen Sie unter [Tel] an.

Wir freuen uns auf Sie.
[Praxis]`,
  },
  {
    id: "t4",
    title: "4. Erinnerung 24h vorher SMS",
    core: true,
    text: `Erinnerung: Ihr Termin bei [Praxis] morgen [Datum] um [Uhrzeit]. Adresse: [Straße]. Bestätigen mit JA, Absage mit NEIN. Tel: [Tel]`,
  },
  {
    id: "t5",
    title: "5. Erinnerung 24h vorher E-Mail",
    core: false,
    text: `Betreff: Morgen ist es so weit, Ihre Beratung bei [Praxis]

Liebe / Lieber [Vorname],

nur eine kurze Erinnerung: Wir sehen uns morgen, [Wochentag], um [Uhrzeit] Uhr in [Straße, Ort].

Falls Sie noch Fragen vorab haben oder Ihre Anfahrt klären möchten, melden Sie sich gerne unter [Tel].

Sollte Ihnen kurzfristig etwas dazwischenkommen, geben Sie uns bitte bis spätestens heute 18:00 Uhr Bescheid, dann können wir den Termin nachbesetzen.

Bis morgen
[Empfangsteam]
[Praxis]`,
  },
  {
    id: "t6",
    title: "6. Letzte Erinnerung 2h vorher SMS oder WhatsApp",
    core: false,
    text: `Hallo [Vorname], Ihr Termin bei [Praxis] ist heute in 2h um [Uhrzeit]. Adresse: [Straße], [PLZ Ort]. Anfahrt: [maps.app.goo.gl/xxx] Bis gleich.`,
  },
  {
    id: "t7",
    title: "7. No-Show-Anruf-Skript (innerhalb 30 Min)",
    core: false,
    text: `Guten Tag [Anrede] [Nachname], hier spricht [Vorname Nachname] aus der [Praxisname]. Wir hatten Sie um [Uhrzeit] zur Beratung erwartet und konnten Sie noch nicht erreichen. Ist alles in Ordnung? Wenn Sie wollen, können wir gerne einen neuen Termin finden, melden Sie sich einfach bei mir.

Tonfall: besorgt, nicht ärgerlich. Kein Vorwurf.`,
  },
  {
    id: "t8",
    title: "8. No-Show-SMS (falls niemand abhebt)",
    core: false,
    text: `Hallo [Vorname], wir hatten Sie um [Uhrzeit] zur Beratung erwartet und konnten Sie noch nicht erreichen. Ist alles in Ordnung? Bitte melden Sie sich kurz: [Tel]`,
  },
  {
    id: "t9",
    title: "9. No-Show-Nachfass nach 24h, E-Mail",
    core: false,
    text: `Betreff: Ihr Termin gestern, wir holen das gerne nach

Liebe / Lieber [Vorname],

Sie konnten gestern Ihren Beratungstermin nicht wahrnehmen, kein Problem, das passiert.

Wir möchten Sie nicht aus den Augen verlieren. Falls Ihr Anliegen weiterhin besteht, finden wir gemeinsam einen neuen Termin, der besser in Ihren Alltag passt.

Direkt einen neuen Termin wählen: [Termin-Link]
Oder antworten Sie einfach auf diese E-Mail.

Wenn Sie sich anders entschieden haben, ist das ebenfalls völlig in Ordnung. Eine kurze Rückmeldung würde uns helfen, den Termin wieder freizugeben.

Herzliche Grüße
[Name], [Praxis]
[Tel]`,
  },
  {
    id: "t10",
    title: "10. Reaktivierung nach 7 Tagen, E-Mail",
    core: false,
    text: `Betreff: Wir denken an Sie, möchten Sie Ihren Beratungstermin neu vereinbaren?

Liebe / Lieber [Vorname],

vor einer Woche hatten wir Ihre Beratung zum Thema [Behandlung] reserviert. Wir gehen davon aus, dass etwas dazwischengekommen ist und möchten Ihnen einen neuen Termin anbieten.

Diese Woche haben wir noch zwei freie Termine:
  - [Wochentag, Datum] um [Uhrzeit] Uhr
  - [Wochentag, Datum] um [Uhrzeit] Uhr

Antworten Sie einfach mit Ihrer Wunschzeit oder buchen Sie online: [Link]

Für Rückfragen sind wir Mo bis Fr von [Zeit] erreichbar: [Tel].

Herzliche Grüße
[Name], [Praxis]`,
  },
  {
    id: "t11",
    title: "11. Reaktivierung nach 14 Tagen, SMS-Light",
    core: false,
    text: `Hallo [Vorname], wir hätten weiterhin gerne Ihre Fragen zu [Behandlung] beantwortet. Wenn Sie möchten, melden Sie sich: [Tel] oder [Termin-Link]. [Praxis]`,
  },
  {
    id: "t12",
    title: "12. Storno-Bestätigung SMS",
    core: false,
    text: `Vielen Dank für Ihre Nachricht. Ihr Termin am [Datum] ist storniert. Möchten Sie direkt einen neuen Termin? [Termin-Link] oder rufen Sie uns an: [Tel]`,
  },
  {
    id: "t13",
    title: "13. Storno-Bestätigung E-Mail mit Termin-Angebot",
    core: false,
    text: `Betreff: Termin abgesagt, kein Problem, wir bleiben in Kontakt

Liebe / Lieber [Vorname],

Ihr Termin am [Datum] um [Uhrzeit] ist storniert, danke, dass Sie uns rechtzeitig Bescheid gegeben haben.

Möchten Sie direkt einen Ersatztermin vereinbaren? Wir haben in den nächsten 14 Tagen folgende freie Termine:
  - [Wochentag, Datum] - [Uhrzeit]
  - [Wochentag, Datum] - [Uhrzeit]
  - [Wochentag, Datum] - [Uhrzeit]

Oder Sie wählen selbst: [Termin-Link]

Falls sich Ihre Pläne geändert haben, ist das vollkommen in Ordnung. Wir sind da, sobald Sie soweit sind.

Herzliche Grüße
[Name], [Praxis]`,
  },
];

// ---------------------------------------------------------------
// 10. Warnungen, Cheat-Sheet, Rechtsgrundlagen
// PDF-only (nicht in der Kurzfassung der Seite). Teil des
// vollständigen Playbooks im Download.
// ---------------------------------------------------------------
export interface DontWarning {
  id: string;
  title: string;
  body: string;
}

/** Two warnings that sit under the No-Show section in the full playbook. */
export const NO_SHOW_DONTS: DontWarning[] = [
  {
    id: "ns-don-1",
    title: "Reaktivierungs-Nachrichten brauchen Einwilligung",
    body: "Reaktivierungs-SMS und Marketing-E-Mails gelten als Werbung im Sinne von § 7 UWG. Sie setzen dokumentierte Einwilligung des Patienten voraus, die zum Zeitpunkt der Buchung eingeholt sein muss. Aufbewahrung 5 Jahre nach § 7a UWG. Pflicht: Opt-Out-Hinweis in jeder Nachricht („Antworten Sie mit STOP“ oder Abmelde-Link).",
  },
  {
    id: "ns-don-2",
    title: "Stornogebühren proportional gestalten",
    body: "Pauschale Stornogebühren bei ästhetischen Eingriffen sind nach AG München (Az. 213 C 27099/15) unwirksam. Stornogebühr darf den Behandlungspreis nicht überschreiten, Schadensminderungspflicht der Praxis beachten, kein 100 % am OP-Tag. AGB vor Auslieferung anwaltlich prüfen lassen.",
  },
];

/** "Was Sie unbedingt vermeiden" — eight hard prohibitions. */
export const VERMEIDEN_DONTS: DontWarning[] = [
  {
    id: "v1",
    title: "Keinen Endpreis am Telefon nennen",
    body: "Lockpreise und Festpreise verstoßen gegen § 7 HWG und § 5 Abs. 2 GOÄ. Stattdessen Spanne, Beratungsgebühr, Verweis auf Kostenvoranschlag in der Sprechstunde (§ 630c Abs. 3 BGB).",
  },
  {
    id: "v2",
    title: "Keine Heilversprechen, Erfolgsgarantien, Bagatellisierung",
    body: "„Garantiert“, „100 %“, „schmerzfrei“, „risikofrei“ sind § 3 HWG verboten. Auch bei direkter Patientenfrage nicht „nett“ gemeint verwenden.",
  },
  {
    id: "v3",
    title: "Keine Vorher-Nachher-Aussagen, auch nicht verbal",
    body: "§ 11 Abs. 1 Satz 3 HWG. Erweitert durch BGH 31.07.2025 (I ZR 170/24) auch auf Hyaluron, Botox und andere Unterspritzungen. Bußgeld bis 50.000 €.",
  },
  {
    id: "v4",
    title: "Keine vergleichende Werbung über Mitbewerber",
    body: "§ 27 Abs. 3 MBO-Ä, § 6 UWG. „Bei denen ist das nicht so sicher“ ist üble Nachrede plus Berufsrecht-Verstoß. Eigene Leistungen sachlich darstellen.",
  },
  {
    id: "v5",
    title: "Keine Diagnose, keine Behandlungsempfehlung am Telefon",
    body: "§ 7 Abs. 4 MBO-Ä Fernbehandlungsverbot, § 1 HeilprG. Nicht-ärztliches Personal darf keine Eignung beurteilen. Routen statt antworten.",
  },
  {
    id: "v6",
    title: "Keine Patiententestimonials oder Promi-Empfehlungen",
    body: "§ 11 Abs. 1 Nr. 2 und Nr. 11 HWG. „Alle sagen, sie ist die Beste“ oder „Promi Y kommt zu uns“ sind verboten.",
  },
  {
    id: "v7",
    title: "Standard-WhatsApp ist tabu",
    body: "Adressbuch-Synchronisation und Metadaten-Verstoß gegen § 203 StGB. Nur WhatsApp Business API mit zertifiziertem Anbieter, Opt-In und AVV. Quelle: BfDI 2024.",
  },
  {
    id: "v8",
    title: "Reaktivierungs-Mails nur mit Einwilligung",
    body: "§ 7 / § 7a UWG. Werbliche Nachrichten ohne dokumentiertes Opt-In sind abmahnfähig. Aufbewahrung 5 Jahre.",
  },
];

/** Compact legal-basis index, rendered as badges on the legacy page / chips in the PDF. */
export const RECHTSGRUNDLAGEN: string[] = [
  "§ 3 HWG (Heilversprechen)",
  "§ 7 HWG (Lockangebote)",
  "§ 11 HWG (Vorher-Nachher)",
  "§ 27 MBO-Ä (Werbung)",
  "§ 7 Abs. 4 MBO-Ä (Fernbehandlung)",
  "§ 1 HeilprG",
  "§ 630c BGB (Kostenvoranschlag)",
  "§ 630e BGB (Aufklärung)",
  "§ 6 UWG (vergleichend)",
  "§ 7 / § 7a UWG (Werbeanruf)",
  "Art. 13 DSGVO",
  "BGH I ZR 170/24 (31.07.2025)",
  "AG München 213 C 27099/15 (Stornogebühr)",
];

export const RECHTSGRUNDLAGEN_NOTE =
  "Vor produktivem Einsatz dieses Leitfadens: anwaltliche Prüfung der Skripte und AGB-Passagen (Beratungsgebühr, Stornoregeln, AVV mit BSP). Landesärztekammer-Berufsordnungen variieren leicht von der MBO-Ä-Modellnorm.";

/** Printable one-page cheat-sheet for the reception desk (PDF + legacy page). */
export const CHEAT_SHEET = `VERTRIEBSLEITFADEN, KURZFASSUNG FÜR DEN EMPFANGSTRESEN
─────────────────────────────────────────────────────────

1. ERÖFFNUNG
   "[Praxisname], guten Tag, Sie sprechen mit [Name],
    was kann ich für Sie tun?"

2. DISCOVERY (3 Pflicht-Fragen)
   - Welche Behandlung schwebt Ihnen vor?
   - Wann wäre der Wunschzeitpunkt?
   - Wo wohnen Sie ungefähr?

3. PREIS-FRAGE? Niemals Punktpreis am Telefon.
   "Den genauen Preis legt unser Arzt nach der
    individuellen Beratung fest. Bei [Behandlung] bewegen
    wir uns zwischen [von €] und [bis €]."

4. NIEMALS SAGEN (HWG-relevant)
   - "Schmerzfrei" / "Sie spüren nichts"
   - "Sie werden so aussehen wie [Bild / Person]"
   - "Das hält genau X Monate / ein Leben lang"
   - "Bei der Konkurrenz zahlen Sie mehr"
   - "Wir sind die beste Praxis in [Stadt]"
   - "Heute Sonderkondition / Frühlingsaktion"
   - "Erstberatung kostenlos" (für invasive Eingriffe)
   - Keine Vorher-Nachher-Bilder per WhatsApp / E-Mail

5. CLOSE (Either-Or)
   "Ich habe [Datum 1] um [Uhrzeit] frei oder
    [Datum 2] um [Uhrzeit]. Welcher Termin passt besser?"

6. BERATUNGSGEBÜHR PROAKTIV
   "Die Beratung kostet [50 €] und wird auf eine
    eventuelle Behandlung verrechnet."

7. DATENAUFNAHME (Pflichtfelder)
   Anrede + Name | Geb-Datum | Mobil | E-Mail | PLZ
   + Behandlungswunsch + bevorzugter Kanal

8. DSGVO-SATZ
   "Eine ausführliche Datenschutzinformation schicke ich
    Ihnen mit der Bestätigung per E-Mail."

9. BEI MEDIZINISCHEN FRAGEN
   "Diese Frage gehört in die ärztliche Aufklärung im
    Beratungstermin."

10. ROTE FLAGGEN (kein Termin)
    - Unter 18 / nicht selbstbestimmt
    - Unrealistische Erwartungen ("wie [Promi]")
    - Fokussierung auf minimale "Makel"
    - Druck durch Dritte erkennbar

─────────────────────────────────────────────────────────
KPI: Reaktion < 5 Min · Abschluss > 25 % · No-Show < 20 %
Patient ernst nehmen, nicht weg-skripten.`;
