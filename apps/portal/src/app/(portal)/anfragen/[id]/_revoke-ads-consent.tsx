"use client";

import { useTransition } from "react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { revokeAdsConsent } from "./actions";

/**
 * "Widerrufen" for the consent to report to Meta and Google (migration 0077),
 * in the consent's row of the Details card: rarely used and never during a
 * call, so a quiet raised button, not a red one on the page. Not optimistic
 * on purpose: it stops data flows to Meta and Google, so the row changes when
 * the server has done it; the toast says so, or why not, with the patient's
 * name. While it saves the button only dims; a spinner would widen it.
 */
export function RevokeAdsConsentButton({ requestId, name }: { requestId: string; name: string }) {
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    startTransition(async () => {
      try {
        const res = await revokeAdsConsent(fd);
        showActionFlash(
          res.ok
            ? { tone: "good", title: "Einwilligung widerrufen", description: `${name}: Die Anfrage geht nicht mehr an Meta und Google.` }
            : { tone: "bad", title: "Nicht widerrufen", description: `${name}: ${res.message}` }
        );
      } catch {
        showActionFlash({
          tone: "bad",
          title: "Nicht widerrufen",
          description: `${name}: Keine Verbindung. Bitte versuchen Sie es noch einmal.`,
        });
      }
    });
  };

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={submit}
      className={cn(RAISED_CONTROL, CONTROL, "-my-3 shrink-0 px-3")}
    >
      Widerrufen
    </Button>
  );
}
