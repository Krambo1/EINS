"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import { changePasswordAction, type SettingsActionState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Wird gespeichert…" : "Passwort ändern"}
    </Button>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<SettingsActionState, FormData>(
    changePasswordAction,
    undefined
  );
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw && pw2 && pw !== pw2;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="newPassword">Neues Passwort</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
          <p className="text-xs text-fg-secondary">
            Mindestens 12 Zeichen, mit mindestens 3 von 4: Großbuchstabe,
            Kleinbuchstabe, Ziffer, Sonderzeichen.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="newPassword2">Wiederholung</Label>
          <Input
            id="newPassword2"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
          />
          {mismatch && (
            <p className="text-sm text-tone-bad">
              Die Eingaben stimmen nicht überein.
            </p>
          )}
        </div>
      </div>
      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-xl border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary"
        >
          {state.error}
        </div>
      )}
      {state && state.ok && (
        <div
          role="status"
          className="rounded-xl border border-tone-good/40 bg-tone-good/10 p-3 text-sm text-fg-primary"
        >
          {state.message}
        </div>
      )}
      <SubmitButton />
    </form>
  );
}
