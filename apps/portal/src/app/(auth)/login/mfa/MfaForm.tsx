"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import { verifyMfaAction, type MfaVerifyState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird geprüft…" : "Code bestätigen"}
    </Button>
  );
}

export function MfaForm() {
  const [state, action] = useActionState<MfaVerifyState, FormData>(
    verifyMfaAction,
    undefined
  );
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="code">6-stelliger Code aus Ihrer Authenticator-App</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          placeholder="123 456"
          className="h-14 text-center text-2xl tracking-[0.4em] tabular-nums"
          maxLength={12}
        />
      </div>
      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-xl border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary"
        >
          {state.error}
        </div>
      )}
      <SubmitButton />
      <p className="text-sm text-fg-secondary">
        Haben Sie Ihre App nicht zur Hand? Ein Backup-Code funktioniert ebenfalls.
      </p>
    </form>
  );
}
