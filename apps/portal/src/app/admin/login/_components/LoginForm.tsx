"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Label, Button } from "@eins/ui";
import { GoogleSignInButton } from "@/app/_components/GoogleSignInButton";
import {
  adminPasswordLoginAction,
  requestAdminMagicLinkAction,
  type AdminLoginActionState,
  type AdminMailActionState,
} from "../actions";

/**
 * Admin-Login-Formular. Default: Email + Passwort.
 * Toggle ganz unten: "Lieber per Email-Link anmelden" (Magic-Link).
 * Link daneben: "Passwort vergessen?" → /admin/forgot-password.
 *
 * Beide Action-Pfade nutzen `useActionState`. Fehler werden inline gerendert;
 * Magic-Link-Success ebenfalls inline (statt Navigation auf /admin/login/sent).
 * Hintergrund: Next.js #65893 — Server-Action-Redirects auf /admin/* unter
 * admin.*-Subdomain-Rewrite zeigen not-found.tsx bis Hard-Reload.
 */
function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function LoginForm({
  googleEnabled = false,
}: {
  googleEnabled?: boolean;
}) {
  const [mode, setMode] = useState<"password" | "magic">("password");

  const [magicState, magicAction] = useActionState<AdminMailActionState, FormData>(
    requestAdminMagicLinkAction,
    undefined
  );

  const [loginState, loginAction] = useActionState<
    AdminLoginActionState,
    FormData
  >(adminPasswordLoginAction, undefined);

  // Login-Success: harte Browser-Navigation auf /admin statt router.replace +
  // router.refresh. Hintergrund: /admin/login und /admin teilen sich das
  // Admin-Shell-Layout (apps/portal/src/app/admin/layout.tsx), das anhand der
  // Session zwischen "bare" und "chrome" (mit Top-Nav) entscheidet. Eine
  // Soft-Nav würde das pre-Login bare-Rendering des geteilten Layouts
  // konservieren; die Top-Nav erschiene erst nach Hard-Reload.
  // window.location.assign erzwingt einen frischen Document-Request, das Layout
  // rendert serverseitig mit Session durch und die Top-Nav erscheint sofort.
  // Der Next.js #65893-Bug greift nur bei Server-Action-redirect(), nicht bei
  // einer reinen Browser-Navigation.
  useEffect(() => {
    if (loginState?.ok && loginState.redirectTo) {
      window.location.assign(loginState.redirectTo);
    }
  }, [loginState]);

  if (mode === "magic") {
    if (magicState?.ok) {
      return (
        <div
          role="status"
          className="space-y-3 rounded-xl border border-[var(--tone-good-border)] bg-[var(--tone-good-bg)] p-4 text-sm text-fg-primary"
        >
          <p className="font-medium">Posteingang prüfen.</p>
          <p className="text-fg-secondary">
            Wenn die Adresse in der Admin-Allowlist hinterlegt ist, liegt jetzt
            ein Anmeldelink im Posteingang. Der Link ist 15 Minuten gültig.
          </p>
          <button
            type="button"
            onClick={() => setMode("password")}
            className="text-xs text-fg-secondary underline-offset-2 hover:underline"
          >
            ← Zurück zur Passwort-Anmeldung
          </button>
        </div>
      );
    }
    return (
      <form action={magicAction} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email-magic">E-Mail</Label>
          <Input
            id="email-magic"
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
          />
        </div>
        {magicState && !magicState.ok && (
          <div
            role="alert"
            className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad"
          >
            {magicState.error}
          </div>
        )}
        <SubmitButton label="Anmeldelink senden" pendingLabel="Wird gesendet…" />
        <p className="text-xs text-fg-secondary">
          Nur in der Allowlist hinterlegte Admin-Adressen erhalten einen Link.
        </p>
        <button
          type="button"
          onClick={() => setMode("password")}
          className="text-xs text-fg-secondary underline-offset-2 hover:underline"
        >
          ← Lieber doch mit Passwort anmelden
        </button>
      </form>
    );
  }

  return (
    <form action={loginAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">E-Mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Passwort</Label>
          <Link
            href="/admin/forgot-password"
            className="text-xs text-fg-secondary underline-offset-2 hover:underline"
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
        />
      </div>
      <label className="flex cursor-pointer select-none items-start gap-2.5 text-xs text-fg-primary">
        <input
          type="checkbox"
          name="remember"
          value="on"
          className="mt-0.5 h-4 w-4 rounded border-border accent-[var(--accent)]"
        />
        <span>Angemeldet bleiben</span>
      </label>
      {loginState && !loginState.ok && (
        <div
          role="alert"
          className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad"
        >
          {loginState.error}
        </div>
      )}
      <SubmitButton label="Anmelden" pendingLabel="Wird angemeldet…" />
      <p className="text-xs text-fg-secondary">
        Noch kein Passwort gesetzt?{" "}
        <Link
          href="/admin/forgot-password"
          className="underline-offset-2 hover:underline"
        >
          Über &bdquo;Passwort vergessen&ldquo; einrichten
        </Link>
        .
      </p>
      <div className="flex items-center gap-3 text-xs text-fg-secondary">
        <span className="h-px flex-1 bg-border" />
        <span>oder</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      {googleEnabled && (
        <GoogleSignInButton
          href="/admin/login/google/start"
          className="gap-2 rounded-md bg-bg-secondary px-3 py-2 text-xs"
        />
      )}
      <button
        type="button"
        onClick={() => setMode("magic")}
        className="w-full rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-fg-primary transition hover:bg-bg-secondary"
      >
        Lieber per E-Mail-Link anmelden
      </button>
    </form>
  );
}
