"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PASSWORD_MIN_LENGTH } from "@/auth/password-rules";
import { AuthToast } from "../_components/AuthToast";
import { PasswordInput } from "../_components/PasswordInput";
import { PasswordRules } from "../_components/PasswordRules";
import { AuthLabel, PendingDots, authCtaClass } from "../_components/auth-ui";
import {
  setPasswordFromCookieAction,
  type SetPasswordState,
} from "./actions";

interface Props {
  mode: "set_password" | "reset_password";
  /** The account's address, for password managers (hidden username field). */
  email: string;
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || blocked}
      aria-busy={pending}
      className={authCtaClass}
    >
      {pending ? <PendingDots label="Wird gespeichert" /> : "Passwort speichern"}
    </button>
  );
}

// `mode` only selects copy on the page; every mode uses the cookie action
// (the session-based invite action is gone, B-8).
export function SetPasswordForm({ mode: _mode, email }: Props) {
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
    <form action={formAction} onSubmit={() => setClosedFor(state)} className="space-y-6">
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
      <div>
        <AuthLabel htmlFor="password" className="mb-2">
          Neues Passwort
        </AuthLabel>
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
      </div>
      <div>
        <AuthLabel htmlFor="password2" className="mb-2">
          Passwort wiederholen
        </AuthLabel>
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
      </div>
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
