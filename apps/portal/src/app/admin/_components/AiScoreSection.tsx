import { formatNumber } from "@/lib/formatting";
import type { AiCategoryDistribution } from "@/server/queries/admin";

/**
 * KI-Bewertung: the AI lead-score distribution as one bar per category (one
 * hue each, same scale). Rendered inside the Anfragen panel next to the
 * status breakdown (see PipelineSection), which owns the time window.
 */
export function AiScoreList({ ai }: { ai: AiCategoryDistribution }) {
  const rows = [
    { name: "Sehr heiß", value: ai.hot, color: "var(--tone-bad)" },
    { name: "Warm", value: ai.warm, color: "var(--tone-warn)" },
    { name: "Kalt", value: ai.cold, color: "var(--tone-neutral)" },
    { name: "Ohne Bewertung", value: ai.unscored, color: "var(--fg-tertiary)" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <ul className="space-y-3" aria-label="KI-Bewertung der Anfragen">
      {rows.map((r) => (
        <li key={r.name}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-fg-primary">{r.name}</span>
            <span className="font-medium tabular-nums text-fg-primary">{formatNumber(r.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-bg-secondary">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, background: r.color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
