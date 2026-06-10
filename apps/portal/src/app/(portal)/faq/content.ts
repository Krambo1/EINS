/**
 * FAQ content for the clinic-facing portal.
 *
 * Plain data, grouped by category. The /faq page renders this with its own
 * local search (see ./_components/FaqBrowser). This list is intentionally NOT
 * added to the global search index (src/lib/search/staticIndex.ts): the FAQ
 * tab is exempt from the global palette by design and only searchable from its
 * own search bar.
 *
 * Editing rules (same as the rest of the portal): formal Sie, no em-dashes,
 * "Praxis" never "Klinik", anti-anglicism (Anfrage not Lead, bezahlte Anzeigen
 * not Paid Ads, Werbeertrag for ROAS, Auswertung not Reporting, Zielseite not
 * Landingpage). Keep answers short and concrete. Do not promise specifics that
 * live in the contract (Garantie-Bedingungen, Abrechnung): point to Dokumente
 * instead.
 *
 * `a` may contain blank lines (\n\n) for paragraph breaks; the renderer uses
 * whitespace-pre-line.
 */

export interface FaqItem {
  /** Stable, unique, kebab-case id (also used as the accordion item value). */
  id: string;
  /** The question, shown in the accordion trigger. */
  q: string;
  /** The answer. May contain \n\n for paragraph breaks. */
  a: string;
  /** Extra search terms (synonyms, English words) the question text misses. */
  keywords?: string[];
}

