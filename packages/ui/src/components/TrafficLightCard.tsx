import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Circle } from "lucide-react";
import { cn } from "../lib/cn";
import type { MetricTone } from "./SimpleMetric";

const toneConfig: Record<
  MetricTone,
  { Icon: React.ComponentType<{ className?: string }>; label: string; card: string }
> = {
  good: {
    Icon: CheckCircle2,
    label: "Läuft gut",
    card: "opa-card opa-card--good",
  },
  warn: {
    Icon: AlertTriangle,
    label: "Beobachten",
    card: "opa-card opa-card--warn",
  },
  bad: {
    Icon: XCircle,
    label: "Wir sollten sprechen",
    card: "opa-card opa-card--bad",
  },
  neutral: {
    Icon: Circle,
    label: "Neutral",
    card: "opa-card opa-card--neutral",
  },
};

export interface TrafficLightCardProps {
  tone: MetricTone;
  /** Override the default Zustandsetikett ("Läuft gut" etc.) */
  toneLabel?: string;
  /** Short headline */
  title: string;
  /** Diagnose-Satz — one sentence, Klartext-Deutsch */
  diagnosis: string;
  /** Optional action node — usually a <PrimaryAction> or <Button> */
  action?: React.ReactNode;
  /** Tighter padding + smaller icon/text. Use in dense layouts (Detail-Mode dashboard). */
  compact?: boolean;
  className?: string;
}

/**
 * TrafficLightCard — Ampel-Karte (grün/gelb/rot + neutral).
 *
 * Design rules (plan §3.1 #5):
 *  • Grün = läuft gut · Gelb = beobachten · Rot = "Wir sollten sprechen"
 *  • Kein Balkendiagramm-Overkill. Einfache Diagnose.
 */
export function TrafficLightCard({
  tone,
  toneLabel,
  title,
  diagnosis,
  action,
  compact,
  className,
}: TrafficLightCardProps) {
  const cfg = toneConfig[tone];
  const Icon = cfg.Icon;

  return (
    <div className={cn(cfg.card, compact && "opa-card--compact", className)}>
      <div className={cn("flex items-start", compact ? "gap-3" : "gap-4")}>
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-full",
            compact ? "h-8 w-8" : "h-12 w-12",
            tone === "good" && "bg-tone-good text-white",
            tone === "warn" && "bg-tone-warn text-white",
            tone === "bad" && "bg-tone-bad text-white",
            tone === "neutral" && "bg-tone-neutral text-white"
          )}
          aria-hidden="true"
        >
          <Icon className={compact ? "h-4 w-4" : "h-6 w-6"} />
        </div>
        <div className={cn("min-w-0 flex-1", compact ? "space-y-0.5" : "space-y-1")}>
          <p
            className={cn(
              "font-semibold uppercase tracking-wide text-fg-secondary",
              compact ? "text-[11px]" : "text-sm"
            )}
          >
            {toneLabel ?? cfg.label}
          </p>
          <h3
            className={cn(
              "text-fg-primary",
              compact ? "text-[15px] font-semibold leading-snug" : "opa-h3"
            )}
          >
            {title}
          </h3>
          <p className={compact ? "text-[13px] text-fg-primary leading-snug" : "opa-body"}>
            {diagnosis}
          </p>
        </div>
      </div>
      {action && (
        <div className={cn("flex justify-end", compact ? "mt-2" : "mt-5")}>
          {action}
        </div>
      )}
    </div>
  );
}
