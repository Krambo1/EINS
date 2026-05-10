"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import { TIMEFRAMES, type QuizAction, type QuizState } from "./types";

interface Props {
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
}

export function StepTimeframe({ state, dispatch }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-xl font-semibold text-brand-fg sm:text-2xl">
        Wann hätten Sie gerne den ersten Termin?
      </h3>
      <p className="mt-1 text-brand-fg-muted">
        Wir richten uns nach Ihnen. Kein Druck.
      </p>
      <div className="mt-5">
        <RadioCardGroup
          name="timeframe"
          ariaLabel="Zeitfenster auswählen"
          value={state.timeframe}
          onValueChange={(v) => {
            dispatch({ type: "set", field: "timeframe", value: v });
            // The "info-only" branch routes through a shorter path.
            dispatch({ type: "branch", value: v === "info-only" ? "info-only" : "qualified" });
          }}
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
