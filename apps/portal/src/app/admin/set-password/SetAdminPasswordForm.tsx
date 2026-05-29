"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import {
  setAdminPasswordAction,
  type SetAdminPasswordActionState,
} from "./actions";

/**
 * Fehler werden inline gerendert (siehe Action-Header für Hintergrund:
 * Next.js #65893). Bei `expired: true` zeigt die Form zusätzlich einen
 * "Zurück zur Anmeldung"-Link, weil die Setup-Sitzung weg ist.
 */
function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending} className="w-full">
      {pending ? "Wird gespeichert…" : "Passwort speichern"}
    </Button>
  );
}

export function SetAdminPasswordForm() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = Boolean(pw && pw2 && pw !== pw2);

  const [state, action] = useActionState<SetAdminPasswordActionState, FormData>(
    setAdminPasswordAction,
    undefined
  );

  // Success: clientseitige Navigation auf /admin?password=set, danach
  // router.refresh() damit das Dashboard die frische Session-Cookie sieht.
  // (Server-side redirect() würde Next.js #65893 triggern.)
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      router.replace(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  const errorState = state && "error" in state ? state : null;

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
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
        />
        <p className="text-xs text-fg-secondary">
          Mindestens 12 Zeichen, mit mindestens 3 von 4: Großbuchstabe,
          Kleinbuchstabe, Ziffer, Sonderzeichen.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password2">Wiederholung</Label>
        <Input
          id="password2"
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
      {errorState && (
        <div
          role="alert"
          className="space-y-2 rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad"
        >
          <p>{errorState.error}</p>
          {errorState.expired && (
            <p>
              <Link
                href="/admin/login"
                className="font-medium underline underline-offset-2"
              >
                Zurück zur Anmeldung
              </Link>
            </p>
          )}
        </div>
      )}
      <SubmitButton disabled={mismatch} />
    </form>
  );
}
