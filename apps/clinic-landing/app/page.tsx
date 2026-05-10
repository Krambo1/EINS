import Link from "next/link";
import { listClinics, listTreatmentsForClinic } from "@/lib/clinic-registry";

export const dynamic = "force-static";

/**
 * Internal index page — only ever visible on `*.vercel.app` / localhost.
 * Real patient traffic always lands on `praxis-X.de/<treatment>` directly.
 */
export default function Index() {
  const clinics = listClinics();
  return (
    <main className="container mx-auto max-w-3xl py-16 md:py-24">
      <p className="eyebrow">Clinic Landing Template</p>
      <h1 className="mt-3">Mandanten-Vorschau</h1>
      <p className="mt-3 text-brand-fg-muted">
        Diese Seite ist nur intern erreichbar (Preview-Domain / localhost). Patientinnen
        sehen ausschließlich die jeweilige Praxis-Domain mit der angefragten Behandlung.
      </p>
      <div className="mt-10 space-y-10">
        {clinics.map((c) => {
          const treatments = listTreatmentsForClinic(c.slug);
          return (
            <section key={c.slug}>
              <h2>{c.name}</h2>
              <p className="mt-1 text-sm text-brand-fg-muted">/{c.slug}</p>
              <ul className="mt-4 grid auto-rows-fr gap-2 sm:grid-cols-2">
                {treatments.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/${c.slug}/${t.slug}`}
                      className="card flex h-full items-center justify-between transition-colors hover:border-brand-primary/60"
                    >
                      <span className="font-medium text-brand-fg">{t.h1}</span>
                      <span className="text-sm text-brand-fg-muted">{t.category}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-3 text-sm">
                <Link
                  href={`/${c.slug}/datenschutz`}
                  className="underline-offset-4 hover:underline"
                >
                  Datenschutz
                </Link>
                <Link
                  href={`/${c.slug}/impressum`}
                  className="underline-offset-4 hover:underline"
                >
                  Impressum
                </Link>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
