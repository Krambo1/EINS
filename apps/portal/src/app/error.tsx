"use client";

import { startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@eins/ui";
import { EinsLogo } from "./_components/EinsLogo";
import { CardBody, CardFoot, PRIMARY_BUTTON } from "./(portal)/einstellungen/_components/settings-ui";

/**
 * Root-segment error boundary. Catches what the segment boundaries cannot:
 * errors thrown by `(portal)/layout.tsx` or `admin/layout.tsx` themselves
 * (session lookup, onboarding gate, nav badges hit the DB there, so a Neon
 * wake-up timeout lands here), plus the `(auth)` pages. Renders inside the
 * root layout, so fonts and theme still apply. No shell is left here, so the
 * page stands on its own like the Freigabe link: the canvas (the admin
 * host's dark ground in its dark theme), the EINS logo where the shell has
 * it, one card. Errors in the root layout itself go to `global-error.tsx`.
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
    <div className="min-h-dvh bg-[var(--surface-canvas)] text-fg-primary [[data-theme=dark]_&]:bg-bg-primary">
      <main className="mx-auto w-full max-w-xl px-4 pb-8 sm:px-6 sm:pb-12">
        <div className="flex h-[var(--shell-row)] items-center">
          <EinsLogo className="h-7 w-auto shrink-0" />
        </div>
        <div className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]">
          <CardBody className="pt-5 md:pt-6">
            <h1 className="text-lg font-semibold leading-7 text-fg-primary sm:text-xl">
              Das hat gerade nicht geklappt
            </h1>
            <p className="mt-1 text-[15px] leading-6 text-fg-primary">
              Die Seite konnte nicht geladen werden. Bleibt der Fehler,
              schreiben Sie uns die Fehlernummer.
            </p>
            {/* The row stays when an error has no number, so the card keeps its height. */}
            <p className="mt-2 min-h-5 text-sm leading-5 text-fg-secondary">
              {error.digest && (
                <>
                  Fehlernummer: <span className="select-all tabular-nums text-fg-primary">{error.digest}</span>
                </>
              )}
            </p>
          </CardBody>
          <CardFoot
            start={
              <Link
                href="/"
                className="rounded-[var(--r-small)] text-sm font-medium text-fg-primary underline underline-offset-4 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Zur Startseite
              </Link>
            }
          >
            <Button
              className={PRIMARY_BUTTON}
              onClick={() =>
                startTransition(() => {
                  router.refresh();
                  reset();
                })
              }
            >
              Erneut versuchen
            </Button>
          </CardFoot>
        </div>
      </main>
    </div>
  );
}
