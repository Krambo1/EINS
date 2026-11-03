"use client";

import { useState } from "react";
import { cn } from "@eins/ui";
import { INTERVAL_MODE_LABELS } from "../_lib/labels";
import { FIELD } from "../_lib/sizes";
import { Select } from "./settings-ui";

type Mode = keyof typeof INTERVAL_MODE_LABELS;

/**
 * The choice of one row in "Abstand je Behandlung", the same form fields as
 * `wiederbehandlungen/TreatmentModeField` (`mode_<id>`, `months_<id>`), in
 * the card's controls. The months field shows only for "Fester Abstand"
 * (hidden, it still posts its value, as before); "Monate" stands inside the
 * field (Stripe's amount fields), so both fit one line at 390.
 */
export function IntervalField({
  id,
  name,
  mode,
  intervalMonths,
}: {
  id: string;
  name: string;
  mode: Mode;
  intervalMonths: number | null;
}) {
  const [current, setCurrent] = useState<Mode>(mode);
  return (
    <div className="flex items-center gap-2 lg:w-[22rem] lg:shrink-0">
      <Select
        name={`mode_${id}`}
        value={current}
        onChange={(e) => setCurrent(e.target.value as Mode)}
        aria-label={`Einstellung für ${name}`}
        className="min-w-0 flex-1"
      >
        {(Object.keys(INTERVAL_MODE_LABELS) as Mode[]).map((m) => (
          <option key={m} value={m}>
            {INTERVAL_MODE_LABELS[m]}
          </option>
        ))}
      </Select>
      <label className={cn("relative w-[7.5rem] shrink-0", current !== "fixed" && "hidden")}>
        <input
          name={`months_${id}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={36}
          step={1}
          defaultValue={intervalMonths ?? ""}
          aria-label={`Fester Abstand in Monaten für ${name}`}
          className={cn(FIELD, "pr-16 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none")}
        />
        <span aria-hidden className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-fg-secondary">
          Monate
        </span>
      </label>
    </div>
  );
}
