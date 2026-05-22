/**
 * Shared types for the anomaly-scan rule library.
 *
 * Each rule is a pure async function `(clinicId, db) => AlertCandidate[]`.
 * The scan worker collects candidates from all rules, optionally enriches
 * the `aiEnrich`-flagged ones, then upserts into `dashboard_alerts` keyed
 * on `(clinicId, dedupeKey)`.
 */

export type AlertSeverity = "info" | "warn" | "high" | "extreme";

export interface AlertCandidate {
  /** Stable slug, e.g. "no_show_spike", "cpl_surge", "lead_drought". */
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  /**
   * Rule-provided default action steps (German). Empty array means no
   * action is required; the widget shows the alert headline but no
   * action section.
   */
  defaultActionSteps: string[];
  /**
   * True ONLY when the situation is "wirklich außergewöhnlich" (extreme
   * severity, multi-signal coincidence) AND the rule's default action
   * steps would be too generic. The scan worker calls the LLM enricher
   * only for `true` candidates; everything else stays purely rule-based.
   */
  aiEnrich: boolean;
  /** Metric id for the widget chart link (optional). */
  metric?: string;
  baselineValue?: number;
  observedValue?: number;
  /** Stable across re-detections, e.g. `cpl_surge:meta`. */
  dedupeKey: string;
}
