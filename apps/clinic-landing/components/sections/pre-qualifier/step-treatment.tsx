"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import type { Treatment } from "@/lib/types";
import type { QuizAction, QuizState } from "./types";

interface Props {
  treatment: Treatment;
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
}

export function StepTreatment({ treatment, state, dispatch }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-xl font-semibold text-brand-fg sm:text-2xl">
        Was möchten Sie behandeln lassen?
      </h3>
      <p className="mt-1 text-brand-fg-muted">
        Bitte wählen Sie aus — Mehrfachauswahl besprechen wir gerne im Beratungsgespräch.
      </p>
      <div className="mt-5">
        <RadioCardGroup
          name="treatment"
          ariaLabel="Behandlungsbereich auswählen"
          value={state.treatment}
          onValueChange={(v) => dispatch({ type: "set", field: "treatment", value: v })}
          options={treatment.quiz.treatmentOptions}
          cols={2}
        />
        {state.errors.treatment && (
          <p className="mt-2 text-sm text-red-600">{state.errors.treatment}</p>
        )}
      </div>
    </div>
  );
}
