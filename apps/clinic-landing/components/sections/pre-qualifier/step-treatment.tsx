"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import type { Treatment } from "@/lib/types";
import type { QuizState } from "./types";

interface Props {
  treatment: Treatment;
  state: QuizState;
  onSelect: (value: string) => void;
}

export function StepTreatment({ treatment, state, onSelect }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
        Was möchten Sie behandeln lassen?
      </h3>
      <div className="mt-4">
        <RadioCardGroup
          name="treatment"
          ariaLabel="Behandlungsbereich auswählen"
          value={state.treatment}
          onValueChange={onSelect}
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
