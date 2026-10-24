"use client";

import { startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Root-segment error boundary. Catches what the segment boundaries cannot:
 * errors thrown by `(portal)/layout.tsx` or `admin/layout.tsx` themselves
 * (session lookup, onboarding gate, nav badges hit the DB there, so a Neon
 * wake-up timeout lands here), plus the `(auth)` pages. Renders inside the
 * root layout, so fonts and theme still apply. Same look as `not-found.tsx`.
 * Errors in the root layout itself go to `global-error.tsx`.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg-primary p-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-fg-primary">
        Das hat gerade nicht geklappt
      </h1>
      <p className="max-w-md text-fg-secondary">
        Die Seite konnte nicht geladen werden. Bitte versuchen Sie es in einem
        Moment erneut. Bleibt das Problem bestehen, melden Sie sich bei uns und
        nennen Sie die Fehlernummer.
      </p>
      {error.digest && (
        <p className="text-sm text-fg-secondary">Fehlernummer: {error.digest}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
        <button
          type="button"
          onClick={() =>
            startTransition(() => {
              router.refresh();
              reset();
            })
          }
          className="text-sm text-accent underline underline-offset-4"
        >
          Erneut versuchen
        </button>
        <Link
          href="/"
          className="text-sm text-accent underline underline-offset-4"
        >
          Zur Startseite
        </Link>
      </div>
    </main>
  );
}
