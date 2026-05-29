"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import {
  requestPasswordResetAction,
  type LoginActionState,
} from "../login/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird gesendet…" : "Link senden"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<LoginActionState, FormData>(
    requestPasswordResetAction,
    undefined
  );

  if (state?.ok) {
    return (
      <div
        role="status"
        className="rounded-xl border border-tone-good/40 bg-tone-good/10 p-4 text-sm text-fg-primary"
      >
        <p className="font-medium">E-Mail ist unterwegs.</p>
        <p className="mt-1 text-fg-secondary">
          Wenn die Adresse bei uns hinterlegt ist, haben wir Ihnen einen Link
          geschickt. Der Link ist 15 Minuten gültig und kann nur einmal
          verwendet werden. Prüfen Sie auch Ihren Spam-Ordner, falls die Mail
          nicht ankommt.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">E-Mail-Adresse</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="ihre.adresse@praxis.de"
          className="h-12 text-base"
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
    </form>
  );
}
