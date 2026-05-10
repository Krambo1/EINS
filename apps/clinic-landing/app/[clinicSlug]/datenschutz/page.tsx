import { notFound } from "next/navigation";
import Link from "next/link";
import { getClinic, listClinics } from "@/lib/clinic-registry";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return listClinics().map((c) => ({ clinicSlug: c.slug }));
}

export function generateMetadata({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) return {};
  return {
    // `title.absolute` skips the parent layout's "%s | clinic.name" template.
    title: { absolute: `Datenschutz | ${clinic.name}` },
    description: `Datenschutzerklärung der Praxis ${clinic.name}.`,
    robots: { index: true, follow: true },
  };
}

export default function DatenschutzPage({ params }: { params: { clinicSlug: string } }) {
  const clinic = getClinic(params.clinicSlug);
  if (!clinic) notFound();
  return (
    <main className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-12 md:py-16">
        <Link
          href="../"
          className="text-sm text-brand-fg-muted underline-offset-4 hover:text-brand-fg hover:underline"
        >
          ← zurück
        </Link>
        <article className="mt-6 prose prose-neutral max-w-none">
          {renderMarkdown(clinic.datenschutzMarkdown)}
        </article>
      </div>
    </main>
  );
}
