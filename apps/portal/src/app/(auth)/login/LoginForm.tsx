"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@eins/ui";
import { GoogleSignInButton } from "@/app/_components/GoogleSignInButton";
import { CHECKBOX } from "@/app/(portal)/einstellungen/_lib/sizes";
import { AuthToast } from "../_components/AuthToast";
import { PasswordInput } from "../_components/PasswordInput";
import {
  AuthBody,
  AuthDivider,
  AuthField,
  PendingStatus,
  authFieldClass,
  authPrimaryClass,
  authQuietClass,
  authSecondaryClass,
  authTextLinkClass,
} from "../_components/auth-ui";
import {
  passwordLoginAction,
  requestMagicLinkAction,
  type LoginActionState,
} from "./actions";

const LINK_FORM_ID = "eins-login-link";

/** Greys out while the request runs, same size, same label. */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" disabled={pending} aria-busy={pending} data-auth-primary className={authPrimaryClass}>
        {label}
      </button>
      <PendingStatus pending={pending} label="Wird geprüft" />
    </>
  );
}

/**
 * Two steps: e-mail first, then the password field under it. Step one never
 * talks to the server and the second step looks the same for every address,
 * so nothing reveals whether an account exists. The e-mail link is offered
 * under the button in both steps, Google under a hairline below.
 *
 * Contract with ./actions.ts is unchanged: the password form posts `email`,
 * `password`, `remember` ("on") and, if present, the hidden `next`. The link
 * request is its own small form (#eins-login-link) that posts `email` only,
 * so a typed password never travels with it.
 */
export function LoginForm({
  initialError,
  googleEnabled = false,
  next = null,
}: {
  initialError?: string;
  googleEnabled?: boolean;
  /** Validated return path (safeNextPath) carried through the password login. */
  next?: string | null;
}) {
  const [step, setStep] = useState<"email" | "password">("email");
  // Kontrolliert, damit React 19s automatischer Form-Reset nach einem
  // fehlgeschlagenen Login die E-Mail nicht mitlöscht (nur das Passwort
  // soll neu eingegeben werden müssen).
  const [email, setEmail] = useState("");
  const [initialState] = useState<LoginActionState>(() =>
    initialError ? { ok: false, error: initialError } : undefined
  );
  const [pwState, pwAction] = useActionState<LoginActionState, FormData>(
    passwordLoginAction,
    initialState
  );
  const [linkState, linkAction, linkPending] = useActionState<LoginActionState, FormData>(
    requestMagicLinkAction,
    undefined
  );

  // Which request ran last decides which result the toast shows. Results
  // that were closed (or are older than the request now running) stay hidden;
  // every new result is a new object, so it shows again.
  const [lastSource, setLastSource] = useState<"pw" | "link" | null>(null);
  const [closed, setClosed] = useState<unknown[]>([]);
  const hideCurrent = () => setClosed((c) => [...c, pwState, linkState]);
  const [editedAfter, setEditedAfter] = useState<unknown>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const current = lastSource === "link" ? linkState : pwState;
  const toastError = current && !current.ok && !closed.includes(current) ? current.error : null;
  const pwFailed =
    lastSource === "pw" && !!pwState && !pwState.ok && pwState !== initialState;

  // After a wrong password React clears the field; put the cursor back in it.
  useEffect(() => {
    if (pwState && !pwState.ok && pwState !== initialState) passwordRef.current?.focus();
  }, [pwState, initialState]);

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
    <AuthBody>
      <form action={pwAction} onSubmit={onSubmit} className="space-y-4">
        {next && <input type="hidden" name="next" value={next} />}

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

        {step === "password" && (
          <>
            <AuthField
              label="Passwort"
              htmlFor="password"
              aside={
                <Link href="/forgot-password" className={authTextLinkClass}>
                  Passwort vergessen?
                </Link>
              }
            >
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
            </AuthField>
            <label className="flex w-fit cursor-pointer select-none items-center gap-3 text-[15px] leading-6 text-fg-primary">
              <input type="checkbox" name="remember" value="on" className={cn(CHECKBOX, "mt-0")} />
              Angemeldet bleiben
            </label>
          </>
        )}

        {/* Never disabled for an empty field: the browser's own check names
            the problem, a greyed-out button does not. */}
        <SubmitButton label={step === "email" ? "Weiter" : "Anmelden"} />
      </form>

      <button
        type="submit"
        form={LINK_FORM_ID}
        disabled={linkPending || emailEmpty}
        aria-busy={linkPending}
        onClick={() => {
          hideCurrent();
          setLastSource("link");
        }}
        className={authQuietClass}
      >
        Anmeldelink per E-Mail senden
      </button>
      <PendingStatus pending={linkPending} label="Wird gesendet" />

      {/* Sibling form for the link request: only the address goes along. */}
      <form id={LINK_FORM_ID} action={linkAction} hidden>
        <input type="hidden" name="email" value={email} />
      </form>

      {googleEnabled && (
        <>
          <AuthDivider />
          <GoogleSignInButton href="/api/auth/google/start" className={cn(authSecondaryClass, "py-0")} />
        </>
      )}

      {toastError && (
        <AuthToast tone="bad" onClose={hideCurrent}>
          {toastError}
        </AuthToast>
      )}
    </AuthBody>
  );
}
