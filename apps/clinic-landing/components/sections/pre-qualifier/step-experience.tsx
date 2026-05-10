"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import { EXPERIENCES, type QuizAction, type QuizState } from "./types";

interface Props {
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
}

export function StepExperience({ state, dispatch }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-xl font-semibold text-brand-fg sm:text-2xl">
        Hatten Sie schon einmal eine ähnliche Behandlung?
      </h3>
      <p className="mt-1 text-brand-fg-muted">
        Hilft uns, das Beratungsgespräch passend für Sie vorzubereiten.
      </p>
      <div className="mt-5">
        <RadioCardGroup
          name="experience"
          ariaLabel="Erfahrung auswählen"
          value={state.experience}
          onValueChange={(v) => dispatch({ type: "set", field: "experience", value: v })}
          options={EXPERIENCES}
          cols={1}
        />
        {state.errors.experience && (
          <p className="mt-2 text-sm text-red-600">{state.errors.experience}</p>
        )}
      </div>
    </div>
  );
}
