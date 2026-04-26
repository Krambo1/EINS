import { Card, CardContent } from "@eins/ui";
import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import type {
  AiCategoryDistribution,
  FunnelBucket,
} from "@/server/queries/admin";
import { Donut } from "../_charts/Donut";
import { FunnelBar } from "../_charts/FunnelBar";

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad" | "accent"> = {
  neu: "neutral",
  qualifiziert: "accent",
  termin_vereinbart: "accent",
  beratung_erschienen: "warn",
  gewonnen: "good",
  verloren: "bad",
  spam: "neutral",
};

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function PipelineSection({
  funnel,
  ai,
}: {
  funnel: FunnelBucket[];
  ai: AiCategoryDistribution;
}) {
  const aiSlices = [
    { name: "Sehr heiß", value: ai.hot, color: "var(--tone-bad)" },
    { name: "Warm", value: ai.warm, color: "var(--tone-warn)" },
    { name: "Kalt", value: ai.cold, color: "var(--tone-neutral)" },
    { name: "Ungescort", value: ai.unscored, color: "var(--bg-tertiary)" },
  ].filter((s) => s.value > 0);
  const aiTotal = ai.hot + ai.warm + ai.cold + ai.unscored;

  return (
    <Card className={GLOW_CARD}>
      <CardContent className="space-y-6 pt-6">
        <header>
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
            Lead-Pipeline
          </span>
          <h2 className="mt-1 font-display text-2xl font-semibold">
            Funnel · 30 Tage
          </h2>
        </header>
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-xl border border-border bg-bg-primary/40 p-4">
            <FunnelBar
              stages={funnel.map((b) => ({
                label: REQUEST_STATUS_LABELS[b.status] ?? b.status,
                count: b.count,
                tone: STATUS_TONE[b.status] ?? "neutral",
              }))}
            />
          </div>
          <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
            <div className="mb-1 px-2 text-xs text-fg-secondary">
              KI-Score · 30 Tage
            </div>
            <Donut
              slices={aiSlices}
              centerLabel={aiTotal}
              centerSubLabel="Anfragen"
              height={200}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
