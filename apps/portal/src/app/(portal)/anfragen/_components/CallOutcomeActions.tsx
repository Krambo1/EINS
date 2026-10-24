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

// Zweistufig (C-30): Der erste Klick wählt das Ergebnis, erst "Speichern"
// schreibt. Jeder gespeicherte Anruf zählt als Kontaktversuch und lässt sich
// nicht zurücknehmen, ein Fehlklick am Handy darf also nichts auslösen.

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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
  const selected = OUTCOMES.find((o) => o.key === selectedKey) ?? null;

  const run = (o: (typeof OUTCOMES)[number]) => {
    setError(null);
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
        const res = await logCall(fd);
        // Erfolg: revalidatePath("/anfragen") in der Action rendert die
        // Warteschlange neu, der nächste Lead wird zur Hero-Karte.
        if (res.ok) {
          setSelectedKey(null);
        } else {
          setError(res.message);
          setPendingKey(null);
        }
      } catch {
        setError("Keine Verbindung. Bitte versuchen Sie es noch einmal.");
        setPendingKey(null);
      }
    });
  };

  return (
    <div>
      <div className="mb-2 text-sm font-medium text-fg-primary">Anruf protokollieren</div>
      <div className="flex flex-wrap gap-2">
        {OUTCOMES.map((o) => {
          const Icon = o.icon;
          const thisPending = isPending && pendingKey === o.key;
          const isSelected = selectedKey === o.key;
          return (
            <Button
              key={o.key}
              size="sm"
              variant={selected && !isSelected ? "outline" : o.variant}
              disabled={isPending}
              aria-pressed={isSelected}
              onClick={() => {
                setError(null);
                setSelectedKey(isSelected ? null : o.key);
              }}
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
      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-primary">
            Anruf als „{selected.label}“ speichern? Das zählt als Kontaktversuch.
          </span>
          <Button size="sm" disabled={isPending} onClick={() => run(selected)}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Speichern
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => setSelectedKey(null)}
          >
            Abbrechen
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-tone-bad">{error}</p>}
    </div>
  );
}
