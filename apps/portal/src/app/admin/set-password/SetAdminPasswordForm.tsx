"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { PASSWORD_MIN_LENGTH } from "@/auth/password-rules";
import { AuthToast } from "@/app/(auth)/_components/AuthToast";
import { PasswordInput } from "@/app/(auth)/_components/PasswordInput";
import { PasswordRules } from "@/app/(auth)/_components/PasswordRules";
import {
  AuthLabel,
  PendingDots,
  authCtaClass,
  authTextLinkClass,
} from "@/app/(auth)/_components/auth-ui";
import {
  setAdminPasswordAction,
  type SetAdminPasswordActionState,
} from "./actions";

function SubmitButton({ blocked, busy }: { blocked: boolean; busy: boolean }) {
  const { pending } = useFormStatus();
  const waiting = pending || busy;
  return (
    <button
      type="submit"
      disabled={waiting || blocked}
      aria-busy={waiting}
      className={authCtaClass}
    >
      {waiting ? <PendingDots label="Wird gespeichert" /> : "Passwort speichern"}
    </button>
  );
}

/**
 * Errors come back as action state and show as a toast (see the action
 * header: Next.js #65893). With `expired: true` the setup cookie is gone, so
 * the toast offers a new link.
 */
export function SetAdminPasswordForm({ email }: { email: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const mismatch = pw.length > 0 && pw2.length > 0 && pw !== pw2;

  const [state, action] = useActionState<SetAdminPasswordActionState, FormData>(
    setAdminPasswordAction,
    undefined
  );
  const [closedFor, setClosedFor] = useState<SetAdminPasswordActionState>(undefined);

  const saved = !!state && "ok" in state && state.ok;

  // Success: a hard navigation, like the login. A soft one would keep the
  // signed-out frame of admin/layout.tsx around the dashboard until a reload.
  useEffect(() => {
    if (state && "ok" in state && state.ok) window.location.assign(state.redirectTo);
  }, [state]);

  const errorState = state && "error" in state && closedFor !== state ? state : null;

  return (
    <form action={action} onSubmit={() => setClosedFor(state)} className="space-y-6">
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
      <SubmitButton blocked={mismatch} busy={saved} />
      {errorState && (
        <AuthToast tone="bad" onClose={() => setClosedFor(state)}>
          {errorState.error}
          {errorState.expired && (
            <>
              {" "}
              <Link href="/admin/forgot-password" className={authTextLinkClass}>
                Neuen Link anfordern
              </Link>
            </>
          )}
        </AuthToast>
      )}
    </form>
  );
}
