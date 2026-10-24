"use client";

import { useState } from "react";
import { Input } from "@eins/ui";

const MODE_LABELS = {
  auto: "Automatisch aus Ihrer PVS",
  fixed: "Fester Abstand",
  off: "Nicht im Kalender",
} as const;

type Mode = keyof typeof MODE_LABELS;

/** Mode select for one treatment; the months field only shows for "Fester Abstand". */
export function TreatmentModeField({
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
    <div className="flex flex-wrap items-center gap-3">
      <select
        name={`mode_${id}`}
        value={current}
        onChange={(e) => setCurrent(e.target.value as Mode)}
        aria-label={`Einstellung für ${name}`}
        className="h-11 rounded-xl border border-border bg-bg-primary px-3 text-base"
      >
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </select>
      <label className={current === "fixed" ? "flex items-center gap-2 text-base" : "hidden"}>
        alle
        <Input
          name={`months_${id}`}
          type="number"
          min={1}
          max={36}
          step={1}
          defaultValue={intervalMonths ?? ""}
          aria-label={`Fester Abstand in Monaten für ${name}`}
          className="w-20"
        />
        Monate
      </label>
    </div>
  );
}
