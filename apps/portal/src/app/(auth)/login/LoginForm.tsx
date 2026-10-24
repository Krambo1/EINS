"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { GoogleSignInButton } from "@/app/_components/GoogleSignInButton";
import { AuthToast } from "../_components/AuthToast";
import { PasswordInput } from "../_components/PasswordInput";
import {
  AuthDivider,
  AuthLabel,
  PendingDots,
  authButtonClass,
  authCtaClass,
  authFieldClass,
  authTextLinkClass,
} from "../_components/auth-ui";
import {
  passwordLoginAction,
  requestMagicLinkAction,
  type LoginActionState,
} from "./actions";

const LINK_FORM_ID = "eins-login-link";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={authCtaClass}
    >
      {pending ? (
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
 * Two steps: e-mail first, then the password field slides in under it.
 * Step one never talks to the server and the second step looks the same for
 * every address, so nothing reveals whether an account exists. Google sits
 * on top, the e-mail link is offered under the button in both steps.
 *
 * Contract with ./actions.ts is unchanged: the password form posts `email`,
 * `password`, `remember` ("on") and, if present, the hidden `next`. The link
 * request is its own small form (#eins-login-link) that posts `email` only,
 * so a typed password never travels with it.
 */
export function LoginForm({
  initialError,
  initialNotice,
  googleEnabled = false,
  next = null,
}: {
  initialError?: string;
  initialNotice?: string;
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
  const hideCurrent = () => setClosed((c) => [...c, pwState, linkState, "notice"]);
  const [editedAfter, setEditedAfter] = useState<unknown>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const current = lastSource === "link" ? linkState : pwState;
  const toastError = current && !current.ok && !closed.includes(current) ? current.error : null;
  const toastNotice =
    !toastError && lastSource === null && initialNotice && !closed.includes("notice")
      ? initialNotice
      : null;
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
    <div>
      {googleEnabled && (
        <>
          <GoogleSignInButton
            href="/api/auth/google/start"
            className={`${authButtonClass} py-0`}
          />
          <AuthDivider />
        </>
      )}

      <form action={pwAction} onSubmit={onSubmit} className="space-y-6">
        {next && <input type="hidden" name="next" value={next} />}

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
            placeholder="name@praxis.de"
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
                <Link href="/forgot-password" className={`${authTextLinkClass} text-sm`}>
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

        {/* Never disabled for an empty field: the browser's own check names
            the problem, a greyed-out button does not. */}
        <SubmitButton label={step === "email" ? "Weiter" : "Anmelden"} />
      </form>

      <p className="mt-6 text-center text-sm text-fg-secondary">
        Kein Passwort?{" "}
        <button
          type="submit"
          form={LINK_FORM_ID}
          disabled={linkPending || emailEmpty}
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
