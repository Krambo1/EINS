"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@eins/ui";
import {
  rotateIntakeSecretAction,
  type RotateIntakeSecretState,
} from "../actions";

const CONFIRM_TEXT =
  "Geheimen Schlüssel wirklich erneuern?\n\nDer bisherige Schlüssel gilt noch 24 Stunden. Bis dahin muss der neue Schlüssel in Ihren Zielseiten hinterlegt sein, sonst werden Anfragen abgelehnt. Im Zweifel fragen Sie zuerst EINS.";

function RotateSubmit() {
  const { pending } = useFormStatus();
  // Disabled until hydrated, else a click submits without the confirm (VD2).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending || !hydrated}
      onClick={(e) => {
        if (!window.confirm(CONFIRM_TEXT)) e.preventDefault();
      }}
    >
      {pending ? "Wird erneuert…" : "Schlüssel erneuern"}
    </Button>
  );
}

/**
 * Rotation of the Zielseiten secret with a confirmation (C-34 / F-11). The
 * new secret comes back from the action and is shown once here (F-30: no
 * flash cookie).
 */
export function IntakeSecretRotator() {
  const [state, action] = useActionState<RotateIntakeSecretState, FormData>(
    rotateIntakeSecretAction,
    undefined
  );
  return (
    <div className="space-y-3">
      <form action={action}>
        <RotateSubmit />
      </form>
      {state && !state.ok && (
        <p role="alert" className="text-sm text-tone-bad">
          {state.error}
        </p>
      )}
      {state && state.ok && (
        <div className="rounded-lg border border-border bg-bg-primary p-3">
          <div className="text-sm font-semibold text-fg-primary">
            Neuer geheimer Schlüssel (einmalig sichtbar):
          </div>
          <code className="mt-1 block break-all font-mono text-sm text-fg-primary">
            {state.secret}
          </code>
          <p className="mt-2 text-sm text-fg-secondary">
            Der bisherige Schlüssel gilt noch 24 Stunden. Wenn Sie diese Seite
            verlassen, ist der neue Schlüssel nicht mehr aus dem Portal
            abrufbar. Bei Verlust erneuern Sie ihn einfach noch einmal.
          </p>
        </div>
      )}
    </div>
  );
}
