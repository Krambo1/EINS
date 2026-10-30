"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@eins/ui";
import {
  PATIENT_FEEDBACK_STATUSES,
  PATIENT_FEEDBACK_STATUS_LABELS,
  type PatientFeedbackStatus,
} from "@/lib/constants";
import { showActionFlash } from "../../../_components/flash-event";
import { saveFeedbackStatusAction } from "../actions";

/** Dot colour per status, as in `FeedbackStatus`. */
const DOT: Record<PatientFeedbackStatus, string> = {
  neu: "bg-tone-warn",
  gesehen: "bg-accent",
  beantwortet: "bg-tone-good",
  geschlossen: "bg-fg-tertiary",
};

/**
 * The four statuses as one switch (the period switch's pressed track, the
 * current status raised): one tap saves, the toast confirms and offers
 * "Rückgängig" (Help Scout's undo after an action), no confirm dialog. Two
 * by two on the phone, four in a row from sm. A failed save puts the switch
 * back and says why in a toast.
 */
export function FeedbackStatusSwitch({
  feedbackId,
  status,
}: {
  feedbackId: string;
  status: PatientFeedbackStatus;
}) {
  const [current, setCurrent] = useState(status);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);

  // The page re-renders after a save; follow it unless a tap is underway.
  useEffect(() => {
    if (!saving.current) setCurrent(status);
  }, [status]);

  function save(next: PatientFeedbackStatus, previous: PatientFeedbackStatus, undo = false) {
    setCurrent(next);
    saving.current = true;
    const fd = new FormData();
    fd.set("id", feedbackId);
    fd.set("status", next);
    startTransition(async () => {
      try {
        const res = await saveFeedbackStatusAction(fd);
        if (res.ok) {
          showActionFlash({
            tone: "good",
            title: undo ? "Rückgängig gemacht" : "Status gespeichert",
            description: `Jetzt: ${PATIENT_FEEDBACK_STATUS_LABELS[next]}`,
            action: undo ? undefined : { label: "Rückgängig", onClick: () => save(previous, next, true) },
          });
        } else {
          setCurrent(previous);
          showActionFlash({ tone: "bad", title: "Status nicht gespeichert", description: res.error });
        }
      } catch {
        setCurrent(previous);
        showActionFlash({
          tone: "bad",
          title: "Keine Verbindung",
          description: "Der Status wurde nicht gespeichert. Prüfen Sie die Verbindung und tippen Sie noch einmal.",
        });
      } finally {
        saving.current = false;
      }
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Status"
      aria-busy={pending}
      className="elev-inset grid grid-cols-2 gap-1 rounded-[var(--r-panel)] bg-[var(--well)] p-1 sm:grid-cols-4"
    >
      {PATIENT_FEEDBACK_STATUSES.map((s) => {
        const on = s === current;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && save(s, current)}
            className={cn(
              "inline-flex h-[var(--control-h)] items-center justify-center gap-2 rounded-[var(--r-control)] px-3 text-sm font-medium transition-[background-color,box-shadow,color] duration-300 ease-expo",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
              on
                ? "elev-raised bg-[var(--surface-raised)] text-fg-primary"
                : "text-fg-secondary hover:text-fg-primary"
            )}
          >
            <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", DOT[s], !on && "opacity-60")} />
            {PATIENT_FEEDBACK_STATUS_LABELS[s]}
          </button>
        );
      })}
    </div>
  );
}
