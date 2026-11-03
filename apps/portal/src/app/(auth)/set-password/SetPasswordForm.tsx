"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PASSWORD_MIN_LENGTH } from "@/auth/password-rules";
import { AuthToast } from "../_components/AuthToast";
import { PasswordInput } from "../_components/PasswordInput";
import { PasswordRules } from "../_components/PasswordRules";
import { AuthField, PendingStatus, authPrimaryClass } from "../_components/auth-ui";
import { AUTH_STACK } from "../_lib/sizes";
import {
  setPasswordFromCookieAction,
  type SetPasswordState,
} from "./actions";

interface Props {
  /** The account's address, for password managers (hidden username field). */
  email: string;
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        data-auth-primary
        disabled={pending || blocked}
        aria-busy={pending}
        className={authPrimaryClass}
      >
        Passwort speichern
      </button>
      <PendingStatus pending={pending} label="Wird gespeichert" />
    </>
  );
}

export function SetPasswordForm({ email }: Props) {
  const [state, formAction] = useActionState<SetPasswordState, FormData>(
    setPasswordFromCookieAction,
    undefined
  );

  const [closedFor, setClosedFor] = useState<SetPasswordState>(undefined);
  const error = state && !state.ok && closedFor !== state ? state.error : null;

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw.length > 0 && pw2.length > 0 && pw !== pw2;

  return (
    <form action={formAction} onSubmit={() => setClosedFor(state)} className={AUTH_STACK}>
      {/* Lets password managers file the new password under the right
          account. Not read by the action. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />
      <AuthField label="Neues Passwort" htmlFor="password">
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          autoFocus
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          aria-describedby="password-rules"
        />
      </AuthField>
      <AuthField label="Passwort wiederholen" htmlFor="password2">
        <PasswordInput
          id="password2"
          name="password2"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          toggleLabel="Wiederholung"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </AuthField>
      <PasswordRules id="password-rules" pw={pw} pw2={pw2} />
      <SubmitButton blocked={mismatch} />
      {error && (
        <AuthToast tone="bad" onClose={() => setClosedFor(state)}>
          {error}
        </AuthToast>
      )}
    </form>
  );
}
