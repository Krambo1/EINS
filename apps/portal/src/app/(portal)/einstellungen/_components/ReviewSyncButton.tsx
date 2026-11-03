"use client";

import { createContext, useActionState, useContext, useEffect, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { syncReviewsNowAction, type ReviewSyncState } from "../actions";

const PLATFORM_LABELS: Record<"google" | "jameda", string> = {
  google: "Google",
  jameda: "Jameda",
};

/** The form "Jetzt abrufen" submits; it sits outside the settings form. */
const FORM_ID = "bewertungen-jetzt-abrufen";

const SyncPending = createContext(false);

/**
 * "Jetzt abrufen" for review syncs (B-20 / F-25 / F-30). The button stands in
 * the "Sternwerte" row of the Bewertungen form, but submits its own form
 * (`form` attribute), so it never saves the settings and the settings never
 * trigger a sync. The result comes back from the action and shows in the
 * toast (no flash cookie, no raw platform error text), so the card keeps its
 * height. Without JavaScript the button still posts its form.
 */
export function ReviewSyncProvider({ children }: { children: ReactNode }) {
  const [state, action, pending] = useActionState<ReviewSyncState, FormData>(syncReviewsNowAction, undefined);
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      showActionFlash({ tone: "good", title: "Sternwerte abgerufen" });
      return;
    }
    const failed = state.platforms.filter((p) => !p.ok).map((p) => PLATFORM_LABELS[p.platform]);
    const done = state.platforms.filter((p) => p.ok).map((p) => PLATFORM_LABELS[p.platform]);
    showActionFlash({
      tone: "bad",
      title: "Nicht abgerufen",
      description: [
        state.message,
        done.length > 0 ? `Aktualisiert: ${done.join(", ")}. Nicht erreichbar: ${failed.join(", ")}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }, [state]);
  return (
    <SyncPending.Provider value={pending}>
      {children}
      <form id={FORM_ID} action={action} hidden />
    </SyncPending.Provider>
  );
}

/** Greyed out while the sync runs, same size (not optimistic, DESIGN.md section 10). */
export function ReviewSyncButton() {
  const pending = useContext(SyncPending);
  return (
    <Button
      type="submit"
      form={FORM_ID}
      variant="outline"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cn(RAISED_CONTROL, CONTROL, "shrink-0 px-3.5")}
    >
      <RefreshCw className="h-4 w-4" aria-hidden />
      Jetzt abrufen
    </Button>
  );
}
