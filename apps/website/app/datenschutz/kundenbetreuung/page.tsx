import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

/**
 * Datenschutzhinweise zur Kundenbetreuung (Supportdienst eins-support).
 * Linked from the first automatic reply per recipient and channel
 * (SUPPORT_PRIVACY_URL). Static page on eins.ag so it stays reachable even
 * when the portal is not. Keep in sync with eins-support/launch/.
 */

export const metadata = {
  title: "Datenschutz Kundenbetreuung · EINS",
  alternates: { canonical: "/datenschutz/kundenbetreuung" },
};

const STAND = "30.10.2026";

/** Every service that receives support data, with role, place and transfer basis. */
const PROVIDERS: { name: string; task: string; place: string; basis: string }[] = [
  {
    name: "Purelymail (Add Rabbit LLC, USA)",
    task: "E-Mail-Postfach team@eins.ag: Empfang Ihrer E-Mails und Ablage der Korrespondenz",
    place: "Server von Amazon Web Services in den USA",
    basis: "Purelymail ist nicht nach dem EU-U.S. Data Privacy Framework zertifiziert, für diesen Empfänger besteht also kein Angemessenheitsbeschluss, und US-Behörden können unter Umständen auf die Daten zugreifen. Die Übermittlung stützt sich auf Art. 49 Abs. 1 Buchstabe b und c DSGVO: Ihre Nachricht muss in unserem Postfach liegen, damit wir den Vertrag mit Ihnen oder Ihrer Praxis erfüllen und Ihnen antworten können",
  },
  {
    name: "Cloudflare (Cloudflare, Inc., San Francisco, USA)",
    task: "nur wenn Sie an kontakt@eins-wachstum.de oder kontakt@eins-system.de schreiben: Weiterleitung dieser E-Mails an team@eins.ag; Cloudflare speichert die Nachricht nicht",
    place: "Netz des Anbieters; Anbieter in den USA",
    basis: "Auftragsverarbeitungsvertrag; Cloudflare ist nach dem EU-U.S. Data Privacy Framework zertifiziert (Angemessenheitsbeschluss, Art. 45 DSGVO)",
  },
  {
    name: "Resend (Plus Five Five, Inc., San Francisco, USA)",
    task: "Versand unserer E-Mail-Antworten und Zustellstatus; außerdem erhält Resend eine Kopie jeder persönlich geschriebenen E-Mail an team@eins.ag, damit die Software startet, sobald eine Nachricht eintrifft (die Software liest diese Kopie nicht)",
    place: "Versand aus Irland (EU); Konto- und Versanddaten sowie die Kopien eingehender E-Mails in den USA",
    basis: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln (Art. 46 Abs. 2 Buchstabe c DSGVO)",
  },
  {
    name: "OpenAI Ireland Ltd., Dublin, Irland",
    task: "Entwurf einer Antwort durch ein KI-Sprachmodell (siehe Abschnitt 4)",
    place: "Irland und USA (OpenAI, L.L.C.)",
    basis: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln (Art. 46 Abs. 2 Buchstabe c DSGVO)",
  },
  {
    name: "Fly.io, Inc., Chicago, USA",
    task: "Betrieb der Software, die Nachrichten annimmt, prüft und beantwortet",
    place: "Rechenzentrum Frankfurt am Main; Zugriff des Anbieters aus den USA möglich",
    basis: "Auftragsverarbeitungsvertrag; Fly.io ist nach dem EU-US Data Privacy Framework zertifiziert (Angemessenheitsbeschluss, Art. 45 DSGVO)",
  },
  {
    name: "Neon, Teil der Databricks, Inc., San Francisco, USA",
    task: "Datenbank mit Vorgängen, Nachrichten und Antworten",
    place: "Rechenzentrum Frankfurt am Main (AWS eu-central-1); Zugriff des Anbieters aus den USA möglich",
    basis: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln (Art. 46 Abs. 2 Buchstabe c DSGVO)",
  },
  {
    name: "Vercel Inc., San Francisco, USA",
    task: "Kundenportal portal.eins.ag, über das Sie uns ebenfalls schreiben können",
    place: "Funktionen in Frankfurt am Main; Zugriff des Anbieters aus den USA möglich",
    basis: "Auftragsverarbeitungsvertrag mit Standardvertragsklauseln (Art. 46 Abs. 2 Buchstabe c DSGVO)",
  },
];

