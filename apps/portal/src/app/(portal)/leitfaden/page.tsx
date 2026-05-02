import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Badge,
  Separator,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import {
  Phone,
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  Printer,
  ShieldCheck,
  Clock,
  Users,
  HeartHandshake,
  Scale,
} from "lucide-react";

export const metadata = { title: "Vertriebsleitfaden" };

/**
 * Static playbook for clinic reception/sales staff handling inbound calls
 * from Meta/Google ad leads. HWG-konform, Sie-Form. Sources are listed in
 * the internal Notion plan; staff-facing page keeps citations sparse.
 *
 * Content is intentionally inline (not schema-backed): same for every
 * clinic, edit this file to change. Clinic-specific variants live in
 * /dokumente under kind=vertriebsleitfaden.
 */

export default async function LeitfadenPage() {
  const session = await requireSession();
  const isDetail = session.uiMode === "detail";

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Vertriebsleitfaden.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          {isDetail
            ? "So verwandeln Sie eine Anfrage in einen Beratungstermin, ohne gegen HWG, MBO-Ä oder DSGVO zu verstoßen. Bewährte Abläufe für eingehende Anrufe aus Meta- und Google-Anzeigen."
            : "Die wichtigsten 20 % des Leitfadens, die in 80 % der Anrufe ausreichen. Für die vollständigen Skripte, Discovery-Fragen, Vorlagen und HWG-Tabellen oben rechts auf Detail umschalten."}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{isDetail ? "Sechs goldene Prinzipien" : "Drei goldene Prinzipien"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Rule
            icon={<HeartHandshake className="h-5 w-5" />}
            title="Anerkennen, reframen, Termin anbieten"
          >
            Niemals dagegen argumentieren, nie drängen. Erst die Sorge ernst
            nehmen, dann den Rahmen wechseln, dann konkret einen Termin
            vorschlagen.
          </Rule>
          <Rule
            icon={<Scale className="h-5 w-5" />}
            title="Niemals einen Endpreis am Telefon nennen"
          >
            Nur Spannen, Beratungsgebühr und was im Termin passiert. Begründung
            ist medizinisch (Individualität), nicht verkäuferisch. Den
            verbindlichen Kostenvoranschlag erstellt der Arzt nach der
            Untersuchung.
          </Rule>
          <Rule
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Eine Antwort, ein Termin-Angebot"
          >
            Jede Antwort endet mit zwei konkreten Termin-Vorschlägen
            („Donnerstag oder eher nächste Woche?“), nie mit offener „Wollen
            Sie?“-Frage.
          </Rule>
          {isDetail && (
            <>
              <Rule
                icon={<MessageCircle className="h-5 w-5" />}
                title="Spiegeln statt widerlegen"
              >
                „Ich verstehe, dass …“ statt „Aber …". Patienten kaufen Sicherheit,
                nicht Argumente.
              </Rule>
              <Rule
                icon={<ShieldCheck className="h-5 w-5" />}
                title="Bei medizinischen Fragen: routen, nicht antworten"
              >
                Risiken, Diagnosen, konkrete Methoden gehören in die ärztliche
                Aufklärung. Nicht-ärztliches Personal darf keine medizinische
                Empfehlung geben (§ 7 Abs. 4 MBO-Ä, § 1 HeilprG).
              </Rule>
              <Rule
                icon={<Clock className="h-5 w-5" />}
                title="Stille aushalten"
              >
                Nach dem Termin-Angebot drei Sekunden schweigen. Wer nachschiebt,
                wirkt unsicher und gibt das Frame ab.
              </Rule>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>KPI-Ziele für jeden Anruf</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Reaktionszeit" value="< 5 Min" hint="ab Lead-Eingang" />
          <Kpi label="Abschlussquote" value="> 25 %" hint="aus Beratungsterminen" />
          <Kpi label="No-Show-Rate" value="< 20 %" hint="bei Erstberatung" />
        </CardContent>
      </Card>

      {isDetail && (
      <Card>
        <CardHeader>
          <CardTitle>Vor jedem Anruf in 30 Sekunden</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="ml-5 list-decimal space-y-2 text-base text-fg-primary">
            <li>
              Anrufer-Profil aus dem Vorqualifizierungs-Score öffnen (Hot, Warm,
              Cold).
            </li>
            <li>Behandlungswunsch und Budget-Indikation lesen, falls vorhanden.</li>
            <li>
              Notiz-Block parat halten: Anrede, Name, Geburtsdatum, Mobil,
              E-Mail, PLZ, Behandlungswunsch, bevorzugter Kanal,
              Empfehlungsquelle.
            </li>
            <li>Stimme hochbringen, leise Umgebung, kein Hintergrundgeräusch.</li>
          </ol>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Gesprächs-Eröffnung, wortwörtlich</CardTitle>
        </CardHeader>
        <CardContent>
          {!isDetail && (
            <div className="space-y-2">
              <Quote>
                „[Klinikname], guten Tag, Sie sprechen mit [Vorname Nachname].
                Was kann ich für Sie tun?"
              </Quote>
              <p className="text-sm text-fg-secondary">
                DACH-Standard: Klinik, Person, Bereitschaft, in einem Satz. Bei
                spontaner Preisfrage siehe Einwand „Was kostet das genau?" weiter unten.
              </p>
            </div>
          )}
          {isDetail && (
          <Accordion type="multiple" className="space-y-2">
            <Step
              value="standard"
              title="Standard-Eröffnung"
              content={
                <>
                  <Quote>
                    „[Klinikname], guten Tag, Sie sprechen mit [Vorname
                    Nachname]. Was kann ich für Sie tun?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    DACH-Standard. Klinik, Person, Bereitschaft, in einem Satz.
                  </p>
                </>
              }
            />
            <Step
              value="behandlung"
              title="Patient nennt sofort eine Behandlung"
              content={
                <>
                  <p className="text-sm font-medium">
                    Patient: „Ich habe Ihre Anzeige gesehen, ich interessiere
                    mich für [Behandlung]."
                  </p>
                  <Quote>
                    „Schön, dass Sie sich melden, Frau / Herr [Nachname]. Ich
                    nehme mir gerne fünf Minuten für Sie, damit ich verstehe,
                    worum es Ihnen geht und Ihnen den passenden Termin anbieten
                    kann. Ist das in Ordnung?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Frame übernehmen, Zustimmung holen, Discovery ankündigen.
                  </p>
                </>
              }
            />
            <Step
              value="preis"
              title="Patient fragt sofort den Preis"
              content={
                <>
                  <p className="text-sm font-medium">
                    Patient: „Was kostet das?"
                  </p>
                  <Quote>
                    „Den genauen Preis kann ich Ihnen nicht am Telefon nennen,
                    weil unsere Ärzte ihn erst nach der individuellen Beratung
                    festlegen. Bei [Behandlung] bewegen wir uns typischerweise
                    zwischen [von €] und [bis €], abhängig von Aufwand und
                    Material. Den verbindlichen Kostenvoranschlag erstellt Ihr
                    Arzt nach der Untersuchung. Möchten Sie einen
                    Beratungstermin?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    HWG-konform (kein Lockpreis). § 630c Abs. 3 BGB verlangt
                    schriftlichen Kostenvoranschlag in der Sprechstunde.
                  </p>
                </>
              }
            />
            <Step
              value="unsicher"
              title="Patient klingt unsicher"
              content={
                <>
                  <p className="text-sm font-medium">
                    Patient: „Eigentlich wollte ich mich nur erstmal informieren …"
                  </p>
                  <Quote>
                    „Das ist genau richtig. Bei uns ist das Erstgespräch dazu
                    da, dass Sie ohne Druck Fragen stellen und sich ein eigenes
                    Bild machen. Wir entscheiden nichts in diesem Gespräch, wir
                    klären nur, ob die Behandlung für Sie überhaupt geeignet
                    ist. Ist das ein guter Rahmen für Sie?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Druck rausnehmen, Beratung als unverbindlich rahmen.
                  </p>
                </>
              }
            />
          </Accordion>
          )}
        </CardContent>
      </Card>

      {isDetail && (
      <Card>
        <CardHeader>
          <CardTitle>Discovery: 14 Fragen in vier Blöcken</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-fg-secondary">
            Nicht jede Frage in jedem Anruf. Der Block leitet das Gespräch.
            Prinzip: offene Frage zuerst, geschlossene Folge-Frage zur
            Präzisierung.
          </p>
          <Accordion type="multiple" className="space-y-2">
            <Step
              value="d-a"
              title="A. Behandlungs-Interesse (3 Fragen)"
              content={
                <ul className="ml-5 list-decimal space-y-1">
                  <li>„Welche Behandlung schwebt Ihnen vor?"</li>
                  <li>
                    „Was hat Sie auf das Thema aufmerksam gemacht? Stand das
                    schon länger im Raum oder ist die Idee neu?"
                  </li>
                  <li>
                    „Haben Sie sich vorab schon irgendwo darüber informiert,
                    etwa im Internet oder in einer anderen Klinik?"
                  </li>
                </ul>
              }
            />
            <Step
              value="d-b"
              title="B. Dringlichkeit und Anlass (4 Fragen)"
              content={
                <ol className="ml-5 list-decimal space-y-1" start={4}>
                  <li>
                    „Gibt es einen Anlass, der den Zeitpunkt für Sie wichtig
                    macht? Eine Hochzeit, ein Geburtstag, ein Urlaub?"
                  </li>
                  <li>
                    „Wann würden Sie die Behandlung idealerweise umsetzen? Eher
                    in den nächsten Wochen oder eher in mehreren Monaten?"
                  </li>
                  <li>
                    „Sind Sie zeitlich flexibel für ein Beratungsgespräch in den
                    nächsten zwei Wochen?"
                  </li>
                  <li>
                    „Sind Sie auf eine Erholungsphase angewiesen, die wir
                    berücksichtigen müssen?"
                  </li>
                </ol>
              }
            />
            <Step
              value="d-c"
              title="C. Budget-Indikatoren (3 Fragen, indirekt)"
              content={
                <>
                  <ol className="ml-5 list-decimal space-y-1" start={8}>
                    <li>
                      „Haben Sie bei der Recherche schon eine grobe Vorstellung
                      bekommen, was die Behandlung kosten kann?"
                    </li>
                    <li>
                      „Ist das Thema Investition für Sie schon eingeplant oder
                      klären Sie das parallel?"
                    </li>
                    <li>
                      „Spielt eine Finanzierung über Ratenzahlung eine Rolle für
                      Sie? Wir bieten das in Kooperation mit
                      [Finanzierungspartner] an."
                    </li>
                  </ol>
                  <p className="mt-3 text-sm text-fg-secondary">
                    Niemals direkt fragen „Wie viel können Sie ausgeben?". Das
                    ist im DACH-Raum unhöflich und beschädigt Vertrauen.
                  </p>
                </>
              }
            />
            <Step
              value="d-d"
              title="D. Vertrauenssignale und Eignung (4 Fragen)"
              content={
                <ol className="ml-5 list-decimal space-y-1" start={11}>
                  <li>
                    „Wo wohnen Sie ungefähr? Ist [Klinikstadt] gut für Sie zu
                    erreichen?"
                  </li>
                  <li>
                    „Gab es einen Grund, warum Sie sich gerade für unsere Klinik
                    interessieren? Empfehlung, Anzeige, Recherche?"
                  </li>
                  <li>
                    „Haben Sie aktuell gesundheitliche Themen, die wir vor dem
                    Termin wissen sollten? Medikamente, Allergien,
                    Vor-Operationen?"
                  </li>
                  <li>
                    „Haben Sie Vorbehalte oder etwas, das Sie nervös macht beim
                    Gedanken an die Behandlung? Das klären wir gern offen."
                  </li>
                </ol>
              }
            />
            <Step
              value="d-rote-flaggen"
              title="Rote Flaggen, bei denen kein Termin vereinbart wird"
              content={
                <ul className="ml-5 list-disc space-y-1">
                  <li>Patient ist unter 18 oder fragt für Minderjährige.</li>
                  <li>
                    Unrealistische Erwartungen („Ich möchte aussehen wie
                    [Promi]").
                  </li>
                  <li>
                    Patient wirkt unter Druck einer dritten Person („Mein Mann
                    sagt, ich soll das machen lassen“).
                  </li>
                  <li>
                    Anzeichen einer körperdysmorphen Wahrnehmung (extreme
                    Fokussierung auf minimale „Makel“).
                  </li>
                  <li>
                    Wiederholungs-OP nach mehreren misslungenen Eingriffen
                    anderswo.
                  </li>
                </ul>
              }
            />
          </Accordion>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {isDetail
              ? "Einwandbehandlung: 23 Patienten-Einwände"
              : "Top 5 Einwände, die Sie heute hören werden"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {!isDetail && (
            <>
              <p className="text-sm text-fg-secondary">
                Diese fünf decken den Großteil aller Anrufe ab. Antworten direkt
                vorlesbar, HWG-konform.
              </p>
              <Accordion type="multiple" className="space-y-2">
                <Objection
                  value="easy-a1"
                  title="„Das ist mir zu teuer.“"
                  concern="Wert noch nicht eingeordnet, oder reales Budgetproblem."
                  answer="Das kann ich gut nachvollziehen, jede ästhetische Behandlung ist eine bewusste Entscheidung. Bei uns hängen die Kosten immer von Ihrer individuellen Anatomie und vom medizinischen Vorgehen ab. Deshalb können wir seriös erst nach dem persönlichen Gespräch mit Frau Dr. [Name] eine konkrete Summe nennen. Im Beratungstermin schauen wir genau, was zu Ihnen passt, und Sie entscheiden danach in Ruhe, ohne Verpflichtung. Hätten Sie eher Anfang oder Ende nächster Woche Zeit?"
                  avoid={[
                    "„Schönheit hat ihren Preis.“ (wertend)",
                    "„Aktion …“ (§ 7 HWG)",
                    "„Sparen Sie nicht an Ihrer Gesundheit.“ (Angst-Trigger)",
                  ]}
                />
                <Objection
                  value="easy-a3"
                  title="„Was kostet das genau?“"
                  concern="Reine Preisnennung am Telefon senkt die Conversion und schafft falsche Anker."
                  answer="Das ist die Frage, die uns am häufigsten erreicht, sehr verständlich. Eine seriöse Antwort kann ich Ihnen am Telefon nicht geben, weil die Kosten von Ihrer Anatomie, dem genauen Vorgehen und dem zeitlichen Aufwand abhängen. Was ich Ihnen aber sagen kann: Behandlungen in diesem Bereich bewegen sich bei uns üblicherweise in einer Spanne von [grobe Spanne]. Das persönliche Beratungsgespräch kostet [50 €] und wird bei Behandlung in vielen Fällen angerechnet. Im Termin bekommen Sie einen schriftlichen Kostenvoranschlag, den Sie ohne Verpflichtung mitnehmen. Wann passt es Ihnen?"
                  avoid={[
                    "Konkrete Einzelzahl („3.200 €“)",
                    "„Ab“-Preise (§ 11 HWG)",
                    "Frage abwimmeln („Kann ich Ihnen nicht sagen.“)",
                  ]}
                />
                <Objection
                  value="easy-b1"
                  title="„Was, wenn etwas schiefgeht?“"
                  concern="Kontrollverlust. Sie braucht das Gefühl, dass jemand das schon zigmal gemacht hat."
                  answer="Diese Sorge ist verständlich, und sie gehört zu jedem ehrlichen Beratungsgespräch dazu. Jeder Eingriff ist mit Risiken verbunden, das gehört zur ärztlichen Aufklärung, und Frau Dr. [Name] geht im Termin offen mit Ihnen jedes mögliche Risiko durch und erklärt, wie wir damit umgehen, von der Voruntersuchung bis zur Nachsorge. Was ich Ihnen am Telefon zusichern kann: Sie verlassen die Beratung mit allen Informationen schriftlich und entscheiden in Ruhe zuhause. Ohne Termindruck. Hätten Sie diese Woche oder nächste Woche Zeit?"
                  avoid={[
                    "„Bei uns geht nichts schief.“ (§ 3 HWG Heilversprechen)",
                    "„Das ist ungefährlich.“ (§ 3 HWG, § 11 HWG)",
                    "Konkrete Komplikationsraten zitieren (Arztaufgabe)",
                  ]}
                />
                <Objection
                  value="easy-c1"
                  title="„Ich überlege es mir noch.“"
                  concern="Ambivalenz, oft mit ungenannter Sub-Sorge (Geld, Partner, Schmerz)."
                  answer="Das ist absolut richtig, eine ästhetische Behandlung ist nichts, was man am Telefon entscheidet. Darf ich Sie etwas fragen: Gibt es einen konkreten Punkt, der Sie noch zögern lässt, Ergebnis, Risiken, Kosten, Termin? Dann kann ich gezielt darauf eingehen. Und falls Sie einfach in Ruhe weiter überlegen wollen: Soll ich Ihnen unverbindlich einen Beratungstermin in zwei oder drei Wochen vormerken, den Sie jederzeit kostenfrei verschieben können?"
                  avoid={[
                    "„Aber das ist eine super Investition.“ (Druck)",
                    "„Heute haben wir Aktionspreis.“ (§ 11 HWG)",
                    "Weiteren Schub geben (vertieft Ambivalenz)",
                  ]}
                />
                <Objection
                  value="easy-c2"
                  title="„Ich rede erst mit meinem Mann oder Partner.“"
                  concern="Familien-Entscheidung, Erlaubnis, finanzielle Abstimmung oder Test."
                  answer="Selbstverständlich, das ist eine persönliche Entscheidung, und es ist absolut richtig, das mit Ihrem Partner zu besprechen. Was vielen Patientinnen geholfen hat: erst zur unverbindlichen Beratung zu kommen, sich konkrete Informationen, Kosten und Fragen schriftlich mitzunehmen, und dann zuhause in Ruhe zu zweit zu sprechen, mit Fakten statt Vermutungen. Möchten Sie, dass ich Ihnen einen Termin reserviere? Ihr Partner ist auch herzlich eingeladen mitzukommen, wenn Sie das möchten."
                  avoid={[
                    "„Sie sind doch erwachsen, das ist Ihre Entscheidung.“ (übergriffig)",
                    "„Sie müssen das nicht mit Ihrem Mann besprechen.“ (gefährlich)",
                    "Unterstellungen über die Partnerschaft",
                  ]}
                />
              </Accordion>
            </>
          )}

          {isDetail && (
          <>
          <p className="text-sm text-fg-secondary">
            Pro Eintrag: eigentliche Sorge, HWG-konforme Antwort wortwörtlich,
            was zu vermeiden ist. Sie können die Antworten direkt vorlesen.
          </p>

          <ObjectionGroup label="A. Preis-Einwände">
            <Accordion type="multiple" className="space-y-2">
              <Objection
                value="a1"
                title="A1. „Das ist mir zu teuer."
                concern="Wert noch nicht eingeordnet, oder reales Budgetproblem. Häufigster Vorwand für ungelöste Werteklarheit."
                answer="Das kann ich gut nachvollziehen, jede ästhetische Behandlung ist eine bewusste Entscheidung, und der Preis ist ein Teil davon. Bei uns hängen die Kosten immer von Ihrer individuellen Anatomie und vom medizinischen Vorgehen ab. Deshalb können wir seriös erst nach dem persönlichen Gespräch mit Frau Dr. [Name] eine konkrete Summe nennen. Im Beratungstermin schauen wir genau, was zu Ihnen passt, und Sie entscheiden danach in Ruhe, ohne Verpflichtung. Hätten Sie eher Anfang oder Ende nächster Woche Zeit?"
                avoid={[
                  "„Schönheit hat ihren Preis.“ (wertend)",
                  "„Das ist im Vergleich günstig.“ (Preisvergleich)",
                  "„Aktion …“ (verstößt gegen § 7 HWG)",
                  "„Sparen Sie nicht an Ihrer Gesundheit.“ (Angst-Trigger)",
                ]}
              />
              <Objection
                value="a2"
                title="A2. „Bei Klinik X ist das günstiger."
                concern="Sicherheitsfrage in Preisform."
                answer="Es ist absolut richtig, dass Sie vergleichen, das ist Ihr gutes Recht. Über die Preise von Kolleginnen und Kollegen kann ich seriös nichts sagen, weil dort jeweils andere Methoden, Materialien und Verläufe zugrunde liegen. Was ich Ihnen für unsere Klinik sagen kann: Frau Dr. [Name] ist [Fachärztin für Plastische und Ästhetische Chirurgie], wir nehmen uns für die Beratung 45 Minuten Zeit, und Sie bekommen einen schriftlichen Heil- und Kostenplan, den Sie in Ruhe mitnehmen. Möchten Sie das bei uns einmal persönlich erleben?"
                avoid={[
                  "„Bei denen ist das nicht so sicher.“ (üble Nachrede, abmahnfähig)",
                  "„Wir haben den besten Arzt.“ (§ 3 HWG, § 27 MBO-Ä)",
                  "„Da gibt es bestimmt einen Grund, warum es billiger ist.“ (suggestiv)",
                ]}
              />
              <Objection
                value="a3"
                title="A3. „Was kostet das genau?"
                concern="Triage. Reine Preisnennung am Telefon senkt Conversion und schafft falsche Anker."
                answer="Das ist die Frage, die uns am häufigsten erreicht, sehr verständlich. Eine seriöse Antwort kann ich Ihnen am Telefon nicht geben, weil die Kosten von Ihrer Anatomie, dem genauen Vorgehen und dem zeitlichen Aufwand abhängen. Was ich Ihnen aber sagen kann: Behandlungen in diesem Bereich bewegen sich bei uns üblicherweise in einer Spanne von [grobe Spanne]. Das persönliche Beratungsgespräch kostet [50 €] und wird bei Behandlung in vielen Fällen angerechnet. Im Termin bekommen Sie einen schriftlichen Kostenvoranschlag, den Sie ohne Verpflichtung mitnehmen. Wann passt es Ihnen?"
                avoid={[
                  "Konkrete Einzelzahl („3.200 €“)",
                  "Frage abwimmeln („Kann ich Ihnen nicht sagen.“)",
                  "„Ab“-Preise (§ 11 HWG, irreführende Anlock-Werbung)",
                ]}
              />
              <Objection
                value="a4"
                title="A4. „Warum ist das so teuer?"
                concern="Sie möchte den Preis vor sich selbst rechtfertigen können, will Transparenz, keinen Rabatt."
                answer="Eine sehr gute Frage. In dem Preis stecken im Wesentlichen drei Dinge: erstens die Zeit und Erfahrung der behandelnden Ärztin oder des Arztes, zweitens das Material und die Anästhesie auf medizinischem Standard, und drittens die Nachsorge mit allen Kontrollterminen. Wir rechnen das im Beratungstermin transparent für Sie auf, Sie bekommen den Kostenvoranschlag schriftlich, mit allen Posten einzeln. Soll ich Ihnen einen Termin in dieser oder nächster Woche reservieren?"
                avoid={[
                  "„Qualität hat ihren Preis.“ (Floskel)",
                  "„Wenn Sie sehen, wie schön das wird, denken Sie nicht mehr an den Preis.“ (§ 3 HWG-Risiko)",
                ]}
              />
              <Objection
                value="a5"
                title="A5. „Gibt es Ratenzahlung?"
                concern="Kaufsignal mit Liquiditätsfrage. Sie ist innerlich weiter als sie klingt."
                answer="Ja, das ist eine Frage, die viele Patientinnen stellen. Wir arbeiten mit dem etablierten Anbieter [Finanzierungspartner] zusammen. Die Antragsstrecke ist unkompliziert, Sie machen das eigenständig nach der Beratung, ganz ohne Druck unsererseits. Die genauen Konditionen besprechen wir, sobald wir wissen, um welche Behandlung es konkret geht. Wann darf ich Sie für die Beratung eintragen?"
                avoid={[
                  "Konkrete Monatsraten am Telefon",
                  "„Sie können sich das definitiv leisten.“ (übergriffig)",
                  "Drittanbieter ungenannt lassen (Transparenzpflicht)",
                ]}
              />
            </Accordion>
          </ObjectionGroup>

          <ObjectionGroup label="B. Vertrauens- und Sicherheits-Einwände">
            <Accordion type="multiple" className="space-y-2">
              <Objection
                value="b1"
                title="B1. „Was, wenn etwas schiefgeht?"
                concern="Kontrollverlust. Sie braucht das Gefühl, dass jemand das schon zigmal gemacht hat und es einen Plan B gibt."
                answer="Diese Sorge ist verständlich, und sie gehört zu jedem ehrlichen Beratungsgespräch dazu. Jeder Eingriff ist mit Risiken verbunden, das gehört zur ärztlichen Aufklärung, und Frau Dr. [Name] geht im Termin offen mit Ihnen jedes mögliche Risiko durch und erklärt, wie wir damit umgehen, von der Voruntersuchung bis zur Nachsorge. Was ich Ihnen am Telefon zusichern kann: Sie verlassen die Beratung mit allen Informationen schriftlich und entscheiden in Ruhe zuhause. Ohne Termindruck. Hätten Sie diese Woche oder nächste Woche Zeit?"
                avoid={[
                  "„Bei uns geht nichts schief.“ (§ 3 HWG Heilversprechen)",
                  "„Das ist ungefährlich.“ (§ 3 HWG, § 11 HWG)",
                  "Konkrete Komplikationsraten zitieren (§ 630e BGB Aufklärungspflicht ist Arztaufgabe)",
                ]}
              />
              <Objection
                value="b2"
                title="B2. „Tut das weh?"
                concern="Antizipation von Schmerz, häufig mit konkreter Vor-Erfahrung."
                answer="Schmerz ist sehr individuell, manche Patientinnen empfinden eine Behandlung als kaum spürbar, andere brauchen mehr Lokalanästhesie oder eine Sedierung. Im Beratungstermin bespricht der Arzt mit Ihnen genau, welche Schmerzlinderung in Ihrem Fall sinnvoll ist und was Sie während und nach der Behandlung erwartet. Sind Sie schon einmal beim Zahnarzt lokal betäubt worden? Dann haben Sie eine ungefähre Vorstellung. Mehr darf und kann ich Ihnen seriös am Telefon nicht versprechen. Soll ich Ihnen einen Termin reservieren?"
                avoid={[
                  "„Das tut nicht weh.“ / „Sie spüren nichts.“ (§ 3 HWG Bagatellisierung)",
                  "„Das halten Sie schon aus.“ (entwertend)",
                ]}
              />
              <Objection
                value="b3"
                title="B3. „Ich habe Angst vor OPs oder vor Spritzen."
                concern="Reale Angst, eventuell Trypanophobie. Wer dagegen argumentiert, eskaliert sie."
                answer="Danke, dass Sie das so offen sagen, damit sind Sie überhaupt nicht allein, das hören wir sehr oft. Genau deshalb beginnt bei uns nichts ohne ein ausführliches Gespräch mit dem Arzt. Sie kommen erstmal nur zur Beratung, ohne dass irgendetwas behandelt wird. Wir nehmen uns Zeit, Sie lernen die Räume und das Team kennen, und Sie entscheiden danach völlig frei, ob und wann es weitergeht. Wäre Ihnen ein Vormittag oder lieber ein später Nachmittag angenehmer?"
                avoid={[
                  "„Stellen Sie sich nicht so an.“ (entwertend)",
                  "„Sie werden es lieben.“ (Heilversprechen)",
                  "Sofortige Behandlungstermine anbieten (verschärft die Angst)",
                ]}
              />
              <Objection
                value="b4"
                title="B4. „Wie qualifiziert ist der Arzt oder die Ärztin?"
                concern="Sie hat Horrorgeschichten gelesen und sucht Sicherheit über die Person."
                answer="Sehr berechtigte Frage. Bei uns behandelt Sie ausschließlich [Frau Dr. Müller], Fachärztin für Plastische und Ästhetische Chirurgie, Mitglied der [DGPRÄC / VDÄPC], approbiert seit [Jahr], in dem Eingriff seit über 12 Jahren tätig. Auf unserer Website finden Sie ihren vollständigen Lebenslauf. Im Beratungstermin lernen Sie die Ärztin persönlich kennen, das halten wir für die ehrlichste Form der Antwort auf Ihre Frage. Wann passt es Ihnen, vorbeizukommen?"
                avoid={[
                  "„Der ist der Beste.“ / „Top-Doc 2025.“ (§ 3 HWG Spitzenstellung)",
                  "„Alle sagen, sie ist die Beste.“ (§ 11 Abs. 1 Nr. 11 HWG)",
                  "Vage Aussagen („erfahrenes Team“) ohne nachprüfbare Qualifikation",
                ]}
              />
              <Objection
                value="b5"
                title="B5. „Welche Risiken gibt es?"
                concern="Sie testet, ob Sie ehrlich antworten oder etwas verschweigen. Falsche Beruhigung kostet hier am meisten Vertrauen."
                answer="Vielen Dank, dass Sie das fragen, das ist genau die richtige Frage vor einer ästhetischen Behandlung. Jeder Eingriff hat Risiken, von Rötung und Schwellung bis zu seltenen Komplikationen. Welche Risiken konkret in Ihrem Fall relevant sind, hängt von Ihrer Anatomie, Ihren Medikamenten und der gewählten Methode ab. Deshalb bekommen Sie im Beratungstermin eine vollständige ärztliche Aufklärung, schriftlich, mit Bedenkzeit, bevor Sie irgendetwas unterschreiben. Möchten Sie, dass ich Ihnen einen Termin vorschlage?"
                avoid={[
                  "„Eigentlich keine.“ / „Nichts Nennenswertes.“ (§ 3 HWG Bagatellisierung)",
                  "Alle Risiken am Telefon aufzählen (Fernbehandlungsverbot, § 7 Abs. 4 MBO-Ä)",
                ]}
              />
            </Accordion>
          </ObjectionGroup>

          <ObjectionGroup label="C. Timing-Einwände">
            <Accordion type="multiple" className="space-y-2">
              <Objection
                value="c1"
                title="C1. „Ich überlege es mir noch."
                concern="Ambivalenz, oft mit ungenannter Sub-Sorge (Geld, Partner, Schmerz, Ergebnis)."
                answer="Das ist absolut richtig, eine ästhetische Behandlung ist nichts, was man am Telefon entscheidet. Darf ich Sie etwas fragen: Gibt es einen konkreten Punkt, der Sie noch zögern lässt, Ergebnis, Risiken, Kosten, Termin? Dann kann ich gezielt darauf eingehen. Und falls Sie einfach in Ruhe weiter überlegen wollen: Soll ich Ihnen unverbindlich einen Beratungstermin in zwei oder drei Wochen vormerken, den Sie jederzeit kostenfrei verschieben können?"
                avoid={[
                  "„Aber das ist eine super Investition.“ (Druck)",
                  "„Heute haben wir Aktionspreis.“ (§ 11 HWG)",
                  "Weiteren Schub geben (vertieft die Ambivalenz)",
                ]}
              />
              <Objection
                value="c2"
                title="C2. „Ich rede erst mit meinem Mann oder Partner."
                concern="Familien-Entscheidung, Erlaubnis, finanzielle Abstimmung oder Test."
                answer="Selbstverständlich, das ist eine persönliche Entscheidung, und es ist absolut richtig, das mit Ihrem Partner zu besprechen. Was vielen Patientinnen geholfen hat: erst zur unverbindlichen Beratung zu kommen, sich konkrete Informationen, Kosten und Fragen schriftlich mitzunehmen, und dann zuhause in Ruhe zu zweit zu sprechen, mit Fakten statt Vermutungen. Möchten Sie, dass ich Ihnen einen Termin reserviere? Ihr Partner ist auch herzlich eingeladen mitzukommen, wenn Sie das möchten."
                avoid={[
                  "„Sie sind doch erwachsen, das ist Ihre Entscheidung.“ (übergriffig)",
                  "„Sie müssen das nicht mit Ihrem Mann besprechen.“ (in Konstellationen mit häuslicher Kontrolle gefährlich)",
                  "Unterstellungen über die Partnerschaft",
                ]}
              />
              <Objection
                value="c3"
                title="C3. „Aktuell ist gerade nicht der richtige Zeitpunkt."
                concern="Lebensphase oder sanfter Abschied."
                answer="Das ist mehr als nachvollziehbar. Eine ästhetische Behandlung passt am besten in eine ruhige Phase, ohne anstehende Veränderungen wie Schwangerschaft, Stillzeit oder größere berufliche Belastungen. Wenn Sie möchten, vermerken wir Sie unverbindlich, ich rufe Sie zum Beispiel in drei oder sechs Monaten einmal an, ob es dann für Sie passt. Wenn Sie sich bis dahin schon mal informieren wollen, kann ich Ihnen auch gerne unverbindliche Informationen per E-Mail schicken."
                avoid={[
                  "„Es gibt nie den perfekten Zeitpunkt.“ (abwertend)",
                  "„Aber jetzt ist die beste Zeit.“ (Druck)",
                ]}
              />
              <Objection
                value="c4"
                title="C4. „Ich möchte mir noch andere Kliniken ansehen."
                concern="Sie nimmt die Entscheidung ernst. Druck wirkt kontraproduktiv."
                answer="Das halte ich für absolut sinnvoll und ich würde es Ihnen sogar empfehlen, bei einer ästhetischen Behandlung sollten Sie sich rundum sicher fühlen. Wenn ich Ihnen einen Tipp geben darf für Ihre Vergleichsrunde: Achten Sie auf die Facharzt-Qualifikation der behandelnden Person, auf die Dauer des Beratungsgesprächs und darauf, dass Sie schriftlich aufgeklärt werden. Wir laden Sie gerne unabhängig davon zu einem ersten Beratungstermin ein, damit Sie eine Vergleichsbasis haben. Wann würde Ihnen das passen?"
                avoid={[
                  "„Das brauchen Sie nicht, wir sind die Besten.“ (§ 3 HWG, § 27 MBO-Ä)",
                  "Konkurrenten benennen oder abwerten",
                ]}
              />
              <Objection
                value="c5"
                title="C5. „Ich habe keine Zeit für die Beratung."
                concern="Echtes Zeitproblem oder höfliche Absage."
                answer="Das verstehe ich, das geht vielen so. Wir bieten deshalb auch Termine am späten Nachmittag und Samstagsvormittage an. Wenn ein erstes Kennenlernen telefonisch oder per Video für Sie einfacher wäre, könnte Frau Dr. [Name] Sie auch kurz in einem 15-minütigen Vorgespräch zurückrufen, um Ihre Fragen zu klären, die ausführliche Beratung folgt dann persönlich vor Ort. Was passt Ihnen besser?"
                avoid={[
                  "„Dafür müssen Sie sich Zeit nehmen.“ (belehrend)",
                  "„Das geht ganz schnell.“ (Heilversprechen-nah)",
                ]}
              />
            </Accordion>
          </ObjectionGroup>

          <ObjectionGroup label="D. Ergebnis- und Realismus-Einwände">
            <Accordion type="multiple" className="space-y-2">
              <Objection
                value="d1"
                title="D1. „Sieht man danach, dass ich etwas gemacht habe?"
                concern="Soziale Sorge und Downtime-Frage zugleich."
                answer="Das ist sehr unterschiedlich, je nach Behandlung, Methode und Ihrer individuellen Heilung. Bei manchen Eingriffen sieht man direkt nach der Behandlung leichte Schwellungen oder Rötungen, das kann ein paar Tage bis Wochen anhalten. Wie das Endergebnis bei Ihnen aussehen kann und wann es sich zeigt, erklärt Frau Dr. [Name] im Beratungstermin, mit ehrlichen Zeitangaben, einschließlich der typischen Erholungsphase. Möchten Sie, dass ich Ihnen einen Termin vorschlage?"
                avoid={[
                  "„Sie können sofort wieder arbeiten.“ (§ 3 HWG)",
                  "Vorher-Nachher-Bilder anbieten oder per WhatsApp schicken (§ 11 Abs. 1 Satz 3 HWG, BGH 31.07.2025 inkl. Hyaluron)",
                ]}
              />
              <Objection
                value="d2"
                title="D2. „Wirkt das natürlich?"
                concern="Furcht vor unnatürlich operierter Wirkung und sozialer Beschämung."
                answer="Das ist die Frage, die uns wahrscheinlich am häufigsten gestellt wird, und die uns selbst sehr wichtig ist. Unser Anspruch ist eine Behandlung, die zu Ihnen und Ihren Proportionen passt, nicht eine, die auffällt. Wie weit man gehen kann und was sich für Sie natürlich anfühlt, ist sehr individuell, und das bespricht Frau Dr. [Name] im Beratungsgespräch sehr genau mit Ihnen, inklusive realistischer Vorstellungen, was im Rahmen Ihrer Anatomie möglich ist. Wann darf ich Ihnen einen Termin vorschlagen?"
                avoid={[
                  "„Sie werden 100 % natürlich aussehen.“ (§ 3 HWG)",
                  "„Niemand wird etwas merken.“ (Garantie)",
                  "Vergleich mit Promi-Bildern",
                ]}
              />
              <Objection
                value="d3"
                title="D3. „Werde ich danach so aussehen wie [Influencer / Promi]?"
                concern="Unrealistische Bildreferenz, eventuell Body-Image-Red-Flag."
                answer="Das ist eine gute Frage, und sie verdient eine ehrliche Antwort: Niemand sieht nach einer Behandlung aus wie eine andere Person, jede Patientin hat ihre eigene Knochenstruktur, Hautqualität und Mimik. Was wir tun können, ist gemeinsam mit Ihnen herausarbeiten, welche Aspekte Ihres Erscheinungsbilds Sie verändern möchten und was im Rahmen Ihrer Anatomie sinnvoll ist. Wenn Sie ein Bild zur Beratung mitbringen möchten, gerne, Frau Dr. [Name] schaut sich das mit Ihnen an und erklärt offen, was davon realistisch ist. Möchten Sie einen Termin?"
                avoid={[
                  "„Klar, das machen wir.“ (Heilversprechen plus Body-Image-Trigger)",
                  "Spott über die Referenz",
                  "„Wir machen Sie noch hübscher als …",
                ]}
              />
              <Objection
                value="d4"
                title="D4. „Wie lange hält das?"
                concern="ROI-Frage. „Lohnt sich das für mich?"
                answer="Das ist je nach Behandlung sehr unterschiedlich, und auch innerhalb derselben Behandlung sehr individuell, weil das von Stoffwechsel, Lebensstil und Ihrem Körper abhängt. Übliche Zeiträume liegen zum Beispiel bei Faltenunterspritzungen sechs bis zwölf Monate, je nach Präparat und Region. Was in Ihrem konkreten Fall realistisch ist, kann Ihnen Frau Dr. [Name] im Beratungstermin sagen, inklusive der Frage, wann eine Auffrischung sinnvoll wäre. Soll ich Ihnen einen Termin vorschlagen?"
                avoid={[
                  "Garantierte Zeiträume („Hält genau fünf Jahre“)",
                  "Pauschal-Versprechen („Permanent“) ohne medizinischen Beleg",
                ]}
              />
              <Objection
                value="d5"
                title="D5. „Was, wenn ich enttäuscht bin?"
                concern="Reue-Antizipation. Hier nie mit Garantien arbeiten."
                answer="Das ist eine wichtige und sehr ehrliche Frage. Genau deshalb arbeiten wir bewusst mit einem zweistufigen Vorgehen: Im Beratungstermin gehen wir mit Ihnen detailliert durch, was im Rahmen Ihrer Anatomie realistisch ist und was nicht, mit klarer ärztlicher Sprache, ohne Schönfärberei. Sie unterschreiben nichts an dem Tag. Sie nehmen sich die schriftlichen Unterlagen mit, lassen alles auf sich wirken, und entscheiden frei. Falls Sie nach der Behandlung das Gefühl haben, dass etwas nachjustiert werden sollte, sprechen Sie mit der Ärztin, wir besprechen jeden Fall individuell in der Nachsorge. Möchten Sie zuerst zur Beratung kommen?"
                avoid={[
                  "„Bei uns ist noch keiner enttäuscht weggegangen.“ (§ 3 HWG)",
                  "„Geld-zurück-Garantie.“ (medizinethisch heikel, HWG-Risiko)",
                  "„Wir korrigieren das kostenlos.“ (Pauschal-Versprechen)",
                ]}
              />
            </Accordion>
          </ObjectionGroup>

          <ObjectionGroup label="E. Psychologische und Scham-Einwände">
            <Accordion type="multiple" className="space-y-2">
              <Objection
                value="e1"
                title="E1. „Mein Partner soll davon nichts wissen."
                concern="Diskretion, Scham oder Autonomie in einer kontrollierenden Beziehung."
                answer="Das respektieren wir selbstverständlich, Diskretion gehört zu unserem Berufsverständnis, und Ihre Daten und Ihr Termin bleiben bei uns. Wichtig ist mir nur, dass Sie wissen: Eine ästhetische Behandlung hat eine Erholungsphase, das wird Ihre Ärztin im Beratungstermin sehr genau mit Ihnen besprechen, damit Sie für sich planen können, was offen kommunizierbar ist und was nicht. Möchten Sie einen Beratungstermin?"
                avoid={[
                  "Verschwörerisch werden („Klar, das merkt niemand“)",
                  "Druck zur Offenlegung",
                  "Heilversprechen „nach der OP wird nichts sichtbar sein",
                ]}
              />
              <Objection
                value="e2"
                title="E2. „Was werden die Leute denken?"
                concern="Soziale Beschämung."
                answer="Diese Sorge teilen sehr viele Patientinnen, und das ist menschlich. Was uns aus Erfahrung wichtig ist: Eine gut durchgeführte ästhetische Behandlung ist meist viel unauffälliger, als die meisten Menschen glauben, die Veränderung ist subtil und passt zu Ihrem Gesicht. Aber das Wichtigste vorweg: Es ist Ihr Körper, Ihre Entscheidung, und Sie schulden niemandem eine Erklärung. Im Beratungsgespräch besprechen wir auch, wie viel Veränderung für Sie persönlich richtig ist. Wann hätten Sie Zeit?"
                avoid={[
                  "„Das merkt eh keiner.“ (spielt das Anliegen klein)",
                  "„Was Sie machen, geht niemanden etwas an.“ (übergriffig)",
                ]}
              />
              <Objection
                value="e3"
                title="E3. „Ist das oberflächlich?"
                concern="Wertekonflikt mit Selbstbild."
                answer="Diese Frage stellen sich viele Patientinnen, und allein dass Sie sie stellen, zeigt, dass Sie sich Gedanken machen. Wir sehen das so: Ästhetische Medizin ist dann gut, wenn sie etwas verändert, das Sie selbst stört, nicht, wenn sie einem äußeren Ideal hinterherläuft. Das ist auch der Grund, warum Frau Dr. [Name] sich im Beratungsgespräch Zeit nimmt, mit Ihnen zu klären, was Sie genau möchten und warum. Wenn Sie das Gefühl haben, das ist nichts für Sie, ist das ein völlig legitimes Ergebnis einer Beratung. Möchten Sie unverbindlich einen Termin reservieren?"
                avoid={[
                  "„Nein, überhaupt nicht.“ / „Sie haben es verdient.“ (übergriffig)",
                  "„Alle machen das heute.“ (Social-Proof-Druck)",
                  "Empowerment-Phrasen",
                ]}
              />
            </Accordion>
          </ObjectionGroup>
          </>
          )}
        </CardContent>
      </Card>

      {isDetail && (
      <Card>
        <CardHeader>
          <CardTitle>HWG-Quick-Reference: Sag-So, Sag-So-Nicht</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-fg-secondary">
            Sieben Tabellen mit konkreten Formulierungen. Jede Sag-So-Nicht-Zeile
            ist ein konkretes HWG-, MBO-Ä- oder UWG-Risiko.
          </p>
          <Accordion type="multiple" className="space-y-2">
            <SagSoBlock
              value="ss-1"
              title="1. Heilversprechen, Erfolg"
              rows={[
                ["„Sie werden auf jeden Fall zufrieden sein."
                  ,
                  "„Welches Ergebnis bei Ihnen erreichbar ist, kann nur Frau / Herr Dr. … nach persönlicher Untersuchung beurteilen."
                  ,
                ],
                [
                  "„Garantiert faltenfrei."
                  ,
                  "„Viele Patientinnen berichten über eine deutliche Glättung; das Ergebnis ist individuell."
                  ,
                ],
                [
                  "„100 % schmerzfrei."
                  ,
                  "„Wir arbeiten mit modernen Lokalanästhetika; Schmerzempfinden ist individuell und wird in der Sprechstunde besprochen."
                  ,
                ],
                [
                  "„Das hält ein Leben lang."
                  ,
                  "„Die Wirkdauer hängt von Verfahren und individuellen Faktoren ab; Details bespricht Dr. … im Termin."
                  ,
                ],
              ]}
            />
            <SagSoBlock
              value="ss-2"
              title="2. Diagnose, Eignung am Telefon"
              rows={[
                [
                  "„Bei Ihrer Schilderung ist Hyaluron das Richtige."
                  ,
                  "„Welche Methode geeignet ist, klärt die Ärztin oder der Arzt in der persönlichen Sprechstunde."
                  ,
                ],
                [
                  "„Sie brauchen keine OP, eine Unterspritzung reicht."
                  ,
                  "„Die Auswahl zwischen den Verfahren hängt vom Befund ab und wird ärztlich entschieden."
                  ,
                ],
                [
                  "„Schicken Sie mir ein Foto, dann sage ich Ihnen, was Sie brauchen."
                  ,
                  "„Eine seriöse Beurteilung ist nur im persönlichen Untersuchungskontext möglich."
                  ,
                ],
              ]}
            />
            <SagSoBlock
              value="ss-3"
              title="3. Vergleich, Superlative"
              rows={[
                [
                  "„Wir sind die beste Klinik in [Stadt]."
                  ,
                  "„Wir sind eine [Fachgebiet]-Praxis mit Schwerpunkt …"
                  ,
                ],
                [
                  "„Besser als Klinik X."
                  ,
                  "(kein vergleichender Bezug; eigene Leistungen sachlich darstellen)",
                ],
                [
                  "„Marktführer für Hyaluron in NRW."
                  ,
                  "„Wir führen Hyaluron-Behandlungen regelmäßig durch und haben Erfahrung mit …"
                  ,
                ],
              ]}
            />
            <SagSoBlock
              value="ss-4"
              title="4. Preis, Rabatt, Lockangebot"
              rows={[
                [
                  "„Heute 30 % Rabatt."
                  ,
                  "„Die Abrechnung erfolgt nach GOÄ; ein verbindlicher Kostenvoranschlag wird in der Sprechstunde erstellt."
                  ,
                ],
                [
                  "„Erstberatung kostenlos."
                  ,
                  "„Die Erstberatung in der Sprechstunde kostet [50 €] und wird bei Behandlung verrechnet."
                  ,
                ],
                [
                  "„Pauschalpreis 1.500 € für Botox."
                  ,
                  "„Die Behandlung beginnt typischerweise bei [von €]; der individuelle Betrag richtet sich nach Aufwand und GOÄ-Bemessung."
                  ,
                ],
                [
                  "„Frühlingsaktion: Botox -20 %."
                  ,
                  "(komplett streichen, § 7 HWG)",
                ],
              ]}
            />
            <SagSoBlock
              value="ss-5"
              title="5. Empfehlung, Testimonials"
              rows={[
                [
                  "„Prof. Dr. X von der Uniklinik empfiehlt uns."
                  ,
                  "(weglassen, § 11 Abs. 1 Nr. 2 HWG)",
                ],
                [
                  "„Eine Patientin mit Ihrem Problem war nach 2 Wochen begeistert."
                  ,
                  "„Erfahrungen sind individuell. Frau Dr. … bespricht mit Ihnen, was in Ihrem Fall realistisch ist."
                  ,
                ],
                [
                  "„Promi Y lässt das bei uns machen."
                  ,
                  "(weglassen, § 11 HWG)",
                ],
                [
                  "„Alle sagen, sie ist die Beste."
                  ,
                  "(weglassen, § 11 Abs. 1 Nr. 11 HWG)",
                ],
              ]}
            />
            <SagSoBlock
              value="ss-6"
              title="6. Risiko, Nichtschädlichkeit"
              rows={[
                [
                  "„Komplett risikofrei."
                  ,
                  "„Wie bei jedem medizinischen Eingriff bestehen Risiken; diese werden vor der Behandlung ärztlich aufgeklärt."
                  ,
                ],
                [
                  "„Ohne Nebenwirkungen."
                  ,
                  "„Mögliche Nebenwirkungen werden in der ärztlichen Aufklärung besprochen."
                  ,
                ],
                [
                  "„Bei uns kann nichts passieren."
                  ,
                  "„Wir arbeiten nach den geltenden medizinischen Standards; alle Risiken werden persönlich erläutert."
                  ,
                ],
              ]}
            />
            <SagSoBlock
              value="ss-7"
              title="7. Vorher-Nachher (kritisch)"
              rows={[
                [
                  "„Sie werden so aussehen wie auf den Bildern auf Instagram."
                  ,
                  "„Vergleichsbilder sind kein verlässlicher Maßstab für Ihr Ergebnis. Im Termin schauen wir Ihre Anatomie an."
                  ,
                ],
                [
                  "„Wir schicken Ihnen Vorher-Nachher-Bilder per WhatsApp."
                  ,
                  "Verboten. § 11 Abs. 1 Satz 3 HWG, BGH 31.07.2025 (I ZR 170/24) gilt auch für Hyaluron und Botox. Bußgeld bis 50.000 €.",
                ],
              ]}
            />
          </Accordion>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {isDetail ? "Termin-Close und DSGVO-Datenaufnahme" : "Termin-Close in zwei Sätzen"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            <Step
              value="close"
              title="Either-Or-Close (wortwörtlich)"
              content={
                <Quote>
                  „Ich nehme das so mit, dass Sie sich [Behandlung] anschauen
                  möchten und ein Beratungsgespräch der nächste sinnvolle Schritt
                  ist. Ich habe nächste Woche [Tag], [Datum], um [Uhrzeit] frei,
                  oder am [Tag], [Datum], um [Uhrzeit]. Welcher Termin passt
                  Ihnen besser?"
                </Quote>
              }
            />
            <Step
              value="gebuehr"
              title="Beratungsgebühr proaktiv kommunizieren"
              content={
                <>
                  <Quote>
                    „Unsere ärztliche Beratung dauert bis zu einer Stunde und
                    kostet [50 €]. Diese Gebühr verrechnen wir vollständig auf
                    die Behandlung, falls Sie sich für einen Eingriff
                    entscheiden. Damit stellen wir sicher, dass die Beratung
                    wirklich Zeit hat und nicht zwischen Tür und Angel passiert.
                    Ist das in Ordnung für Sie?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Vorab-Erhebung der Beratungsgebühr (Kreditkarte, Vorkasse,
                    SEPA-Mandat) ist die robusteste Methode, No-Shows in der
                    Erstberatung zu reduzieren („skin in the game“).
                  </p>
                </>
              }
            />
            {isDetail && (
            <>
            <Step
              value="dsgvo"
              title="DSGVO-konformer Datenaufnahme-Satz"
              content={
                <>
                  <Quote>
                    „Bevor wir Ihre Daten aufnehmen, ein kurzer Hinweis: Wir,
                    [Klinikname], speichern Ihre Angaben ausschließlich zur
                    Terminvereinbarung und Beratung. Die ausführlichen
                    Datenschutzhinweise nach Artikel 13 DSGVO finden Sie auf
                    unserer Website unter [URL] und liegen bei Ihrem Besuch in
                    der Praxis aus. Sind Sie damit einverstanden, dass ich Ihre
                    Daten für die Terminvereinbarung notiere?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Aufsichtsbehörden akzeptieren „zeitlichen Zusammenhang", die
                    vollständige Belehrung muss nicht am Telefon erfolgen.
                    Zustimmung im CRM mit Zeitstempel dokumentieren.
                  </p>
                </>
              }
            />
            <Step
              value="datenfelder"
              title="Datenfelder in fester Reihenfolge"
              content={
                <ol className="ml-5 list-decimal space-y-1">
                  <li>Anrede und vollständiger Name</li>
                  <li>Geburtsdatum (Identifikation, Mindestalter)</li>
                  <li>Mobilnummer</li>
                  <li>E-Mail-Adresse</li>
                  <li>Postleitzahl und Ort</li>
                  <li>Behandlungs-Interesse in einem Satz</li>
                  <li>Bevorzugter Kanal (E-Mail, SMS, Anruf, WhatsApp nur mit Opt-In)</li>
                  <li>Empfehlungsquelle (optional)</li>
                </ol>
              }
            />
            <Step
              value="whatsapp"
              title="WhatsApp-Einwilligung optional einholen"
              content={
                <>
                  <Quote>
                    „Wir bieten an, Termin-Erinnerungen auch über WhatsApp zu
                    schicken, das ist für viele Patienten praktischer. Möchten
                    Sie das nutzen, oder bleiben wir bei E-Mail und SMS?"
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Nur über WhatsApp Business API mit zertifiziertem Anbieter
                    (z.B. mateo, Superchat, Chatarmin), Pre-approved-Templates,
                    AVV. Standard-WhatsApp und WhatsApp-Business-App sind in
                    Praxen nicht DSGVO-konform.
                  </p>
                </>
              }
            />
            <Step
              value="reaktivierung"
              title="Reaktivierungs-Einwilligung am Ende"
              content={
                <>
                  <Quote>
                    „Dürfen wir Sie auch zu künftigen Angeboten und
                    Informationsveranstaltungen per E-Mail oder SMS
                    kontaktieren? Sie können diese Einwilligung jederzeit
                    widerrufen."
                  </Quote>
                  <p className="text-sm text-fg-secondary">
                    Wenn ja: dokumentieren mit Zeitstempel, Aufbewahrung 5 Jahre
                    nach § 7a UWG. Pflicht: Opt-Out-Hinweis in jeder
                    Marketing-Nachricht.
                  </p>
                </>
              }
            />
            <Step
              value="abschluss"
              title="Abschluss-Satz"
              content={
                <Quote>
                  „Ihr Termin ist gebucht. Sie bekommen jetzt gleich eine
                  Bestätigung per [Kanal]. 24 Stunden vor dem Termin schicken
                  wir Ihnen eine kurze Erinnerung. Falls Sie noch Fragen haben
                  oder verschieben müssen, melden Sie sich einfach unter
                  [Telefonnummer] oder per E-Mail an [Adresse]. Wir freuen uns
                  auf Sie."
                </Quote>
              }
            />
            </>
            )}
          </Accordion>
        </CardContent>
      </Card>

      {isDetail && (
      <Card>
        <CardHeader>
          <CardTitle>No-Show-Prävention: Cadence und Vorlagen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-fg-secondary">
            Mehrkanal-Cadence reduziert No-Shows in deutschen Praxen messbar
            (Doctolib 30 bis 60 %, Universität Lübeck zitiert von LINK Mobility
            bis 82 %, Frontiers in Digital Health 2025 bei n=98.067 Terminen
            signifikant). Hauptgrund: 64 % vergessen den Termin schlicht.
          </p>

          <CadenceTable />

          <Accordion type="multiple" className="space-y-2">
            <Template
              value="t1"
              title="1. Sofort-Bestätigung E-Mail (mit iCal)"
              text={`Betreff: Ihre Erstberatung bei [Klinik] am [Datum], alle wichtigen Infos

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
[Klinik]
[Tel] | [Web]`}
            />
            <Template
              value="t2"
              title="2. Sofort-Bestätigung SMS (160 Zeichen)"
              text={`Hallo [Vorname], Ihr Beratungstermin bei [Klinik] am [Datum] um [Uhrzeit] ist bestätigt. Adresse: [Straße]. Bei Verhinderung: [Tel]. Wir freuen uns auf Sie.`}
            />
            <Template
              value="t3"
              title="3. Sofort-Bestätigung WhatsApp (nur via Business API)"
              text={`Hallo [Vorname]

Ihr Beratungstermin bei [Klinik] ist bestätigt:

Termin: [Wochentag], [Datum]
Uhrzeit: [Uhrzeit] Uhr
Adresse: [Straße], [PLZ Ort]
Anfahrt: [Maps-Link]

Was Sie mitbringen: Ausweis, ggf. Vorbefunde.

Bei Verhinderung antworten Sie einfach mit ABSAGE oder rufen Sie unter [Tel] an.

Wir freuen uns auf Sie.
[Klinik]`}
            />
            <Template
              value="t4"
              title="4. Erinnerung 24h vorher SMS"
              text={`Erinnerung: Ihr Termin bei [Klinik] morgen [Datum] um [Uhrzeit]. Adresse: [Straße]. Bestätigen mit JA, Absage mit NEIN. Tel: [Tel]`}
            />
            <Template
              value="t5"
              title="5. Erinnerung 24h vorher E-Mail"
              text={`Betreff: Morgen ist es so weit, Ihre Beratung bei [Klinik]

Liebe / Lieber [Vorname],

nur eine kurze Erinnerung: Wir sehen uns morgen, [Wochentag], um [Uhrzeit] Uhr in [Straße, Ort].

Falls Sie noch Fragen vorab haben oder Ihre Anfahrt klären möchten, melden Sie sich gerne unter [Tel].

Sollte Ihnen kurzfristig etwas dazwischenkommen, geben Sie uns bitte bis spätestens heute 18:00 Uhr Bescheid, dann können wir den Slot nachbesetzen.

Bis morgen
[Empfangsteam]
[Klinik]`}
            />
            <Template
              value="t6"
              title="6. Last-Reminder 2h vorher SMS oder WhatsApp"
              text={`Hallo [Vorname], Ihr Termin bei [Klinik] ist heute in 2h um [Uhrzeit]. Adresse: [Straße], [PLZ Ort]. Anfahrt: [maps.app.goo.gl/xxx] Bis gleich.`}
            />
            <Template
              value="t7"
              title="7. No-Show-Anruf-Skript (innerhalb 30 Min)"
              text={`Guten Tag [Anrede] [Nachname], hier spricht [Vorname Nachname] aus der [Klinikname]. Wir hatten Sie um [Uhrzeit] zur Beratung erwartet und konnten Sie noch nicht erreichen. Ist alles in Ordnung? Wenn Sie wollen, können wir gerne einen neuen Termin finden, melden Sie sich einfach bei mir.

Tonfall: besorgt, nicht ärgerlich. Kein Vorwurf.`}
            />
            <Template
              value="t8"
              title="8. No-Show-SMS (falls niemand abhebt)"
              text={`Hallo [Vorname], wir hatten Sie um [Uhrzeit] zur Beratung erwartet und konnten Sie noch nicht erreichen. Ist alles in Ordnung? Bitte melden Sie sich kurz: [Tel]`}
            />
            <Template
              value="t9"
              title="9. No-Show-Nachfass nach 24h, E-Mail"
              text={`Betreff: Ihr Termin gestern, wir holen das gerne nach

Liebe / Lieber [Vorname],

Sie konnten gestern Ihren Beratungstermin nicht wahrnehmen, kein Problem, das passiert.

Wir möchten Sie nicht aus den Augen verlieren. Falls Ihr Anliegen weiterhin besteht, finden wir gemeinsam einen neuen Termin, der besser in Ihren Alltag passt.

Direkt einen neuen Slot wählen: [Booking-Link]
Oder antworten Sie einfach auf diese E-Mail.

Wenn Sie sich anders entschieden haben, ist das ebenfalls völlig in Ordnung. Eine kurze Rückmeldung würde uns helfen, den Slot freizugeben.

Herzliche Grüße
[Name], [Klinik]
[Tel]`}
            />
            <Template
              value="t10"
              title="10. Reaktivierung nach 7 Tagen, E-Mail"
              text={`Betreff: Wir denken an Sie, möchten Sie Ihren Beratungstermin neu vereinbaren?

Liebe / Lieber [Vorname],

vor einer Woche hatten wir Ihre Beratung zum Thema [Behandlung] reserviert. Wir gehen davon aus, dass etwas dazwischengekommen ist und möchten Ihnen einen neuen Termin anbieten.

Diese Woche haben wir noch zwei Slots frei:
  - [Wochentag, Datum] um [Uhrzeit] Uhr
  - [Wochentag, Datum] um [Uhrzeit] Uhr

Antworten Sie einfach mit Ihrer Wunschzeit oder buchen Sie online: [Link]

Für Rückfragen sind wir Mo bis Fr von [Zeit] erreichbar: [Tel].

Herzliche Grüße
[Name], [Klinik]`}
            />
            <Template
              value="t11"
              title="11. Reaktivierung nach 14 Tagen, SMS-Light"
              text={`Hallo [Vorname], wir hätten weiterhin gerne Ihre Fragen zu [Behandlung] beantwortet. Wenn Sie möchten, melden Sie sich: [Tel] oder [Booking-Link]. [Klinik]`}
            />
            <Template
              value="t12"
              title="12. Cancellation-Bestätigung SMS"
              text={`Vielen Dank für Ihre Nachricht. Ihr Termin am [Datum] ist storniert. Möchten Sie direkt einen neuen Termin? [Booking-Link] oder rufen Sie uns an: [Tel]`}
            />
            <Template
              value="t13"
              title="13. Cancellation-Bestätigung E-Mail mit Re-Booking"
              text={`Betreff: Termin abgesagt, kein Problem, wir bleiben in Kontakt

Liebe / Lieber [Vorname],

Ihr Termin am [Datum] um [Uhrzeit] ist storniert, danke, dass Sie uns rechtzeitig Bescheid gegeben haben.

Möchten Sie direkt einen Ersatztermin vereinbaren? Wir haben in den nächsten 14 Tagen folgende Slots:
  - [Wochentag, Datum] - [Uhrzeit]
  - [Wochentag, Datum] - [Uhrzeit]
  - [Wochentag, Datum] - [Uhrzeit]

Oder Sie wählen selbst: [Booking-Link]

Falls sich Ihre Pläne geändert haben, ist das vollkommen in Ordnung. Wir sind da, sobald Sie soweit sind.

Herzliche Grüße
[Name], [Klinik]`}
            />
          </Accordion>

          <Dont title="Reaktivierungs-Nachrichten brauchen Einwilligung">
            Reaktivierungs-SMS und Marketing-E-Mails gelten als Werbung im Sinne
            von § 7 UWG. Sie setzen dokumentierte Einwilligung des Patienten
            voraus, die zum Zeitpunkt der Buchung eingeholt sein muss.
            Aufbewahrung 5 Jahre nach § 7a UWG. Pflicht: Opt-Out-Hinweis in
            jeder Nachricht („Antworten Sie mit STOP" oder Abmelde-Link).
          </Dont>

          <Dont title="Stornogebühren proportional gestalten">
            Pauschale Stornogebühren bei ästhetischen Eingriffen sind nach AG
            München (Az. 213 C 27099/15) unwirksam. Stornogebühr darf den
            Behandlungspreis nicht überschreiten, Schadensminderungspflicht der
            Klinik beachten, kein 100 % am OP-Tag. AGB vor Auslieferung
            anwaltlich prüfen lassen.
          </Dont>
        </CardContent>
      </Card>
      )}

      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Cheat-Sheet zum Ausdrucken
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto whitespace-pre rounded-xl border border-border bg-bg-secondary/40 p-4 font-mono text-xs leading-relaxed text-fg-primary">{`VERTRIEBSLEITFADEN, KURZFASSUNG FÜR DEN EMPFANGSTRESEN
─────────────────────────────────────────────────────────

1. ERÖFFNUNG
   "[Klinikname], guten Tag, Sie sprechen mit [Name],
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
   - "Wir sind die beste Klinik in [Stadt]"
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
Patient ernst nehmen, nicht weg-skripten.`}</pre>
          <p className="mt-3 text-xs text-fg-secondary print:hidden">
            Drucken über das Browser-Menü (Strg+P / Cmd+P), Schriftgröße 11,
            laminiert am Empfangstresen platzieren.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Was Sie unbedingt vermeiden</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Dont title="Keinen Endpreis am Telefon nennen">
            Lockpreise und Festpreise verstoßen gegen § 7 HWG und § 5 Abs. 2
            GOÄ. Stattdessen Spanne, Beratungsgebühr, Verweis auf Kostenvoranschlag
            in der Sprechstunde (§ 630c Abs. 3 BGB).
          </Dont>
          <Dont title="Keine Heilversprechen, Erfolgsgarantien, Bagatellisierung">
            „Garantiert", „100 %", „schmerzfrei", „risikofrei" sind § 3 HWG
            verboten. Auch bei direkter Patientenfrage nicht „nett" gemeint
            verwenden.
          </Dont>
          <Dont title="Keine Vorher-Nachher-Aussagen, auch nicht verbal">
            § 11 Abs. 1 Satz 3 HWG. Erweitert durch BGH 31.07.2025 (I ZR 170/24)
            auch auf Hyaluron, Botox und andere Unterspritzungen. Bußgeld bis
            50.000 €.
          </Dont>
          <Dont title="Keine vergleichende Werbung über Mitbewerber">
            § 27 Abs. 3 MBO-Ä, § 6 UWG. „Bei denen ist das nicht so sicher" ist
            üble Nachrede plus Berufsrecht-Verstoß. Eigene Leistungen sachlich
            darstellen.
          </Dont>
          <Dont title="Keine Diagnose, keine Behandlungsempfehlung am Telefon">
            § 7 Abs. 4 MBO-Ä Fernbehandlungsverbot, § 1 HeilprG. Nicht-ärztliches
            Personal darf keine Eignung beurteilen. Routen statt antworten.
          </Dont>
          {isDetail && (
            <>
              <Dont title="Keine Patiententestimonials oder Promi-Empfehlungen">
                § 11 Abs. 1 Nr. 2 und Nr. 11 HWG. „Alle sagen, sie ist die Beste"
                oder „Promi Y kommt zu uns" sind verboten.
              </Dont>
              <Dont title="Standard-WhatsApp ist tabu">
                Adressbuch-Synchronisation und Metadaten-Verstoß gegen § 203 StGB.
                Nur WhatsApp Business API mit zertifiziertem Anbieter, Opt-In und
                AVV. Quelle: BfDI 2024.
              </Dont>
              <Dont title="Reaktivierungs-Mails nur mit Einwilligung">
                § 7 / § 7a UWG. Werbliche Nachrichten ohne dokumentiertes Opt-In
                sind abmahnfähig. Aufbewahrung 5 Jahre.
              </Dont>
            </>
          )}
        </CardContent>
      </Card>

      {isDetail && (
      <Card>
        <CardHeader>
          <CardTitle>Rechtsgrundlagen, kompakt</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">§ 3 HWG (Heilversprechen)</Badge>
            <Badge tone="neutral">§ 7 HWG (Lockangebote)</Badge>
            <Badge tone="neutral">§ 11 HWG (Vorher-Nachher)</Badge>
            <Badge tone="neutral">§ 27 MBO-Ä (Werbung)</Badge>
            <Badge tone="neutral">§ 7 Abs. 4 MBO-Ä (Fernbehandlung)</Badge>
            <Badge tone="neutral">§ 1 HeilprG</Badge>
            <Badge tone="neutral">§ 630c BGB (Kostenvoranschlag)</Badge>
            <Badge tone="neutral">§ 630e BGB (Aufklärung)</Badge>
            <Badge tone="neutral">§ 6 UWG (vergleichend)</Badge>
            <Badge tone="neutral">§ 7 / § 7a UWG (Werbeanruf)</Badge>
            <Badge tone="neutral">Art. 13 DSGVO</Badge>
            <Badge tone="neutral">BGH I ZR 170/24 (31.07.2025)</Badge>
            <Badge tone="neutral">AG München 213 C 27099/15 (Stornogebühr)</Badge>
          </div>
          <Separator className="my-4" />
          <p className="text-sm text-fg-secondary">
            Vor produktivem Einsatz dieses Leitfadens: anwaltliche Prüfung der
            Skripte und AGB-Passagen (Beratungsgebühr, Stornoregeln, AVV mit
            BSP). Landesärztekammer-Berufsordnungen variieren leicht von der
            MBO-Ä-Modellnorm.
          </p>
        </CardContent>
      </Card>
      )}
    </div>
  );
}

function Rule({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        {icon}
      </div>
      <div>
        <div className="font-semibold text-fg-primary">{title}</div>
        <p className="mt-1 text-base text-fg-primary">{children}</p>
      </div>
    </div>
  );
}

function Step({
  value,
  title,
  content,
}: {
  value: string;
  title: string;
  content: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="space-y-2 pb-4 text-base text-fg-primary">
        {content}
      </AccordionContent>
    </AccordionItem>
  );
}

function Dont({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-4">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-tone-bad" />
      <div>
        <div className="font-semibold text-fg-primary">{title}</div>
        <p className="mt-1 text-base text-fg-primary">{children}</p>
      </div>
    </div>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="rounded-xl border-l-4 border-accent bg-bg-secondary/40 px-4 py-3 italic text-fg-primary">
      {children}
    </blockquote>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="text-xs uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-secondary">{hint}</div>}
    </div>
  );
}

function ObjectionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-accent" />
        <h3 className="text-base font-semibold text-fg-primary">{label}</h3>
      </div>
      {children}
    </div>
  );
}

function Objection({
  value,
  title,
  concern,
  answer,
  avoid,
}: {
  value: string;
  title: string;
  concern: string;
  answer: string;
  avoid: string[];
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4 text-base text-fg-primary">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            Eigentliche Sorge
          </div>
          <p className="mt-1 text-sm text-fg-primary">{concern}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            HWG-konforme Antwort, Sie-Form
          </div>
          <Quote>„{answer}"</Quote>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            Was vermeiden
          </div>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-sm">
            {avoid.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function SagSoBlock({
  value,
  title,
  rows,
}: {
  value: string;
  title: string;
  rows: [string, string][];
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-1/2 py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-tone-bad">
                  Sag-So-Nicht
                </th>
                <th className="w-1/2 py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-accent">
                  Sag-So
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([bad, good], i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-3 align-top text-fg-primary">{bad}</td>
                  <td className="py-3 pl-3 align-top text-fg-primary">{good}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function CadenceTable() {
  const rows: { time: string; channel: string; purpose: string }[] = [
    { time: "T+0 sofort", channel: "E-Mail mit iCal + SMS", purpose: "Bestätigung mit Adresse, Anfahrt, Vorbereitung" },
    { time: "T-7 Tage (optional)", channel: "E-Mail", purpose: "Vorab-Intake, Erwartungsmanagement" },
    { time: "T-24h", channel: "SMS primär + E-Mail", purpose: "Hauptreminder mit JA / NEIN-Bestätigung" },
    { time: "T-2h", channel: "SMS oder WhatsApp", purpose: "Last-Minute-Reminder mit Adresse + Map" },
    { time: "T+30 Min No-Show", channel: "Anruf + SMS", purpose: "Wo bleiben Sie? sanft, lösungsorientiert" },
    { time: "T+24h", channel: "E-Mail", purpose: "Empathische Nachfass-Mail mit Re-Booking-Link" },
    { time: "T+7 Tage", channel: "E-Mail oder Anruf", purpose: "Reaktivierung 1: Slot-Angebot" },
    { time: "T+14 Tage", channel: "SMS oder E-Mail", purpose: "Reaktivierung 2: neue Erstberatung" },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/40">
          <tr className="border-b border-border">
            <th className="w-1/4 py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Zeitpunkt
            </th>
            <th className="w-1/4 py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Kanal
            </th>
            <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Zweck
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="py-3 px-3 align-top font-medium text-fg-primary">
                {r.time}
              </td>
              <td className="py-3 px-3 align-top text-fg-primary">{r.channel}</td>
              <td className="py-3 px-3 align-top text-fg-primary">{r.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Template({
  value,
  title,
  text,
}: {
  value: string;
  title: string;
  text: string;
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-bg-secondary/40 p-4 font-mono text-xs leading-relaxed text-fg-primary">
{text}
        </pre>
      </AccordionContent>
    </AccordionItem>
  );
}
