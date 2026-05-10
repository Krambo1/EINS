import { notFound } from "next/navigation";
import Link from "next/link";
import { getClinic, listClinics } from "@/lib/clinic-registry";
import { formatAddress } from "@/lib/format";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return listClinics().map((c) => ({ clinicSlug: c.slug }));
}

export function generateMetadata({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) return {};
  return {
    title: { absolute: `Impressum | ${clinic.name}` },
    robots: { index: true, follow: true },
  };
}

export default function ImpressumPage({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) notFound();
  const l = clinic.legal;

  return (
    <main className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-12 md:py-16">
        <Link
          href="../"
          className="text-sm text-brand-fg-muted underline-offset-4 hover:text-brand-fg hover:underline"
        >
          ← zurück
        </Link>
        <h1 className="mt-6">Impressum</h1>
        <p className="mt-1 text-sm text-brand-fg-muted">Angaben gemäß § 5 DDG</p>

        <Section title="Anbieter">
          <P>{clinic.name}</P>
          <P>{clinic.doctor.name}</P>
          <P>{formatAddress(clinic.address)}</P>
          <P>{clinic.address.country}</P>
        </Section>

        <Section title="Kontakt">
          <P>
            Telefon:{" "}
            <a className="underline-offset-4 hover:underline" href={`tel:${clinic.contact.phoneE164}`}>
              {clinic.contact.phoneDisplay}
            </a>
          </P>
          <P>
            E-Mail:{" "}
            <a
              className="underline-offset-4 hover:underline"
              href={`mailto:${clinic.contact.email}`}
            >
              {clinic.contact.email}
            </a>
          </P>
        </Section>

        <Section title="Berufsbezeichnung und berufsrechtliche Regelungen">
          <P>Berufsbezeichnung: {l.berufsbezeichnung}</P>
          <P>Verleihender Staat: {l.verleihungsstaat}</P>
          <P>Zuständige Kammer: {l.kammer.name}</P>
          <P>{l.kammer.address}</P>
          <P>
            <a
              className="underline-offset-4 hover:underline"
              href={l.kammer.url}
              target="_blank"
              rel="noreferrer"
            >
              {l.kammer.url}
            </a>
          </P>
          <P className="mt-3">
            Berufsordnung (Auszug):{" "}
            <a
              className="underline-offset-4 hover:underline"
              href={l.berufsordnungUrl}
              target="_blank"
              rel="noreferrer"
            >
              {l.berufsordnungUrl}
            </a>
          </P>
          <P>
            Heilberufekammergesetz:{" "}
            <a
              className="underline-offset-4 hover:underline"
              href={l.heilberufekammergesetzUrl}
              target="_blank"
              rel="noreferrer"
            >
              {l.heilberufekammergesetzUrl}
            </a>
          </P>
        </Section>

        {l.ustId && (
          <Section title="Umsatzsteuer-ID">
            <P>Umsatzsteuer-Identifikationsnummer gemäß § 27 a UStG: {l.ustId}</P>
          </Section>
        )}

        <Section title="Berufshaftpflichtversicherung">
          <P>{l.berufshaftpflicht.versicherer}</P>
          <P>{l.berufshaftpflicht.adresse}</P>
          <P>Geltungsbereich: {l.berufshaftpflicht.geltungsbereich}</P>
        </Section>

        {l.datenschutzbeauftragter && (
          <Section title="Datenschutzbeauftragter">
            <P>{l.datenschutzbeauftragter.name}</P>
            <P>
              <a
                className="underline-offset-4 hover:underline"
                href={`mailto:${l.datenschutzbeauftragter.email}`}
              >
                {l.datenschutzbeauftragter.email}
              </a>
            </P>
          </Section>
        )}

        <Section title="Verbraucherstreitbeilegung / Universalschlichtungsstelle">
          <P>
            Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </P>
        </Section>

        <Section title="Haftung für Inhalte">
          <P>
            Als Diensteanbieter sind wir gemäß § 7 Abs.1 DDG für eigene Inhalte auf diesen Seiten
            nach den allgemeinen Gesetzen verantwortlich. Wir sind jedoch nicht verpflichtet,
            übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen
            zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
          </P>
        </Section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-1.5 text-brand-fg-muted">{children}</div>
    </section>
  );
}

function P({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={className}>{children}</p>;
}