const RETENTION: [string, string][] = [
  ["Vorgänge mit Ihren Nachrichten, unseren Antworten und dem Bearbeitungsverlauf", "drei Jahre ab Ende des Jahres, in dem der Vorgang abgeschlossen wurde"],
  ["Alle Vorgänge einer Praxis nach Ende der Betreuung", "drei Jahre ab Ende des Jahres, in dem die Betreuung endete"],
  ["Versandaufträge einschließlich KI-Entwurf und Quellenangaben", "30 Tage nach Erstellung"],
  ["Technisches Bearbeitungsprotokoll ohne Bezug zu einem Vorgang", "30 Tage"],
  ["Nachrichten von Adressen, die noch keiner Praxis zugeordnet sind", "30 Tage nach Klärung, spätestens sechs Monate nach Eingang"],
  ["Protokolle des KI-Anbieters zur Missbrauchserkennung", "bis zu 30 Tage beim Anbieter"],
  ["Kopien eingehender E-Mails, die die Software starten (bei Resend)", "30 Tage beim Anbieter"],
];

function Section({ label, heading, children }: { label: string; heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 first:mt-10">
      <div className="font-mono text-sm text-fg-secondary">{label}</div>
      <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight md:text-3xl">{heading}</h2>
      <div className="mt-4 max-w-prose space-y-3 text-base leading-relaxed text-fg-primary md:text-lg">{children}</div>
    </section>
  );
}

const link = "text-accent underline-offset-4 hover:underline";

