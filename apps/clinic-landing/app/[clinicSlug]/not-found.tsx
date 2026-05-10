import Link from "next/link";

export default function ClinicNotFound() {
  return (
    <main className="container mx-auto flex min-h-[60vh] flex-col items-center justify-center py-20 text-center">
      <h1>Seite nicht gefunden</h1>
      <p className="mt-3 text-brand-fg-muted">
        Die gewünschte Behandlungsseite ist auf dieser Praxis-Domain nicht verfügbar.
      </p>
      <Link href="/" className="mt-6 underline-offset-4 hover:underline">
        ← zur Startseite
      </Link>
    </main>
  );
}
