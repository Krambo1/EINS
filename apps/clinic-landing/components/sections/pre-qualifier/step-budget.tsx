"use client";

import { RadioCardGroup } from "@/components/ui/radio-card-group";
import { formatFromPrice } from "@/lib/format";
import type { Treatment } from "@/lib/types";
import { BUDGET_OPTIONS, type QuizState } from "./types";

interface Props {
  treatment: Treatment;
  state: QuizState;
  onSelect: (value: string) => void;
}

/**
 * Investment gate (OP-level flows only). Anchors the entry price early so
 * unqualified traffic self-selects into the info branch instead of burning
 * a Beratungstermin — and qualified patients arrive without price shock.
 */
export function StepBudget({ treatment, state, onSelect }: Props) {
  const anchor = formatFromPrice(treatment.priceRange);
  return (
    <div className="step-enter">
      <h3 className="text-lg font-semibold text-brand-fg sm:text-xl">
        Die Behandlung beginnt bei uns ab ca. {anchor}.
      </h3>
      <p className="mt-1 text-sm text-brand-fg-muted">
        Passt das grundsätzlich in Ihren Rahmen? Den genauen Preis erhalten Sie nach der Beratung.
      </p>
      <div className="mt-4">
        <RadioCardGroup
          name="budget"
          ariaLabel="Investitionsrahmen auswählen"
          value={state.budget}
          onValueChange={onSelect}
          options={BUDGET_OPTIONS}
          cols={1}
        />
        {state.errors.budget && (
          <p className="mt-2 text-sm text-red-600">{state.errors.budget}</p>
        )}
      </div>
    </div>
  );
}
