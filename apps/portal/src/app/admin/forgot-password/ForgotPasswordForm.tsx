"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AuthToast } from "@/app/(auth)/_components/AuthToast";
import {
  AuthHeader,
  AuthLabel,
  CheckInbox,
  PendingDots,
  authCtaClass,
  authFieldClass,
  authTextLinkClass,
} from "@/app/(auth)/_components/auth-ui";
import {
  requestAdminPasswordResetAction,
  type AdminMailActionState,
} from "../login/actions";

/**
 * Admin "Passwort vergessen". Success and errors come back as action state
 * and are shown in place: a server-action redirect under the admin.* host
 * rewrite hits Next.js #65893 (not-found.tsx until a hard reload).
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={authCtaClass}>
      {pending ? <PendingDots label="Wird gesendet" /> : "Link senden"}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<AdminMailActionState, FormData>(
    requestAdminPasswordResetAction,
    undefined
  );
  const [closedFor, setClosedFor] = useState<AdminMailActionState>(undefined);
  // Controlled, so React's form reset after an error keeps the address.
  const [email, setEmail] = useState("");

  // Same answer for allowlisted and unknown addresses (enumeration defence).
  if (state?.ok) {
    return (
      <CheckInbox backHref="/admin/login">
        Wenn die Adresse für den Admin-Bereich freigeschaltet ist, haben wir
        Ihnen einen Link geschickt, mit dem Sie ein neues Passwort wählen. Er
        gilt 15 Minuten lang und nur einmal.
      </CheckInbox>
    );
  }

  const error = state && !state.ok && closedFor !== state ? state.error : null;

  return (
    <div>
      <AuthHeader title="Passwort zurücksetzen.">
        Geben Sie Ihre Admin-Adresse ein. Wir schicken Ihnen einen Link, mit
        dem Sie ein neues Passwort wählen.
      </AuthHeader>
      <form action={action} onSubmit={() => setClosedFor(state)} className="space-y-6">
        <div>
          <AuthLabel htmlFor="email" className="mb-2">
            E-Mail
          </AuthLabel>
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
        </div>
        <SubmitButton />
      </form>
      <p className="mt-6 text-center text-sm text-fg-secondary">
        Doch wieder eingefallen?{" "}
        <Link href="/admin/login" className={authTextLinkClass}>
          Zur Anmeldung
        </Link>
      </p>
      {error && (
        <AuthToast tone="bad" onClose={() => setClosedFor(state)}>
          {error}
        </AuthToast>
      )}
    </div>
  );
}
