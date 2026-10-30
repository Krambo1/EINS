import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/formatting";
import { SegmentedShareBar } from "@/app/_components/SegmentedShareBar";
import { SHARE_TONE_VAR, type ShareTone } from "@/lib/share-tone";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { ADMIN_RANGE_KEYS, type DashboardRange } from "@/lib/dashboard-range";
import type { AiCategoryDistribution, FunnelBucket } from "@/server/queries/admin";
import { AiScoreList } from "./AiScoreSection";
import { Panel } from "./Panel";

const STATUS_TONE: Record<string, ShareTone> = {
  neu: "neutral",
  termin_vereinbart: "accent",
  beratung_erschienen: "warn",
  gewonnen: "good",
  verloren: "bad",
  spam: "neutral",
};

/**
 * Anfragen im gewählten Zeitraum, two ways: by status (the shared segmented
 * share bar, the same visual as the clinic's Quellen) and by KI-Bewertung.
 * Both describe the same Anfragen, so they share one panel, one count and one
 * time switch (rPipeline).
 *
 * lg: the two lists sit on thirds. With the panel's px-4, gap-x-12 puts each
 * column's text exactly on the text edge of the thirds panels above (Garantie-
 * Uhr | Rückruf-Lage, the number tiles), so the page reads as one grid.
 */
export function PipelineSection({
  funnel,
  ai,
  range,
}: {
  funnel: FunnelBucket[];
  ai: AiCategoryDistribution;
  range: DashboardRange;
}) {
  const totalLeads = funnel.reduce((s, b) => s + b.count, 0);
  const segments = funnel
    .filter((b) => b.count > 0)
    .map((b) => ({
      key: b.status,
      label: REQUEST_STATUS_LABELS[b.status] ?? b.status,
      value: b.count,
      tone: STATUS_TONE[b.status] ?? "neutral",
    }));

  return (
    <Panel
      title="Anfragen"
      count={totalLeads}
      action={
        <TimeRangeToggle
          value={range}
          paramKey={ADMIN_RANGE_KEYS.pipeline}
          ariaLabel="Zeitraum für Anfragen"
        />
      }
      bodyClassName="px-4 pb-4 pt-2"
    >
      {segments.length === 0 ? (
        // No empty bar outline and no rows of 0: one sentence says it.
        <p className="text-sm text-fg-secondary">Keine Anfragen im Zeitraum.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3 lg:gap-x-12">
          <section className="min-w-0 space-y-3 lg:col-span-2">
            <h3 className="text-sm font-medium text-fg-primary">Status</h3>
            <SegmentedShareBar
              segments={segments}
              ariaLabel={`Status-Verteilung: ${formatNumber(totalLeads)} Anfragen`}
              valueFormat="number"
            />
            <ul className="divide-y divide-border">
              {segments.map((s) => (
                <li key={s.key} className="flex items-center gap-2 py-2 text-sm">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: SHARE_TONE_VAR[s.tone] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 text-fg-primary">{s.label}</span>
                  <span className="w-10 text-right font-medium tabular-nums text-fg-primary">
                    {formatNumber(s.value)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="min-w-0 space-y-3">
            <h3 className="text-sm font-medium text-fg-primary">KI-Bewertung</h3>
            <AiScoreList ai={ai} />
          </section>
        </div>
      )}
    </Panel>
  );
}
