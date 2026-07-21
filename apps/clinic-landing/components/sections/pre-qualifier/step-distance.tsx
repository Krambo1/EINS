"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import { DISTANCE_OPTIONS, type QuizState } from "./types";

interface Props {
  state: QuizState;
  onSelect: (value: string) => void;
}

/** Service-framed distance step (OP flows) — replaces the free-text city field. */
export function StepDistance({ state, onSelect }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
        Wie weit wäre Ihre Anreise zu uns?
      </h3>
      <p className="mt-1 text-sm text-brand-fg-muted">
        Damit wir Beratung und Termine passend für Sie planen können.
      </p>
      <div className="mt-4">
        <RadioCardGroup
          name="distance"
          ariaLabel="Entfernung auswählen"
          value={state.distance}
          onValueChange={onSelect}
          options={DISTANCE_OPTIONS}
          cols={1}
        />
        {state.errors.distance && (
          <p className="mt-2 text-sm text-red-600">{state.errors.distance}</p>
        )}
      </div>
    </div>
  );
}
