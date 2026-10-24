"use client";

import { useActionState } from "react";
import {
  requestAnimationCustomizationAction,
  type RequestCustomizationState,
} from "./actions";
import { RequestSubmitButton } from "./RequestSubmitButton";

/**
 * "Anpassung anfordern" form. Same markup as before; a failed request shows
 * a German message under the button and keeps the typed note (F-01).
 */
export function RequestCustomizationForm({
  libraryId,
  label,
}: {
  libraryId: string;
  label: string;
}) {
  const [state, action] = useActionState<RequestCustomizationState, FormData>(
    requestAnimationCustomizationAction,
    undefined
  );
  const failed = state && !state.ok ? state : null;
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="libraryId" value={libraryId} />
      <label
        htmlFor={`note-${libraryId}`}
        className="block text-sm font-medium text-fg-primary"
      >
        Was möchten Sie ändern? (optional)
      </label>
      <textarea
        id={`note-${libraryId}`}
        name="note"
        rows={3}
        maxLength={1000}
        defaultValue={failed?.note ?? ""}
        placeholder="Logo, Farbe, Stimme …"
        className="w-full rounded-lg border border-border bg-bg-primary p-2 text-sm"
      />
      <RequestSubmitButton label={label} />
      {failed && (
        <p className="text-sm text-tone-bad" role="alert">
          {failed.error}
        </p>
      )}
    </form>
  );
}
