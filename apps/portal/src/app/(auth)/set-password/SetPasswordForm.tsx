"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import {
  setPasswordFromCookieAction,
  setPasswordWithSessionAction,
  type SetPasswordState,
} from "./actions";

interface Props {
  mode: "set_password" | "reset_password" | "invite";
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird gespeichert…" : "Passwort speichern"}
    </Button>
  );
}

export function SetPasswordForm({ mode }: Props) {
  const useCookie = mode === "set_password" || mode === "reset_password";
  const action = useCookie
    ? setPasswordFromCookieAction
    : setPasswordWithSessionAction;

  const [state, formAction] = useActionState<SetPasswordState, FormData>(
    action,
    undefined
  );

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw && pw2 && pw !== pw2;

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="password">Neues Passwort</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="h-12 text-base"
        />
        <p className="text-xs text-fg-secondary">
          Mindestens 12 Zeichen, mit mindestens 3 von 4: Großbuchstabe,
          Kleinbuchstabe, Ziffer, Sonderzeichen.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password2">Wiederholung</Label>
        <Input
          id="password2"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          className="h-12 text-base"
        />
        {mismatch && (
          <p className="text-sm text-tone-bad">
            Die Eingaben stimmen nicht überein.
          </p>
        )}
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
