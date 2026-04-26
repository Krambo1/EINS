"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import { requestMagicLinkAction, type LoginActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird gesendet…" : "Anmelde-Link senden"}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<LoginActionState, FormData>(
    requestMagicLinkAction,
    undefined
  );

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
      <p className="text-sm text-fg-secondary">
        Sie erhalten einen einmaligen Link per E-Mail. Kein Passwort nötig.
      </p>
    </form>
  );
}
