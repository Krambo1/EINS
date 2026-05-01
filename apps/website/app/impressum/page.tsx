import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

export const metadata = { title: "Impressum · EINS Visuals" };

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
      <div className="mt-4 max-w-prose space-y-2 text-base leading-relaxed text-fg-primary md:text-lg">
        {children}
      </div>
    </section>
  );
}

export default function Impressum() {
  return (
    <main className="container py-24">
      <Link
        href="/"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Zurück
      </Link>

      <h1 className="display-m">Impressum</h1>

      <Section label="§ 5 TMG" heading="Angaben zum Anbieter">
        <p>Karam Issa</p>
        <p>Rösrather Straße 172</p>
        <p>51107 Köln</p>
        <p>Deutschland</p>
      </Section>

      <Section label="Kontakt" heading="So erreichen Sie uns">
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

      <Section label="Umsatzsteuer" heading="Steuerliche Angaben">
        <p>Umsatzsteuer-Identifikationsnummer gemäß § 27 a Umsatzsteuergesetz: DE457197636</p>
        <p>
          Hinweis nach § 19 UStG: Als Kleinunternehmer wird keine Umsatzsteuer
          berechnet und in Rechnungen nicht ausgewiesen.
        </p>
      </Section>

      <Section label="§ 18 Abs. 2 MStV" heading="Verantwortlich für den Inhalt">
        <p>Karam Issa</p>
        <p>Rösrather Straße 172, 51107 Köln</p>
      </Section>

      <Section label="EU-Streitschlichtung" heading="Online-Streitbeilegung">
        <p>
          Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung
          (OS) bereit:{" "}
          <a
            href="https://ec.europa.eu/consumers/odr"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline-offset-4 hover:underline"
          >
            https://ec.europa.eu/consumers/odr
          </a>
          .
        </p>
        <p>
          Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren
          vor einer Verbraucherschlichtungsstelle teilzunehmen.
        </p>
      </Section>

      <Section label="Haftung" heading="Haftung für Inhalte">
        <p>
          Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf
          diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis
          10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte
          oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu
          forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
        </p>
        <p>
          Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen
          nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine
          diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer
          konkreten Rechtsverletzung möglich. Bei Bekanntwerden entsprechender
          Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.
        </p>
      </Section>

      <Section label="Haftung" heading="Haftung für Links">
        <p>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte
          wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte
          auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist
          stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
        </p>
        <p>
          Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche
          Rechtsverstöße überprüft. Rechtswidrige Inhalte waren zum Zeitpunkt der
          Verlinkung nicht erkennbar. Bei Bekanntwerden von Rechtsverletzungen werden
          wir derartige Links umgehend entfernen.
        </p>
      </Section>

      <Section label="Urheberrecht" heading="Urheberrecht">
        <p>
          Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen
          Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung,
          Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen
          des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen
          Autors beziehungsweise Erstellers.
        </p>
        <p>
          Downloads und Kopien dieser Seite sind nur für den privaten, nicht
          kommerziellen Gebrauch gestattet.
        </p>
      </Section>
    </main>
  );
}
