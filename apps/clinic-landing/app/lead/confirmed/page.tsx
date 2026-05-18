import Link from "next/link";
import { getClinic } from "@/lib/clinic-registry";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Anmeldung bestätigt",
  robots: { index: false, follow: false },
};

export default function ConfirmedPage({
  searchParams,
}: {
  searchParams: { clinic?: string };
}) {
  const clinic = searchParams.clinic ? getClinic(searchParams.clinic) : null;
  const clinicName = clinic?.name ?? "Ihrer Praxis";

  return (
    <main className="min-h-[80vh] bg-brand-bg-soft">
      <div className="container mx-auto max-w-xl px-4 py-16 md:py-24">
        <div className="rounded-brand-lg border border-brand-border bg-brand-bg p-8 text-center sm:p-10">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary-soft">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-brand-primary"
              aria-hidden
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="mt-5 text-2xl font-semibold text-brand-fg">
            E-Mail-Adresse bestätigt
          </h1>
          <p className="mt-3 text-brand-fg-muted">
            Vielen Dank. Sie erhalten ab jetzt gelegentlich Informationen von{" "}
            <strong>{clinicName}</strong>. Sie können diese Einwilligung jederzeit per
            Antwortmail oder über den Abmelde-Link in jeder E-Mail widerrufen.
          </p>
          {clinic && (
            <div className="mt-6">
              <Link
                href={`/${clinic.slug}`}
                className="inline-flex items-center justify-center rounded-brand bg-brand-primary px-5 py-3 text-sm font-medium text-white hover:opacity-90"
              >
                Zurück zur Praxis-Seite
              </Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
