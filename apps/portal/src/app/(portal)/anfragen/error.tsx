"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@eins/ui";
import { PageHeader } from "../_components/PageHeader";
import { CardBody, CardFoot, PRIMARY_BUTTON } from "../einstellungen/_components/settings-ui";

/**
 * Error boundary for the Anfragen pages (list, one Anfrage, "Anfrage
 * anlegen"), laid out and worded like the portal's (`(portal)/error.tsx`): the title on
 * the logo row, one card with the sentence, the Fehlernummer and "Erneut
 * versuchen", which loads the page from the server again before resetting.
 */
export default function AnfragenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  return (
    <div className="max-w-3xl space-y-4 md:space-y-6">
      <PageHeader title="Diese Seite konnte gerade nicht geladen werden" />
      <div className="anim-rise elev-card min-w-0 rounded-[var(--r-card)] bg-[var(--surface-tile)]">
        <CardBody className="pt-5 md:pt-6">
          <p className="text-[15px] leading-6 text-fg-primary">
            Bleibt der Fehler, schreiben Sie uns die Fehlernummer.
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
        <CardFoot>
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
    </div>
  );
}
