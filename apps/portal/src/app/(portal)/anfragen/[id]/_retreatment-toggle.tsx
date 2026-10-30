"use client";

import { startTransition } from "react";
import { EyeOff, RotateCcw } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { dismissRetreatmentAction, restoreRetreatmentAction } from "../../wiederbehandlungen/actions";
import { newActivity, usePending, usePendingDismissed } from "./_pending";

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

/**
 * Take one Wiederbehandlung off the calendar, or back on: one tap flips the
 * label and the state line at once (optimistic, _pending.tsx) and saves in the
 * background; the toast confirms (and offers "Rückgängig" after taking it
 * off), a failed save flips everything back and says why. This is where
 * someone hidden by mistake comes back, also long after the toast is gone.
 * Both labels share one grid cell, so the button keeps its width.
 */
export function RetreatmentToggle({
  cycleId,
  dismissed: fromServer,
  treatment,
}: {
  cycleId: string;
  dismissed: boolean;
  treatment: string;
}) {
  const dismissed = usePendingDismissed(cycleId, fromServer);
  const { add, actor } = usePending();

  // Also called from the toast's "Rückgängig", so it carries its own transition.
  const save = (dismiss: boolean) => {
    const fd = new FormData();
    fd.set("id", cycleId);
    startTransition(async () => {
      const at = new Date();
      add({
        at,
        retreatment: { cycleId, dismissed: dismiss },
        // The note the server leaves in the Verlauf.
        activities: [
          newActivity(actor, at, "note", `Wiederbehandlung ${treatment}: ${dismiss ? "ausgeblendet" : "wieder aufgenommen"}.`),
        ],
      });
      try {
        const res = await (dismiss ? dismissRetreatmentAction : restoreRetreatmentAction)(fd);
        showActionFlash(
          !res.ok
            ? { tone: "bad", title: "Nicht gespeichert", description: res.message }
            : dismiss
              ? {
                  tone: "good",
                  title: "Ausgeblendet",
                  description: `${treatment}: keine Erinnerung, nicht mehr in den Anrufen.`,
                  action: { label: "Rückgängig", onClick: () => save(false) },
                }
              : { tone: "good", title: "Wieder aufgenommen", description: treatment }
        );
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: OFFLINE });
      }
    });
  };

  const Icon = dismissed ? RotateCcw : EyeOff;
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => save(!dismissed)}
      className={cn(RAISED_CONTROL, CONTROL, "px-4")}
    >
      <Icon className="h-4 w-4" aria-hidden />
      <span className="inline-grid">
        {["Ausblenden", "Wieder aufnehmen"].map((label) => (
          <span
            key={label}
            aria-hidden={label !== (dismissed ? "Wieder aufnehmen" : "Ausblenden")}
            className={cn(
              "col-start-1 row-start-1 whitespace-nowrap",
              label !== (dismissed ? "Wieder aufnehmen" : "Ausblenden") && "invisible"
            )}
          >
            {label}
          </span>
        ))}
      </span>
    </Button>
  );
}

/**
 * Where the cycle stands, as a dot and words. The server sends both lines
 * (taken off the calendar, and the one it has when it is on); the tap on the
 * toggle picks between them at once.
 */
export function RetreatmentStanding({
  cycleId,
  dismissed: fromServer,
  on,
  off,
}: {
  cycleId: string;
  dismissed: boolean;
  on: { dot: string; text: string };
  off: { dot: string; text: string };
}) {
  const dismissed = usePendingDismissed(cycleId, fromServer);
  const s = dismissed ? off : on;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
      {s.text}
    </span>
  );
}
