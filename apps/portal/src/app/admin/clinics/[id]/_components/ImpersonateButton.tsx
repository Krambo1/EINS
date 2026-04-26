"use client";

import { useState, useTransition } from "react";
import { Button } from "@eins/ui";
import { startImpersonationAction } from "../_actions/impersonate";

interface Props {
  targetUserId: string;
  /** Shown on hover for clarity in the table. */
  targetEmail: string;
}

export function ImpersonateButton({ targetUserId, targetEmail }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { url } = await startImpersonationAction(targetUserId);
        const w = window.open(url, "_blank", "noopener");
        if (!w) {
          setError("Popup blockiert — bitte Popups erlauben.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onClick}
        disabled={pending}
        title={`Portal als ${targetEmail} öffnen`}
      >
        {pending ? "Öffnet …" : "Als Benutzer öffnen"}
      </Button>
      {error && (
        <span className="text-[11px] text-red-600" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
