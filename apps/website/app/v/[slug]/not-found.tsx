import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/constants";

export default function VideoNotFound() {
  return (
    <main className="container flex min-h-dvh max-w-2xl flex-col justify-center py-24">
      <h1 className="display-m">Dieses Video ist nicht mehr verfügbar.</h1>
      <p className="mt-5 text-lg leading-relaxed text-fg-primary md:text-xl">
        Schreiben Sie uns kurz an{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent underline-offset-4 hover:underline">
          {CONTACT_EMAIL}
        </a>
        , dann schicken wir Ihnen einen neuen Link.
      </p>
      <Link href="/" className="mt-8 text-base text-fg-secondary hover:text-fg-primary">
        Zur Startseite
      </Link>
    </main>
  );
}
