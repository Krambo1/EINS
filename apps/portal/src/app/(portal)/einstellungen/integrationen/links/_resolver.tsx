"use client";

import { useState, useTransition } from "react";
import { Button, Badge } from "@eins/ui";
import {
  resolveLinkingFailureAction,
  ignoreLinkingFailureAction,
} from "../actions";
import { CheckCircle2, X } from "lucide-react";

interface Candidate {
  patientId: string;
  score: number;
  reason: string;
  patient: {
    id: string;
    email: string | null;
    phone: string | null;
    fullName: string | null;
    dob: string | null;
  } | null;
}

export function LinkingResolver({
  failureId,
  candidates,
}: {
  failureId: string;
  candidates: Candidate[];
}) {
  const [pending, startTransition] = useTransition();
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (resolved) {
    return (
      <p className="text-sm text-green-700">
        <CheckCircle2 className="mr-1 inline h-4 w-4" /> Zuordnung gespeichert
      </p>
    );
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      try {
        const r = await action();
        if (r.ok) setResolved(true);
        else setError(r.error ?? "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal.");
      } catch {
        setError("Keine Verbindung. Bitte versuchen Sie es noch einmal.");
      }
    });
  }

  function pick(patientId: string) {
    run(() =>
      resolveLinkingFailureAction({
        failureId,
        pickedPatientId: patientId,
        method: "candidate_pick",
      })
    );
  }

  function ignore() {
    run(() => ignoreLinkingFailureAction({ failureId }));
  }

  return (
    <div className="space-y-2">
      {candidates.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          Keine ähnlichen Patienten gefunden. Sie können ignorieren oder über
          die Patienten-Suche manuell zuordnen.
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <div
              key={c.patientId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {c.patient?.fullName ?? "(unbekannt)"}
                  </span>
                  <Badge tone={c.score >= 0.85 ? "good" : "neutral"}>
                    {Math.round(c.score * 100)} % Übereinstimmung
                  </Badge>
                </div>
                <div className="text-sm text-fg-secondary">
                  {c.patient?.email && <>{c.patient.email} · </>}
                  {c.patient?.phone && <>{c.patient.phone} · </>}
                  {c.reason}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => pick(c.patientId)}
              >
                Das ist die Person
              </Button>
            </div>
          ))}
        </div>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-auto min-h-9 whitespace-normal py-1.5 text-left"
        disabled={pending}
        onClick={ignore}
      >
        <X className="mr-1 h-4 w-4" /> Ignorieren (keine echte Person)
      </Button>
      {error && <p className="text-sm text-tone-bad">{error}</p>}
    </div>
  );
}
