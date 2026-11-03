"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AuthToast } from "../_components/AuthToast";
import {
  AuthBody,
  AuthField,
  AuthHeader,
  CheckInbox,
  PendingStatus,
  authFieldClass,
  authPrimaryClass,
  authQuietClass,
} from "../_components/auth-ui";
import {
  requestPasswordResetAction,
  type LoginActionState,
} from "../login/actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        data-auth-primary
        disabled={pending}
        aria-busy={pending}
        className={authPrimaryClass}
      >
        Link senden
      </button>
      <PendingStatus pending={pending} label="Wird gesendet" />
    </>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<LoginActionState, FormData>(
    requestPasswordResetAction,
    undefined
  );
  const [closedFor, setClosedFor] = useState<LoginActionState>(undefined);
  // Controlled, so React's form reset after an error keeps the address.
  const [email, setEmail] = useState("");

  // Same answer for known and unknown addresses (enumeration defence).
  if (state?.ok) {
    return (
      <CheckInbox>
        Wenn die Adresse bei uns hinterlegt ist, haben wir Ihnen einen Link
        geschickt, mit dem Sie ein neues Passwort wählen. Er gilt 15 Minuten
        lang und nur einmal.
      </CheckInbox>
    );
  }

  const error = state && !state.ok && closedFor !== state ? state.error : null;

  return (
    <div>
      <AuthHeader title="Passwort zurücksetzen" />
      <AuthBody>
        <form action={action} onSubmit={() => setClosedFor(state)} className="space-y-4">
          <AuthField label="E-Mail" htmlFor="email">
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username email"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authFieldClass}
            />
          </AuthField>
          <SubmitButton />
        </form>
        <Link href="/login" className={authQuietClass}>
          Zur Anmeldung
        </Link>
      </AuthBody>
      {error && (
        <AuthToast tone="bad" onClose={() => setClosedFor(state)}>
          {error}
        </AuthToast>
      )}
    </div>
  );
}
