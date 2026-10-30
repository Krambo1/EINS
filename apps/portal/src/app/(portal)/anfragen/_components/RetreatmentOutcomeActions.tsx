"use client";

import { startTransition, useState, useTransition } from "react";
import { logRetreatmentCall, restoreRetreatmentAction } from "../../wiederbehandlungen/actions";
import { showActionFlash } from "../../_components/flash-event";
import { OUTCOME_TRACK, outcomeSegment } from "./CallOutcomeActions";
import { useTrackedCall } from "./CallQueueState";

const OUTCOMES = [
  { key: "termin_vereinbart", label: "Termin vereinbart" },
  { key: "nicht_erreicht", label: "Nicht erreicht" },
  { key: "kein_interesse", label: "Kein Interesse" },
] as const;

type Outcome = (typeof OUTCOMES)[number]["key"];

const OFFLINE = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";

/**
 * The result of a call about a Wiederbehandlung, at the foot of its call
 * card: the same switch in the same place as for an Anfrage, one tap saves
 * (logRetreatmentCall), the toast says whose call it was. "Kein Interesse"
 * takes the person off the calendar; the toast offers "Rückgängig" for that,
 * since the list of everyone taken off is gone (it lives on as the filter
 * "Wiederbehandlung ausgeblendet" and on the Anfrage).
 */
export function RetreatmentOutcomeActions({ cycleId, name }: { cycleId: string; name: string }) {
  const [isPending, startPending] = useTransition();
  const [pendingKey, setPendingKey] = useState<Outcome | null>(null);
  const track = useTrackedCall();

  // Not bound to this card: by the time "Rückgängig" is clicked the next
  // patient may be on it and this component gone.
  const undo = () => {
    const fd = new FormData();
    fd.set("id", cycleId);
    startTransition(async () => {
      try {
        const res = await restoreRetreatmentAction(fd);
        showActionFlash(
          res.ok
            ? { tone: "good", title: "Wieder aufgenommen", description: name }
            : { tone: "bad", title: "Nicht gespeichert", description: res.message }
        );
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: OFFLINE });
      }
    });
  };

  const run = (o: (typeof OUTCOMES)[number]) => {
    setPendingKey(o.key);
    const fd = new FormData();
    fd.set("id", cycleId);
    fd.set("outcome", o.key);
    startPending(async () => {
      try {
        // On the call card (CallQueueState) the next patient is up at once and
        // `track` hides this call until the action is back; a failed save
        // brings the patient back. Elsewhere: the action alone, as before.
        const res = await (track ? track(() => logRetreatmentCall(fd)) : logRetreatmentCall(fd));
        if (!res.ok) {
          showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${res.message}` });
        } else if (o.key === "kein_interesse") {
          showActionFlash({
            tone: "good",
            title: "Ausgeblendet",
            description: `${name}: keine Erinnerung, nicht mehr in den Anrufen.`,
            action: { label: "Rückgängig", onClick: undo },
          });
        } else {
          showActionFlash({ tone: "good", title: "Anruf gespeichert", description: `${name}: ${o.label}` });
        }
      } catch {
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${OFFLINE}` });
      } finally {
        setPendingKey(null);
      }
    });
  };

  return (
    <div>
      <div id={`retreatment-outcome-${cycleId}`} className="mb-2 text-[15px] font-medium text-fg-primary">
        Ergebnis des Anrufs
      </div>
      <div
        role="group"
        aria-labelledby={`retreatment-outcome-${cycleId}`}
        aria-busy={isPending}
        className={OUTCOME_TRACK}
      >
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={isPending}
            onClick={() => run(o)}
            className={outcomeSegment(isPending && pendingKey === o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