export interface FaqCategory {
  id: string;
  label: string;
  items: FaqItem[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: "erste-schritte",
    label: "Erste Schritte",
    items: [
      {
        id: "was-ist-portal",
        q: "Was ist das EINS-Portal?",
        a: "Das Portal ist Ihre zentrale Übersicht für die Zusammenarbeit mit EINS. Sie sehen hier alle Patientenanfragen aus Ihren Anzeigen, Ihre Kennzahlen, Ihre Videos und Medien, Ihre Bewertungen, Ihre Dokumente und den Vertriebsleitfaden für Ihr Team. Alles an einem Ort, jederzeit erreichbar.",
        keywords: ["dashboard", "überblick", "was kann das", "zweck", "wofür"],
      },
      {
        id: "anmelden",
        q: "Wie melde ich mich an?",
        a: "Sie melden sich mit Ihrer E-Mail-Adresse und Ihrem Passwort an. Alternativ können Sie sich einen Magic-Link zusenden lassen: Sie erhalten dann eine E-Mail mit einem Link, über den Sie sich ohne Passwort anmelden.",
        keywords: ["login", "einloggen", "anmeldung", "passwort", "magic link", "zugang"],
      },
      {
        id: "passwort-vergessen",
        q: "Ich habe mein Passwort vergessen. Was kann ich tun?",
        a: "Lassen Sie sich auf der Anmeldeseite einen Magic-Link zusenden. Damit kommen Sie ohne Passwort ins Portal. Anschließend können Sie unter Einstellungen, Mein Profil ein neues Passwort vergeben.",
        keywords: ["passwort zurücksetzen", "reset", "vergessen", "kein passwort", "magic link"],
      },
      {
        id: "magic-link",
        q: "Was ist ein Magic-Link?",
        a: "Ein Magic-Link ist ein einmaliger Anmeldelink, den wir Ihnen per E-Mail schicken. Sie klicken darauf und sind angemeldet, ohne ein Passwort eingeben zu müssen. Der Link ist nur kurze Zeit gültig und funktioniert nur einmal.",
        keywords: ["passwortlos", "einmal-link", "link login", "passwordless"],
      },
      {
        id: "app-oder-browser",
        q: "Brauche ich eine App, oder läuft alles im Browser?",
        a: "Sie brauchen keine App. Das Portal läuft in jedem aktuellen Browser, am Computer genauso wie am Tablet oder Smartphone.",
        keywords: ["installieren", "download", "app store", "mobil", "handy", "browser"],
      },
      {
        id: "mobil-nutzbar",
        q: "Funktioniert das Portal auch auf dem Smartphone?",
        a: "Ja. Das Portal ist für kleine Bildschirme optimiert. Gerade die Anfragen-Inbox und die Anruf-Warteschlange lassen sich am Telefon bequem bedienen, etwa wenn Sie unterwegs zurückrufen.",
        keywords: ["handy", "tablet", "mobil", "unterwegs", "responsive"],
      },
      {
        id: "bereiche-ueberblick",
        q: "Welche Bereiche gibt es im Portal?",
        a: "In der Seitenleiste finden Sie: Übersicht (Ihre Kennzahlen), Fortschritt (Ihr Onboarding), Anfragen (Patientenanfragen), Werbebudget (Ihre laufenden Anzeigen), Bewertungen (Reputation und Patientenfeedback), Medien (Ihre Videos), Dokumente (Verträge und Material), Leitfaden (Ihr Vertriebs-Playbook), Feedback (Ihre Wünsche an uns) und Einstellungen.",
        keywords: ["navigation", "tabs", "menü", "seitenleiste", "module"],
      },
      {
        id: "hilfe-bei-problemen",
        q: "An wen wende ich mich bei Fragen oder Problemen?",
        a: "Schreiben Sie uns über den Bereich Feedback in der Seitenleiste. Dort landet Ihre Nachricht direkt bei uns. Ihre persönlichen Ansprechpartner und die Kontaktmöglichkeiten finden Sie außerdem in der Kontaktkarte unten in der Seitenleiste.",
        keywords: ["kontakt", "support", "ansprechpartner", "hilfe", "erreichen"],
      },
    ],
  },
  {
    id: "anfragen",
    label: "Anfragen",
    items: [
      {
        id: "was-ist-anfrage",
        q: "Was ist eine Anfrage?",
        a: "Eine Anfrage ist eine interessierte Patientin oder ein interessierter Patient, die oder der über eine Ihrer Anzeigen auf Sie aufmerksam geworden ist und sich gemeldet hat, per Formular oder per Anruf. Jede Anfrage ist eine konkrete Chance auf einen Beratungstermin.",
        keywords: ["lead", "interessent", "patient", "anfrage", "kontaktanfrage"],
      },
      {
        id: "woher-anfragen",
        q: "Woher kommen die Anfragen?",
        a: "Die Anfragen entstehen aus Ihren bezahlten Anzeigen bei Meta (Instagram und Facebook) und Google. Wer auf eine Anzeige klickt, landet auf einer Zielseite und hinterlässt dort seine Daten oder ruft direkt an. Diese Kontakte sammeln sich in Ihrer Anfragen-Inbox.",
        keywords: ["herkunft", "quelle", "meta", "google", "instagram", "anzeigen", "zielseite"],
      },
      {
        id: "reaktionszeit",
        q: "Wie schnell sollte ich auf eine neue Anfrage reagieren?",
        a: "So schnell wie möglich. Je früher Sie sich melden, desto höher ist die Chance, dass aus der Anfrage ein Termin wird. Konkrete Zielwerte und bewährte Gesprächsabläufe finden Sie im Vertriebsleitfaden.",
        keywords: ["sla", "geschwindigkeit", "zurückrufen", "schnell", "antwortzeit", "reaktion"],
      },
      {
        id: "anfrage-status",
        q: "Was bedeuten die Status einer Anfrage?",
        a: "Der Status zeigt, wo eine Anfrage gerade steht: zum Beispiel neu eingegangen, in Bearbeitung, Termin vereinbart oder abgeschlossen. So sehen Sie und Ihr Team auf einen Blick, was noch zu tun ist und wer sich kümmert.",
        keywords: ["status", "offen", "in bearbeitung", "termin", "abgeschlossen", "phasen"],
      },
      {
        id: "call-queue",
        q: "Was ist die Anruf-Warteschlange?",
        a: "Die Anruf-Warteschlange listet die Anfragen, die jetzt einen Rückruf brauchen, in sinnvoller Reihenfolge auf. So weiß Ihr Empfang sofort, wen er als Nächstes anrufen sollte, ohne lange suchen zu müssen.",
        keywords: ["call queue", "warteschlange", "rückruf", "anrufen", "empfang", "frontdesk"],
      },
      {
        id: "ueberfaellig",
        q: "Warum wird eine Anfrage als überfällig angezeigt?",
        a: "Überfällig bedeutet, dass eine Anfrage schon länger auf eine Reaktion wartet, als sie sollte. Das ist ein Hinweis, sich zügig zu kümmern, denn die ersten Minuten und Stunden entscheiden oft darüber, ob ein Termin zustande kommt.",
        keywords: ["überfällig", "sla breach", "verspätet", "zu spät", "warnung"],
      },
      {
        id: "anfrage-manuell",
        q: "Kann ich eine Anfrage auch selbst anlegen?",
        a: "Ja. Wenn sich jemand auf einem anderen Weg meldet, etwa direkt in der Praxis oder über einen Empfehlungskontakt, können Sie die Anfrage von Hand anlegen, damit sie mit allen anderen an einem Ort steht.",
        keywords: ["manuell anlegen", "selbst erfassen", "neue anfrage", "hinzufügen"],
      },
      {
        id: "anfrage-zuordnen",
        q: "Wie ordne ich eine Anfrage einem Teammitglied zu?",
        a: "In der Anfragen-Inbox können Sie eine Anfrage einer Person aus Ihrem Team zuweisen, einzeln oder mehrere auf einmal. So ist klar, wer sich um welche Anfrage kümmert.",
        keywords: ["zuweisen", "zuordnen", "team", "verantwortlich", "bulk"],
      },
      {
        id: "anfrage-zu-termin",
        q: "Was passiert, wenn aus einer Anfrage ein Termin wird?",
        a: "Sie halten den Termin an der Anfrage fest. Dadurch fließt die Anfrage in Ihre Kennzahlen ein und Sie sehen später in der Übersicht, wie viele Anfragen tatsächlich zu Terminen und zu Umsatz geführt haben.",
        keywords: ["termin", "abschluss", "umwandeln", "gewonnen", "conversion"],
      },
    ],
  },
  {
    id: "uebersicht",
    label: "Übersicht und Kennzahlen",
    items: [
      {
        id: "was-zeigt-dashboard",
        q: "Was zeigt mir die Übersicht?",
        a: "Die Übersicht ist Ihr Dashboard. Sie sehen dort auf einen Blick die wichtigsten Zahlen: wie viele Anfragen eingegangen sind, wie schnell darauf reagiert wird, wie sich Ihr Umsatz entwickelt und wie wirtschaftlich Ihre Anzeigen laufen.",
        keywords: ["dashboard", "kennzahlen", "kpi", "übersicht", "zahlen", "auswertung"],
      },
      {
        id: "werbeertrag",
        q: "Was bedeutet Werbeertrag?",
        a: "Der Werbeertrag (englisch ROAS) sagt Ihnen, wie viel Umsatz je investiertem Euro Werbebudget zurückkommt. Ein Werbeertrag von 5 bedeutet zum Beispiel: für jeden Euro, den Sie in Anzeigen stecken, kommen fünf Euro Umsatz zurück. So sehen Sie schnell, ob sich Ihre Anzeigen lohnen.",
        keywords: ["roas", "werbeertrag", "rentabilität", "return on ad spend", "wirtschaftlich"],
      },
      {
        id: "sla-ampel",
        q: "Was bedeutet die Ampel bei der Reaktionszeit?",
        a: "Die Ampel zeigt, wie schnell Ihre Praxis im Schnitt auf neue Anfragen reagiert. Grün heißt: alles im Zielbereich. Gelb und Rot sind ein Hinweis, dass Anfragen schneller bearbeitet werden sollten, denn schnelle Reaktion ist der größte Hebel für mehr Termine.",
        keywords: ["ampel", "sla", "reaktionszeit", "grün gelb rot", "antwortzeit"],
      },
      {
        id: "zeitraum-waehlen",
        q: "Kann ich den Zeitraum der Zahlen umstellen?",
        a: "Ja. Oben auf der Übersicht können Sie den Zeitraum wechseln, zum Beispiel den aktuellen Monat oder einen längeren Zeitraum. Alle Kennzahlen passen sich dann automatisch an.",
        keywords: ["zeitraum", "monat", "quartal", "filter", "zeit umstellen", "vergleich"],
      },
      {
        id: "umsatz-herkunft",
        q: "Woher kommt die Umsatzzahl in der Übersicht?",
        a: "Die Umsatzzahl basiert auf den tatsächlich erbrachten und abgerechneten Behandlungen Ihrer Praxis. So sehen Sie nicht nur, wie viele Anfragen kommen, sondern auch, welcher Umsatz daraus entstanden ist.",
        keywords: ["umsatz", "revenue", "einnahmen", "honorar", "abrechnung", "euro"],
      },
      {
        id: "umsatz-aktualitaet",
        q: "Wie aktuell sind die Umsatzzahlen?",
        a: "Die Umsatzzahlen werden einmal täglich aktualisiert. Es ist also normal, dass eine Behandlung von heute erst am nächsten Tag in der Übersicht auftaucht.",
        keywords: ["aktualität", "wie oft", "täglich", "verzögerung", "latenz", "nightly"],
      },
      {
        id: "umsatz-zuordnung",
        q: "Sehe ich, welche Anfrage zu welchem Umsatz geführt hat?",
        a: "Ja, in der Übersicht ist nachvollziehbar, wie aus Anfragen Termine und daraus Umsatz wird. So erkennen Sie, welche Behandlungsbereiche besonders gut laufen.",
        keywords: ["zuordnung", "attribution", "welche anfrage", "umsatz quelle", "herkunft umsatz"],
      },
      {
        id: "ladezeit",
        q: "Warum lädt die Übersicht manchmal kurz?",
        a: "Die Zahlen auf der Übersicht werden bei jedem Aufruf frisch und nur für Ihre Praxis geladen. In seltenen Fällen dauert das einen Moment länger. Die angezeigten Werte sind dafür immer aktuell.",
        keywords: ["langsam", "ladezeit", "lädt", "dauert", "performance"],
      },
    ],
  },
  {
    id: "werbung",
    label: "Werbebudget und Anzeigen",
    items: [
      {
        id: "wo-laufen-anzeigen",
        q: "Wo laufen meine Anzeigen?",
        a: "Ihre Anzeigen laufen dort, wo Ihre Wunschpatienten sind: bei Meta, also auf Instagram und Facebook, sowie bei Google. Welche Kanäle für Ihre Praxis am besten funktionieren, stimmen wir gemeinsam ab.",
        keywords: ["meta", "google", "instagram", "facebook", "anzeigen", "kanäle", "ads"],
      },
      {
        id: "werbebudget-bereich",
        q: "Was sehe ich unter Werbebudget?",
        a: "Unter Werbebudget sehen Sie Ihre aktuell laufenden Kampagnen und das jeweils eingesetzte Budget. So ist transparent, wofür Ihr Werbebudget eingesetzt wird.",
        keywords: ["werbebudget", "budget", "kampagnen", "adspend", "ausgaben"],
      },
      {
        id: "wer-verwaltet-anzeigen",
        q: "Wer kümmert sich um die Anzeigen?",
        a: "Das übernimmt EINS für Sie: Konzeption, Erstellung, Schaltung und laufende Optimierung der Anzeigen. Sie müssen sich nicht um die Technik kümmern und behalten im Portal trotzdem den vollen Überblick.",
        keywords: ["wer macht", "verwaltung", "betreuung", "optimierung", "agentur"],
      },
      {
        id: "werbekonto-verbinden",
        q: "Wie verbinde ich mein Werbekonto?",
        a: "Unter Einstellungen, Werbekonten verbinden Sie Ihr Meta- und Google-Konto mit wenigen Klicks. Dadurch können wir die Anzeigen in Ihrem Namen schalten und die Zahlen sauber in Ihre Übersicht spielen. Diesen Schritt nimmt in der Regel die Inhaberin oder der Inhaber vor.",
        keywords: ["werbekonto", "verbinden", "meta", "google ads", "oauth", "verknüpfen"],
      },
      {
        id: "budget-aendern",
        q: "Kann ich mein Budget ändern?",
        a: "Ihr Werbebudget legen wir gemeinsam fest. Wenn Sie es anpassen möchten, sprechen Sie uns einfach an, zum Beispiel über den Bereich Feedback. Wir setzen die Änderung dann für Sie um.",
        keywords: ["budget ändern", "erhöhen", "senken", "anpassen", "mehr ausgeben"],
      },
      {
        id: "werbekonto-trennen",
        q: "Was passiert, wenn ich ein Werbekonto trenne?",
        a: "Wird die Verbindung getrennt, können wir keine neuen Anzeigen mehr in Ihrem Namen schalten und keine aktuellen Zahlen mehr abrufen. Trennen Sie ein Konto deshalb bitte nur in Absprache mit uns.",
        keywords: ["trennen", "verbindung lösen", "deaktivieren", "abmelden"],
      },
    ],
  },
  {
    id: "bewertungen",
    label: "Bewertungen und Reputation",
    items: [
      {
        id: "bewertungen-bereich",
        q: "Was finde ich unter Bewertungen?",
        a: "Unter Bewertungen sehen Sie Ihre öffentlichen Bewertungen, etwa von Google und Jameda, und Sie verwalten das private Patientenfeedback. So haben Sie Ihre Reputation an einem Ort im Blick.",
        keywords: ["bewertungen", "google", "jameda", "reputation", "sterne", "reviews"],
      },
      {
        id: "bewertungen-aktualisieren",
        q: "Wie werden meine Google- und Jameda-Bewertungen aktualisiert?",
        a: "Sobald Sie Ihre Bewertungsadresse hinterlegt haben, holt das Portal Ihre öffentlichen Bewertungen automatisch und zeigt sie an. Sie können die Aktualisierung in den Einstellungen bei Bedarf auch manuell anstoßen.",
        keywords: ["sync", "aktualisieren", "google", "jameda", "place id", "synchronisieren"],
      },
      {
        id: "bewertungs-anfragen",
        q: "Was sind Bewertungs-Anfragen und wie aktiviere ich sie?",
        a: "Mit Bewertungs-Anfragen bitten Sie zufriedene Patienten nach der Behandlung automatisch um eine Bewertung. Das ist der einfachste Weg zu mehr und besseren öffentlichen Bewertungen. Aktivieren können Sie die Funktion in den Einstellungen unter Bewertungen.",
        keywords: ["bewertungsanfrage", "review request", "patienten fragen", "mehr bewertungen", "aktivieren"],
      },
      {
        id: "oeffentlich-vs-feedback",
        q: "Was ist der Unterschied zwischen Bewertungen und Patientenfeedback?",
        a: "Öffentliche Bewertungen sind für alle sichtbar, zum Beispiel bei Google. Patientenfeedback ist privat: Es ist nur für Sie bestimmt und hilft Ihnen, intern besser zu werden, ohne dass es öffentlich erscheint.",
        keywords: ["öffentlich", "privat", "patientenfeedback", "unterschied", "intern"],
      },
      {
        id: "bewertungsadresse-hinterlegen",
        q: "Wie hinterlege ich meine Google-Bewertungs-URL oder Place-ID?",
        a: "Das machen Sie in den Einstellungen unter Bewertungen und Reputation. Dort tragen Sie Ihre Google-Bewertungsadresse, Ihre Google Place-ID und gegebenenfalls Ihre Jameda-Adresse ein, damit Bewertungen korrekt gelesen werden.",
        keywords: ["place id", "url", "google", "jameda", "einrichten", "hinterlegen"],
      },
      {
        id: "feedback-beantworten",
        q: "Wie antworte ich auf Patientenfeedback?",
        a: "Im Bereich Patientenfeedback öffnen Sie eine Rückmeldung und können direkt darauf reagieren. Vorlagen helfen Ihnen, schnell und passend zu antworten.",
        keywords: ["antworten", "reagieren", "feedback", "vorlagen", "patientenstimmen"],
      },
    ],
  },
  {
    id: "medien",
    label: "Medien und Videos",
    items: [
      {
        id: "medien-bereich",
        q: "Was finde ich unter Medien?",
        a: "Unter Medien finden Sie die für Ihre Praxis produzierten Videos, Animationen und Grafiken. Diese werden in Ihren Anzeigen eingesetzt und stehen Ihnen dort zum Ansehen und Herunterladen bereit.",
        keywords: ["medien", "videos", "animationen", "grafiken", "assets", "content"],
      },
      {
        id: "medien-nutzen",
        q: "Darf ich die Videos auch für meine eigenen Kanäle nutzen?",
        a: "In der Regel ja, etwa für Ihre Website oder Ihre eigenen Profile. Die genauen Nutzungsrechte sind in Ihrem Vertrag geregelt, den Sie unter Dokumente finden. Bei Unsicherheit sprechen Sie uns gerne an.",
        keywords: ["nutzungsrechte", "verwenden", "eigene kanäle", "website", "social media", "rechte"],
      },
      {
        id: "medien-herunterladen",
        q: "Wie lade ich ein Video herunter?",
        a: "Öffnen Sie das gewünschte Video im Bereich Medien und nutzen Sie die Download-Funktion. Die Datei wird dann auf Ihr Gerät gespeichert.",
        keywords: ["download", "herunterladen", "speichern", "video"],
      },
      {
        id: "neue-medien-haeufigkeit",
        q: "Wie oft bekomme ich neue Medien?",
        a: "Zu Beginn der Zusammenarbeit produzieren wir die Medien für Ihren Start. Weitere Produktionen stimmen wir individuell mit Ihnen ab, je nachdem, was für Ihre Praxis sinnvoll ist.",
        keywords: ["wie oft", "neue videos", "produktion", "häufigkeit", "monatlich"],
      },
      {
        id: "medien-formate",
        q: "In welchen Formaten bekomme ich die Videos?",
        a: "Die Videos werden in den Formaten geliefert, die für die jeweiligen Plattformen passen, zum Beispiel im Hochformat für Instagram und Facebook. So sind sie sofort einsatzbereit.",
        keywords: ["formate", "hochformat", "auflösung", "dateiformat", "größe"],
      },
    ],
  },
  {
    id: "dokumente",
    label: "Dokumente und Verträge",
    items: [
      {
        id: "dokumente-bereich",
        q: "Was finde ich unter Dokumente?",
        a: "Unter Dokumente liegen Ihre Verträge, die Auftragsverarbeitungsvereinbarung (AVV), Marketing-Material und der vollständige Vertriebsleitfaden als PDF. Sie können die Dateien dort jederzeit ansehen und herunterladen.",
        keywords: ["dokumente", "dateien", "vertrag", "avv", "downloads", "material"],
      },
      {
        id: "vertrag-finden",
        q: "Wo finde ich meinen Vertrag und die AVV?",
        a: "Beides liegt unter Dokumente. Aus Datenschutzgründen sind Verträge und die AVV nur für die Inhaberin oder den Inhaber sichtbar.",
        keywords: ["vertrag", "avv", "finden", "inhaber", "rechtliches"],
      },
      {
        id: "was-ist-avv",
        q: "Was ist eine AVV?",
        a: "AVV steht für Auftragsverarbeitungsvereinbarung. Sie regelt nach DSGVO, wie EINS die personenbezogenen Daten Ihrer Praxis in Ihrem Auftrag verarbeitet. Sie ist die rechtliche Grundlage für eine datenschutzkonforme Zusammenarbeit.",
        keywords: ["avv", "auftragsverarbeitung", "dsgvo", "datenschutz", "vereinbarung"],
      },
      {
        id: "leitfaden-pdf",
        q: "Wo finde ich den vollständigen Vertriebsleitfaden als PDF?",
        a: "Die komplette Fassung mit allen Einwänden, HWG-Tabellen und Vorlagen liegt als PDF unter Dokumente. Der Bereich Leitfaden im Portal zeigt die wichtigste Kurzfassung.",
        keywords: ["leitfaden pdf", "playbook", "vollständig", "download", "vertriebsleitfaden"],
      },
      {
        id: "wer-sieht-vertraege",
        q: "Wer in meinem Team kann die Verträge sehen?",
        a: "Verträge und die AVV sind standardmäßig nur für die Inhaberin oder den Inhaber sichtbar. Allgemeines Material und der Leitfaden stehen dagegen allen Rollen zur Verfügung.",
        keywords: ["sichtbarkeit", "rollen", "wer sieht", "vertraulich", "team"],
      },
    ],
  },
  {
    id: "leitfaden",
    label: "Leitfaden und Prüfung",
    items: [
      {
        id: "was-ist-leitfaden",
        q: "Was ist der Vertriebsleitfaden?",
        a: "Der Vertriebsleitfaden ist Ihr Playbook für die Annahme von Patientenanfragen am Telefon: Gesprächs-Eröffnung, die richtigen Fragen, Antworten auf häufige Einwände, HWG-konforme Formulierungen und Tipps gegen ausgefallene Termine. Damit machen Sie aus mehr Anfragen echte Termine.",
        keywords: ["leitfaden", "playbook", "gesprächsführung", "telefon", "skript", "vertrieb"],
      },
      {
        id: "wer-leitfaden-lesen",
        q: "Wer sollte den Leitfaden lesen?",
        a: "Alle, die in Ihrer Praxis Anrufe und Anfragen von Patienten annehmen, also vor allem Empfang und Sekretariat. Der Leitfaden sorgt dafür, dass jedes Gespräch souverän und einheitlich läuft.",
        keywords: ["wer", "empfang", "sekretariat", "mfa", "team", "mitarbeiter"],
      },
      {
        id: "was-ist-pruefung",
        q: "Was ist die Leitfaden-Prüfung?",
        a: "Die Prüfung ist ein kurzes Quiz mit Fragen aus dem Leitfaden. Damit stellen Sie sicher, dass Ihr Team die wichtigsten Inhalte wirklich verinnerlicht hat. Sie können sie beliebig oft wiederholen.",
        keywords: ["prüfung", "quiz", "test", "schulung", "wiederholen"],
      },
      {
        id: "wer-pruefung-bestehen",
        q: "Wer muss die Prüfung bestehen?",
        a: "Mindestens eine Person pro Praxis sollte die Prüfung bestehen. Das gehört zu Ihrer Mitwirkung, damit Anfragen bestmöglich in Termine umgewandelt werden.",
        keywords: ["wer muss", "bestehen", "pflicht", "mindestens", "mitwirkung"],
      },
      {
        id: "pruefung-umfang",
        q: "Wie viele Fragen hat die Prüfung und wie oft darf ich sie machen?",
        a: "Die Prüfung besteht aus mehreren Fragen aus dem Leitfaden, von denen Sie einen Großteil richtig beantworten müssen. Die Zahl der Versuche ist nicht begrenzt: Sie können die Prüfung so oft wiederholen, wie Sie möchten.",
        keywords: ["anzahl fragen", "versuche", "wie oft", "bestehensgrenze", "punkte"],
      },
      {
        id: "pruefung-garantie",
        q: "Was hat die Prüfung mit der Garantie zu tun?",
        a: "Die EINS-Garantie setzt voraus, dass Ihre Praxis aktiv mitwirkt. Dazu gehört, dass mindestens eine Person die Leitfaden-Prüfung besteht. Die genauen Bedingungen stehen in Ihrem Vertrag unter Dokumente.",
        keywords: ["garantie", "bedingung", "mitwirkung", "voraussetzung", "vertrag"],
      },
    ],
  },
  {
    id: "fortschritt",
    label: "Fortschritt und Onboarding",
    items: [
      {
        id: "was-zeigt-fortschritt",
        q: "Was zeigt mir der Bereich Fortschritt?",
        a: "Der Bereich Fortschritt zeigt Ihre Meilensteine beim Start mit EINS: was schon erledigt ist und was als Nächstes ansteht. So sehen Sie jederzeit, wo Sie im Onboarding stehen.",
        keywords: ["fortschritt", "onboarding", "meilensteine", "start", "schritte", "timeline"],
      },
      {
        id: "meilensteine-bedeutung",
        q: "Was bedeuten die einzelnen Meilensteine?",
        a: "Jeder Meilenstein steht für einen Schritt auf dem Weg zu laufenden Anzeigen und ersten Anfragen, zum Beispiel Werbekonten verbinden, Medien produzieren und Kampagnen starten. Erledigte Schritte werden als abgeschlossen markiert.",
        keywords: ["meilensteine", "schritte", "bedeutung", "phasen", "aufgaben"],
      },
      {
        id: "onboarding-dauer",
        q: "Wie lange dauert das Onboarding?",
        a: "Das hängt davon ab, wie schnell die nötigen Schritte auf Ihrer Seite erledigt sind, etwa das Verbinden der Werbekonten und das Bereitstellen erster Inhalte. Den aktuellen Stand sehen Sie jederzeit im Bereich Fortschritt.",
        keywords: ["dauer", "wie lange", "zeit", "start", "bis anzeigen laufen"],
      },
    ],
  },
  {
    id: "team",
    label: "Team und Zugänge",
    items: [
      {
        id: "team-einladen",
        q: "Wie lade ich Teammitglieder ein?",
        a: "Unter Einstellungen, Team können Sie weitere Personen per E-Mail einladen und ihnen eine Rolle zuweisen. Die eingeladene Person erhält dann einen Link, um ihren Zugang einzurichten.",
        keywords: ["team", "einladen", "mitarbeiter hinzufügen", "kollegen", "nutzer anlegen"],
      },
      {
        id: "welche-rollen",
        q: "Welche Rollen gibt es?",
        a: "Es gibt drei Rollen: Inhaberin oder Inhaber (voller Zugriff inklusive Verträge und Einstellungen), Marketing-Verantwortliche und Empfang beziehungsweise Sekretariat (Fokus auf Anfragen und Anrufe). Die Rolle steuert, welche Bereiche eine Person sieht.",
        keywords: ["rollen", "berechtigung", "inhaber", "marketing", "empfang", "mfa", "frontdesk"],
      },
      {
        id: "wer-sieht-was",
        q: "Wer darf welche Bereiche sehen?",
        a: "Die meisten Bereiche wie Übersicht, Anfragen, Bewertungen, Medien und Leitfaden stehen allen Rollen offen. Verträge, das Team und die Werbekonten sind aus gutem Grund nur für die Inhaberin oder den Inhaber sichtbar.",
        keywords: ["berechtigung", "sichtbarkeit", "zugriff", "rollen", "rechte"],
      },
      {
        id: "passwort-aendern",
        q: "Wie ändere ich mein Passwort?",
        a: "Unter Einstellungen, Mein Profil können Sie jederzeit ein neues Passwort vergeben.",
        keywords: ["passwort ändern", "neues passwort", "profil", "sicherheit"],
      },
      {
        id: "zwei-faktor",
        q: "Gibt es eine Zwei-Faktor-Authentifizierung oder Authenticator-App?",
        a: "Eine Authenticator-App ist nicht erforderlich. Die Anmeldung erfolgt über Passwort oder über einen einmaligen Magic-Link, der nur an Ihre E-Mail-Adresse geht. Verwenden Sie ein starkes, eigenes Passwort und geben Sie Ihre Zugänge nicht weiter.",
        keywords: ["2fa", "zwei-faktor", "totp", "authenticator", "mfa", "sicherheit"],
      },
      {
        id: "zugang-entfernen",
        q: "Ein Teammitglied hat die Praxis verlassen. Wie entferne ich den Zugang?",
        a: "Unter Einstellungen, Team können Sie den Zugang einer Person entfernen oder deaktivieren. Tun Sie das zeitnah, wenn jemand nicht mehr für Ihre Praxis arbeitet.",
        keywords: ["zugang entfernen", "deaktivieren", "ausscheiden", "löschen", "sperren"],
      },
    ],
  },
  {
    id: "datenschutz",
    label: "Datenschutz und Sicherheit",
    items: [
      {
        id: "daten-sicher",
        q: "Sind die Patientendaten im Portal sicher?",
        a: "Ja. Der Zugang ist passwortgeschützt, die Verbindung ist verschlüsselt und jede Praxis sieht ausschließlich ihre eigenen Daten. Die Verarbeitung erfolgt DSGVO-konform auf Grundlage der Auftragsverarbeitungsvereinbarung.",
        keywords: ["sicherheit", "datenschutz", "dsgvo", "patientendaten", "verschlüsselung", "schutz"],
      },
      {
        id: "wer-sieht-daten",
        q: "Wer kann die Daten meiner Praxis sehen?",
        a: "Nur die von Ihnen eingeladenen Teammitglieder, jeweils im Rahmen ihrer Rolle, sowie EINS als Auftragsverarbeiter zur Erbringung der vereinbarten Leistungen. Andere Praxen haben keinerlei Zugriff auf Ihre Daten.",
        keywords: ["wer sieht", "zugriff", "andere praxen", "datentrennung", "vertraulich"],
      },
      {
        id: "datenspeicherung",
        q: "Werden meine Daten datenschutzkonform verarbeitet?",
        a: "Ja. Die Verarbeitung richtet sich nach der DSGVO und der mit Ihnen geschlossenen Auftragsverarbeitungsvereinbarung. Diese finden Sie unter Dokumente.",
        keywords: ["speicherung", "wo daten", "server", "dsgvo", "konform", "verarbeitung"],
      },
      {
        id: "avv-noetig",
        q: "Brauche ich eine AVV mit EINS?",
        a: "Ja. Da EINS personenbezogene Daten in Ihrem Auftrag verarbeitet, ist eine Auftragsverarbeitungsvereinbarung erforderlich. Sie ist Teil Ihrer Unterlagen und liegt unter Dokumente bereit.",
        keywords: ["avv nötig", "vereinbarung", "auftragsverarbeitung", "pflicht", "dsgvo"],
      },
      {
        id: "daten-bei-kuendigung",
        q: "Was passiert mit meinen Daten, wenn die Zusammenarbeit endet?",
        a: "Der Umgang mit Ihren Daten nach Ende der Zusammenarbeit ist in der Auftragsverarbeitungsvereinbarung geregelt. Bei konkreten Fragen dazu sprechen Sie uns gerne an.",
        keywords: ["kündigung", "ende", "löschung", "daten zurück", "vertragsende"],
      },
    ],
  },
  {
    id: "pvs",
    label: "Anbindung an Ihre Praxissoftware",
    items: [
      {
        id: "was-ist-bridge",
        q: "Was ist die Anbindung an meine Praxissoftware?",
        a: "Über eine sichere Brücke kann das Portal mit Ihrer Praxisverwaltungssoftware zusammenarbeiten. Dadurch lassen sich zum Beispiel erbrachte Behandlungen automatisch Ihren Anfragen zuordnen und Bewertungs-Anfragen zum richtigen Zeitpunkt auslösen, ohne doppelte Pflege.",
        keywords: ["pvs", "bridge", "brücke", "praxissoftware", "anbindung", "integration"],
      },
      {
        id: "welche-pvs",
        q: "Welche Praxisverwaltungssysteme werden unterstützt?",
        a: "Unterstützt werden gängige Systeme wie CharlyTel, Tomedo und Dampsoft, weitere kommen hinzu. Ob Ihr System dabei ist, klären wir gerne im Gespräch mit Ihnen.",
        keywords: ["pvs", "charly", "tomedo", "dampsoft", "systeme", "kompatibel"],
      },
      {
        id: "schreibzugriff",
        q: "Greift EINS schreibend auf meine Praxissoftware zu?",
        a: "Nein. Der Zugriff erfolgt ausschließlich lesend. Es werden keine Daten in Ihrer Praxissoftware verändert. Es werden nur die Informationen ausgelesen, die für Ihre Auswertung und die Zusammenarbeit nötig sind.",
        keywords: ["schreibend", "lesend", "read only", "verändert", "sicher", "zugriff"],
      },
      {
        id: "hersteller-erlaubt",
        q: "Ist der Zugriff vom Hersteller meiner Praxissoftware erlaubt?",
        a: "Ja, die Anbindung erfolgt auf den dafür vorgesehenen, vom jeweiligen Hersteller unterstützten Wegen. Bei Tomedo zum Beispiel wird der lesende Zugang offiziell durch den Hersteller bereitgestellt.",
        keywords: ["erlaubt", "hersteller", "offiziell", "tomedo", "zollsoft", "legitim"],
      },
      {
        id: "bridge-nutzen",
        q: "Was bringt mir die Anbindung an meine Praxissoftware?",
        a: "Sie sehen genauer, welche Anfragen zu tatsächlichem Umsatz geführt haben, und Bewertungs-Anfragen können automatisch nach der Behandlung verschickt werden. Das spart Aufwand und macht Ihre Zahlen aussagekräftiger.",
        keywords: ["vorteil", "nutzen", "warum", "umsatz zuordnung", "automatisch"],
      },
      {
        id: "agent-auf-rechner",
        q: "Läuft dafür etwas auf meinem Praxis-Rechner?",
        a: "Für die Anbindung läuft ein kleines, sicheres Programm in Ihrer Praxis, das die Verbindung herstellt. Die Einrichtung begleiten wir Schritt für Schritt mit Ihnen.",
        keywords: ["agent", "programm", "installation", "rechner", "vor ort", "software"],
      },
    ],
  },
  {
    id: "hwg",
    label: "HWG und rechtliche Fragen",
    items: [
      {
        id: "was-ist-hwg",
        q: "Was ist das HWG und betrifft es mich?",
        a: "HWG steht für Heilmittelwerbegesetz. Es regelt, wie für medizinische Behandlungen geworben werden darf. Für Praxen für ästhetische Medizin ist es besonders relevant. Bei der Werbung achten wir konsequent auf die Einhaltung.",
        keywords: ["hwg", "heilmittelwerbegesetz", "recht", "werberecht", "compliance"],
      },
      {
        id: "anzeigen-hwg-konform",
        q: "Sind meine Anzeigen HWG-konform?",
        a: "Ja, die von uns erstellten Anzeigen werden so gestaltet, dass sie den Vorgaben des HWG entsprechen. Konformität ist für uns kein Zusatz, sondern Voraussetzung jeder Kampagne.",
        keywords: ["anzeigen", "konform", "erlaubt", "werbung", "rechtssicher"],
      },
      {
        id: "was-am-telefon-sagen",
        q: "Was darf ich am Telefon sagen, und was nicht?",
        a: "Eine kompakte Übersicht mit konkreten Formulierungen, also was Sie sagen sollten und was Sie besser vermeiden, finden Sie im Vertriebsleitfaden unter HWG-Quick-Reference. Die vollständige Fassung steht in der PDF unter Dokumente.",
        keywords: ["telefon", "formulierungen", "erlaubt sagen", "verboten", "leitfaden", "sag so"],
      },
      {
        id: "hwg-verantwortlich",
        q: "Wer ist HWG-Verantwortliche oder HWG-Verantwortlicher in meiner Praxis?",
        a: "Das hinterlegen Sie in den Einstellungen unter Praxis-Angaben. Diese Person ist Ihr interner Ansprechpunkt für werberechtliche Fragen.",
        keywords: ["verantwortlich", "hwg", "ansprechpartner", "praxis-angaben", "zuständig"],
      },
    ],
  },
  {
    id: "garantie-abrechnung",
    label: "Garantie und Abrechnung",
    items: [
      {
        id: "was-ist-garantie",
        q: "Was ist die EINS-Garantie?",
        a: "EINS gibt Ihnen eine Leistungsgarantie für die Zusammenarbeit. Voraussetzung ist Ihre Mitwirkung, zum Beispiel schnelles Reagieren auf Anfragen und die bestandene Leitfaden-Prüfung. Die genauen Bedingungen stehen in Ihrem Vertrag.",
        keywords: ["garantie", "leistungsgarantie", "versprechen", "sicherheit", "bedingungen"],
      },
      {
        id: "garantie-bedingungen",
        q: "Welche Bedingungen muss ich für die Garantie erfüllen?",
        a: "Im Kern geht es um Ihre Mitwirkung: Anfragen zügig bearbeiten, den Leitfaden anwenden und die Prüfung bestehen sowie die nötigen Zugänge bereitstellen. Die verbindlichen Details finden Sie in Ihrem Vertrag unter Dokumente.",
        keywords: ["bedingungen", "voraussetzung", "mitwirkung", "erfüllen", "garantie"],
      },
      {
        id: "garantie-finden",
        q: "Wo finde ich die genauen Garantie-Bedingungen?",
        a: "Die verbindlichen Garantie-Bedingungen sind Teil Ihres Vertrags. Diesen finden Sie unter Dokumente. Bei Fragen dazu sind wir jederzeit für Sie da.",
        keywords: ["garantie finden", "bedingungen", "vertrag", "dokumente", "nachlesen"],
      },
      {
        id: "abrechnung",
        q: "Wie funktioniert die Abrechnung?",
        a: "Die Konditionen Ihrer Zusammenarbeit sind in Ihrem Vertrag festgehalten, den Sie unter Dokumente einsehen können. Bei Fragen zur Abrechnung wenden Sie sich gerne direkt an uns.",
        keywords: ["abrechnung", "kosten", "preis", "rechnung", "konditionen", "zahlung"],
      },
    ],
  },
  {
    id: "support",
    label: "Support und Kontakt",
    items: [
      {
        id: "eins-erreichen",
        q: "Wie erreiche ich EINS?",
        a: "Am schnellsten über den Bereich Feedback in der Seitenleiste: Dort schreiben Sie uns direkt. Ihre persönlichen Ansprechpartner und weitere Kontaktmöglichkeiten finden Sie in der Kontaktkarte unten in der Seitenleiste.",
        keywords: ["kontakt", "erreichen", "support", "ansprechpartner", "telefon", "email"],
      },
      {
        id: "fehler-melden",
        q: "Wie melde ich einen Fehler oder einen Wunsch?",
        a: "Nutzen Sie den Bereich Feedback. Egal ob etwas hakt oder Sie sich eine Funktion wünschen: Schreiben Sie es uns dort. Wir lesen jede Nachricht.",
        keywords: ["fehler", "bug", "wunsch", "feature", "vorschlag", "melden", "feedback"],
      },
      {
        id: "antwortzeit-support",
        q: "Wie schnell bekomme ich eine Antwort?",
        a: "Wir melden uns zeitnah bei Ihnen zurück. Dringende Anliegen kennzeichnen Sie am besten direkt in Ihrer Nachricht, damit wir sie priorisieren können.",
        keywords: ["antwortzeit", "wie schnell", "rückmeldung", "dauer", "support"],
      },
    ],
  },
];

/** Total number of questions, handy for the page header. */
export const FAQ_TOTAL_QUESTIONS = FAQ_CATEGORIES.reduce(
  (sum, cat) => sum + cat.items.length,
  0
);
