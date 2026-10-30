"use client";

import { useState, useTransition } from "react";
import { cn } from "@eins/ui";
import {
  STATUS_TRANSITIONS,
  type CallOutcome,
  type RequestStatus,
} from "@/lib/constants";
import { logCall } from "../[id]/actions";
import { showActionFlash } from "../../_components/flash-event";
import { useTrackedCall } from "./CallQueueState";

// Ein Klick speichert (Karam, 2026-10-29: keine Rückfrage mehr; ersetzt den
// zweistufigen Ablauf aus C-30). Jeder gespeicherte Anruf zählt als
// Kontaktversuch und lässt sich nicht zurücknehmen. Bestätigung und Fehler
// kommen als Toast: die Karte behält ihre Größe, der Schalter seinen Platz
// (DESIGN.md Abschnitt 10, "Fixed size").

/**
 * Ein-Klick-Anrufausgang direkt auf der "Jetzt anrufen"-Karte. Ruft die
 * bestehende `logCall`-Action auf (kein neuer Schreibpfad): protokolliert den
 * Anruf, stempelt die erste Reaktionszeit und setzt — wenn erlaubt — den
 * passenden Folgestatus. Sobald der Status `neu` verlässt, fällt der Lead in
 * der Warteschlange nach unten und der nächste Anruf rückt nach.
 *
 * Der Statuswechsel wird nur mitgesendet, wenn er ein erlaubter Übergang ist
 * UND der Lead nicht PVS-gesteuert ist (dann besitzt die PVS den Lebenszyklus).
 * Andernfalls wird nur der Anruf festgehalten — die Action würde einen
 * unerlaubten oder PVS-gesperrten Wechsel ohnehin serverseitig ablehnen.
 */
const OUTCOMES: ReadonlyArray<{
  key: string;
  outcome: CallOutcome;
  status: RequestStatus;
  label: string;
}> = [
  {
    key: "termin",
    outcome: "erreicht",
    status: "termin_vereinbart",
    label: "Termin vereinbart",
  },
  {
    key: "erreicht",
    outcome: "erreicht",
    status: "kontaktiert",
    label: "Erreicht",
  },
  {
    key: "nicht_erreicht",
    outcome: "nicht_erreicht",
    status: "nicht_erreicht",
    label: "Nicht erreicht",
  },
];

/**
 * The switch's track and segments, shared with RetreatmentOutcomeActions.
 * Phone: three equal thirds, labels may wrap (two lines fit in the control
 * height, so the track has one height). From sm each segment is as wide as
 * its words, so "Termin vereinbart" stays on one line in a half-width card.
 * Segments are controls (--control-h, control radius), the track 4 px
 * around them one radius step up, so the corners share a centre (DESIGN.md
 * section 5).
 */
export const OUTCOME_TRACK =
  "elev-inset grid grid-cols-3 gap-1 rounded-[var(--r-panel)] bg-[var(--well)] p-1 sm:inline-grid sm:grid-cols-[repeat(3,auto)]";

export function outcomeSegment(pending: boolean): string {
  return cn(
    "flex h-[var(--control-h)] items-center justify-center rounded-[var(--r-control)] px-2 text-center text-sm font-medium leading-tight transition-[color,background-color,box-shadow,opacity] duration-300 sm:px-3.5",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
    pending
      ? "elev-raised bg-[var(--surface-raised)] text-fg-primary"
      : "text-fg-secondary enabled:hover:text-fg-primary disabled:opacity-50"
  );
}

export function CallOutcomeActions({
  requestId,
  name,
  currentStatus,
  pvsControlled,
}: {
  requestId: string;
  /** Patient name for the toast: by then the next patient is on the card. */
  name: string;
  currentStatus: RequestStatus;
  pvsControlled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const track = useTrackedCall();

  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];

  const run = (o: (typeof OUTCOMES)[number]) => {
    setPendingKey(o.key);
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("outcome", o.outcome);
    if (!pvsControlled && o.status !== currentStatus && allowed.includes(o.status)) {
      fd.set("statusAfter", o.status);
      fd.set("expectedStatus", currentStatus);
    }
    startTransition(async () => {
      try {
        // Auf der Anruf-Karte (CallQueueState) rückt der nächste Patient
        // sofort nach, `track` blendet diesen Anruf aus, bis die Action
        // zurück ist. Schlägt sie fehl, kommt er zurück auf die Karte.
        // Ohne die Karte: wie zuvor, die Action allein.
        const res = await (track ? track(() => logCall(fd)) : logCall(fd));
        // Erfolg: revalidatePath("/anfragen") in der Action rendert die
        // Warteschlange neu, der nächste Lead wird zur Hero-Karte.
        if (res.ok) {
          showActionFlash({ tone: "good", title: "Anruf gespeichert", description: `${name}: ${o.label}` });
        } else {
          showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: `${name}: ${res.message}` });
        }
      } catch {
        showActionFlash({
          tone: "bad",
          title: "Nicht gespeichert",
          description: `${name}: Keine Verbindung. Bitte versuchen Sie es noch einmal.`,
        });
      } finally {
        setPendingKey(null);
      }
    });
  };

  // A switch like the period switch on the Übersicht: the track is pressed
  // into the card, the outcome being saved is raised while it saves. One tap
  // saves. It sits at the foot of the patient's own card, under that
  // patient's call button, so it is clear whose call it logs. Nothing
  // appears or grows here: the result comes as a toast.
  return (
    <div>
      <div id={`call-outcome-${requestId}`} className="mb-2 text-[15px] font-medium text-fg-primary">
        Ergebnis des Anrufs
      </div>
      <div
        role="group"
        aria-labelledby={`call-outcome-${requestId}`}
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