export default function DatenschutzKundenbetreuung() {
  return (
    <main className="container py-24">
      <Link
        href="/datenschutz"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Datenschutzerklärung
      </Link>

      <h1 className="display-m">Datenschutz in der Kundenbetreuung</h1>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-fg-primary md:text-lg">
        Diese Hinweise gelten, wenn Sie als Ansprechperson einer von EINS betreuten Praxis an team@eins.ag
        schreiben oder uns im Kundenportal eine Nachricht senden, und für unsere Antworten. Stand {STAND}.
      </p>

      <Section label="Art. 13 Abs. 1 Buchstabe a DSGVO" heading="1. Verantwortlicher">
        <p>Karam Issa, Einzelunternehmer, handelnd unter KRMedia (Marke EINS), Rösrather Straße 172, 51107 Köln, Deutschland.</p>
        <p>
          E-Mail: <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>, Telefon:{" "}
          <a href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`} className={link}>{CONTACT_PHONE}</a>
        </p>
      </Section>

      <Section label="Daten" heading="2. Was wir verarbeiten">
        <p>
          Ihre Absenderadresse und Ihren Namen, den Betreff und Text Ihrer Nachricht, frühere Nachrichten desselben
          Vorgangs, die Zeitpunkte von Eingang und Antwort, den Zustellstatus unserer Antwort und die Zuordnung zu Ihrer
          Praxis. Anhänge liest die Software nicht aus; Nachrichten mit Anhängen bearbeitet Karam Issa persönlich.
        </p>
        <p>
          Bitte senden Sie uns keine Patientendaten und keine Passwörter. Erkennt die Software mögliche Gesundheits- oder
          Zugangsdaten, gibt sie die Nachricht nicht an die KI weiter, und Karam Issa bearbeitet sie persönlich.
        </p>
      </Section>

      <Section label="Art. 6 DSGVO" heading="3. Zweck und Rechtsgrundlage">
        <p>
          Wir beantworten Ihre Anliegen im Rahmen des Vertrags mit Ihrer Praxis. Dazu gehört, dass EINS auf Nachrichten
          über die vereinbarten Supportkanäle innerhalb einer Stunde reagiert, auch nachts und am Wochenende (Hauptvertrag,
          Abschnitt 2.10).
        </p>
        <p>
          Sind Sie selbst unser Vertragspartner, ist Art. 6 Abs. 1 Buchstabe b DSGVO die Grundlage. Schreiben Sie für eine
          Praxis, die ein anderer Rechtsträger ist, stützen wir die Verarbeitung auf Art. 6 Abs. 1 Buchstabe f DSGVO. Unser
          berechtigtes Interesse ist die zuverlässige und schnelle Betreuung des Vertrags mit Ihrer Praxis.
        </p>
      </Section>

      <Section label="Art. 13 Abs. 2 Buchstabe f DSGVO" heading="4. Wie die Antwort entsteht">
        <p>
          Eine Software nimmt Ihre Nachricht an und prüft sie. Lässt sich eine Frage aus dem Vertrag Ihrer Praxis oder aus
          freigegebenen EINS-Informationen beantworten, erstellt ein KI-Sprachmodell von OpenAI einen Antwortentwurf. Die
          Software prüft, dass jede Aussage darin wörtlich durch diese Quellen belegt ist. Fehlt ein Beleg, erhalten Sie
          stattdessen eine Eingangsbestätigung, und Karam Issa prüft Ihr Anliegen persönlich.
        </p>
        <p>
          Wünsche nach Änderungen, Erstattungen, Kündigungen und Beschwerden entscheidet nie die KI, sondern Karam Issa. Es
          findet keine automatisierte Entscheidung im Sinne von Art. 22 DSGVO statt. Die Antwort geht etwa drei Minuten nach
          Eingang hinaus.
        </p>
        <p>
          Möchten Sie keine Bearbeitung durch KI, schreiben Sie uns das. Ihre Praxis erhält dann als erste Reaktion eine
          feste Eingangsbestätigung, und Karam Issa antwortet persönlich. Die Reaktionsfrist bleibt bestehen.
        </p>
      </Section>

      <Section label="Art. 13 Abs. 1 Buchstabe e und f DSGVO" heading="5. Empfänger und Übermittlung in Drittländer">
        <p>Diese Dienstleister verarbeiten die Daten in unserem Auftrag:</p>
        <ul className="space-y-4">
          {PROVIDERS.map((p) => (
            <li key={p.name} className="border-l-2 border-fg-secondary/30 pl-4">
              <div className="font-semibold">{p.name}</div>
              <div>{p.task}</div>
              <div className="text-fg-secondary">Ort: {p.place}</div>
              <div className="text-fg-secondary">Grundlage: {p.basis}</div>
            </li>
          ))}
        </ul>
        <p>
          Für Störungsalarme an Karam Issa nutzen wir PagerDuty (PagerDuty, Inc., USA) oder Pushover (Pushover, LLC, USA) sowie Healthchecks.io. Diese Dienste
          erhalten keine Namen, Adressen oder Inhalte Ihrer Nachrichten. Eine Kopie der Standardvertragsklauseln erhalten
          Sie auf Anfrage.
        </p>
      </Section>

      <Section label="Art. 13 Abs. 2 Buchstabe a DSGVO" heading="6. Speicherdauer">
        <ul className="space-y-3">
          {RETENTION.map(([what, how]) => (
            <li key={what}>
              <span className="font-semibold">{what}:</span> {how}.
            </li>
          ))}
        </ul>
        <p>
          Die E-Mail-Korrespondenz im Postfach team@eins.ag bewahren wir nach unserer allgemeinen{" "}
          <Link href="/datenschutz" className={link}>Datenschutzerklärung</Link> auf. Ein täglicher Löschlauf entfernt
          Daten in der Supportdatenbank nach Ablauf dieser Fristen.
        </p>
      </Section>

      <Section label="Art. 15 bis 21 und 77 DSGVO" heading="7. Ihre Rechte">
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und
          Datenübertragbarkeit. Soweit wir uns auf Art. 6 Abs. 1 Buchstabe f DSGVO stützen, können Sie aus Gründen Ihrer
          besonderen Situation widersprechen. Schreiben Sie dazu an{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>.
        </p>
        <p>
          Sie können sich bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel bei der für uns zuständigen
          Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, Kavalleriestraße 2 bis 4, 40213
          Düsseldorf.
        </p>
      </Section>
    </main>
  );
}
