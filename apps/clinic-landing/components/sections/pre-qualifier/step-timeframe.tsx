"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import { TIMEFRAMES, type QuizState } from "./types";

interface Props {
  state: QuizState;
  onSelect: (value: string) => void;
}

export function StepTimeframe({ state, onSelect }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
        Wann hätten Sie gerne den ersten Termin?
      </h3>
      <p className="mt-1 text-sm text-brand-fg-muted">Wir richten uns nach Ihnen.</p>
      <div className="mt-4">
        <RadioCardGroup
          name="timeframe"
          ariaLabel="Zeitfenster auswählen"
          value={state.timeframe}
          onValueChange={onSelect}
          options={TIMEFRAMES}
          cols={1}
        />
        {state.errors.timeframe && (
          <p className="mt-2 text-sm text-red-600">{state.errors.timeframe}</p>
        )}
      </div>
    </div>
  );
}
