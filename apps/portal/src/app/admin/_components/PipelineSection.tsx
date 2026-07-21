import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { REQUEST_STATUS_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/formatting";
import { SegmentedShareBar } from "@/app/_components/SegmentedShareBar";
import { SHARE_TONE_VAR, type ShareTone } from "@/lib/share-tone";
import { TimeRangeToggle } from "@/app/_components/TimeRangeToggle";
import { ADMIN_RANGE_KEYS, type DashboardRange } from "@/lib/dashboard-range";
import type { FunnelBucket } from "@/server/queries/admin";

const STATUS_TONE: Record<string, ShareTone> = {
  neu: "neutral",
  termin_vereinbart: "accent",
  beratung_erschienen: "warn",
  gewonnen: "good",
  verloren: "bad",
  spam: "neutral",
};

/**
 * Anfragen-Pipeline — the status distribution rendered through the shared segmented
 * share bar (the same visual as the clinic's Quellen-Aufschlüsselung), directly
 * on the card surface (no inner boxes). Owns its own time window via the
 * rPipeline switcher. The KI-Bewertung lives in its own card alongside this one
 * (see AiScoreSection).
 */
export function PipelineSection({
  funnel,
  funnelRange,
}: {
  funnel: FunnelBucket[];
  funnelRange: DashboardRange;
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
    <Card
      className="flex h-full flex-col print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader>
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          Anfragen-Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-medium text-fg-secondary">
                Status-Verteilung
              </span>
              <span className="font-display text-lg font-semibold tabular-nums text-fg-primary">
                {formatNumber(totalLeads)}
              </span>
            </div>
            <TimeRangeToggle
              value={funnelRange}
              paramKey={ADMIN_RANGE_KEYS.pipeline}
              ariaLabel="Zeitraum für Status-Verteilung"
            />
          </div>
          <SegmentedShareBar
            segments={segments}
            ariaLabel={`Status-Verteilung: ${formatNumber(totalLeads)} Anfragen`}
            valueFormat="number"
          />
          {segments.length > 0 ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {segments.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: SHARE_TONE_VAR[s.tone] }}
                    aria-hidden
                  />
                  <span className="text-fg-primary">{s.label}</span>
                  <span className="tabular-nums text-fg-secondary">
                    {formatNumber(s.value)}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-secondary">
              Keine Anfragen im Zeitraum.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
