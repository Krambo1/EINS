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
  className,
}: TrafficLightCardProps) {
  const cfg = toneConfig[tone];
  const Icon = cfg.Icon;

  return (
    <div className={cn(cfg.card, className)}>
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-full",
            tone === "good" && "bg-tone-good text-white",
            tone === "warn" && "bg-tone-warn text-white",
            tone === "bad" && "bg-tone-bad text-white",
            tone === "neutral" && "bg-tone-neutral text-white"
          )}
          aria-hidden="true"
        >
          <Icon className="h-6 w-6" />
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold uppercase tracking-wide text-fg-secondary">
            {toneLabel ?? cfg.label}
          </p>
          <h3 className="opa-h3 text-fg-primary">{title}</h3>
          <p className="opa-body">{diagnosis}</p>
        </div>
      </div>
      {action && <div className="mt-5 flex justify-end">{action}</div>}
    </div>
  );
}
