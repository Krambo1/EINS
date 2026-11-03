"use client";

import { startTransition } from "react";
import { AlarmClock } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { formatDateTime } from "@/lib/formatting";
import type { FollowupRow } from "@/server/queries/followups";
import { CONTROL, QUIET_CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import { completeFollowup, cancelFollowup, type ActionResult } from "./actions";
import { isPendingId, usePending } from "./_pending";

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

/**
 * An open Wiedervorlage at the top of the Verlauf (Pipedrive's "Focus" above
 * the history, HubSpot's upcoming tasks): when, what for, and the two ways
 * to close it. Optimistic: a tap moves it into the history at once; if the
 * server says no, it comes back and the toast names the patient.
 */
export function PlannedRow({
  requestId,
  name,
  followup,
  canWork,
}: {
  requestId: string;
  name: string;
  followup: FollowupRow;
  canWork: boolean;
}) {
  const { add } = usePending();
  const due = followup.dueAt.getTime() <= Date.now();
  // Planned a moment ago and not confirmed yet: no id to resolve on the server.
  const saving = isPendingId(followup.id);

  // The row is gone while this runs, so the transition is not tied to it.
  const resolve = (
    action: (fd: FormData) => Promise<ActionResult>,
    to: "done" | "cancelled",
    savedTitle: string
  ) => {
    const fd = new FormData();
    fd.set("followupId", followup.id);
    fd.set("requestId", requestId);
    startTransition(async () => {
      add({ at: new Date(), resolve: { followupId: followup.id, to } });
      try {
        const res = await action(fd);
        showActionFlash(
          res.ok
            ? { tone: "good", title: savedTitle, description: name }
            : { tone: "bad", title: "Nicht gespeichert", description: `${name}: ${res.message}` }
        );
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${OFFLINE}` });
      }
    });
  };

  return (
    <li
      className={cn(
        "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 py-3 transition-opacity duration-300",
        saving && "opacity-60"
      )}
    >
      <span aria-hidden className="flex h-5 items-center">
        <AlarmClock className={cn("h-4 w-4", due ? "text-tone-warn" : "text-fg-secondary")} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-[15px] font-medium leading-5 text-fg-primary">
            Wiedervorlage{due && <span> · fällig</span>}
          </p>
          <time className="shrink-0 text-sm leading-5 tabular-nums text-fg-secondary">
            {formatDateTime(followup.dueAt)}
          </time>
        </div>
        {followup.note && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-6 text-fg-primary">{followup.note}</p>
        )}
        {canWork && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => resolve(completeFollowup, "done", "Wiedervorlage erledigt")}
              className={cn(RAISED_CONTROL, CONTROL, "px-4")}
            >
              Erledigt
            </Button>
            <button
              type="button"
              disabled={saving}
              onClick={() => resolve(cancelFollowup, "cancelled", "Wiedervorlage abgebrochen")}
              className={cn(QUIET_CONTROL, "disabled:opacity-50")}
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
