import { notFound } from "next/navigation";
import Link from "next/link";
import { getClinic, isHiddenClinicSlug, listClinics } from "@/lib/clinic-registry";
import { practiceLegalLinks, renderPracticePrivacy } from "@/lib/legal/practice-privacy";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return listClinics().filter((c) => !isHiddenClinicSlug(c.slug)).map((c) => ({ clinicSlug: c.slug }));
}

export function generateMetadata({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) return {};
  return {
    // `title.absolute` skips the parent layout's "%s | clinic.name" template.
    title: { absolute: `Datenschutz | ${clinic.name}` },
    description: `Datenschutzerklärung der Praxis ${clinic.name}.`,
    robots: { index: clinic.slug !== "_template", follow: true },
  };
}

export default function DatenschutzPage({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic || isHiddenClinicSlug(params.clinicSlug)) notFound();
  return (
    <main className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-12 md:py-16">
        <Link
          href={`/${clinic.slug}`}
          className="text-sm text-brand-fg-muted underline-offset-4 hover:text-brand-fg hover:underline"
        >
          ← zurück
        </Link>
        {clinic.slug === "_template" && (
          <p className="mt-6 rounded-lg border border-brand-border bg-brand-bg-soft p-4 text-sm">
            Musteransicht. Die Angaben werden aus dem Praxisblatt ausgefüllt, bevor die Seite veröffentlicht wird.
          </p>
        )}
        <article className="mt-6 prose prose-neutral max-w-none">
          {renderMarkdown(renderPracticePrivacy(clinic.privacySheet))}
        </article>
        <nav aria-label="Rechtliche Informationen" className="mt-10 border-t border-brand-border pt-6">
          <a href={practiceLegalLinks(clinic).imprint} className="underline underline-offset-4">Impressum</a>
        </nav>
      </div>
    </main>
  );
}
