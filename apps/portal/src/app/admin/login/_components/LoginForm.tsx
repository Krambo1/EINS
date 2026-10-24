"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { GoogleSignInButton } from "@/app/_components/GoogleSignInButton";
import { AuthToast } from "@/app/(auth)/_components/AuthToast";
import { PasswordInput } from "@/app/(auth)/_components/PasswordInput";
import {
  Accent,
  AuthDivider,
  AuthHeader,
  AuthLabel,
  CheckInbox,
  PendingDots,
  authButtonClass,
  authCtaClass,
  authFieldClass,
  authTextLinkClass,
} from "@/app/(auth)/_components/auth-ui";
import {
  adminPasswordLoginAction,
  requestAdminMagicLinkAction,
  type AdminLoginActionState,
  type AdminMailActionState,
} from "../actions";

const LINK_FORM_ID = "eins-admin-login-link";

function SubmitButton({ label, busy }: { label: string; busy: boolean }) {
  const { pending } = useFormStatus();
  const waiting = pending || busy;
  return (
    <button type="submit" disabled={waiting} aria-busy={waiting} className={authCtaClass}>
      {waiting ? (
        <PendingDots label="Wird geprüft" />
      ) : (
        <>
          {label}
          <ArrowRight aria-hidden className="h-4 w-4" />
        </>
      )}
    </button>
  );
}

/**
 * Admin sign-in, the same flow as the clinic login (/login): e-mail first,
 * then the password field slides in. Step one never talks to the server and
 * the second step looks the same for every address, so nothing reveals
 * which addresses are on the admin allowlist. The e-mail link is its own
 * small form (#eins-admin-login-link) that posts `email` only.
 *
 * Results come back as action state and are shown in place, never via a
 * server-action redirect: under the admin.* host rewrite those hit Next.js
 * #65893 (not-found.tsx until a hard reload).
 */
export function LoginForm({
  initialError,
  initialNotice,
  googleEnabled = false,
}: {
  initialError?: string;
  initialNotice?: string;
  googleEnabled?: boolean;
}) {
  const [step, setStep] = useState<"email" | "password">("email");
  // Controlled, so React's form reset after a failed attempt keeps the address.
  const [email, setEmail] = useState("");
  const [initialState] = useState<AdminLoginActionState>(() =>
    initialError ? { ok: false, error: initialError } : undefined
  );
  const [pwState, pwAction] = useActionState<AdminLoginActionState, FormData>(
    adminPasswordLoginAction,
    initialState
  );
  const [linkState, linkAction, linkPending] = useActionState<AdminMailActionState, FormData>(
    requestAdminMagicLinkAction,
    undefined
  );

  // Which request ran last decides which result shows. Closed results stay
  // hidden; every new result is a new object, so it shows again.
  const [lastSource, setLastSource] = useState<"pw" | "link" | null>(null);
  const [closed, setClosed] = useState<unknown[]>([]);
  const hideCurrent = () => setClosed((c) => [...c, pwState, linkState, "notice"]);
  const [editedAfter, setEditedAfter] = useState<unknown>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const signedIn = !!pwState?.ok;
  const current = lastSource === "link" ? linkState : pwState;
  const toastError = current && !current.ok && !closed.includes(current) ? current.error : null;
  const toastNotice =
    !toastError && lastSource === null && initialNotice && !closed.includes("notice")
      ? initialNotice
      : null;
  const pwFailed =
    lastSource === "pw" && !!pwState && !pwState.ok && pwState !== initialState;

  // Success: a hard navigation, not router.push. /admin/login and /admin share
  // admin/layout.tsx, which picks frame or nav chrome by session; a soft
  // navigation would keep the signed-out frame until a reload.
  useEffect(() => {
    if (pwState?.ok) window.location.assign(pwState.redirectTo);
  }, [pwState]);

  // After a wrong password React clears the field; put the cursor back in it.
  useEffect(() => {
    if (pwState && !pwState.ok && pwState !== initialState) passwordRef.current?.focus();
  }, [pwState, initialState]);

  // Same screen for every address (enumeration defence).
  if (lastSource === "link" && linkState?.ok && !closed.includes(linkState)) {
    return (
      <CheckInbox onBack={hideCurrent}>
        Wenn die Adresse für den Admin-Bereich freigeschaltet ist, haben wir
        Ihnen einen Anmeldelink geschickt. Er gilt 15 Minuten lang und nur
        einmal.
      </CheckInbox>
    );
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (step === "email") {
      // Native validation has already checked the address. No request here.
      e.preventDefault();
      setStep("password");
      return;
    }
    hideCurrent();
    setLastSource("pw");
  };

  const emailEmpty = email.trim() === "";

  return (
    <div>
      <AuthHeader
        title={
          <>
            Willkommen <Accent>zurück.</Accent>
          </>
        }
      >
        Melden Sie sich im Admin-Bereich an.
      </AuthHeader>

      {googleEnabled && (
        <>
          <GoogleSignInButton
            href="/admin/login/google/start"
            className={`${authButtonClass} py-0`}
          />
          <AuthDivider />
        </>
      )}

      <form action={pwAction} onSubmit={onSubmit} className="space-y-6">
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

        {step === "password" && (
          <div className="animate-fade-in space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <AuthLabel htmlFor="password">Passwort</AuthLabel>
                <Link href="/admin/forgot-password" className={`${authTextLinkClass} text-sm`}>
                  Passwort vergessen?
                </Link>
              </div>
              <PasswordInput
                ref={passwordRef}
                id="password"
                name="password"
                autoComplete="current-password"
                required
                autoFocus
                aria-invalid={pwFailed && editedAfter !== pwState}
                onInput={() => setEditedAfter(pwState)}
              />
            </div>
            <label className="flex w-fit cursor-pointer select-none items-center gap-2.5 text-base text-fg-primary">
              <input
                type="checkbox"
                name="remember"
                value="on"
                className="h-4 w-4 rounded accent-[#58BAB5]"
              />
              Angemeldet bleiben
            </label>
          </div>
        )}

        <SubmitButton label={step === "email" ? "Weiter" : "Anmelden"} busy={signedIn} />
      </form>

      <p className="mt-6 text-center text-sm text-fg-secondary">
        Kein Passwort?{" "}
        <button
          type="submit"
          form={LINK_FORM_ID}
          disabled={linkPending || emailEmpty || signedIn}
          onClick={() => {
            hideCurrent();
            setLastSource("link");
          }}
          className={authTextLinkClass}
        >
          {linkPending ? "Wird gesendet…" : "Anmeldelink per E-Mail senden"}
        </button>
      </p>

      {/* Sibling form for the link request: only the address goes along. */}
      <form id={LINK_FORM_ID} action={linkAction} hidden>
        <input type="hidden" name="email" value={email} />
      </form>

      {toastError && (
        <AuthToast tone="bad" onClose={hideCurrent}>
          {toastError}
        </AuthToast>
      )}
      {toastNotice && (
        <AuthToast tone="good" onClose={hideCurrent}>
          {toastNotice}
        </AuthToast>
      )}
    </div>
  );
}
