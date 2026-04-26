"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input, Label } from "@eins/ui";
import { finalizeEnrollmentAction, type EnrollState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Wird eingerichtet…" : "Einrichtung abschließen"}
    </Button>
  );
}

function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-tone-warn/40 bg-tone-warn/10 p-4 text-sm text-fg-primary">
        <strong>Wichtig:</strong> Speichern Sie diese Codes jetzt. Jeder Code
        funktioniert genau einmal und ersetzt die App, falls Sie keinen Zugriff
        auf Ihr Handy haben.
      </div>
      <ul className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-bg-secondary p-4 font-mono text-base tabular-nums">
        {codes.map((c) => (
          <li key={c} className="text-center">{c}</li>
        ))}
      </ul>
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Kopiert ✓" : "Codes kopieren"}
        </Button>
        <Button asChild>
          <a href="/dashboard">Zum Portal</a>
        </Button>
      </div>
    </div>
  );
}

export function EnrollForm({
  secret,
  qrDataUrl,
}: {
  secret: string;
  qrDataUrl: string;
}) {
  const [state, action] = useActionState<EnrollState, FormData>(
    finalizeEnrollmentAction,
    undefined
  );

  if (state?.ok) {
    return <BackupCodes codes={state.backupCodes} />;
  }

  return (
    <form action={action} className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">1. Code einscannen</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Öffnen Sie Ihre Authenticator-App (z. B. 1Password, Google
          Authenticator oder Microsoft Authenticator) und scannen Sie diesen Code.
        </p>
        <div className="mt-4 flex justify-center rounded-xl border border-border bg-white p-4">
          <img src={qrDataUrl} alt="QR-Code für TOTP" className="h-48 w-48" />
        </div>
        <p className="mt-3 text-center text-xs text-fg-secondary">
          Manuell eintragen:{" "}
          <span className="font-mono text-fg-primary">{secret}</span>
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="code">
          2. Geben Sie den 6-stelligen Code aus der App ein
        </Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          placeholder="123 456"
          className="h-14 text-center text-2xl tracking-[0.4em] tabular-nums"
          maxLength={12}
        />
        <input type="hidden" name="secret" value={secret} />
      </div>

      {state && !state.ok && (
        <div
          role="alert"
          className="rounded-xl border border-tone-bad/40 bg-tone-bad/10 p-3 text-sm text-fg-primary"
        >
          {state.error}
        </div>
      )}
      <SubmitButton />
    </form>
  );
}
