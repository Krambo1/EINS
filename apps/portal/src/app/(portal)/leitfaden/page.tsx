import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { Phone, MessageCircle, CheckCircle2, AlertCircle } from "lucide-react";

export const metadata = { title: "Vertriebsleitfaden" };

/**
 * Static playbook content — pulled from the agency's onboarding material.
 * Rendered server-side so translations/updates can just edit this file.
 *
 * Intentionally not schema-backed — this is agency knowledge, the same for
 * every clinic. Clinic-specific variants live in /dokumente under kind=
 * vertriebsleitfaden.
 */

export default async function LeitfadenPage() {
  await requireSession();

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Vertriebsleitfaden.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          So verwandeln Sie eine Anfrage in eine Behandlung. Bewährte Abläufe aus
          hunderten Fällen unserer Praxen.
        </p>
      </header>

      {/* The golden rules */}
      <Card>
        <CardHeader>
          <CardTitle>Die drei goldenen Regeln</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Rule
            icon={<Phone className="h-5 w-5" />}
            title="Innerhalb von 10 Minuten anrufen"
          >
            Nach 10 Minuten fällt die Erreichbarkeit um 50 Prozent. Nach einer
            Stunde noch einmal um die Hälfte. Die Sekretärin ruft sofort an,
            nicht später am Tag.
          </Rule>
          <Rule
            icon={<MessageCircle className="h-5 w-5" />}
            title="Drei Kontaktversuche über zwei Kanäle"
          >
            Wenn niemand ans Telefon geht: zweiter Anruf nach 2 Stunden, dann
            eine persönliche SMS oder WhatsApp mit konkretem Terminvorschlag.
            Nach drei Versuchen: E-Mail mit Terminkalender-Link.
          </Rule>
          <Rule
            icon={<CheckCircle2 className="h-5 w-5" />}
            title="Termin noch im ersten Gespräch vereinbaren"
          >
            Nicht „Ich schicke Ihnen was zu.“ Sondern: „Bei uns ist am Dienstag
            um 14 Uhr oder am Donnerstag um 16 Uhr Platz. Was passt Ihnen
            besser?“
          </Rule>
        </CardContent>
      </Card>

      {/* Call script */}
      <Card>
        <CardHeader>
          <CardTitle>Gesprächsleitfaden für den ersten Anruf</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            <Step
              value="begruessung"
              title="1. Begrüßung (10 Sekunden)"
              content={
                <>
                  <p>
                    „Guten Tag Frau Müller, hier ist Anna von Praxis Dr. Demo.
                    Sie haben sich heute für eine Invisalign-Beratung
                    interessiert, richtig?“
                  </p>
                  <p className="text-sm text-fg-secondary">
                    Warum so? Namen beider Seiten nennen, Anliegen bestätigen,
                    Vertrauen aufbauen.
                  </p>
                </>
              }
            />
            <Step
              value="bedarf"
              title="2. Bedarf verstehen (3–5 Minuten)"
              content={
                <>
                  <p>Fragen, die Sie stellen sollten:</p>
                  <ul className="ml-5 list-disc space-y-1">
                    <li>„Was stört Sie aktuell an Ihren Zähnen?“</li>
                    <li>„Haben Sie schon früher eine Behandlung gemacht?“</li>
                    <li>„Bis wann möchten Sie fertig sein?“</li>
                  </ul>
                  <p className="text-sm text-fg-secondary">
                    Zuhören. Notieren. Nicht direkt Preise nennen.
                  </p>
                </>
              }
            />
            <Step
              value="einwand"
              title="3. Einwände entkräften"
              content={
                <>
                  <p className="font-medium">„Ich muss es mir noch überlegen.“</p>
                  <p>
                    „Das verstehe ich. Was genau beschäftigt Sie? Die Dauer, die
                    Kosten oder etwas anderes?“
                  </p>
                  <p className="mt-3 font-medium">„Ist das nicht sehr teuer?“</p>
                  <p>
                    „Die Behandlung ist eine Investition. Die meisten unserer
                    Patienten zahlen in Raten. Der Termin ist kostenlos und
                    unverbindlich. Möchten wir einen Termin machen?“
                  </p>
                </>
              }
            />
            <Step
              value="termin"
              title="4. Termin fix vereinbaren"
              content={
                <>
                  <p>
                    „Ich kann Ihnen am Dienstag 14 Uhr oder Donnerstag 16 Uhr
                    anbieten. Was passt Ihnen besser?“
                  </p>
                  <p>
                    Nach Bestätigung: direkt im Portal auf „Termin vereinbart“
                    setzen. SMS-Bestätigung 24 Stunden vorher, das senkt die
                    No-Show-Quote um 40 Prozent.
                  </p>
                </>
              }
            />
            <Step
              value="abschied"
              title="5. Verabschiedung"
              content={
                <>
                  <p>
                    „Danke für das Gespräch, Frau Müller. Sie bekommen jetzt
                    gleich eine SMS mit dem Termin. Falls etwas dazwischenkommt,
                    melden Sie sich einfach bei mir unter …“
                  </p>
                </>
              }
            />
          </Accordion>
        </CardContent>
      </Card>

      {/* Don'ts */}
      <Card>
        <CardHeader>
          <CardTitle>Was Sie vermeiden sollten</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Dont title="Keine Preise am Telefon nennen">
            Preise ohne Befund sind nicht aussagekräftig. Statt: „Das kostet
            ca. X.“ lieber: „Das klären wir im Termin, dort können wir genau
            kalkulieren.“
          </Dont>
          <Dont title="Keine medizinischen Versprechen">
            Nach HWG strikt verboten. Keine „Garantie“, kein „wird auf jeden
            Fall klappen“.
          </Dont>
          <Dont title="Nicht direkt E-Mail statt Anruf">
            E-Mails haben eine Antwortquote von 15 Prozent. Anrufe über 60
            Prozent. Nur als Ergänzung.
          </Dont>
        </CardContent>
      </Card>
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
