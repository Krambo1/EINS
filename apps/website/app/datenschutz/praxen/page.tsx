import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL, CONTACT_PHONE } from "@/lib/constants";

// Art. 14 DSGVO information for practices EINS researched and wrote to without
// prior contact. Every cold e-mail links here ("Datenschutz:
// eins.ag/datenschutz/praxen"); the numbers on this page are enforced in the
// eins-mail server (one follow-up, in-thread limits, block list, address source).

export const metadata = {
  title: "Datenschutz für angeschriebene Praxen",
  description:
    "Woher wir Ihre Adresse haben, was wir damit tun und wie Sie jede weitere E-Mail stoppen (Art. 14 DSGVO).",
  alternates: { canonical: "/datenschutz/praxen" },
};

const linkClass = "text-accent underline-offset-4 hover:underline";

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

function Mail() {
  return (
    <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
      {CONTACT_EMAIL}
    </a>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

export default function DatenschutzPraxen() {
  return (
    <main className="container py-24">
      <Link
        href="/datenschutz"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Allgemeine Datenschutzerklärung
      </Link>

      <h1 className="display-m">Datenschutz für angeschriebene Praxen</h1>
      <p className="mt-6 max-w-prose text-base leading-relaxed text-fg-primary md:text-lg">
        Sie haben eine E-Mail von K. Issa (EINS) bekommen, ohne vorher mit uns
        Kontakt gehabt zu haben. Hier steht, woher wir Ihre Adresse haben, was
        wir damit tun, wie lange wir sie behalten und wie Sie jede weitere
        E-Mail stoppen. Das ist die Information nach Art. 14 DSGVO. Sie ergänzt
        unsere{" "}
        <Link href="/datenschutz" className={linkClass}>
          allgemeine Datenschutzerklärung
        </Link>
        .
      </p>

      <div className="mt-8 max-w-prose rounded-lg border border-fg-secondary/30 p-5 text-base leading-relaxed text-fg-primary md:text-lg">
        <p className="font-semibold">Keine E-Mails mehr von uns?</p>
        <p className="mt-2">
          Antworten Sie mit „Abmelden“ oder schreiben Sie an <Mail />. Dann
          bekommen Sie von keiner unserer Absenderadressen je wieder eine
          E-Mail. Eine Begründung brauchen wir nicht. Dasselbe gilt, wenn Sie
          uns einfach absagen.
        </p>
      </div>

      <Section label="Art. 14 Abs. 1 lit. a DSGVO" heading="Wer schreibt Ihnen">
        <p>
          Verantwortlich ist Karam Issa, Einzelunternehmer, handelnd unter der
          Geschäftsbezeichnung KRMedia, Marke EINS.
        </p>
        <p>Rösrather Straße 172, 51107 Köln, Deutschland</p>
        <p>
          E-Mail: <Mail />
        </p>
        <p>
          Telefon:{" "}
          <a href={`tel:${CONTACT_PHONE.replace(/\s/g, "")}`} className={linkClass}>
            {CONTACT_PHONE}
          </a>
        </p>
        <p>
          Unsere E-Mails an Praxen kommen von Absenderadressen wie
          kontakt@eins-wachstum.de oder kontakt@eins-system.de und sind mit
          „K. Issa“ unterschrieben. Antworten gehen an <Mail />.
        </p>
      </Section>

      <Section label="Art. 14 Abs. 2 lit. f DSGVO" heading="Woher wir Ihre Adresse haben">
        <p>
          Ausschließlich aus öffentlich zugänglichen Quellen, in denen Ihre
          Praxis sich selbst vorstellt:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>der Website Ihrer Praxis, meist Impressum oder Kontaktseite,</li>
          <li>dem Google-Unternehmensprofil Ihrer Praxis (Google Maps),</li>
          <li>
            Arztsuchen und Verzeichnissen von Fachgesellschaften und
            Plattformen, etwa DGBT, VDÄPC, DGPRÄC oder Estheticon,
          </li>
          <li>Arztfindern von Herstellern ästhetischer Produkte,</li>
          <li>der öffentlichen Werbebibliothek von Meta (ob Ihre Praxis dort Anzeigen schaltet).</li>
        </ul>
        <p>
          In der ersten E-Mail nennen wir die genaue Seite, auf der Ihre Adresse
          steht („Ihre Adresse habe ich von …“). Vor dem Versand prüft unser
          System, dass die Adresse dort tatsächlich veröffentlicht ist. Finden
          wir sie nicht, schreiben wir sie nicht an.
        </p>
      </Section>

      <Section label="Art. 14 Abs. 1 lit. d DSGVO" heading="Welche Daten wir verarbeiten">
        <ul className="list-disc space-y-2 pl-5">
          <li>Name der Praxis, Name der Inhaberin oder des Inhabers, Fachrichtung</li>
          <li>Geschäftsadresse, geschäftliche E-Mail-Adresse und Telefonnummer</li>
          <li>
            Website und öffentliche Profile der Praxis (Google, Instagram,
            Verzeichnisse) sowie das dort genannte Leistungsangebot
          </li>
          <li>
            Anzahl und Durchschnitt Ihrer Google-Bewertungen, Gründungsjahr,
            öffentliche Neuigkeiten der Praxis und ob sie bei Meta Anzeigen
            schaltet
          </li>
          <li>die Seite, auf der Ihre E-Mail-Adresse steht, und das Datum der Recherche</li>
          <li>das Ergebnis der Prüfung, ob die Adresse E-Mails annimmt</li>
          <li>wann wir Ihnen von welcher Absenderadresse geschrieben haben</li>
          <li>Ihre Antworten an uns, falls Sie antworten</li>
          <li>
            nur wenn Sie das Analysevideo anfragen: Bildschirmaufnahmen Ihrer
            öffentlichen Website und Ihres öffentlichen Google-Profils
          </li>
        </ul>
        <p>
          Private Angaben, Patientendaten und Gesundheitsdaten sammeln wir nicht.
        </p>
      </Section>

      <Section label="Art. 14 Abs. 1 lit. c DSGVO" heading="Wofür und wie oft wir schreiben">
        <p>
          Wir stellen Praxen unsere Leistung vor: Patientengewinnung über
          Online-Werbung. Dafür bekommen Sie:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            eine erste E-Mail mit dem Angebot eines kostenlosen Analysevideos zu
            Ihrem Online-Auftritt,
          </li>
          <li>
            höchstens eine Nachfass-E-Mail, wenn Sie nicht antworten. Danach
            schreiben wir nicht mehr.
          </li>
        </ul>
        <p>Wenn Sie antworten:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Wir beantworten Ihre Nachricht.</li>
          <li>
            Danach erinnern wir höchstens einmal, frühestens nach sieben Tagen.
          </li>
          <li>
            Haben Sie Interesse gezeigt oder das Video angefragt, erinnern wir
            höchstens dreimal, jeweils mit mindestens sieben Tagen Abstand. Das
            angefragte Video schicken wir einmal.
          </li>
          <li>Schreiben Sie uns erneut, beantworten wir auch diese Nachricht.</li>
          <li>Sagen Sie ab, schreiben wir Ihnen nicht mehr.</li>
        </ul>
      </Section>

      <Section label="Art. 14 Abs. 1 lit. c, Abs. 2 lit. b DSGVO" heading="Rechtsgrundlage">
        <p>
          Art. 6 Abs. 1 lit. f DSGVO. Unser berechtigtes Interesse ist, Praxen
          als Geschäftskunden zu gewinnen (Direktwerbung, Erwägungsgrund 47
          DSGVO). Wir verwenden dafür nur berufliche Angaben, die Ihre Praxis
          selbst veröffentlicht hat, schreiben selten und hören beim ersten
          Widerspruch für immer auf. Ihr Interesse, nicht beworben zu werden,
          wahren wir so, dass ein einziges Wort von Ihnen genügt.
        </p>
      </Section>

      <Section label="Art. 21 DSGVO" heading="Ihr Widerspruch">
        <p>
          Sie können der Verarbeitung Ihrer Daten für Werbung jederzeit ohne
          Begründung widersprechen (Art. 21 Abs. 2 DSGVO): mit der Antwort
          „Abmelden“, mit einer Absage oder per E-Mail an <Mail />.
        </p>
        <p>
          Dann schreiben wir Ihnen nie wieder, von keiner unserer
          Absenderadressen und auch nicht an andere Adressen Ihrer Praxis. Damit
          das so bleibt, behalten wir einen Sperrvermerk: Ihre Adresse, die
          Domain und die Google-Kennung Ihrer Praxis, den Zeitpunkt und woher
          der Widerspruch kam. Jede künftige E-Mail wird vor
          dem Versand gegen diese Sperrliste geprüft (Art. 21 Abs. 3 DSGVO).
        </p>
      </Section>

      <Section label="Art. 14 Abs. 1 lit. e, f DSGVO" heading="Wer Ihre Daten außerdem verarbeitet">
        <p>
          Wir geben Ihre Daten nicht weiter und verkaufen sie nicht. Für den
          Betrieb setzen wir diese Dienste ein:
        </p>
        <ul className="list-disc space-y-3 pl-5">
          <li>
            <strong>Resend</strong> (Plus Five Five, Inc., San Francisco, USA):
            Versand unserer E-Mails über Server in Irland. Zugriff aus den USA
            ist möglich. Der Anbieter ist unter dem EU-U.S. Data Privacy
            Framework zertifiziert, zusätzlich gelten Standardvertragsklauseln.
          </li>
          <li>
            <strong>Migadu</strong> (Migadu-Mail GmbH, Schachen, Schweiz): das
            Postfach {CONTACT_EMAIL}, in dem Ihre Antworten eingehen und aus dem
            wir antworten, auch mit dem angefragten Video als Anhang. Server in
            Frankreich (EU), keine Übermittlung in ein Drittland.
          </li>
          <li>
            <strong>Cloudflare</strong> (Cloudflare, Inc., San Francisco, USA):
            leitet Antworten an unsere Absenderadressen kontakt@eins-wachstum.de
            und kontakt@eins-system.de an {CONTACT_EMAIL} weiter, ohne den
            Inhalt zu speichern. Zertifiziert unter dem Data Privacy Framework.
          </li>
          <li>
            <strong>ZeroBounce</strong> (Hertza, L.L.C., Santa Barbara, USA):
            prüft vor dem Versand, ob Ihre Adresse E-Mails annimmt. Zertifiziert
            unter dem Data Privacy Framework.
          </li>
          <li>
            <strong>Google Maps Platform</strong> (Google Cloud EMEA Limited,
            Dublin, Irland): liefert die öffentlichen Angaben Ihres
            Google-Unternehmensprofils. Google verarbeitet unsere Suchanfragen
            als eigener Verantwortlicher. Google LLC ist unter dem Data Privacy
            Framework zertifiziert.
          </li>
          <li>
            <strong>Claude</strong> (Anthropic Ireland, Limited, Dublin, Irland):
            KI-Assistent, mit dem wir öffentliche Angaben zu Praxen
            zusammenfassen und E-Mails vorbereiten. Verarbeitung auch in den
            USA, auf Grundlage von Standardvertragsklauseln oder des Data
            Privacy Framework nach Angabe des Anbieters.
          </li>
          <li>
            <strong>Jev</strong> (TypeSafe AI, Inc., San Francisco, USA): ordnet
            Ihre Antwort ein, damit eine Absage sofort zur Sperre führt. Server
            in den USA, Standardvertragsklauseln (Modul 2) im
            Auftragsverarbeitungsvertrag.
          </li>
          <li>
            <strong>iCloud</strong> (Apple Distribution International Ltd., Cork,
            Irland): Sicherungskopie von Versandprotokoll und Sperrliste.
            Speicherung auch in den USA, auf Grundlage von
            Standardvertragsklauseln.
          </li>
          <li>
            Nur wenn Sie das Analysevideo anfragen:{" "}
            <strong>ElevenLabs</strong> (ElevenLabs Poland sp. z o.o., Warschau,
            Polen) erzeugt die Sprecherstimme aus dem Videotext. Die
            US-Muttergesellschaft ist unter dem Data Privacy Framework
            zertifiziert, zusätzlich gelten Standardvertragsklauseln.
          </li>
        </ul>
        <p>
          Die Liste der zertifizierten Unternehmen finden Sie unter{" "}
          <Ext href="https://www.dataprivacyframework.gov/list">dataprivacyframework.gov/list</Ext>.
          Eine Kopie der Standardvertragsklauseln bekommen Sie auf Anfrage an{" "}
          <Mail />.
        </p>
      </Section>

      <Section label="Art. 14 Abs. 2 lit. a DSGVO" heading="Wie lange wir Ihre Daten behalten">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Recherchedaten zu Ihrer Praxis:</strong> wir löschen sie
            spätestens zwölf Monate nach der Recherche. Länger nur, wenn Sie
            geantwortet haben und wir im Austausch sind oder eine
            Geschäftsbeziehung entsteht.
          </li>
          <li>
            <strong>Versandprotokoll</strong> (welche Adresse wir wann von
            welcher Absenderadresse angeschrieben haben): so lange, wie wir es
            brauchen, um doppelte E-Mails zu verhindern und einen rechtmäßigen
            Versand belegen zu können.
          </li>
          <li>
            <strong>Sperrvermerk nach Widerspruch:</strong> dauerhaft, nur
            Adresse, Domain und Google-Kennung der Praxis, Zeitpunkt und
            Herkunft des Widerspruchs. Ohne ihn könnten
            wir nicht garantieren, dass Sie nie wieder angeschrieben werden.
          </li>
          <li>
            <strong>Korrespondenz zu einem Auftrag:</strong> nach den
            gesetzlichen Aufbewahrungspflichten (§ 257 HGB, § 147 AO).
          </li>
        </ul>
      </Section>

      <Section label="Art. 15-20, 77 DSGVO" heading="Ihre weiteren Rechte">
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung
          der Verarbeitung und Datenübertragbarkeit. Eine formlose Nachricht an{" "}
          <Mail /> genügt. Wir antworten innerhalb eines Monats.
        </p>
        <p>
          Sie können sich bei einer Datenschutzaufsichtsbehörde beschweren. Für
          uns zuständig ist die Landesbeauftragte für Datenschutz und
          Informationsfreiheit Nordrhein-Westfalen (LDI NRW), Postfach 20 04 44,
          40102 Düsseldorf, <Ext href="https://www.ldi.nrw.de">ldi.nrw.de</Ext>.
        </p>
      </Section>

      <Section label="Art. 22 DSGVO" heading="Keine automatisierte Entscheidung">
        <p>
          Eine ausschließlich automatisierte Entscheidung mit rechtlicher oder
          ähnlich erheblicher Wirkung für Sie findet nicht statt. Unser System
          sortiert und prüft vor dem Versand, etwa ob eine Adresse öffentlich
          ist oder gesperrt wurde. Den Versand löst Karam Issa selbst aus.
        </p>
      </Section>

      <Section label="Aktualität" heading="Stand dieser Information">
        <p>
          Ändert sich etwas an der Recherche, am Versand oder an den Diensten,
          passen wir diese Seite an.
        </p>
        <p className="font-mono text-sm text-fg-secondary">Stand: 13.10.2026</p>
      </Section>
    </main>
  );
}
