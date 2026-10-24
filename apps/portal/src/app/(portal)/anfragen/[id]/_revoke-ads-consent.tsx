"use client";

import { useState, useTransition } from "react";
import { Button } from "@eins/ui";
import { Loader2 } from "lucide-react";
import { revokeAdsConsent } from "./actions";

/**
 * "Einwilligung widerrufen" (migration 0077). The action returns
 * `{ ok, message }` like the other cockpit actions (V2 Neben 5), so a refusal
 * shows as a German line instead of an error page.
 */
export function RevokeAdsConsentButton({ requestId }: { requestId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const fd = new FormData();
    fd.set("id", requestId);
    setError(null);
    startTransition(async () => {
      try {
        const res = await revokeAdsConsent(fd);
        if (!res.ok) setError(res.message);
      } catch {
        setError("Keine Verbindung. Bitte versuchen Sie es noch einmal.");
      }
    });
  };

  return (
    <>
      <Button type="button" size="sm" variant="danger" disabled={isPending} onClick={submit}>
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Einwilligung widerrufen
      </Button>
      {error && <p className="basis-full text-sm text-tone-bad">{error}</p>}
    </>
  );
}
