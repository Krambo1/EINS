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

  if (resolved) {
    return (
      <p className="text-sm text-green-700">
        <CheckCircle2 className="mr-1 inline h-4 w-4" /> Zuordnung gespeichert
      </p>
    );
  }

  function pick(patientId: string) {
    startTransition(async () => {
      const r = await resolveLinkingFailureAction({
        failureId,
        pickedPatientId: patientId,
        method: "candidate_pick",
      });
      if (r.ok) setResolved(true);
    });
  }

  function ignore() {
    startTransition(async () => {
      const r = await ignoreLinkingFailureAction({ failureId });
      if (r.ok) setResolved(true);
    });
  }

  return (
    <div className="space-y-2">
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine ähnlichen Patienten gefunden. Sie können ignorieren oder über
          die Patienten-Suche manuell zuordnen.
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((c) => (
            <div
              key={c.patientId}
              className="flex items-center justify-between rounded-md border p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {c.patient?.fullName ?? "(unbekannt)"}
                  </span>
                  <Badge
                    tone={c.score >= 0.85 ? "good" : "neutral"}
                    className="text-[10px]"
                  >
                    {Math.round(c.score * 100)} %
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">
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
      <Button size="sm" variant="ghost" disabled={pending} onClick={ignore}>
        <X className="mr-1 h-4 w-4" /> Ignorieren (nicht real)
      </Button>
    </div>
  );
}
