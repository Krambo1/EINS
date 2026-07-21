"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import { GoogleSignInButton } from "@/app/_components/GoogleSignInButton";
import {
  passwordLoginAction,
  requestMagicLinkAction,
  type LoginActionState,
} from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function LoginForm({
  initialError,
  googleEnabled = false,
}: {
  initialError?: string;
  googleEnabled?: boolean;
}) {
  const [mode, setMode] = useState<"password" | "magic">("password");
  // Kontrolliert, damit React 19s automatischer Form-Reset nach einem
  // fehlgeschlagenen Login die E-Mail nicht mitlöscht (nur das Passwort
  // soll neu eingegeben werden müssen). Gilt für beide Modi, dadurch
  // überlebt die Adresse auch den Wechsel Passwort ↔ E-Mail-Link.
  const [email, setEmail] = useState("");
  const [pwState, pwAction] = useActionState<LoginActionState, FormData>(
    passwordLoginAction,
    initialError ? { ok: false, error: initialError } : undefined
  );
  const [mlkState, mlkAction] = useActionState<LoginActionState, FormData>(
    requestMagicLinkAction,
    undefined
  );

  if (mode === "magic") {
    return (
      <form action={mlkAction} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email-magic">E-Mail-Adresse</Label>
          <Input
            id="email-magic"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="ihre.adresse@praxis.de"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        {mlkState && !mlkState.ok && (
          <div
            role="alert"
            className="rounded-xl border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary"
          >
            {mlkState.error}
          </div>
        )}
        <SubmitButton label="Anmelde-Link senden" pendingLabel="Wird gesendet…" />
        <p className="text-sm text-fg-secondary">
          Wir schicken einen einmaligen Link in Ihre Inbox. Kein Passwort nötig.
        </p>
        <button
          type="button"
          onClick={() => setMode("password")}
          className="text-sm text-fg-secondary underline-offset-2 hover:underline"
        >
          ← Lieber doch mit Passwort anmelden
        </button>
      </form>
    );
  }

  return (
    <form action={pwAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">E-Mail-Adresse</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="ihre.adresse@praxis.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-12 text-base"
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Passwort</Label>
          <Link
            href="/forgot-password"
            className="text-sm text-fg-secondary underline-offset-2 hover:underline"
          >
            Passwort vergessen?
          </Link>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={1}
          className="h-12 text-base"
        />
      </div>
      <label className="flex cursor-pointer select-none items-start gap-3 text-sm text-fg-primary">
        <input
          type="checkbox"
          name="remember"
          value="on"
          className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--accent)]"
        />
        <span>Angemeldet bleiben</span>
      </label>
      {pwState && !pwState.ok && (
        <div
          role="alert"
          className="rounded-xl border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary"
        >
          {pwState.error}
        </div>
      )}
      <SubmitButton label="Anmelden" pendingLabel="Wird geprüft…" />
      <p className="text-xs text-fg-secondary">
        Noch kein Passwort gesetzt?{" "}
        <Link
          href="/forgot-password"
          className="underline-offset-2 hover:underline"
        >
          Über &bdquo;Passwort vergessen&ldquo; einrichten
        </Link>
        .
      </p>
      <div className="flex items-center gap-3 text-sm text-fg-secondary">
        <span className="h-px flex-1 bg-border" />
        <span>oder</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {googleEnabled && (
        <GoogleSignInButton href="/api/auth/google/start" />
      )}
      <button
        type="button"
        onClick={() => setMode("magic")}
        className="w-full rounded-xl border border-border bg-bg-secondary px-4 py-3 text-sm text-fg-primary transition hover:bg-bg-secondary"
      >
        Lieber per E-Mail-Link anmelden
      </button>
    </form>
  );
}
