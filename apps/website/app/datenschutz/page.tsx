import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

export const metadata = { title: "Datenschutz · EINS Visuals" };

function Section({
  label,
  heading,
  children,
}: {
  label: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-10">
      <div className="font-mono text-sm text-fg-secondary">{label}</div>
      <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight md:text-3xl">
        {heading}
      </h2>
      <div className="mt-4 max-w-prose space-y-3 text-base leading-relaxed text-fg-primary md:text-lg">
        {children}
      </div>
    </section>
  );
}

export default function Datenschutz() {
  return (
    <main className="container py-24">
      <Link
        href="/"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Zurück
      </Link>

      <h1 className="display-m">Datenschutz­erklärung</h1>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-fg-primary md:text-lg">
        Der Schutz Ihrer personenbezogenen Daten ist uns wichtig. Diese Erklärung
        informiert Sie darüber, welche Daten wir erheben, wenn Sie unsere Website
        besuchen oder Kontakt mit uns aufnehmen, auf welcher Rechtsgrundlage das
        geschieht und welche Rechte Sie haben.
      </p>

      <Section label="Art. 4 Nr. 7 DSGVO" heading="Verantwortlicher">
        <p>Karam Issa</p>
        <p>Rösrather Straße 172, 51107 Köln, Deutschland</p>
        <p>
          E-Mail:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline-offset-4 hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
        <p>
          Telefon:{" "}
          <a href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`} className="text-accent underline-offset-4 hover:underline">
            {CONTACT_PHONE}
          </a>
        </p>
      </Section>

      <Section label="Hosting" heading="Bereitstellung der Website">
        <p>
          Diese Website wird bei der Vercel Inc., 340 S Lemon Ave #4133, Walnut,
          CA 91789, USA gehostet (Auftragsverarbeiter nach Art. 28 DSGVO). Beim
          Aufruf der Seiten werden durch Vercel automatisch Zugriffsdaten in
          Server-Logfiles verarbeitet: IP-Adresse in gekürzter Form, Datum und
          Uhrzeit des Zugriffs, User-Agent (Browser, Betriebssystem), Referrer-URL
          und die aufgerufene Ressource.
        </p>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Das berechtigte Interesse
          liegt in der technisch fehlerfreien Darstellung und der Sicherheit der
          Website. Die Übermittlung in die USA erfolgt auf Basis der Zertifizierung
          von Vercel unter dem EU-U.S. Data Privacy Framework (DPF).
        </p>
        <p>
          Weitere Informationen:{" "}
          <a
            href="https://vercel.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            vercel.com/legal/privacy-policy
          </a>
          .
        </p>
      </Section>

      <Section label="Reichweitenmessung" heading="Vercel Web Analytics & Speed Insights">
        <p>
          Zur Auswertung der Seitenaufrufe und zur Überwachung der Ladezeiten nutzen
          wir die datenschutzfreundlichen Dienste Vercel Web Analytics und Vercel
          Speed Insights. Diese Dienste arbeiten ohne Cookies und ohne
          Nutzer-Tracking über Sitzungen hinweg. Verarbeitet werden anonymisierte
          Zugriffsinformationen wie aufgerufene Seite, Verweisquelle, Gerätekategorie,
          Browser und ein täglich rotierender Hash aus IP-Adresse und User-Agent,
          der keine Identifizierung einzelner Personen erlaubt.
        </p>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes
          Interesse besteht darin, die Nutzung unserer Website statistisch auszuwerten
          und ihre Performance zu verbessern. Anbieter ist die Vercel Inc. (USA),
          zertifiziert unter dem EU-U.S. Data Privacy Framework.
        </p>
      </Section>

      <Section label="Art. 6 Abs. 1 lit. b, f DSGVO" heading="Kontaktaufnahme">
        <p>
          Wenn Sie uns per E-Mail oder Telefon kontaktieren, werden die von Ihnen
          mitgeteilten Daten (Name, Kontaktdaten, Inhalt der Anfrage) zur Bearbeitung
          Ihrer Anfrage verarbeitet. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO,
          soweit Ihre Anfrage der Vorbereitung oder Durchführung eines Vertrages
          dient, andernfalls Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse an
          der Beantwortung von Anfragen).
        </p>
        <p>
          Für die Verarbeitung eingehender E-Mails nutzen wir Gmail der Google
          Ireland Limited (Gordon House, Barrow Street, Dublin 4, Irland). Google
          ist unter dem EU-U.S. Data Privacy Framework zertifiziert. Ihre Daten
          werden gelöscht, sobald der Zweck der Verarbeitung entfallen ist und
          keine gesetzlichen Aufbewahrungspflichten entgegenstehen.
        </p>
      </Section>

      <Section label="Terminbuchung" heading="Externer Link zu Calendly">
        <p>
          Auf unserer Website verlinken wir auf den Dienst Calendly der Calendly,
          LLC (271 17th St NW, Suite 1000, Atlanta, GA 30363, USA), über den Sie
          ein Strategie-Gespräch buchen können. Wenn Sie auf den Calendly-Button
          klicken, werden Sie auf die Website von Calendly weitergeleitet. Erst ab
          diesem Zeitpunkt werden Ihre Daten durch Calendly verarbeitet. Auf der
          Website einsvisuals.com selbst findet keine Datenübermittlung an
          Calendly statt.
        </p>
        <p>
          Rechtsgrundlage für die Weiterleitung ist Art. 6 Abs. 1 lit. f DSGVO.
          Näheres entnehmen Sie der Datenschutzerklärung von Calendly:{" "}
          <a
            href="https://calendly.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            calendly.com/privacy
          </a>
          .
        </p>
      </Section>

      <Section label="Art. 15-21 DSGVO" heading="Ihre Rechte">
        <p>Ihnen stehen folgende Rechte gegenüber uns zu:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Recht auf Auskunft über die verarbeiteten Daten (Art. 15 DSGVO)</li>
          <li>Recht auf Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
          <li>Recht auf Löschung (Art. 17 DSGVO)</li>
          <li>Recht auf Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Recht auf Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>Widerspruchsrecht gegen die Verarbeitung (Art. 21 DSGVO)</li>
          <li>
            Beschwerderecht bei einer Aufsichtsbehörde, in der Regel bei der
            Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen
          </li>
        </ul>
        <p>
          Zur Ausübung Ihrer Rechte genügt eine formlose Nachricht an{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline-offset-4 hover:underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <Section label="Art. 21 DSGVO" heading="Widerspruch gegen Datenverarbeitung auf Grundlage berechtigter Interessen">
        <p>
          Soweit die Verarbeitung Ihrer Daten auf Art. 6 Abs. 1 lit. f DSGVO
          gestützt wird, haben Sie das Recht, aus Gründen, die sich aus Ihrer
          besonderen Situation ergeben, jederzeit Widerspruch einzulegen. Wir
          verarbeiten Ihre Daten dann nicht mehr, es sei denn, wir können zwingende
          schutzwürdige Gründe nachweisen oder die Verarbeitung dient der
          Geltendmachung oder Verteidigung von Rechtsansprüchen.
        </p>
      </Section>

      <Section label="Speicherdauer" heading="Löschung und Aufbewahrung">
        <p>
          Wir speichern personenbezogene Daten nur so lange, wie es für die Erfüllung
          des jeweiligen Zwecks erforderlich ist oder soweit gesetzliche
          Aufbewahrungspflichten (insbesondere aus Handels- und Steuerrecht,
          typischerweise 6 bis 10 Jahre) bestehen. Server-Logfiles werden in der
          Regel nach 14 Tagen automatisch gelöscht.
        </p>
      </Section>

      <Section label="Aktualität" heading="Änderungen dieser Erklärung">
        <p>
          Wir passen diese Datenschutzerklärung an, sobald sich die rechtlichen
          Rahmenbedingungen oder die auf unserer Website eingesetzten Dienste
          ändern. Die jeweils aktuelle Fassung finden Sie auf dieser Seite.
        </p>
        <p className="font-mono text-sm text-fg-secondary">Stand: April 2026</p>
      </Section>

      {/*
        Pre-drafted sections for when retargeting/ads are enabled.
        Move these out of the comment and into the page body at that point.

        <Section label="Art. 6 Abs. 1 lit. a DSGVO" heading="Meta-Pixel (Facebook / Instagram)">
          <p>
            Auf dieser Website setzen wir bei entsprechender Einwilligung den Meta-Pixel
            der Meta Platforms Ireland Limited (4 Grand Canal Square, Dublin 2, Irland)
            ein. Der Pixel erlaubt es uns, das Verhalten von Nutzern nachzuvollziehen,
            nachdem sie durch Klick auf eine Meta-Werbeanzeige auf unsere Website
            weitergeleitet wurden. So können wir die Wirksamkeit unserer Anzeigen
            auswerten und Nutzern zielgerichtete Werbung anzeigen.
          </p>
          <p>
            Rechtsgrundlage ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO.
            Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft
            widerrufen, indem Sie die Cookie-Einstellungen auf dieser Website
            anpassen. Näheres: https://www.facebook.com/privacy/policy
          </p>
        </Section>

        <Section label="Art. 6 Abs. 1 lit. a DSGVO" heading="Google Ads (Conversion-Tracking und Remarketing)">
          <p>
            Auf dieser Website nutzen wir bei entsprechender Einwilligung Google Ads
            der Google Ireland Limited (Gordon House, Barrow Street, Dublin 4, Irland).
            Google Ads setzt Cookies und vergleichbare Technologien ein, um die
            Wirksamkeit unserer Anzeigen zu messen (Conversion-Tracking) und Nutzern
            erneut zielgerichtete Werbung anzuzeigen (Remarketing).
          </p>
          <p>
            Rechtsgrundlage ist Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO.
            Sie können Ihre Einwilligung jederzeit mit Wirkung für die Zukunft
            widerrufen. Näheres: https://policies.google.com/privacy
          </p>
        </Section>
      */}
    </main>
  );
}
