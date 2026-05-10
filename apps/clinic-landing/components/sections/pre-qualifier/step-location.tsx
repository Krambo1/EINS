"use client";

import { Input } from "@/components/ui/input";
import type { Treatment } from "@/lib/types";
import type { QuizAction, QuizState } from "./types";

interface Props {
  treatment: Treatment;
  state: QuizState;
  dispatch: React.Dispatch<QuizAction>;
}

export function StepLocation({ treatment, state, dispatch }: Props) {
  return (
    <div className="step-enter">
      <h3 className="text-xl font-semibold text-brand-fg sm:text-2xl">
        {treatment.quiz.locationLabel}
      </h3>
      <p className="mt-1 text-brand-fg-muted">
        Wir bestätigen den Standort kurz, damit wir Ihnen passende Termine vorschlagen können.
      </p>
      <div className="mt-5">
        <Input
          label="Stadt"
          value={state.city}
          onChange={(e) => dispatch({ type: "set", field: "city", value: e.target.value })}
          placeholder={treatment.city}
          autoComplete="address-level2"
          inputMode="text"
          required
          error={state.errors.city}
        />
      </div>
    </div>
  );
}
