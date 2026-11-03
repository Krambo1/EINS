"use client";

import { useState, useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { showActionFlash } from "@/app/(portal)/_components/flash-event";
import { QUIET_CONTROL } from "@/app/(portal)/dashboard/_components/dash-ui";
import { CardBody, CardFoot, SECONDARY_BUTTON, SettingsCard, Status } from "../../_components/settings-ui";
import { ONE_LINE } from "../../_lib/sizes";
import { resolveLinkingFailureAction, ignoreLinkingFailureAction } from "../actions";

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

/**
 * One person from the Praxis-Software the portal could not match: who it is,
 * what the Praxis-Software sent (`children`), the suggested matches, and
 * "Ignorieren" in the foot. A tap takes the card away at once and the toast
 * says what was saved; if the server refuses, the card comes back with the
 * reason in the toast (DESIGN.md section 10, optimistic). The actions and
 * their checks are unchanged.
 */
export function LinkingCard({
  failureId,
  name,
  meta,
  candidates,
  children,
}: {
  failureId: string;
  name: string;
  meta: string;
  candidates: Candidate[];
  children: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState(false);

  if (hidden) return null;

  function run(done: string, action: () => Promise<{ ok: boolean; error?: string }>) {
    setHidden(true);
    startTransition(async () => {
      let error: string | null = null;
      try {
        const r = await action();
        if (!r.ok) error = r.error ?? "Speichern hat nicht geklappt. Bitte versuchen Sie es noch einmal.";
      } catch {
        error = "Keine Verbindung. Bitte versuchen Sie es noch einmal.";
      }
      if (error) {
        setHidden(false);
        showActionFlash({ tone: "bad", title: "Nicht gespeichert", description: error });
      } else {
        showActionFlash({ tone: "good", title: done, description: name });
      }
    });
  }

  function pick(patientId: string) {
    run("Zuordnung gespeichert", () =>
      resolveLinkingFailureAction({ failureId, pickedPatientId: patientId, method: "candidate_pick" })
    );
  }

  function ignore() {
    run("Eintrag ignoriert", () => ignoreLinkingFailureAction({ failureId }));
  }

  return (
    <SettingsCard
      id={`eintrag-${failureId}`}
      title={<span className={cn(ONE_LINE, "block")}>{name}</span>}
      action={
        <span className="text-sm text-fg-secondary">
          {candidates.length === 1 ? "1 Vorschlag" : `${candidates.length} Vorschläge`}
        </span>
      }
    >
      <CardBody className="space-y-4 pt-1">
        <p className={cn(ONE_LINE, "text-sm leading-5 text-fg-secondary")}>{meta}</p>
        {children}
        {candidates.length === 0 ? (
          <p className="text-[15px] leading-6 text-fg-primary">
            Keine ähnlichen Patienten gefunden. Sie können ignorieren oder über die Patienten-Suche manuell
            zuordnen.
          </p>
        ) : (
          <ul className="border-b border-border [&>li]:border-t [&>li]:border-border">
            {candidates.map((c) => (
              // The Werbekonten row's anatomy: who, a dot and how well it
              // matches, the button at the end (below lg on its own line).
              <li key={c.patientId} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0 flex-1">
                  <p className={cn(ONE_LINE, "text-[15px] font-medium leading-6 text-fg-primary")}>
                    {c.patient?.fullName ?? "(unbekannt)"}
                  </p>
                  <p className="break-words text-sm leading-5 text-fg-secondary">
                    {c.patient?.email && <>{c.patient.email} · </>}
                    {c.patient?.phone && <>{c.patient.phone} · </>}
                    {c.reason}
                  </p>
                  <div className="mt-1 flex min-h-6 items-center">
                    <Status tone={c.score >= 0.85 ? "good" : "none"}>{Math.round(c.score * 100)} % Übereinstimmung</Status>
                  </div>
                </div>
                <div className="flex w-full lg:w-auto">
                  <Button
                    variant="outline"
                    className={SECONDARY_BUTTON}
                    disabled={pending}
                    aria-busy={pending}
                    onClick={() => pick(c.patientId)}
                  >
                    Das ist die Person
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <CardFoot
        start={
          <button type="button" className={cn(QUIET_CONTROL, "-ml-2.5")} disabled={pending} onClick={ignore}>
            <X className="h-4 w-4" aria-hidden />
            Ignorieren (keine echte Person)
          </button>
        }
      >
        {null}
      </CardFoot>
    </SettingsCard>
  );
}
