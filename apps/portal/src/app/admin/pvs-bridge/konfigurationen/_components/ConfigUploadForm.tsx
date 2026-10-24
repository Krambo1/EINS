"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@eins/ui";
import { publishConfigAction, type ActionResult } from "../actions";

/**
 * Upload a signed config bundle.
 *
 * Two inputs for one job: a file picker for the .json the signing script wrote,
 * and a paste box for when the file is sitting in a chat window rather than on
 * disk. The action prefers the file.
 *
 * There is no editor here on purpose. A config that this page could edit would
 * be a config nobody signed, and an unsigned config is one every agent refuses.
 */
export function ConfigUploadForm({ signingConfigured }: { signingConfigured: boolean }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    publishConfigAction,
    null
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label
            htmlFor="bundleFile"
            className="block text-sm font-medium text-fg-primary"
          >
            Signierte Datei
          </label>
          <input
            id="bundleFile"
            name="bundleFile"
            type="file"
            accept=".json,application/json"
            disabled={!signingConfigured}
            className="block w-full rounded-lg border border-border bg-bg-secondary p-2 text-sm text-fg-primary file:mr-3 file:rounded-md file:border-0 file:bg-bg-primary file:px-3 file:py-1.5 file:text-sm file:text-fg-primary disabled:opacity-50"
          />
          <p className="text-xs text-fg-secondary">
            Die Datei, die <code>config:sign</code> erzeugt hat, zum Beispiel{" "}
            <code>tomedo-db-v4.signed.json</code>.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="bundleText"
            className="block text-sm font-medium text-fg-primary"
          >
            Oder Inhalt einfügen
          </label>
          <textarea
            id="bundleText"
            name="bundleText"
            rows={4}
            disabled={!signingConfigured}
            placeholder='{"schema":"eins-pvs-vendor-config/v1", ...}'
            className="block w-full rounded-lg border border-border bg-bg-secondary p-2 font-mono text-xs text-fg-primary disabled:opacity-50"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton disabled={!signingConfigured} />
        <span className="text-sm text-fg-secondary">
          Nach dem Hochladen steht die Verteilung auf „Aus“.
        </span>
      </div>

      {state && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            state.ok
              ? "border-tone-good text-tone-good"
              : "border-tone-bad text-tone-bad"
          }`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Wird geprüft …" : "Prüfen und hinterlegen"}
    </Button>
  );
}
