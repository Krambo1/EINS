"use client";

import { useState, useTransition } from "react";
import { Button } from "@eins/ui";
import { Check, CalendarCheck, PhoneMissed, Loader2 } from "lucide-react";
import {
  STATUS_TRANSITIONS,
  type CallOutcome,
  type RequestStatus,
} from "@/lib/constants";
import { logCall } from "../[id]/actions";

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
  icon: typeof Check;
  variant: "default" | "secondary" | "outline";
}> = [
  {
    key: "termin",
    outcome: "erreicht",
    status: "termin_vereinbart",
    label: "Termin vereinbart",
    icon: CalendarCheck,
    variant: "default",
  },
  {
    key: "erreicht",
    outcome: "erreicht",
    status: "kontaktiert",
    label: "Erreicht",
    icon: Check,
    variant: "secondary",
  },
  {
    key: "nicht_erreicht",
    outcome: "nicht_erreicht",
    status: "nicht_erreicht",
    label: "Nicht erreicht",
    icon: PhoneMissed,
    variant: "outline",
  },
];

export function CallOutcomeActions({
  requestId,
  currentStatus,
  pvsControlled,
}: {
  requestId: string;
  currentStatus: RequestStatus;
  pvsControlled: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];

  const run = (o: (typeof OUTCOMES)[number]) => {
    setError(null);
    setPendingKey(o.key);
    const fd = new FormData();
    fd.set("id", requestId);
    fd.set("outcome", o.outcome);
    if (!pvsControlled && o.status !== currentStatus && allowed.includes(o.status)) {
      fd.set("statusAfter", o.status);
    }
    startTransition(async () => {
      try {
        await logCall(fd);
        // Erfolg: revalidatePath("/anfragen") in der Action rendert die
        // Warteschlange neu — der nächste Lead wird zur Hero-Karte.
      } catch (e) {
        setError(e instanceof Error ? e.message : "Anruf konnte nicht festgehalten werden.");
        setPendingKey(null);
      }
    });
  };

  return (
    <div>
      <div className="mb-2 text-xs text-fg-tertiary">Anruf festhalten</div>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => {
          const Icon = o.icon;
          const thisPending = isPending && pendingKey === o.key;
          return (
            <Button
              key={o.key}
              size="sm"
              variant={o.variant}
              disabled={isPending}
              onClick={() => run(o)}
            >
              {thisPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              {o.label}
            </Button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-sm text-tone-bad">{error}</p>}
    </div>
  );
}
