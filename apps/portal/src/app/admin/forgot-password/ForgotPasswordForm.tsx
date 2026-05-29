"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Label, Button } from "@eins/ui";
import {
  requestAdminPasswordResetAction,
  type AdminMailActionState,
} from "../login/actions";

/**
 * Admin "Passwort vergessen"-Formular.
 *
 * Success wird inline gerendert (kein Redirect auf /admin/login/sent).
 * Hintergrund: Next.js #65893 — Server-Action-Redirects auf /admin/*
 * unter admin.*-Subdomain-Rewrite zeigen not-found.tsx bis Hard-Reload.
 * Inline-State umgeht den Bug.
 */

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird gesendet…" : "Link senden"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState<AdminMailActionState, FormData>(
    requestAdminPasswordResetAction,
    undefined
  );

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="space-y-2 rounded-xl border border-tone-good/40 bg-tone-good/10 p-4 text-sm text-fg-primary"
        >
          <p className="font-medium">Posteingang prüfen.</p>
          <p className="text-fg-secondary">
            Wenn die Adresse in der Admin-Allowlist hinterlegt ist, liegt
            jetzt ein Reset-Link im Posteingang. Der Link ist 15 Minuten
            gültig und kann nur einmal verwendet werden.
          </p>
        </div>
        <p className="text-xs text-fg-secondary">
          <Link
            href="/admin/login"
            className="underline-offset-2 hover:underline"
          >
            ← Zurück zur Anmeldung
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
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
      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-md border border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)] p-3 text-sm text-tone-bad"
        >
          {state.error}
        </div>
      )}
      <SubmitButton />
      <p className="text-xs text-fg-secondary">
        <Link
          href="/admin/login"
          className="underline-offset-2 hover:underline"
        >
          ← Zurück zur Anmeldung
        </Link>
      </p>
    </form>
  );
}
