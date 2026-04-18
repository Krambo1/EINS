import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Impressum · EINS Visuals" };

export default function Impressum() {
  return (
    <main className="container flex min-h-screen flex-col justify-center py-24">
      <Link
        href="/"
        className="mb-12 inline-flex items-center gap-2 font-mono text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" /> Zurück
      </Link>
      <h1 className="display-m">Impressum</h1>
      <p className="mt-6 max-w-prose text-fg-secondary">
        Inhalt folgt in Kürze. Bei Fragen erreichen Sie uns jederzeit unter{" "}
        <a href="mailto:team@einsvisuals.com" className="text-accent underline">
          team@einsvisuals.com
        </a>
        .
      </p>
    </main>
  );
}
