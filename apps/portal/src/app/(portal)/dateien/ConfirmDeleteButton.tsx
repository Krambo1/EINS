"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";

/**
 * Delete button for one uploaded file: 44x44 px tap target, danger styling,
 * asks before deleting (the file is gone from storage afterwards) and is
 * disabled while the action runs.
 */
export function ConfirmDeleteButton({ filename }: { filename: string }) {
  const { pending } = useFormStatus();
  // Disabled until hydrated: before that the confirm in onClick does not
  // exist and a click would submit unasked (VD2).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return (
    <button
      type="submit"
      disabled={pending || !hydrated}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (
          !window.confirm(
            `Datei "${filename}" wirklich löschen? Sie ist danach auch für EINS nicht mehr abrufbar.`
          )
        ) {
          e.preventDefault();
        }
      }}
      className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-tone-bad px-3 text-sm font-medium text-tone-bad transition-colors hover:bg-tone-bad hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tone-bad focus-visible:ring-offset-2 disabled:opacity-50"
      aria-label={`Datei löschen: ${filename}`}
      title="Datei löschen"
    >
      <Trash2 className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span className="hidden sm:inline">Löschen</span>
    </button>
  );
}
