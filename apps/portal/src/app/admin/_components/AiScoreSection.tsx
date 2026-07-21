import { Card, CardContent, CardHeader, CardTitle, Donut } from "@eins/ui";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { ADMIN_RANGE_KEYS, type DashboardRange } from "@/lib/dashboard-range";
import type { AiCategoryDistribution } from "@/server/queries/admin";

/**
 * KI-Bewertung — the AI lead-score distribution as a donut on its own card so
 * it sits beside the Anfragen-Pipeline instead of stacked inside it. Owns its own
 * time window via the rAi switcher.
 */
export function AiScoreSection({
  ai,
  aiRange,
}: {
  ai: AiCategoryDistribution;
  aiRange: DashboardRange;
}) {
  const aiSlices = [
    { name: "Sehr heiß", value: ai.hot, color: "var(--tone-bad)" },
    { name: "Warm", value: ai.warm, color: "var(--tone-warn)" },
    { name: "Kalt", value: ai.cold, color: "var(--tone-neutral)" },
    { name: "Ungescort", value: ai.unscored, color: "var(--bg-tertiary)" },
  ].filter((s) => s.value > 0);
  const aiTotal = ai.hot + ai.warm + ai.cold + ai.unscored;

  return (
    <Card
      className="flex h-full flex-col print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          KI-Bewertung
        </CardTitle>
        <TimeRangeToggle
          value={aiRange}
          paramKey={ADMIN_RANGE_KEYS.ai}
          ariaLabel="Zeitraum für KI-Bewertung"
        />
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center">
        <Donut
          slices={aiSlices}
          centerLabel={aiTotal}
          centerSubLabel="Anfragen"
          height={200}
          ariaLabel="KI-Bewertung der Anfragen"
        />
      </CardContent>
    </Card>
  );
}
