"use client";

import Link from "next/link";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="container flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <div className="eyebrow">Fehler</div>
      <h1 className="display-m mt-6 max-w-2xl">Da ist etwas schiefgelaufen.</h1>
      <p className="mt-4 max-w-prose text-lg text-fg-primary">
        Bitte laden Sie die Seite neu. Besteht das Problem, schreiben Sie uns an team@einsvisuals.com.
      </p>
      <div className="mt-8 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-border bg-bg-secondary px-5 py-2.5 font-mono text-base text-fg-primary transition-colors hover:border-accent hover:text-accent"
        >
          Erneut versuchen
        </button>
        <Link
          href="/"
          className="rounded-full bg-accent px-5 py-2.5 font-mono text-base text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.25)]"
        >
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
