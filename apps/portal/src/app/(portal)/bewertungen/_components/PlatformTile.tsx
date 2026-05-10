"use client";

import Link from "next/link";
import { Star, ExternalLink } from "lucide-react";
import { Badge, TrendChart } from "@eins/ui";
import { formatNumber, formatRelative } from "@/lib/formatting";
import type { ReviewSnapshot, ReviewTrendRow } from "@/server/queries/reviews";
import {
  platformLabelNode,
  publicProfileUrl,
  type Platform,
} from "../_lib/platforms";

export function PlatformTile({
  platform,
  snapshot,
  trend,
  clinicName,
}: {
  platform: Platform;
  snapshot: ReviewSnapshot | null;
  trend: ReviewTrendRow[];
  clinicName: string;
}) {
  const profileUrl = publicProfileUrl(platform, clinicName);
  const trendData = trend.map((r) => ({
    date: new Date(r.recordedAt).toISOString().slice(0, 10),
    value: r.rating,
  }));

  return (
    <div className="flex flex-col rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
            {platformLabelNode(platform)}
          </div>
          {snapshot ? (
            <div className="mt-2 flex items-baseline gap-1.5 font-display text-3xl font-semibold tabular-nums">
              {snapshot.rating.toFixed(1).replace(".", ",")}
              <Star className="h-5 w-5 text-tone-warn" />
            </div>
          ) : (
            <div className="mt-2 font-display text-3xl font-semibold tabular-nums text-fg-tertiary">
              –
            </div>
          )}
          {snapshot ? (
            <div className="mt-1 text-sm text-fg-secondary">
              {formatNumber(snapshot.totalCount)} Bewertungen
            </div>
          ) : (
            <div className="mt-1 text-sm text-fg-tertiary">Noch keine Daten</div>
          )}
        </div>
        {snapshot && (
          <Badge tone="neutral">{formatRelative(snapshot.recordedAt)}</Badge>
        )}
      </div>

      {trendData.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-secondary">
            6-Monats-Trend
          </div>
          <TrendChart
            data={trendData}
            tone="good"
            height={48}
            label="Ø Bewertung"
            formatValue={(v) => v.toFixed(2).replace(".", ",") + " ★"}
          />
        </div>
      )}

      {profileUrl && (
        <Link
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          Profil öffnen
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
