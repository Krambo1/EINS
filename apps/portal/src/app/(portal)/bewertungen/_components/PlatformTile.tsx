"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, Copy, ExternalLink, Minus } from "lucide-react";
import { Button, TrendChart, cn } from "@eins/ui";
import { formatDate, formatNumber } from "@/lib/formatting";
import type { ReviewSnapshot, ReviewTrendRow } from "@/server/queries/reviews";
import { CONTROL, DashCard, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { showActionFlash } from "../../_components/flash-event";
import {
  platformLabelNode,
  publicProfileUrl,
  replyButtonLabel,
  replyLinkUrl,
  type ClinicReviewLinks,
  type Platform,
} from "../_lib/platforms";
import { TOP_CARD_HEIGHT } from "../_lib/sizes";
import { CardLink, FeedbackStars } from "./feedback-ui";

/** The Kennzahl lines of the Übersicht (KpiTiles), in EINS mint. */
const LINE_STYLE = {
  curve: "straight",
  strokeWidth: 2,
  lineGradient: { top: "var(--line-top)", bottom: "var(--line-bottom)" },
  tooltip: "compact",
} as const;

const rating1 = (v: number) => v.toFixed(1).replace(".", ",");

/**
 * One platform as a Kennzahl tile (Triple Whale's tile): logo and name with
 * the change beside it, the rating as the big number, a plain line of the
 * stands along the bottom, and the two ways to the platform as raised
 * buttons in the tile they belong to.
 *
 * Under the rating, how many reviews came in since the stand before
 * (Trustify's trend line on every tile). In the header the review link to
 * copy for patients (Google Business Profile's "Get more reviews").
 *
 * One height whatever the data (DESIGN.md section 10): without a stand the
 * number's row says so and links to the setup, with a single stand the
 * second line says when the comparison starts and the line's box keeps a
 * grey rule. The line is scaled to its values like Triple Whale's tile
 * lines; drawn from 0 a move from 4,3 to 4,7 read as a flat line. Its hover
 * card shows the real rating.
 */
export function PlatformTile({
  platform,
  snapshot,
  trend,
  countChange,
  shareUrl,
  clinicName,
  reviewLinks,
  className,
}: {
  platform: Platform;
  snapshot: ReviewSnapshot | null;
  trend: ReviewTrendRow[];
  /** Reviews added since the stand before the latest; null with one stand. */
  countChange: { added: number; since: Date } | null;
  /** The patients' review link (`reviewShareUrl`), null until it is set. */
  shareUrl: string | null;
  clinicName: string;
  reviewLinks: ClinicReviewLinks;
  className?: string;
}) {
  const profileUrl = publicProfileUrl(platform, clinicName);
  const replyUrl = replyLinkUrl(platform, clinicName, reviewLinks);
  const replyLabel = replyButtonLabel(platform) ?? "Antworten";

  const values = trend.map((r) => r.rating);
  // The chart's axis starts at 0, so the line is drawn above a base one
  // range (at least 0,2) under its lowest value: 4,3 to 4,7 then climbs
  // through the box instead of lying flat at its top.
  const lo = values.length > 1 ? Math.min(...values) : 0;
  const hi = values.length > 1 ? Math.max(...values) : 0;
  const base = values.length > 1 ? Math.max(0, lo - Math.max(hi - lo, 0.2)) : 0;
  const line = trend.map((r) => ({
    date: new Date(r.recordedAt).toISOString().slice(0, 10),
    value: r.rating - base,
  }));
  const first = trend[0];
  const change = trend.length > 1 && snapshot ? snapshot.rating - first!.rating : null;

  return (
    <DashCard
      title={platformLabelNode(platform)}
      titleExtra={change != null && <RatingChange change={change} since={first!.recordedAt} />}
      action={
        shareUrl ? (
          <CopyLinkButton url={shareUrl} platform={platform} />
        ) : (
          <CardLink href="/einstellungen#bewertungen">Link hinterlegen</CardLink>
        )
      }
      className={cn("flex flex-col", TOP_CARD_HEIGHT, className)}
      bodyClassName="flex min-h-0 flex-1 flex-col"
    >
      {snapshot ? (
        <>
          <div className="flex h-10 items-center gap-2.5">
            <span className="text-[1.75rem] font-semibold leading-10 tracking-tight tabular-nums text-fg-primary md:text-[2rem]">
              {rating1(snapshot.rating)}
            </span>
            <FeedbackStars rating={snapshot.rating} size={18} />
          </div>
          <p className="mt-1 h-5 text-sm leading-5 text-fg-secondary">
            <span className="tabular-nums">{formatNumber(snapshot.totalCount)}</span> Bewertungen, Stand{" "}
            <span className="tabular-nums">{formatDate(snapshot.recordedAt)}</span>
          </p>
          <p className="mt-0.5 h-5 text-sm leading-5 text-fg-secondary">
            {countChange == null ? (
              "Vergleich ab dem nächsten Stand."
            ) : countChange.added > 0 ? (
              <>
                <span className="font-medium tabular-nums text-tone-good">+{formatNumber(countChange.added)}</span> seit{" "}
                <span className="tabular-nums">{formatDate(countChange.since)}</span>
              </>
            ) : (
              <>
                Keine neuen seit <span className="tabular-nums">{formatDate(countChange.since)}</span>
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <p className="flex h-10 items-center text-[15px] text-fg-primary">Noch kein Stand erfasst.</p>
          <p className="mt-1 h-5 text-sm leading-5">
            <Link
              href="/einstellungen#bewertungen"
              className="font-medium text-fg-primary underline underline-offset-4 hover:text-accent"
            >
              In den Einstellungen verbinden
            </Link>
          </p>
          <p aria-hidden className="mt-0.5 h-5" />
        </>
      )}

      {/* The line's box, the same height with or without a line. */}
      <div className="mt-4 flex min-h-0 flex-1 items-end">
        {line.length > 1 ? (
          <div className="h-16 w-full">
            <TrendChart
              data={line}
              tone="good"
              height={64}
              filled={false}
              label="Bewertung"
              formatValue={(v) => rating1(v + base)}
              {...LINE_STYLE}
            />
          </div>
        ) : (
          <div aria-hidden className="flex h-16 w-full items-end">
            <span className="block h-0.5 w-full rounded-full bg-[var(--border-hover)]" />
          </div>
        )}
      </div>

      <div className="mt-4 grid shrink-0 grid-cols-2 gap-2">
        <TileButton href={profileUrl} label="Profil öffnen" ariaLabel={`${platformName(platform)}-Profil öffnen`} />
        <TileButton href={replyUrl} label="Antworten" ariaLabel={replyLabel} />
      </div>
    </DashCard>
  );
}

function platformName(p: Platform): string {
  return p === "google" ? "Google" : "Jameda";
}

/** Change of the rating over the line's months, as coloured text (no pill). */
function RatingChange({ change, since }: { change: number; since: Date }) {
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = rating1(Math.abs(change));
  const sinceText = `seit ${formatDate(since)}`;
  return (
    <span
      className={cn(
        "ml-1 inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-sm font-medium leading-none tabular-nums",
        flat ? "text-fg-secondary" : up ? "text-tone-good" : "text-tone-bad"
      )}
      title={sinceText}
      aria-label={`${flat ? "unverändert" : `${up ? "+" : "−"}${text} Sterne`} ${sinceText}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {text}
    </span>
  );
}

/**
 * One tap copies the patients' review link; the toast confirms and carries
 * the platforms' rule against rewards. Keeps its label and width, only the
 * icon turns into a tick for a moment.
 */
function CopyLinkButton({ url, platform }: { url: string; platform: Platform }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
      showActionFlash({
        tone: "good",
        title: `${platformName(platform)}-Bewertungslink kopiert`,
        // Every patient, never only the satisfied ones: asking selectively
        // for good reviews is review gating (Google's policy, vault E-22).
        description: "Geben Sie ihn an Ihre Patienten weiter. Bitte bieten Sie dafür keine Gegenleistung an.",
      });
    } catch {
      showActionFlash({
        tone: "bad",
        title: "Nicht kopiert",
        description: "Ihr Browser hat das Kopieren nicht erlaubt. Den Link finden Sie in den Einstellungen.",
      });
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${platformName(platform)}-Bewertungslink kopieren`}
      className="inline-flex items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-tone-good" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      Link kopieren
    </button>
  );
}

/** A way to the platform: raised, opens in a new tab. */
function TileButton({ href, label, ariaLabel }: { href: string | null; label: string; ariaLabel: string }) {
  const cls = cn(RAISED_CONTROL, CONTROL, "w-full px-3");
  if (!href) {
    return (
      <Button variant="outline" disabled className={cls} title="Kein Praxisname hinterlegt">
        {label}
        <ExternalLink className="h-4 w-4" aria-hidden />
      </Button>
    );
  }
  return (
    <Button asChild variant="outline" className={cls}>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={ariaLabel}>
        {label}
        <ExternalLink className="h-4 w-4" aria-hidden />
      </a>
    </Button>
  );
}
